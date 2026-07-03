/**
 * 行人路網:人行道 + 斑馬線 → undirected graph(以成對有向邊表示)。
 * 斑馬線端點會吸附並切割人行道;斑馬線記錄它跨越的車道邊,
 * 供模擬判斷紅綠燈通行權。
 */

import type { Vec2 } from './bezier';
import { pathToPolyline, type Network } from './network';
import {
  nearestOnPolyline,
  polylineIntersections,
  polylineLength,
  reversePolyline,
  splitPolyline,
  segmentIntersection,
} from './polyline';
import { createProjection } from './projection';
import type { Scene } from '../model/types';

const SNAP_M = 6;
/** 斑馬線端點找人行道的吸附半徑 */
const CROSSWALK_SNAP_M = 15;
const SPAWN_SNAP_M = 80;

export interface PedNode {
  id: number;
  pos: Vec2;
}

export interface PedEdge {
  id: number;
  from: number;
  to: number;
  pts: Vec2[];
  length: number;
  kind: 'walk' | 'cross';
  /** kind='cross' 時:跨越的車道 edge id(用於號誌通行權) */
  crossEdgeIds: number[];
  /** kind='cross' 時:來源斑馬線元素 id */
  crosswalkId: string | null;
}

export interface PedSpawnBinding {
  spawnId: string;
  nodeId: number;
  pedsPerHour: number;
}

export interface PedNetwork {
  nodes: PedNode[];
  edges: PedEdge[];
  spawns: PedSpawnBinding[];
}

/** 從 Scene 建行人路網。net 提供投影原點與車道邊(斑馬線衝突判斷)。 */
export function buildPedNetwork(scene: Scene, net: Network): PedNetwork {
  const proj = createProjection(net.origin);

  const walkLines = scene.sidewalks.map((sw) => ({
    id: sw.id,
    pts: pathToPolyline(sw.path, proj),
  }));
  const crossSegs = scene.crosswalks.map((cw) => ({
    id: cw.id,
    a: proj.toLocal(cw.a),
    b: proj.toLocal(cw.b),
  }));

  // 1. 人行道之間的交點 + 斑馬線端點的吸附點 → 切割位置
  const cuts: number[][] = walkLines.map(() => []);
  for (let i = 0; i < walkLines.length; i++) {
    for (let j = i + 1; j < walkLines.length; j++) {
      for (const h of polylineIntersections(walkLines[i]!.pts, walkLines[j]!.pts)) {
        cuts[i]!.push(h.sA);
        cuts[j]!.push(h.sB);
      }
    }
  }
  // 斑馬線端點吸附:記住每端要接到的座標(人行道上的最近點)
  const endAnchors: Array<{ a: Vec2; b: Vec2 }> = [];
  for (const cs of crossSegs) {
    const snapped = { a: cs.a, b: cs.b };
    for (const key of ['a', 'b'] as const) {
      let best: { line: number; s: number; point: Vec2; d: number } | null = null;
      for (let i = 0; i < walkLines.length; i++) {
        const near = nearestOnPolyline(walkLines[i]!.pts, cs[key]);
        if (near.distance < CROSSWALK_SNAP_M && (best === null || near.distance < best.d)) {
          best = { line: i, s: near.s, point: near.point, d: near.distance };
        }
      }
      if (best !== null) {
        cuts[best.line]!.push(best.s);
        snapped[key] = best.point;
      }
    }
    endAnchors.push(snapped);
  }

  // 2. 建節點與邊
  const nodes: PedNode[] = [];
  const findOrCreateNode = (p: Vec2): number => {
    for (const n of nodes) {
      if (Math.hypot(n.pos.x - p.x, n.pos.y - p.y) < SNAP_M) return n.id;
    }
    nodes.push({ id: nodes.length, pos: p });
    return nodes.length - 1;
  };

  const edges: PedEdge[] = [];
  const addPair = (
    pts: Vec2[],
    kind: 'walk' | 'cross',
    crossEdgeIds: number[],
    crosswalkId: string | null
  ): void => {
    const length = polylineLength(pts);
    if (length < 1) return;
    const from = findOrCreateNode(pts[0]!);
    const to = findOrCreateNode(pts[pts.length - 1]!);
    if (from === to) return;
    edges.push({ id: edges.length, from, to, pts, length, kind, crossEdgeIds, crosswalkId });
    edges.push({
      id: edges.length,
      from: to,
      to: from,
      pts: reversePolyline(pts),
      length,
      kind,
      crossEdgeIds,
      crosswalkId,
    });
  };

  for (let i = 0; i < walkLines.length; i++) {
    for (const part of splitPolyline(walkLines[i]!.pts, cuts[i]!)) {
      addPair(part, 'walk', [], null);
    }
  }

  // 3. 斑馬線邊:找出它跨越哪些車道邊
  for (let k = 0; k < crossSegs.length; k++) {
    const cs = crossSegs[k]!;
    const anchor = endAnchors[k]!;
    const crossEdgeIds: number[] = [];
    for (const e of net.edges) {
      let hit = false;
      for (let i = 1; i < e.pts.length && !hit; i++) {
        if (segmentIntersection(anchor.a, anchor.b, e.pts[i - 1]!, e.pts[i]!) !== null) {
          hit = true;
        }
      }
      if (hit) crossEdgeIds.push(e.id);
    }
    addPair([anchor.a, anchor.b], 'cross', crossEdgeIds, cs.id);
  }

  // 4. spawn 綁定(用行人流量)
  const spawns: PedSpawnBinding[] = [];
  for (const sp of scene.spawns) {
    if (sp.pedsPerHour <= 0) continue;
    const p = proj.toLocal(sp.at);
    let best: { node: PedNode; d: number } | null = null;
    for (const n of nodes) {
      const d = Math.hypot(n.pos.x - p.x, n.pos.y - p.y);
      if (d < SPAWN_SNAP_M && (best === null || d < best.d)) best = { node: n, d };
    }
    if (best !== null) {
      spawns.push({ spawnId: sp.id, nodeId: best.node.id, pedsPerHour: sp.pedsPerHour });
    }
  }

  return { nodes, edges, spawns };
}
