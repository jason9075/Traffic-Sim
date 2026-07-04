import { describe, expect, test } from 'bun:test';

import { groupRoadSidewalkIntersections } from '../src/geometry/intersections';
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

describe('groupRoadSidewalkIntersections', () => {
  test('人行道橫跨馬路 → 兩者同一群組', () => {
    const scene = sceneWith(
      [road('r1', [-100, 0], [100, 0])],
      [sidewalk('sw1', [0, -50], [0, 50])]
    );
    const groups = groupRoadSidewalkIntersections(scene);
    expect(groups.length).toBe(1);
    expect(groups[0]!.roadIds).toEqual(['r1']);
    expect(groups[0]!.sidewalkIds).toEqual(['sw1']);
  });

  test('沒有交集的人行道與馬路不分組', () => {
    const scene = sceneWith(
      [road('r1', [-100, 0], [100, 0])],
      [sidewalk('sw1', [-100, 50], [100, 50])]
    );
    expect(groupRoadSidewalkIntersections(scene)).toEqual([]);
  });

  test('一條人行道跨兩條馬路 → 三者連通成同一群組', () => {
    const scene = sceneWith(
      [road('r1', [-100, -20], [100, -20]), road('r2', [-100, 20], [100, 20])],
      [sidewalk('sw1', [0, -50], [0, 50])]
    );
    const groups = groupRoadSidewalkIntersections(scene);
    expect(groups.length).toBe(1);
    expect(groups[0]!.roadIds.sort()).toEqual(['r1', 'r2']);
    expect(groups[0]!.sidewalkIds).toEqual(['sw1']);
  });
});
