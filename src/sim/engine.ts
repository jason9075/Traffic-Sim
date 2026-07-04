/**
 * 微觀交通模擬引擎:IDM 跟車 + fixed-time 號誌 + Poisson 進車。
 * 不碰 DOM,可在 Worker 或測試中直接使用。
 */

import type { Network, NetEdge } from '../geometry/network';
import { outgoingEdges } from '../geometry/network';
import type { PedNetwork } from '../geometry/pednet';
import { pointAt } from '../geometry/polyline';
import type { SignalTiming } from '../model/types';
import { expSample, mulberry32, type Rng } from './rng';
import { shortestPath, shortestRoute } from './routing';
import { buildSignalPlans, evalSignals, type SignalPlan, type SignalState } from './signals';

/** IDM 參數(市區小客車) */
const IDM = {
  aMax: 1.8, // 最大加速度 m/s²
  bComf: 2.5, // 舒適減速度 m/s²
  s0: 2.0, // 靜止最小間距 m
  T: 1.2, // 期望車頭時距 s
  delta: 4,
} as const;

const VEHICLE_LEN = 4.5;
const STOP_LINE_BUFFER = 1.5;
/** 前方障礙搜尋距離 */
const LOOKAHEAD_M = 150;

export interface SimVehicle {
  id: number;
  route: number[];
  routeIdx: number;
  s: number;
  v: number;
  spawnTime: number;
  freeflowTime: number;
}

export interface SimStats {
  time: number;
  active: number;
  completed: number;
  /** 平均旅行時間(秒,已完成旅次) */
  avgTravel: number;
  /** 平均延滯(秒,實際 - 自由流) */
  avgDelay: number;
  /** 停等中車輛(v < 0.5 m/s) */
  stopped: number;
  /** 等待進入路網的車輛 */
  queuedAtSpawn: number;
  /** 行人:路上 / 完成 / 平均等待秒數 */
  activePeds: number;
  completedPeds: number;
  avgPedWait: number;
}

/** 行人速度範圍 m/s(平均約 1.3) */
const PED_SPEED_MIN = 1.0;
const PED_SPEED_MAX = 1.6;

export interface SimPed {
  id: number;
  route: number[];
  routeIdx: number;
  s: number;
  speed: number;
  spawnTime: number;
  totalWait: number;
  waiting: boolean;
}

export interface EdgeFlow {
  edgeId: number;
  /** 邊上車輛平均速度 / 速限(1 = 順暢,0 = 停死;無車 = 1) */
  speedRatio: number;
  count: number;
}

interface PendingSpawn {
  fromNode: number;
  scheduledAt: number;
}

export class SimEngine {
  readonly net: Network;
  readonly pedNet: PedNetwork | null;
  private readonly plans: SignalPlan[];
  private readonly rng: Rng;

  time = 0;
  vehicles: SimVehicle[] = [];
  peds: SimPed[] = [];
  private nextVehicleId = 1;
  private nextPedId = 1;
  private completedCount = 0;
  private travelSum = 0;
  private delaySum = 0;
  private completedPedCount = 0;
  private pedWaitSum = 0;

  /** 各 spawn 的下次到達時間 */
  private nextArrival: Map<string, number> = new Map();
  private nextPedArrival: Map<string, number> = new Map();
  private pending: PendingSpawn[] = [];
  private signalCache: SignalState[] = [];

  constructor(
    net: Network,
    timings: ReadonlyMap<string, SignalTiming>,
    seed = 12345,
    pedNet: PedNetwork | null = null,
    lightOffsets: ReadonlyMap<string, number> = new Map()
  ) {
    this.net = net;
    this.pedNet = pedNet;
    this.plans = buildSignalPlans(net, timings, lightOffsets);
    this.rng = mulberry32(seed);
    for (const sp of net.spawns) {
      if (sp.vehiclesPerHour > 0) {
        this.nextArrival.set(sp.spawnId, expSample(this.rng, sp.vehiclesPerHour / 3600));
      }
    }
    if (pedNet !== null) {
      for (const sp of pedNet.spawns) {
        this.nextPedArrival.set(sp.spawnId, expSample(this.rng, sp.pedsPerHour / 3600));
      }
    }
  }

  signals(): SignalState[] {
    return this.signalCache;
  }

