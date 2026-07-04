import { describe, expect, test } from 'bun:test';

import { allLaneEnds, laneDirectionsConflict } from '../src/geometry/laneConnections';
import {
  emptyScene,
  type Anchor,
  type GeoPoint,
  type LaneDirection,
  type Road,
  type Scene,
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
function road(
  id: string,
  from: [number, number],
  to: [number, number],
  laneDirections: LaneDirection[] = ['forward']
): Road {
  return {
    id,
    kind: 'road',
    path: { anchors: [anchor(...from), anchor(...to)] },
    lanes: laneDirections.length,
    laneDirections,
    speedLimit: 50,
  };
}
function sceneWith(roads: Road[]): Scene {
  const s = emptyScene('test');
  s.roads = roads;
  return s;
}

describe('allLaneEnds', () => {
  test('每條路每個車道都展開出頭尾兩個端點', () => {
    const scene = sceneWith([road('a', [-100, 0], [100, 0], ['forward', 'backward'])]);
    const ends = allLaneEnds(scene);
    expect(ends.length).toBe(4);
    expect(ends.filter((e) => e.lane === 0).map((e) => e.end).sort()).toEqual(['head', 'tail']);
    expect(ends.filter((e) => e.lane === 1).map((e) => e.end).sort()).toEqual(['head', 'tail']);
    expect(ends.every((e) => e.roadId === 'a')).toBe(true);
  });

  test('多條路的端點各自獨立列出', () => {
    const scene = sceneWith([road('a', [-100, 0], [0, 0]), road('b', [0, 0], [100, 0])]);
    const ends = allLaneEnds(scene);
    expect(ends.length).toBe(4);
    expect(new Set(ends.map((e) => e.roadId))).toEqual(new Set(['a', 'b']));
  });

  test('沒有路時回傳空陣列', () => {
    expect(allLaneEnds(sceneWith([]))).toEqual([]);
  });

  test('端點的 direction 對應該車道目前的標籤', () => {
    const scene = sceneWith([road('a', [-100, 0], [100, 0], ['both'])]);
    const ends = allLaneEnds(scene);
    expect(ends.every((e) => e.direction === 'both')).toBe(true);
  });
});

describe('laneDirectionsConflict', () => {
  test('去向對來向(不論順序)衝突', () => {
    expect(laneDirectionsConflict('forward', 'backward')).toBe(true);
    expect(laneDirectionsConflict('backward', 'forward')).toBe(true);
  });

  test('同方向不衝突', () => {
    expect(laneDirectionsConflict('forward', 'forward')).toBe(false);
    expect(laneDirectionsConflict('backward', 'backward')).toBe(false);
  });

  test('雙向跟任何標籤都不衝突', () => {
    expect(laneDirectionsConflict('both', 'forward')).toBe(false);
    expect(laneDirectionsConflict('both', 'backward')).toBe(false);
    expect(laneDirectionsConflict('forward', 'both')).toBe(false);
    expect(laneDirectionsConflict('both', 'both')).toBe(false);
  });
});
