/**
 * 畫路/人行道時,靠近既有道路或人行道端點會提示可延伸連接的吸附點。
 * 獨立成模組是為了同時給 editor.ts(實際吸附落點)與 render.ts(hover 提示)使用,
 * 兩者互相 import 會造成循環依賴,所以這裡不依賴 render.ts 的 project()。
 */

import type maplibregl from 'maplibre-gl';

import { dist, type Vec2 } from '../geometry/bezier';
import type { GeoPoint, Scene } from '../model/types';

const ENDPOINT_SNAP_PX = 14;

function project(map: maplibregl.Map, g: GeoPoint): Vec2 {
  const p = map.project([g.lng, g.lat]);
  return { x: p.x, y: p.y };
}

/** 找出離 screen 最近、在容許誤差內的既有道路/人行道端點(起點或終點) */
export function findEndpointSnap(
  map: maplibregl.Map,
  scene: Scene,
  screen: Vec2,
  excludeId?: string
): GeoPoint | null {
  let best: { point: GeoPoint; d: number } | null = null;
  for (const el of [...scene.roads, ...scene.sidewalks]) {
    if (el.id === excludeId) continue;
    const anchors = el.path.anchors;
    if (anchors.length === 0) continue;
    for (const a of [anchors[0]!, anchors[anchors.length - 1]!]) {
      const d = dist(project(map, a.p), screen);
      if (d < ENDPOINT_SNAP_PX && (best === null || d < best.d)) {
        best = { point: a.p, d };
      }
    }
  }
  return best === null ? null : best.point;
}
