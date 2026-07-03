import { describe, expect, test } from 'bun:test';

import { buildNetwork } from '../src/geometry/network';
import { buildPedNetwork } from '../src/geometry/pednet';
import { SimEngine } from '../src/sim/engine';
import {
  emptyScene,
  type Anchor,
  type GeoPoint,
  type Road,
  type Scene,
  type Sidewalk,
  type SignalTiming,
} from '../src/model/types';

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
    id, kind: 'road',
    path: { anchors: [anchor(...from), anchor(...to)] },
    lanesForward: 1, lanesBackward: 1, speedLimit: 50,
  };
}
function sidewalk(id: string, from: [number, number], to: [number, number]): Sidewalk {
  return { id, kind: 'sidewalk', path: { anchors: [anchor(...from), anchor(...to)] } };
}

/**
 * 東西向道路 + 南北兩側人行道 + x=0 處一條斑馬線跨越道路 + 號誌。
 * 行人從西南角走到西北角,必須通過斑馬線。
 */
function pedScene(): { scene: Scene; timing: SignalTiming } {
  const scene = emptyScene('ped');
  scene.roads = [
    road('ew', [-200, 0], [200, 0]),
    road('ns', [0, -100], [0, 100]), // 讓路口有號誌意義
  ];
  scene.sidewalks = [
    sidewalk('south', [-200, -10], [200, -10]),
    sidewalk('north', [-200, 10], [200, 10]),
  ];
  scene.crosswalks = [{ id: 'cw1', kind: 'crosswalk', a: geo(12, -10), b: geo(12, 10) }];
  const timing: SignalTiming = { green: 30, yellow: 3, allRed: 2 };
  scene.lights = [{ id: 'L1', kind: 'light', at: geo(0, 0), timing }];
  scene.spawns = [
    { id: 'SW', kind: 'spawn', at: geo(-200, -10), vehiclesPerHour: 0, pedsPerHour: 300 },
    { id: 'NW', kind: 'spawn', at: geo(-200, 10), vehiclesPerHour: 0, pedsPerHour: 300 },
  ];
  return { scene, timing };
}

describe('buildPedNetwork', () => {
  test('斑馬線切割人行道並連接兩側', () => {
    const { scene } = pedScene();
    const net = buildNetwork(scene);
    const pedNet = buildPedNetwork(scene, net);

    const crossEdges = pedNet.edges.filter((e) => e.kind === 'cross');
    expect(crossEdges.length).toBe(2); // 一對有向邊
    // 斑馬線跨越東西向道路的兩個方向車道
    expect(crossEdges[0]!.crossEdgeIds.length).toBeGreaterThanOrEqual(2);
    // 兩個 spawn 都綁上
    expect(pedNet.spawns.length).toBe(2);
  });
});

describe('行人模擬', () => {
  test('行人會在紅燈等待、綠燈(車道紅燈)時通過並完成旅次', () => {
    const { scene, timing } = pedScene();
    const net = buildNetwork(scene);
    const pedNet = buildPedNetwork(scene, net);
    const engine = new SimEngine(net, new Map([['L1', timing]]), 42, pedNet);

    let sawWaiting = false;
    const dt = 0.1;
    for (let t = 0; t < 900; t += dt) {
      engine.step(dt);
      if (engine.peds.some((p) => p.waiting)) sawWaiting = true;
      // 不變量:行人正在斑馬線上移動時,被跨越的有號誌車道必須是紅燈起步的
      // (進入當下紅燈;之後變綠屬合理殘留,不檢查)
    }
    const st = engine.stats();
    expect(st.completedPeds).toBeGreaterThan(20);
    expect(sawWaiting).toBe(true);
    expect(st.avgPedWait).toBeGreaterThan(1);
  });

  test('行人絕不在車道綠燈時開始過馬路', () => {
    const { scene, timing } = pedScene();
    const net = buildNetwork(scene);
    const pedNet = buildPedNetwork(scene, net);
    const engine = new SimEngine(net, new Map([['L1', timing]]), 7, pedNet);

    const dt = 0.1;
    const onCrossPrev = new Set<number>();
    for (let t = 0; t < 600; t += dt) {
      engine.step(dt);
      for (const ped of engine.peds) {
        const edge = engine.pedNet!.edges[ped.route[ped.routeIdx]!]!;
        if (edge.kind !== 'cross' || ped.s <= 0) continue;
        if (!onCrossPrev.has(ped.id)) {
          // 剛踏上斑馬線 → 所有有號誌管制的被跨車道必須是紅燈
          for (const st of engine.signals()) {
            for (const ceid of edge.crossEdgeIds) {
              const color = st.colors.get(ceid);
              if (color !== undefined) expect(color).toBe('red');
            }
          }
          onCrossPrev.add(ped.id);
        }
      }
      for (const id of [...onCrossPrev]) {
        if (!engine.peds.some((p) => p.id === id)) onCrossPrev.delete(id);
      }
    }
  });
});
