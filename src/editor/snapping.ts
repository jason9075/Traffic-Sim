/**
 * 畫路/人行道時,靠近既有道路或人行道(端點或路徑中段)會提示可延伸連接的吸附點,
 * 中段吸附讓使用者可以從既有道路拉出 T 字路口分支。
 * 端點吸附優先權高於中段吸附:只要在端點容差內,一律鎖定端點本身的原始座標,
 * 不會被路徑中段搜尋(數值上可能有極小誤差)搶走,確保接龍時座標完全重合。
 * 獨立成模組是為了同時給 editor.ts(實際吸附落點)與 render.ts(hover 提示)使用,
 * 兩者互相 import 會造成循環依賴,所以這裡不依賴 render.ts 的 project()。
 */

import type maplibregl from 'maplibre-gl';

import { dist, nearestPointOnCubic, type CubicSegment, type Vec2 } from '../geometry/bezier';
import type { Anchor, GeoPoint, Scene } from '../model/types';

const ENDPOINT_SNAP_PX = 14;
const PATH_SNAP_PX = 10;

export interface PathSnap {
  point: GeoPoint;
  /** 'endpoint' = 鎖定既有路徑頭尾點;'path' = 吸附到路徑中段(T 字路口分支) */
  kind: 'endpoint' | 'path';
}

function project(map: maplibregl.Map, g: GeoPoint): Vec2 {
  const p = map.project([g.lng, g.lat]);
  return { x: p.x, y: p.y };
}

function unproject(map: maplibregl.Map, p: Vec2): GeoPoint {
  const ll = map.unproject([p.x, p.y]);
  return { lng: ll.lng, lat: ll.lat };
}

function toSegments(map: maplibregl.Map, anchors: Anchor[]): CubicSegment[] {
  const segs: CubicSegment[] = [];
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    segs.push({
      p0: project(map, a.p),
      c1: project(map, a.hOut ?? a.p),
      c2: project(map, b.hIn ?? b.p),
      p3: project(map, b.p),
    });
  }
  return segs;
}

/** 找出離 screen 最近、在容許誤差內的既有道路/人行道吸附點(端點優先,其次路徑中段) */
export function findPathSnap(
  map: maplibregl.Map,
  scene: Scene,
  screen: Vec2,
  excludeId?: string
): PathSnap | null {
  const elements = [...scene.roads, ...scene.sidewalks].filter((el) => el.id !== excludeId);

  let bestEndpoint: { point: GeoPoint; d: number } | null = null;
  for (const el of elements) {
    const anchors = el.path.anchors;
    if (anchors.length === 0) continue;
    for (const a of [anchors[0]!, anchors[anchors.length - 1]!]) {
      const d = dist(project(map, a.p), screen);
      if (d < ENDPOINT_SNAP_PX && (bestEndpoint === null || d < bestEndpoint.d)) {
        bestEndpoint = { point: a.p, d };
      }
    }
  }
  if (bestEndpoint !== null) return { point: bestEndpoint.point, kind: 'endpoint' };

  let bestPath: { point: GeoPoint; d: number } | null = null;
  for (const el of elements) {
    for (const seg of toSegments(map, el.path.anchors)) {
      const near = nearestPointOnCubic(seg, screen);
      if (near.distance < PATH_SNAP_PX && (bestPath === null || near.distance < bestPath.d)) {
        bestPath = { point: unproject(map, near.point), d: near.distance };
      }
    }
  }
  return bestPath === null ? null : { point: bestPath.point, kind: 'path' };
}
