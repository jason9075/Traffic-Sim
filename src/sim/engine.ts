/**
 * 微觀交通模擬引擎:IDM 跟車 + fixed-time 號誌 + Poisson 進車。
 * 不碰 DOM,可在 Worker 或測試中直接使用。
 */

import type { Network, NetEdge } from '../geometry/network';
import { outgoingEdges } from '../geometry/network';
import { pointAt } from '../geometry/polyline';
import type { SignalTiming } from '../model/types';
import { expSample, mulberry32, type Rng } from './rng';
import { shortestRoute } from './routing';
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
  private readonly plans: SignalPlan[];
  private readonly rng: Rng;

  time = 0;
  vehicles: SimVehicle[] = [];
  private nextVehicleId = 1;
  private completedCount = 0;
  private travelSum = 0;
  private delaySum = 0;

  /** 各 spawn 的下次到達時間 */
  private nextArrival: Map<string, number> = new Map();
  private pending: PendingSpawn[] = [];
  private signalCache: SignalState[] = [];

  constructor(net: Network, timings: ReadonlyMap<string, SignalTiming>, seed = 12345) {
    this.net = net;
    this.plans = buildSignalPlans(net, timings);
    this.rng = mulberry32(seed);
    for (const sp of net.spawns) {
      if (sp.vehiclesPerHour > 0) {
        this.nextArrival.set(sp.spawnId, expSample(this.rng, sp.vehiclesPerHour / 3600));
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
    };
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
