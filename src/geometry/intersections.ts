/**
 * 人行道與馬路的幾何交集分組。純函式,不寫回 Scene,
 * 供之後行人路徑規劃需要「這段人行道緊鄰哪些馬路」時即時計算。
 */

import { pathToPolyline } from './network';
import { polylineIntersections } from './polyline';
import { centroidOf, createProjection } from './projection';
import type { Scene } from '../model/types';

export interface IntersectionGroup {
  id: string;
  roadIds: string[];
  sidewalkIds: string[];
}

/** 依道路與人行道路徑的幾何交點,把有交集的元素分成連通群組 */
export function groupRoadSidewalkIntersections(scene: Scene): IntersectionGroup[] {
  const items: Array<{ kind: 'road' | 'sidewalk'; id: string }> = [
    ...scene.roads.map((r) => ({ kind: 'road' as const, id: r.id })),
    ...scene.sidewalks.map((s) => ({ kind: 'sidewalk' as const, id: s.id })),
  ];
  if (items.length === 0) return [];

  const allPoints = [
    ...scene.roads.flatMap((r) => r.path.anchors.map((a) => a.p)),
    ...scene.sidewalks.flatMap((s) => s.path.anchors.map((a) => a.p)),
  ];
  const proj = createProjection(centroidOf(allPoints));

  const lines = [
    ...scene.roads.map((r) => pathToPolyline(r.path, proj)),
    ...scene.sidewalks.map((s) => pathToPolyline(s.path, proj)),
  ];

  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i]!;
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const roadCount = scene.roads.length;
  for (let i = 0; i < roadCount; i++) {
    for (let j = roadCount; j < items.length; j++) {
      if (polylineIntersections(lines[i]!, lines[j]!).length > 0) union(i, j);
    }
  }

  const groups = new Map<number, IntersectionGroup>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    // 只保留有跟其他元素連通(root 底下 >1 個成員)的群組
    const connected = items.some((_, k) => k !== i && find(k) === root);
    if (!connected) continue;
    let group = groups.get(root);
    if (group === undefined) {
      group = { id: `xg_${root}`, roadIds: [], sidewalkIds: [] };
      groups.set(root, group);
    }
    const item = items[i]!;
    if (item.kind === 'road') group.roadIds.push(item.id);
    else group.sidewalkIds.push(item.id);
  }

  return [...groups.values()];
}
