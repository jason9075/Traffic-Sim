/**
 * Dijkstra 最短路徑。路網規模小,線性掃描選點已足夠,不需要 heap。
 */

import type { Network } from '../geometry/network';

export interface CostEdge {
  id: number;
  from: number;
  to: number;
  cost: number;
}

export interface PathResult {
  edgeIds: number[];
  cost: number;
}

/** 泛用最短路徑(車輛與行人共用),無路徑回傳 null */
export function shortestPath(
  edges: readonly CostEdge[],
  fromNode: number,
  toNode: number
): PathResult | null {
  if (fromNode === toNode) return null;
  const distArr = new Map<number, number>();
  const prevEdge = new Map<number, CostEdge>();
  const visited = new Set<number>();
  distArr.set(fromNode, 0);

  while (true) {
    let cur = -1;
    let curDist = Infinity;
    for (const [node, d] of distArr) {
      if (!visited.has(node) && d < curDist) {
        cur = node;
        curDist = d;
      }
    }
    if (cur === -1) return null;
    if (cur === toNode) break;
    visited.add(cur);

    for (const e of edges) {
      if (e.from !== cur) continue;
      const nd = curDist + e.cost;
      if (nd < (distArr.get(e.to) ?? Infinity)) {
        distArr.set(e.to, nd);
        prevEdge.set(e.to, e);
      }
    }
  }

  const edgeIds: number[] = [];
  let node = toNode;
  while (node !== fromNode) {
    const e = prevEdge.get(node);
    if (e === undefined) return null;
    edgeIds.unshift(e.id);
    node = e.from;
  }
  return { edgeIds, cost: distArr.get(toNode)! };
}

export interface RouteResult {
  edgeIds: number[];
  freeflowTime: number;
}

/** 車輛路徑(權重 = 行駛時間) */
export function shortestRoute(net: Network, fromNode: number, toNode: number): RouteResult | null {
  const result = shortestPath(
    net.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, cost: e.length / e.speedLimit })),
    fromNode,
    toNode
  );
  return result === null ? null : { edgeIds: result.edgeIds, freeflowTime: result.cost };
}
