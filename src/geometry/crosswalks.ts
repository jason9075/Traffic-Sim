/**
 * 斑馬線自動生成:人行道與馬路的路徑幾何交叉處,自動產生一段跨越馬路兩側路緣的
 * 斑馬線,取代手動鋪設斑馬線的工具。
 *
 * 人行道進出馬路範圍(兩側路緣)的兩點也一併回傳,讓 pednet 把人行道落在馬路內的
 * 那段路徑捨棄(改由斑馬線通行),避免行人能沿著人行道原路徑直接「穿越」馬路而
 * 不受紅綠燈管制。
 */

import { offsetPolyline, polylineIntersections } from './polyline';
import { LANE_WIDTH_M, pathToPolyline } from './network';
import { centroidOf, createProjection } from './projection';
import type { Crosswalk, GeoPoint, Scene } from '../model/types';

export interface DerivedCrosswalk {
  crosswalk: Crosswalk;
  /** 產生此斑馬線的人行道 id,供切割該人行道用 */
  sidewalkId: string;
  /** 人行道進、出馬路兩側路緣的地理座標(用來切開人行道並捨棄中間落在馬路內的路段) */
  sidewalkCuts: [GeoPoint, GeoPoint];
}

/** 從 Scene 目前的道路與人行道幾何交點,推導出所有斑馬線 */
export function deriveCrosswalks(scene: Scene): DerivedCrosswalk[] {
  if (scene.roads.length === 0 || scene.sidewalks.length === 0) return [];

  const allPoints = [
    ...scene.roads.flatMap((r) => r.path.anchors.map((a) => a.p)),
    ...scene.sidewalks.flatMap((s) => s.path.anchors.map((a) => a.p)),
  ];
  const proj = createProjection(centroidOf(allPoints));

  const roadLines = scene.roads.map((road) => ({ road, pts: pathToPolyline(road.path, proj) }));
  const sidewalkLines = scene.sidewalks.map((sidewalk) => ({
    sidewalk,
    pts: pathToPolyline(sidewalk.path, proj),
  }));

  const derived: DerivedCrosswalk[] = [];
  for (const { road, pts: roadPts } of roadLines) {
    const halfWidthM = (road.lanes * LANE_WIDTH_M) / 2;
    const edgeNear = offsetPolyline(roadPts, halfWidthM);
    const edgeFar = offsetPolyline(roadPts, -halfWidthM);

    for (const { sidewalk, pts: swPts } of sidewalkLines) {
      const hitsNear = polylineIntersections(swPts, edgeNear).sort((x, y) => x.sA - y.sA);
      const hitsFar = polylineIntersections(swPts, edgeFar).sort((x, y) => x.sA - y.sA);
      const pairCount = Math.min(hitsNear.length, hitsFar.length);
      for (let k = 0; k < pairCount; k++) {
        const enter = hitsNear[k]!;
        const exit = hitsFar[k]!;
        derived.push({
          crosswalk: {
            id: `cw_${road.id}_${sidewalk.id}_${derived.length}`,
            kind: 'crosswalk',
            a: proj.toGeo(enter.point),
            b: proj.toGeo(exit.point),
          },
          sidewalkId: sidewalk.id,
          sidewalkCuts: [proj.toGeo(enter.point), proj.toGeo(exit.point)],
        });
      }
    }
  }
  return derived;
}
