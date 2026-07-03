/**
 * Dijkstra 最短路徑(權重 = 行駛時間)。路網規模小,線性掃描的
 * priority 選取已足夠,不需要 heap。
 */

import type { Network, NetEdge } from '../geometry/network';

export interface RouteResult {
  /** 依序經過的 edge id */
  edgeIds: number[];
  /** 自由流旅行時間(秒) */
  freeflowTime: number;
}

/** 從 fromNode 到 toNode 的最短(時間)路徑,無路徑回傳 null */
export function shortestRoute(net: Network, fromNode: number, toNode: number): RouteResult | null {
  if (fromNode === toNode) return null;
  const distArr = new Map<number, number>();
  const prevEdge = new Map<number, NetEdge>();
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

    for (const e of net.edges) {
      if (e.from !== cur) continue;
      const nd = curDist + e.length / e.speedLimit;
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
  return { edgeIds, freeflowTime: distArr.get(toNode)! };
}
