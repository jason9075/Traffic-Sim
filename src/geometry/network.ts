/**
 * Scene(使用者畫的 Bézier 路網)→ 模擬用 directed graph。
 * 全程使用局部平面公尺座標;所有函式皆為純函式。
 */

import { sampleCubicByArcLength, type CubicSegment, type Vec2 } from './bezier';
import {
  nearestOnPolyline,
  offsetPolyline,
  polylineIntersections,
  polylineLength,
  reversePolyline,
  splitPolyline,
} from './polyline';
import { centroidOf, createProjection, type LocalProjection } from './projection';
import type { BezierPath, GeoPoint, Scene } from '../model/types';

/** 節點合併 / 端點吸附容差(公尺) */
const SNAP_M = 6;
/** polyline 取樣間距(公尺) */
const SAMPLE_SPACING_M = 2;
/** 車道寬(公尺) */
export const LANE_WIDTH_M = 3.2;
/** 紅綠燈吸附半徑(公尺) */
const LIGHT_SNAP_M = 40;
/** spawn 吸附半徑(公尺) */
const SPAWN_SNAP_M = 80;

export interface NetNode {
  id: number;
  pos: Vec2;
  /** 綁定的紅綠燈元素 id(null = 無號誌) */
  lightId: string | null;
}

export interface NetEdge {
  id: number;
  from: number;
  to: number;
  /** 行進方向的車道中心線(已向右偏移) */
  pts: Vec2[];
  length: number;
  /** m/s */
  speedLimit: number;
  roadId: string;
}

export interface SpawnBinding {
  spawnId: string;
  nodeId: number;
  vehiclesPerHour: number;
  pedsPerHour: number;
}

export interface Network {
  origin: GeoPoint;
  nodes: NetNode[];
  edges: NetEdge[];
  spawns: SpawnBinding[];
}

/** Bézier path → 弧長均勻取樣的局部座標 polyline */
export function pathToPolyline(path: BezierPath, proj: LocalProjection): Vec2[] {
  const pts: Vec2[] = [];
  const anchors = path.anchors;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    const seg: CubicSegment = {
      p0: proj.toLocal(a.p),
      c1: proj.toLocal(a.hOut ?? a.p),
      c2: proj.toLocal(b.hIn ?? b.p),
      p3: proj.toLocal(b.p),
    };
    const sampled = sampleCubicByArcLength(seg, SAMPLE_SPACING_M);
    // 相鄰 segment 共用端點,避免重複
    pts.push(...(i === 0 ? sampled : sampled.slice(1)));
  }
  return pts;
}

/** 建立模擬路網。Scene 至少要有一條 road 才有意義。 */
export function buildNetwork(scene: Scene): Network {
  const allAnchorPoints = scene.roads.flatMap((r) => r.path.anchors.map((a) => a.p));
  const origin = centroidOf(allAnchorPoints);
  const proj = createProjection(origin);

  const roadLines = scene.roads.map((road) => ({
    road,
    pts: pathToPolyline(road.path, proj),
  }));

  // 1. 收集每條路的切割位置(弧長)
  const cuts: number[][] = roadLines.map(() => []);
  for (let i = 0; i < roadLines.length; i++) {
    for (let j = i + 1; j < roadLines.length; j++) {
      const hits = polylineIntersections(roadLines[i]!.pts, roadLines[j]!.pts);
      for (const h of hits) {
        cuts[i]!.push(h.sA);
        cuts[j]!.push(h.sB);
      }
    }
  }
  // 端點碰到別條路中段 → T 字路口
  for (let i = 0; i < roadLines.length; i++) {
    const pts = roadLines[i]!.pts;
    const ends = [pts[0]!, pts[pts.length - 1]!];
    for (const end of ends) {
      for (let j = 0; j < roadLines.length; j++) {
        if (j === i) continue;
        const near = nearestOnPolyline(roadLines[j]!.pts, end);
        if (near.distance < SNAP_M) cuts[j]!.push(near.s);
      }
    }
  }

  // 2. 切割 → 各部分建 node 與 edge
  const nodes: NetNode[] = [];
  const findOrCreateNode = (p: Vec2): number => {
    for (const n of nodes) {
      if (Math.hypot(n.pos.x - p.x, n.pos.y - p.y) < SNAP_M) return n.id;
    }
    const node: NetNode = { id: nodes.length, pos: p, lightId: null };
    nodes.push(node);
    return node.id;
  };

  const edges: NetEdge[] = [];
  for (let i = 0; i < roadLines.length; i++) {
    const { road, pts } = roadLines[i]!;
    const speedMs = road.speedLimit / 3.6;
    const parts = splitPolyline(pts, cuts[i]!);
    for (const part of parts) {
      const length = polylineLength(part);
      if (length < SNAP_M) continue; // 過短的碎段直接丟棄
      const fromId = findOrCreateNode(part[0]!);
      const toId = findOrCreateNode(part[part.length - 1]!);
      if (fromId === toId) continue;

      // 台灣靠右:雙向道路各向右偏移半車道;單行道走中線
      const offset = road.lanesBackward > 0 ? LANE_WIDTH_M / 2 : 0;
      edges.push({
        id: edges.length,
        from: fromId,
        to: toId,
        pts: offsetPolyline(part, offset),
        length,
        speedLimit: speedMs,
        roadId: road.id,
      });
      if (road.lanesBackward > 0) {
        const back = reversePolyline(part);
        edges.push({
          id: edges.length,
          from: toId,
          to: fromId,
          pts: offsetPolyline(back, offset),
          length,
          speedLimit: speedMs,
          roadId: road.id,
        });
      }
    }
  }

  // 3. 紅綠燈吸附到最近節點
  for (const light of scene.lights) {
    const p = proj.toLocal(light.at);
    let best: { node: NetNode; d: number } | null = null;
    for (const n of nodes) {
      const d = Math.hypot(n.pos.x - p.x, n.pos.y - p.y);
      if (d < LIGHT_SNAP_M && (best === null || d < best.d)) best = { node: n, d };
    }
    if (best !== null) best.node.lightId = light.id;
  }

  // 4. spawn 吸附到最近節點
  const spawns: SpawnBinding[] = [];
  for (const sp of scene.spawns) {
    const p = proj.toLocal(sp.at);
    let best: { node: NetNode; d: number } | null = null;
    for (const n of nodes) {
      const d = Math.hypot(n.pos.x - p.x, n.pos.y - p.y);
      if (d < SPAWN_SNAP_M && (best === null || d < best.d)) best = { node: n, d };
    }
    if (best !== null) {
      spawns.push({
        spawnId: sp.id,
        nodeId: best.node.id,
        vehiclesPerHour: sp.vehiclesPerHour,
        pedsPerHour: sp.pedsPerHour,
      });
    }
  }

  return { origin, nodes, edges, spawns };
}

/** node id → 由該節點出發的 edges(排除 U-turn 回頭同一條路) */
export function outgoingEdges(net: Network, nodeId: number, fromEdge?: NetEdge): NetEdge[] {
  return net.edges.filter(
    (e) =>
      e.from === nodeId &&
      (fromEdge === undefined || !(e.roadId === fromEdge.roadId && e.to === fromEdge.from))
  );
}