  /** 前進一個 timestep */
  step(dt: number): void {
    this.time += dt;
    this.signalCache = evalSignals(this.plans, this.time);
    this.spawn();

    // 每條邊上的車輛(依 s 由大到小,索引 0 = 最前車)
    const byEdge = new Map<number, SimVehicle[]>();
    for (const v of this.vehicles) {
      const edgeId = v.route[v.routeIdx]!;
      const list = byEdge.get(edgeId);
      if (list === undefined) byEdge.set(edgeId, [v]);
      else list.push(v);
    }
    for (const list of byEdge.values()) list.sort((a, b) => b.s - a.s);

    const signalColor = (edgeId: number): 'green' | 'yellow' | 'red' | null => {
      for (const st of this.signalCache) {
        const c = st.colors.get(edgeId);
        if (c !== undefined) return c;
      }
      return null;
    };

    // 計算每台車的加速度
    const accels = new Map<number, number>();
    for (const veh of this.vehicles) {
      const edge = this.net.edges[veh.route[veh.routeIdx]!]!;
      let acc = this.idmFree(veh.v, edge.speedLimit);

      // 1. 前車(同邊或沿路徑往前找)
      const leader = this.findLeader(veh, byEdge);
      if (leader !== null) {
        acc = Math.min(acc, this.idmInteraction(veh.v, leader.gap, leader.dv, edge.speedLimit));
      }

      // 2. 邊尾端的號誌停止線
      const color = signalColor(edge.id);
      if (color !== null && color !== 'green') {
        const gap = edge.length - STOP_LINE_BUFFER - veh.s;
        // 黃燈:煞得住才停(舒適減速度可在停止線前停下)
        const canStop = gap > (veh.v * veh.v) / (2 * IDM.bComf);
        if (color === 'red' || canStop) {
          if (gap > 0.05) {
            acc = Math.min(acc, this.idmInteraction(veh.v, gap, veh.v, edge.speedLimit));
          } else if (veh.v < 0.5) {
            acc = Math.min(acc, 0);
          }
        }
      }
      accels.set(veh.id, acc);
    }

    // 更新速度與位置
    const done: SimVehicle[] = [];
    for (const veh of this.vehicles) {
      const acc = accels.get(veh.id)!;
      veh.v = Math.max(0, veh.v + acc * dt);
      veh.s += veh.v * dt;

      let edge = this.net.edges[veh.route[veh.routeIdx]!]!;
      while (veh.s >= edge.length) {
        // 紅燈防呆:數值誤差衝過停止線時鉗回
        if (veh.routeIdx + 1 >= veh.route.length) {
          done.push(veh);
          break;
        }
        veh.s -= edge.length;
        veh.routeIdx++;
        edge = this.net.edges[veh.route[veh.routeIdx]!]!;
      }
    }
    if (done.length > 0) {
      const doneIds = new Set(done.map((v) => v.id));
      this.vehicles = this.vehicles.filter((v) => !doneIds.has(v.id));
      for (const v of done) {
        const travel = this.time - v.spawnTime;
        this.completedCount++;
        this.travelSum += travel;
        this.delaySum += Math.max(0, travel - v.freeflowTime);
      }
    }

    this.stepPeds(dt);
  }

  /** 行人:走 → 到斑馬線口等紅燈 → 通過 */
  private stepPeds(dt: number): void {
    const pedNet = this.pedNet;
    if (pedNet === null) return;
    this.spawnPeds();

    const donePeds: SimPed[] = [];
    for (const ped of this.peds) {
      let edge = pedNet.edges[ped.route[ped.routeIdx]!]!;

      // 在斑馬線入口且有號誌管制 → 等所有被跨越的車道轉紅
      if (edge.kind === 'cross' && ped.s < 0.05 && !this.crossingAllowed(edge.crossEdgeIds)) {
        ped.totalWait += dt;
        ped.waiting = true;
        continue;
      }
      ped.waiting = false;
      ped.s += ped.speed * dt;

      while (ped.s >= edge.length) {
        if (ped.routeIdx + 1 >= ped.route.length) {
          donePeds.push(ped);
          break;
        }
        ped.s -= edge.length;
        ped.routeIdx++;
        edge = pedNet.edges[ped.route[ped.routeIdx]!]!;
        // 走到下一段是斑馬線且不能過 → 停在入口
        if (edge.kind === 'cross' && !this.crossingAllowed(edge.crossEdgeIds)) {
          ped.s = 0;
          break;
        }
      }
    }
    if (donePeds.length > 0) {
      const ids = new Set(donePeds.map((p) => p.id));
      this.peds = this.peds.filter((p) => !ids.has(p.id));
      for (const p of donePeds) {
        this.completedPedCount++;
        this.pedWaitSum += p.totalWait;
      }
    }
  }

