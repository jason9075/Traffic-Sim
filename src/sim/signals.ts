/**
 * Fixed-time 號誌控制:把路口的進入邊依方位分成兩個時相群組,
 * 依 綠A → 黃A → 全紅 → 綠B → 黃B → 全紅 循環。
 */

import type { Network } from '../geometry/network';
import type { SignalTiming } from '../model/types';

export type LightColor = 'green' | 'yellow' | 'red';

export interface SignalPlan {
  nodeId: number;
  /** 兩個時相各自包含的進入邊 id */
  groups: [number[], number[]];
  timing: SignalTiming;
  cycle: number;
}

export interface SignalState {
  nodeId: number;
  /** edge id → 該進入邊目前的燈色 */
  colors: Map<number, LightColor>;
  /** 行人可穿越 group i 道路的時相(該群組紅燈時) */
  groupColors: [LightColor, LightColor];
}

/** 為每個綁了紅綠燈的節點建立時相計畫 */
export function buildSignalPlans(
  net: Network,
  timings: ReadonlyMap<string, SignalTiming>
): SignalPlan[] {
  const plans: SignalPlan[] = [];
  for (const node of net.nodes) {
    if (node.lightId === null) continue;
    const timing = timings.get(node.lightId);
    if (timing === undefined) continue;

    const approaches = net.edges.filter((e) => e.to === node.id);
    if (approaches.length === 0) continue;

    // 進入方位角(取 polyline 最後一段方向),mod π 使對向同群
    const items = approaches.map((e) => {
      const n = e.pts.length;
      const a = e.pts[Math.max(0, n - 2)]!;
      const b = e.pts[n - 1]!;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      return { id: e.id, ang: ((ang % Math.PI) + Math.PI) % Math.PI };
    });

    // 以「排序後最大角度間隙」把 mod π 的方位分成兩群
    items.sort((x, y) => x.ang - y.ang);
    let splitAt = 0;
    let maxGap = -1;
    for (let i = 0; i < items.length; i++) {
      const next = items[(i + 1) % items.length]!;
      const gap =
        i === items.length - 1 ? items[0]!.ang + Math.PI - items[i]!.ang : next.ang - items[i]!.ang;
      if (gap > maxGap) {
        maxGap = gap;
        splitAt = (i + 1) % items.length;
      }
    }
    const rotated = [...items.slice(splitAt), ...items.slice(0, splitAt)];
    // 第二大的間隙作為兩群分界
    let split2 = rotated.length;
    let gap2 = -1;
    for (let i = 0; i + 1 < rotated.length; i++) {
      const gap = rotated[i + 1]!.ang - rotated[i]!.ang;
      const wrapped = gap < 0 ? gap + Math.PI : gap;
      if (wrapped > gap2) {
        gap2 = wrapped;
        split2 = i + 1;
      }
    }
    const groupA = rotated.slice(0, split2).map((x) => x.id);
    const groupB = rotated.slice(split2).map((x) => x.id);

    const cycle = 2 * (timing.green + timing.yellow + timing.allRed);
    plans.push({ nodeId: node.id, groups: [groupA, groupB], timing, cycle });
  }
  return plans;
}

/** 依模擬時間計算目前所有號誌狀態 */
export function evalSignals(plans: SignalPlan[], time: number): SignalState[] {
  return plans.map((plan) => {
    const { green, yellow, allRed } = plan.timing;
    const half = green + yellow + allRed;
    const t = time % plan.cycle;
    const inFirstHalf = t < half;
    const tt = inFirstHalf ? t : t - half;

    const active: LightColor = tt < green ? 'green' : tt < green + yellow ? 'yellow' : 'red';
    const colorA: LightColor = inFirstHalf ? active : 'red';
    const colorB: LightColor = inFirstHalf ? 'red' : active;

    const colors = new Map<number, LightColor>();
    for (const id of plan.groups[0]) colors.set(id, colorA);
    for (const id of plan.groups[1]) colors.set(id, colorB);
    return { nodeId: plan.nodeId, colors, groupColors: [colorA, colorB] };
  });
}
