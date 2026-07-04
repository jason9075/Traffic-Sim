import { describe, expect, test } from 'bun:test';

import { buildNetwork } from '../src/geometry/network';
import { SimEngine } from '../src/sim/engine';
import { emptyScene, type Anchor, type GeoPoint, type Road, type Scene, type SignalTiming } from '../src/model/types';

const BASE: GeoPoint = { lng: 121.5654, lat: 25.033 };
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320 * Math.cos((BASE.lat * Math.PI) / 180);

function geo(x: number, y: number): GeoPoint {
  return { lng: BASE.lng + x / M_PER_DEG_LNG, lat: BASE.lat + y / M_PER_DEG_LAT };
}
function anchor(x: number, y: number): Anchor {
  return { p: geo(x, y), hIn: null, hOut: null };
}
function road(id: string, from: [number, number], to: [number, number]): Road {
  return {
    id,
    kind: 'road',
    path: { anchors: [anchor(...from), anchor(...to)] },
    lanes: 1,
    laneDirections: ['forward'],
    speedLimit: 50,
  };
}

function runFor(engine: SimEngine, seconds: number, dt = 0.1): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) engine.step(dt);
}

/** 1km 直路(雙向,各自反向拉一條路),兩端各一個 spawn */
function straightScene(vph: number): Scene {
  const s = emptyScene('t');
  s.roads = [road('r1', [-500, 0], [500, 0]), road('r1_back', [500, 0], [-500, 0])];
  s.spawns = [
    { id: 'A', kind: 'spawn', at: geo(-500, 0), vehiclesPerHour: vph, pedsPerHour: 0 },
    { id: 'B', kind: 'spawn', at: geo(500, 0), vehiclesPerHour: vph, pedsPerHour: 0 },
  ];
  return s;
}

describe('SimEngine', () => {
  test('無號誌直路:車輛完成旅次且延滯趨近零', () => {
    const net = buildNetwork(straightScene(360));
    const engine = new SimEngine(net, new Map(), 42);
    runFor(engine, 600);
    const st = engine.stats();
    expect(st.completed).toBeGreaterThan(30);
    // 1km @ 50km/h ≈ 72s 自由流;延滯應該很小
    expect(st.avgTravel).toBeGreaterThan(60);
    expect(st.avgDelay).toBeLessThan(10);
  });

  test('紅燈排隊、綠燈消散', () => {
    const scene = straightScene(600);
    scene.roads.push(road('cross', [0, -200], [0, 200]));
    const timing: SignalTiming = { green: 30, yellow: 3, allRed: 2 };
    scene.lights.push({ id: 'L1', kind: 'light', at: geo(0, 0), timing });
    const net = buildNetwork(scene);
    const timings = new Map([['L1', timing]]);
    const engine = new SimEngine(net, timings, 42);

    // 跑幾個週期,追蹤停等車數的最大值
    let maxStopped = 0;
    let sawFullDischarge = false;
    const dt = 0.1;
    for (let t = 0; t < 300; t += dt) {
      engine.step(dt);
      const stopped = engine.stats().stopped;
      maxStopped = Math.max(maxStopped, stopped);
      if (maxStopped >= 3 && stopped === 0) sawFullDischarge = true;
    }
    // 紅燈期間應該有車排隊
    expect(maxStopped).toBeGreaterThanOrEqual(3);
    // 綠燈後隊伍應完全消散過至少一次
    expect(sawFullDischarge).toBe(true);
    // 有號誌 → 平均延滯明顯大於無號誌
    expect(engine.stats().avgDelay).toBeGreaterThan(3);
  });

  test('號誌路口不會有車輛闖紅燈通過停止線太多', () => {
    const scene = straightScene(600);
    scene.roads.push(road('cross', [0, -200], [0, 200]));
    const timing: SignalTiming = { green: 20, yellow: 3, allRed: 2 };
    scene.lights.push({ id: 'L1', kind: 'light', at: geo(0, 0), timing });
    const net = buildNetwork(scene);
    const engine = new SimEngine(net, new Map([['L1', timing]]), 7);

    const dt = 0.1;
    for (let t = 0; t < 200; t += dt) {
      engine.step(dt);
      // 檢查每台紅燈進向的車:速度大的不該出現在停止線 2m 內
      for (const st of engine.signals()) {
        for (const veh of engine.vehicles) {
          const edgeId = veh.route[veh.routeIdx]!;
          const color = st.colors.get(edgeId);
          if (color !== 'red') continue;
          const edge = engine.net.edges[edgeId]!;
          const gapToStop = edge.length - veh.s;
          if (gapToStop < 2 && gapToStop > 0) {
            expect(veh.v).toBeLessThan(3);
          }
        }
      }
    }
  });

  test('確定性:同 seed 兩次結果一致', () => {
    const net = buildNetwork(straightScene(400));
    const e1 = new SimEngine(net, new Map(), 99);
    const e2 = new SimEngine(net, new Map(), 99);
    runFor(e1, 120);
    runFor(e2, 120);
    expect(e1.stats()).toEqual(e2.stats());
  });
});
