/**
 * 車道連線規劃的共用小工具:列舉場景內所有道路的車道端點、判斷兩端方向是否相容。
 * 目前只針對「單一連線」本身的方向做檢查,不計算路口/路網拓樸(哪些路實際交會於同一點)。
 */

import type { LaneDirection, Scene } from '../model/types';

export type RoadEnd = 'head' | 'tail';

/** 一條路某一端、某一車道的端點,供拖曳把手 / LaneConnection 顯示與 hit-test 用 */
export interface LaneEnd {
  roadId: string;
  lane: number;
  end: RoadEnd;
  direction: LaneDirection;
}

/** 場景內所有道路、所有車道的頭尾端點清單 */
export function allLaneEnds(scene: Scene): LaneEnd[] {
  const ends: LaneEnd[] = [];
  for (const road of scene.roads) {
    for (let lane = 0; lane < road.lanes; lane++) {
      const direction = road.laneDirections[lane] ?? 'forward';
      ends.push({ roadId: road.id, lane, end: 'head', direction });
      ends.push({ roadId: road.id, lane, end: 'tail', direction });
    }
  }
  return ends;
}

/** 車道端點的唯一鍵,editor.ts(把手 hit-test)與 render.ts(把手位置快取)共用 */
export function laneHandleKey(roadId: string, lane: number, end: RoadEnd): string {
  return `${roadId}|${lane}|${end}`;
}

/** 兩個車道方向標籤是否衝突(去向對來向);雙向跟任何標籤都相容 */
export function laneDirectionsConflict(a: LaneDirection, b: LaneDirection): boolean {
  return (a === 'forward' && b === 'backward') || (a === 'backward' && b === 'forward');
}
