import { describe, expect, test } from 'bun:test';

import { deriveCrosswalks } from '../src/geometry/crosswalks';
import { emptyScene, type Anchor, type GeoPoint, type Road, type Scene, type Sidewalk } from '../src/model/types';

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
    lanesForward: 1,
    lanesBackward: 1,
    speedLimit: 50,
  };
}
function sidewalk(id: string, from: [number, number], to: [number, number]): Sidewalk {
  return { id, kind: 'sidewalk', path: { anchors: [anchor(...from), anchor(...to)] } };
}
function sceneWith(roads: Road[], sidewalks: Sidewalk[]): Scene {
  const s = emptyScene('test');
  s.roads = roads;
  s.sidewalks = sidewalks;
  return s;
}
function distMeters(a: GeoPoint, b: GeoPoint): number {
  const dx = (a.lng - b.lng) * M_PER_DEG_LNG;
  const dy = (a.lat - b.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

describe('deriveCrosswalks', () => {
  test('人行道垂直穿過馬路 → 產生一段跨越路寬的斑馬線', () => {
    const scene = sceneWith(
      [road('r1', [-100, 0], [100, 0])],
      [sidewalk('sw1', [0, -50], [0, 50])]
    );
    const derived = deriveCrosswalks(scene);
    expect(derived.length).toBe(1);
    const { crosswalk, sidewalkId } = derived[0]!;
    expect(sidewalkId).toBe('sw1');
    // 雙向道路(2 車道 x 3.2m = 6.4m 寬)→ 斑馬線長度應接近路寬
    const len = distMeters(crosswalk.a, crosswalk.b);
    expect(len).toBeGreaterThan(5);
    expect(len).toBeLessThan(8);
  });

  test('人行道沒有跨越馬路 → 不產生斑馬線', () => {
    const scene = sceneWith(
      [road('r1', [-100, 0], [100, 0])],
      [sidewalk('sw1', [-100, 50], [100, 50])]
    );
    expect(deriveCrosswalks(scene)).toEqual([]);
  });

  test('一條人行道穿過兩條馬路 → 產生兩段斑馬線', () => {
    const scene = sceneWith(
      [road('r1', [-100, -30], [100, -30]), road('r2', [-100, 30], [100, 30])],
      [sidewalk('sw1', [0, -50], [0, 50])]
    );
    const derived = deriveCrosswalks(scene);
    expect(derived.length).toBe(2);
    expect(derived.map((d) => d.crosswalk.id).length).toBe(new Set(derived.map((d) => d.crosswalk.id)).size);
  });

  test('沒有馬路或沒有人行道時回傳空陣列', () => {
    expect(deriveCrosswalks(sceneWith([], [sidewalk('sw1', [0, -50], [0, 50])]))).toEqual([]);
    expect(deriveCrosswalks(sceneWith([road('r1', [-100, 0], [100, 0])], []))).toEqual([]);
  });
});