  /** 斑馬線可通行:所有有號誌管制的被跨越車道都是紅燈 */
  private crossingAllowed(crossEdgeIds: readonly number[]): boolean {
    for (const edgeId of crossEdgeIds) {
      for (const st of this.signalCache) {
        const color = st.colors.get(edgeId);
        if (color !== undefined && color !== 'red') return false;
      }
    }
    return true;
  }

  private spawnPeds(): void {
    const pedNet = this.pedNet;
    if (pedNet === null) return;
    for (const sp of pedNet.spawns) {
      let next = this.nextPedArrival.get(sp.spawnId);
      while (next !== undefined && next <= this.time) {
        this.tryPlacePed(sp.nodeId, next);
        next = next + expSample(this.rng, sp.pedsPerHour / 3600);
      }
      if (next !== undefined) this.nextPedArrival.set(sp.spawnId, next);
    }
  }

  private tryPlacePed(fromNode: number, spawnTime: number): void {
    const pedNet = this.pedNet!;
    const destinations = pedNet.spawns.filter((s) => s.nodeId !== fromNode);
    if (destinations.length === 0) return;
    const dest = destinations[Math.floor(this.rng() * destinations.length)]!;
    const route = shortestPath(
      pedNet.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, cost: e.length })),
      fromNode,
      dest.nodeId
    );
    if (route === null) return;
    this.peds.push({
      id: this.nextPedId++,
      route: route.edgeIds,
      routeIdx: 0,
      s: 0,
      speed: PED_SPEED_MIN + this.rng() * (PED_SPEED_MAX - PED_SPEED_MIN),
      spawnTime,
      totalWait: 0,
      waiting: false,
    });
  }

  stats(): SimStats {
    return {
      time: this.time,
      active: this.vehicles.length,
      completed: this.completedCount,
      avgTravel: this.completedCount === 0 ? 0 : this.travelSum / this.completedCount,
      avgDelay: this.completedCount === 0 ? 0 : this.delaySum / this.completedCount,
      stopped: this.vehicles.filter((v) => v.v < 0.5).length,
      queuedAtSpawn: this.pending.length,
      activePeds: this.peds.length,
      completedPeds: this.completedPedCount,
      avgPedWait: this.avgPedWait(),
    };
  }

  /** 平均每位行人的累積等待(含仍在路上的行人) */
  private avgPedWait(): number {
    const total = this.completedPedCount + this.peds.length;
    if (total === 0) return 0;
    let sum = this.pedWaitSum;
    for (const p of this.peds) sum += p.totalWait;
    return sum / total;
  }

  /** 行人渲染快照:[x, y, waiting] × n */
  snapshotPedBuffer(): Float32Array {
    const pedNet = this.pedNet;
    const buf = new Float32Array(this.peds.length * 3);
    if (pedNet === null) return buf;
    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i]!;
      const edge = pedNet.edges[ped.route[ped.routeIdx]!]!;
      const { point } = pointAt(edge.pts, ped.s);
      buf[i * 3] = point.x;
      buf[i * 3 + 1] = point.y;
      buf[i * 3 + 2] = ped.waiting ? 1 : 0;
    }
    return buf;
  }

  /** 每條邊的流況(供 heatmap) */
  edgeFlows(): EdgeFlow[] {
    const sums = new Map<number, { v: number; n: number }>();
    for (const veh of this.vehicles) {
      const edgeId = veh.route[veh.routeIdx]!;
      const cur = sums.get(edgeId) ?? { v: 0, n: 0 };
      cur.v += veh.v;
      cur.n++;
      sums.set(edgeId, cur);
    }
    const out: EdgeFlow[] = [];
    for (const [edgeId, { v, n }] of sums) {
      const edge = this.net.edges[edgeId]!;
      out.push({ edgeId, speedRatio: Math.min(1, v / n / edge.speedLimit), count: n });
    }
    return out;
  }

  /** 車輛渲染快照:[x, y, angle, v] × n */
  snapshotBuffer(): Float32Array {
    const buf = new Float32Array(this.vehicles.length * 4);
    for (let i = 0; i < this.vehicles.length; i++) {
      const veh = this.vehicles[i]!;
      const edge = this.net.edges[veh.route[veh.routeIdx]!]!;
      const { point, dir } = pointAt(edge.pts, veh.s);
      buf[i * 4] = point.x;
      buf[i * 4 + 1] = point.y;
      buf[i * 4 + 2] = Math.atan2(dir.y, dir.x);
      buf[i * 4 + 3] = veh.v;
    }
    return buf;
  }

  // ---- private ----

  private idmFree(v: number, v0: number): number {
    return IDM.aMax * (1 - Math.pow(v / v0, IDM.delta));
  }

  private idmInteraction(v: number, gap: number, dv: number, v0: number): number {
    const safeGap = Math.max(0.1, gap);
    const sStar = IDM.s0 + v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.aMax * IDM.bComf));
    return (
      IDM.aMax * (1 - Math.pow(v / v0, IDM.delta) - Math.pow(Math.max(0, sStar) / safeGap, 2))
    );
  }

  /** 找同邊前車,或沿路徑往前 LOOKAHEAD_M 內的第一台車 */
  private findLeader(
    veh: SimVehicle,
    byEdge: ReadonlyMap<number, SimVehicle[]>
  ): { gap: number; dv: number } | null {
    const edgeId = veh.route[veh.routeIdx]!;
    const onEdge = byEdge.get(edgeId) ?? [];
    // 同邊上位置比我前面、且最近的車
    let best: SimVehicle | null = null;
    for (const other of onEdge) {
      if (other.id !== veh.id && other.s > veh.s && (best === null || other.s < best.s)) {
        best = other;
      }
    }
    if (best !== null) {
      return { gap: best.s - VEHICLE_LEN - veh.s, dv: veh.v - best.v };
    }
    // 往後續路徑的邊找
    let ahead = this.net.edges[edgeId]!.length - veh.s;
    for (let i = veh.routeIdx + 1; i < veh.route.length && ahead < LOOKAHEAD_M; i++) {
      const nextEdgeId = veh.route[i]!;
      const list = byEdge.get(nextEdgeId) ?? [];
      let tail: SimVehicle | null = null;
      for (const other of list) {
        if (tail === null || other.s < tail.s) tail = other;
      }
      if (tail !== null) {
        return { gap: ahead + tail.s - VEHICLE_LEN, dv: veh.v - tail.v };
      }
      ahead += this.net.edges[nextEdgeId]!.length;
    }
    return null;
  }

  private spawn(): void {
    // 到達時間到 → 進待命佇列
    for (const sp of this.net.spawns) {
      if (sp.vehiclesPerHour <= 0) continue;
      let next = this.nextArrival.get(sp.spawnId);
      while (next !== undefined && next <= this.time) {
        this.pending.push({ fromNode: sp.nodeId, scheduledAt: next });
        next = next + expSample(this.rng, sp.vehiclesPerHour / 3600);
      }
      if (next !== undefined) this.nextArrival.set(sp.spawnId, next);
    }

    // 嘗試放行待命車輛
    const stillPending: PendingSpawn[] = [];
    for (const p of this.pending) {
      const placed = this.tryPlaceVehicle(p);
      if (!placed) stillPending.push(p);
    }
    this.pending = stillPending;
  }

  private tryPlaceVehicle(p: PendingSpawn): boolean {
    const destinations = this.net.spawns.filter((s) => s.nodeId !== p.fromNode);
    if (destinations.length === 0) return false;
    const dest = destinations[Math.floor(this.rng() * destinations.length)]!;
    const route = shortestRoute(this.net, p.fromNode, dest.nodeId);
    if (route === null) return false;

    const firstEdge = this.net.edges[route.edgeIds[0]!]!;
    // 入口被佔住就等下一個 tick
    for (const veh of this.vehicles) {
      if (veh.route[veh.routeIdx] === firstEdge.id && veh.s < VEHICLE_LEN + IDM.s0) {
        return false;
      }
    }
    this.vehicles.push({
      id: this.nextVehicleId++,
      route: route.edgeIds,
      routeIdx: 0,
      s: 0,
      // 以 spawn 排定時間起算,入口壅塞的等待計入旅行時間
      spawnTime: p.scheduledAt,
      freeflowTime: route.freeflowTime,
      v: Math.min(firstEdge.speedLimit, 8),
    });
    return true;
  }
}

/** 由 outgoingEdges 保留的 re-export,供未來動態改道使用 */
export { outgoingEdges };
