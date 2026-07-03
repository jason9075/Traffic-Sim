import { describe, expect, test } from 'bun:test';

import { buildNetwork } from '../src/geometry/network';
import { splitPolyline, polylineLength, polylineIntersections } from '../src/geometry/polyline';
import { emptyScene, type Anchor, type GeoPoint, type Road, type Scene } from '../src/model/types';

/** 以台北市中心為基準,把公尺偏移轉成經緯度(測試用) */
const BASE: GeoPoint = { lng: 121.5654, lat: 25.033 };
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320 * Math.cos((BASE.lat * Math.PI) / 180);

function geo(xMeters: number, yMeters: number): GeoPoint {
  return { lng: BASE.lng + xMeters / M_PER_DEG_LNG, lat: BASE.lat + yMeters / M_PER_DEG_LAT };
}

function anchor(x: number, y: number): Anchor {
  return { p: geo(x, y), hIn: null, hOut: null };
}

function straightRoad(id: string, from: [number, number], to: [number, number], opts?: Partial<Road>): Road {
  return {
    id,
    kind: 'road',
    path: { anchors: [anchor(...from), anchor(...to)] },
    lanesForward: 1,
    lanesBackward: 1,
    speedLimit: 50,
    ...opts,
  };
}

function sceneWith(roads: Road[]): Scene {
  const s = emptyScene('test');
  s.roads = roads;
  return s;
}

describe('polyline utils', () => {
  test('splitPolyline 在中點切一刀', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const parts = splitPolyline(pts, [50]);
    expect(parts.length).toBe(2);
    expect(polylineLength(parts[0]!)).toBeCloseTo(50, 5);
    expect(polylineLength(parts[1]!)).toBeCloseTo(50, 5);
  });

  test('polylineIntersections 找到十字交點', () => {
    const a = [{ x: -50, y: 0 }, { x: 50, y: 0 }];
    const b = [{ x: 0, y: -50 }, { x: 0, y: 50 }];
    const hits = polylineIntersections(a, b);
    expect(hits.length).toBe(1);
    expect(hits[0]!.sA).toBeCloseTo(50, 5);
    expect(hits[0]!.sB).toBeCloseTo(50, 5);
  });
});

describe('buildNetwork', () => {
  test('一條雙向直路 → 2 節點、2 條有向邊', () => {
    const net = buildNetwork(sceneWith([straightRoad('r1', [-100, 0], [100, 0])]));
    expect(net.nodes.length).toBe(2);
    expect(net.edges.length).toBe(2);
    expect(net.edges[0]!.length).toBeCloseTo(200, 0);
    // 速限 50 km/h → 13.9 m/s
    expect(net.edges[0]!.speedLimit).toBeCloseTo(50 / 3.6, 2);
  });

  test('單行道 → 只有 1 條有向邊', () => {
    const net = buildNetwork(
      sceneWith([straightRoad('r1', [-100, 0], [100, 0], { lanesBackward: 0 })])
    );
    expect(net.edges.length).toBe(1);
  });

  test('十字路口 → 5 節點、8 條有向邊', () => {
    const net = buildNetwork(
      sceneWith([
        straightRoad('ew', [-100, 0], [100, 0]),
        straightRoad('ns', [0, -100], [0, 100]),
      ])
    );
    // 中心 1 + 四端 4
    expect(net.nodes.length).toBe(5);
    // 4 臂 × 雙向
    expect(net.edges.length).toBe(8);
  });

  test('T 字路口(端點接到中段)→ 4 節點、6 條有向邊', () => {
    const net = buildNetwork(
      sceneWith([
        straightRoad('main', [-100, 0], [100, 0]),
        straightRoad('branch', [0, 2], [0, 100]), // 端點離主線 2m,應被 snap
      ])
    );
    expect(net.nodes.length).toBe(4);
    expect(net.edges.length).toBe(6);
  });

  test('雙向邊靠右偏移,兩方向的中心線不同', () => {
    const net = buildNetwork(sceneWith([straightRoad('r1', [-100, 0], [100, 0])]));
    const [fwd, back] = net.edges;
    // 沿 +x 行進向右偏移 → y 為負;反向 → y 為正
    expect(fwd!.pts[1]!.y).toBeLessThan(0);
    expect(back!.pts[1]!.y).toBeGreaterThan(0);
  });

  test('紅綠燈與 spawn 吸附到節點', () => {
    const s = sceneWith([
      straightRoad('ew', [-100, 0], [100, 0]),
      straightRoad('ns', [0, -100], [0, 100]),
    ]);
    s.lights.push({
      id: 'L1', kind: 'light', at: geo(5, 5), timing: { green: 40, yellow: 3, allRed: 2 },
    });
    s.spawns.push({
      id: 'S1', kind: 'spawn', at: geo(-105, 3), vehiclesPerHour: 300, pedsPerHour: 60,
    });
    const net = buildNetwork(s);
    const lit = net.nodes.filter((n) => n.lightId === 'L1');
    expect(lit.length).toBe(1);
    // 吸到中心節點(離 (5,5) 最近)
    expect(Math.hypot(lit[0]!.pos.x, lit[0]!.pos.y)).toBeLessThan(6);
    expect(net.spawns.length).toBe(1);
    const spawnNode = net.nodes[net.spawns[0]!.nodeId]!;
    expect(spawnNode.pos.x).toBeLessThan(-90);
  });
});
