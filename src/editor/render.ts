/**
 * 場景渲染:把 Scene(地理座標)投影到螢幕後畫在 overlay canvas 上。
 */

import type maplibregl from 'maplibre-gl';

import { evalCubic, evalCubicDeriv, type Vec2, type CubicSegment } from '../geometry/bezier';
import { deriveCrosswalks } from '../geometry/crosswalks';
import { laneDirectionsConflict, type RoadEnd } from '../geometry/laneConnections';
import type { Anchor, GeoPoint, LaneDirection, Road, Scene } from '../model/types';
import type { EditorView } from './editor';
import { findPathSnap } from './snapping';

/** 車道寬(公尺,台灣市區標準) */
const LANE_WIDTH_M = 3.2;

const COLORS = {
  road: '#3f4045',
  roadSelected: '#52545c',
  sidewalk: '#7cb47c',
  crosswalk: '#f3f4f6',
  draft: '#60a5fa',
  anchor: '#ffffff',
  handle: '#93c5fd',
  selection: '#3b82f6',
  spawn: '#2563eb',
  snapHint: '#22c55e',
  warning: '#f59e0b',
  laneAnchor: '#7f1d1d',
} as const;

/** 車道方向箭頭顏色:去向/來向各一色,雙向兩個箭頭各用自己的顏色 */
const LANE_DIR_ARROW_COLORS: Record<'forward' | 'backward', string> = {
  forward: '#4ade80',
  backward: '#60a5fa',
};

export function project(map: maplibregl.Map, g: GeoPoint): Vec2 {
  const p = map.project([g.lng, g.lat]);
  return { x: p.x, y: p.y };
}

/** 目前視圖中心的公尺/像素比 */
export function metersPerPixel(map: maplibregl.Map): number {
  const c = map.getCenter();
  const p1 = map.project([c.lng, c.lat]);
  const p2 = map.project([c.lng, c.lat + 0.0001]);
  const px = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  const meters = 0.0001 * 111320; // 緯度 0.0001 度 ≈ 11.13 m
  return meters / px;
}

/** 把相鄰錨點展開成螢幕座標的 cubic segments */
export function anchorsToSegments(map: maplibregl.Map, anchors: Anchor[]): CubicSegment[] {
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

/** 沿 cubic 曲線密集取樣後,每點依切線法向量偏移固定像素距離,近似畫出平行的偏移線 */
function offsetSegmentPoints(segs: CubicSegment[], offsetPx: number): Vec2[] {
  const SAMPLES_PER_SEG = 16;
  const pts: Vec2[] = [];
  for (const seg of segs) {
    for (let i = 0; i <= SAMPLES_PER_SEG; i++) {
      const t = i / SAMPLES_PER_SEG;
      const p = evalCubic(seg, t);
      const d = evalCubicDeriv(seg, t);
      const len = Math.hypot(d.x, d.y) || 1;
      pts.push({ x: p.x + (-d.y / len) * offsetPx, y: p.y + (d.x / len) * offsetPx });
    }
  }
  return pts;
}

function strokeOffsetLine(ctx: CanvasRenderingContext2D, segs: CubicSegment[], offsetPx: number): void {
  const pts = offsetSegmentPoints(segs, offsetPx);
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();
}

/** 每條車道之間白色分隔線,以路徑中心(0)為基準、車道群組左右對稱置中的偏移量(公尺) */
function laneDividerOffsetsM(lanes: number): number[] {
  const offsets: number[] = [];
  const halfWidthM = (lanes * LANE_WIDTH_M) / 2;
  for (let i = 1; i < lanes; i++) offsets.push(-halfWidthM + i * LANE_WIDTH_M);
  return offsets;
}

/** 每條車道「中心線」相對路徑中心的偏移量(公尺),用於路口把手定位 */
function laneCenterOffsetsM(lanes: number): number[] {
  const halfWidthM = (lanes * LANE_WIDTH_M) / 2;
  return Array.from({ length: lanes }, (_, i) => -halfWidthM + (i + 0.5) * LANE_WIDTH_M);
}

/** 某條路在指定端點(head/tail)、指定車道的把手螢幕座標(往路外側稍微推出,避免多路交會時重疊) */
export function laneHandleScreenPos(map: maplibregl.Map, road: Road, end: RoadEnd, lane: number): Vec2 {
  const segs = anchorsToSegments(map, road.path.anchors);
  const seg = end === 'head' ? segs[0]! : segs[segs.length - 1]!;
  const t = end === 'head' ? 0 : 1;
  const p = evalCubic(seg, t);
  // evalCubicDeriv 在控制點退化(hIn/hOut 為 null,即沒拉過弧度)時,端點切線量值恰為 0,
  // 會讓頭尾把手全部疊在同一點;改用有限差分取一小段弧近似方向,穩定不受退化控制點影響。
  const eps = 0.05;
  const near = end === 'head' ? evalCubic(seg, eps) : evalCubic(seg, 1 - eps);
  const d = end === 'head' ? { x: near.x - p.x, y: near.y - p.y } : { x: p.x - near.x, y: p.y - near.y };
  const len = Math.hypot(d.x, d.y) || 1;
  const pxPerMeter = 1 / metersPerPixel(map);
  const offsetPx = (laneCenterOffsetsM(road.lanes)[lane] ?? 0) * pxPerMeter;
  const outward = end === 'head' ? -1 : 1;
  return {
    x: p.x + (-d.y / len) * offsetPx + outward * (d.x / len) * 10,
    y: p.y + (d.x / len) * offsetPx + outward * (d.y / len) * 10,
  };
}

/** 車道中心線大約中點的螢幕座標與切線方向(單位向量),供畫方向箭頭用 */
function laneMidScreenPosAndDir(map: maplibregl.Map, road: Road, lane: number): { pos: Vec2; dir: Vec2 } {
  const segs = anchorsToSegments(map, road.path.anchors);
  const seg = segs[Math.floor((segs.length - 1) / 2)]!;
  const p = evalCubic(seg, 0.5);
  const eps = 0.05;
  const near = evalCubic(seg, 0.5 + eps);
  const d = { x: near.x - p.x, y: near.y - p.y };
  const len = Math.hypot(d.x, d.y) || 1;
  const dir = { x: d.x / len, y: d.y / len };
  const pxPerMeter = 1 / metersPerPixel(map);
  const offsetPx = (laneCenterOffsetsM(road.lanes)[lane] ?? 0) * pxPerMeter;
  return {
    pos: { x: p.x + -dir.y * offsetPx, y: p.y + dir.x * offsetPx },
    dir,
  };
}

function pathFromSegments(segs: CubicSegment[]): Path2D {
  const path = new Path2D();
  if (segs.length === 0) return path;
  path.moveTo(segs[0]!.p0.x, segs[0]!.p0.y);
  for (const s of segs) {
    path.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.p3.x, s.p3.y);
  }
  return path;
}

function drawArrow(ctx: CanvasRenderingContext2D, at: Vec2, dir: Vec2, size: number, color: string): void {
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0) return;
  const ux = dir.x / len;
  const uy = dir.y / len;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(at.x + ux * size, at.y + uy * size);
  ctx.lineTo(at.x - uy * size * 0.5, at.y + ux * size * 0.5);
  ctx.lineTo(at.x + uy * size * 0.5, at.y - ux * size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  scene: Scene,
  view: EditorView
): void {
  const mpp = metersPerPixel(map);
  const pxPerMeter = 1 / mpp;

  for (const sw of scene.sidewalks) {
    const segs = anchorsToSegments(map, sw.path.anchors);
    const path = pathFromSegments(segs);
    ctx.save();
    ctx.strokeStyle = sw.id === view.selectedId ? COLORS.selection : COLORS.sidewalk;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(2, 2 * pxPerMeter);
    ctx.lineCap = 'round';
    ctx.stroke(path);
    ctx.restore();
  }

  for (const road of scene.roads) {
    const segs = anchorsToSegments(map, road.path.anchors);
    const path = pathFromSegments(segs);
    const widthPx = Math.max(4, road.lanes * LANE_WIDTH_M * pxPerMeter);
    const selected = road.id === view.selectedId;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 路面
    ctx.strokeStyle = selected ? COLORS.roadSelected : COLORS.road;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = widthPx;
    ctx.stroke(path);
    // 車道之間的白色虛線分隔線(單向道路,無中央線)
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1, 0.1 * pxPerMeter);
    ctx.setLineDash([2 * pxPerMeter, 2 * pxPerMeter]);
    for (const offsetM of laneDividerOffsetsM(road.lanes)) {
      strokeOffsetLine(ctx, segs, offsetM * pxPerMeter);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  for (const { crosswalk: cw } of deriveCrosswalks(scene)) {
    const a = project(map, cw.a);
    const b = project(map, cw.b);
    ctx.save();
    ctx.strokeStyle = COLORS.crosswalk;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(4, 3 * pxPerMeter);
    // 沿行走方向的 dash → 視覺上垂直行走方向的枕木紋
    ctx.setLineDash([0.6 * pxPerMeter, 0.6 * pxPerMeter]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  for (const light of scene.lights) {
    const p = project(map, light.at);
    const group = scene.lightGroups.find((g) => g.lightIds.includes(light.id));
    const badge = group === undefined ? null : String(group.lightIds.indexOf(light.id) + 1);
    drawTrafficLight(ctx, p, light.id === view.selectedId, view.multiSelect.includes(light.id), badge);
  }

  for (const sp of scene.spawns) {
    const p = project(map, sp.at);
    ctx.save();
    ctx.fillStyle = COLORS.spawn;
    ctx.strokeStyle = sp.id === view.selectedId ? '#fff' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    drawArrow(ctx, { x: p.x, y: p.y }, { x: 1, y: 0 }, 5, '#fff');
    ctx.restore();
  }

  // 車道連線:一律畫線(方向衝突畫紅色並常駐顯示黃色驚嘆號,不受目前工具影響)
  for (const c of scene.laneConnections) {
    const fromRoad = scene.roads.find((r) => r.id === c.fromRoadId);
    const toRoad = scene.roads.find((r) => r.id === c.toRoadId);
    if (fromRoad === undefined || toRoad === undefined) continue;
    const a = laneHandleScreenPos(map, fromRoad, c.fromEnd, c.fromLane);
    const b = laneHandleScreenPos(map, toRoad, c.toEnd, c.toLane);
    const invalid = laneDirectionsConflict(
      fromRoad.laneDirections[c.fromLane] ?? 'forward',
      toRoad.laneDirections[c.toLane] ?? 'forward'
    );
    drawConnectionLine(ctx, a, b, invalid, c.id === view.selectedConnectionId);
    if (invalid) drawJunctionWarning(ctx, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  // 選取模式選中馬路時:顯示每條車道的編號/方向箭頭/深紅色 anchor,並可拖曳 anchor 建立連線
  if (view.tool === 'select' && view.selectedId !== null) {
    const selectedRoad = scene.roads.find((r) => r.id === view.selectedId);
    if (selectedRoad !== undefined) {
      for (let lane = 0; lane < selectedRoad.lanes; lane++) {
        const direction = selectedRoad.laneDirections[lane] ?? 'forward';
        const { pos: midPos, dir: midDir } = laneMidScreenPosAndDir(map, selectedRoad, lane);
        drawLaneDirectionArrows(ctx, midPos, midDir, direction);
        for (const end of ['head', 'tail'] as const) {
          drawLaneAnchor(ctx, laneHandleScreenPos(map, selectedRoad, end, lane), lane + 1);
        }
      }
      if (view.laneHandleDrag !== null && view.laneHandleDrag.roadId === selectedRoad.id) {
        const start = laneHandleScreenPos(
          map,
          selectedRoad,
          view.laneHandleDrag.end,
          view.laneHandleDrag.lane
        );
        drawConnectionLine(ctx, start, view.laneHandleDrag.at, false, false, true);
      }
    }
  }

  // 繪製中的草稿路徑
  if (view.draft !== null) {
    drawDraft(ctx, map, view.draft);
  }

  // 畫路/人行道時,靠近既有路徑端點或中段提示可延伸連接
  if (
    (view.tool === 'road' || view.tool === 'sidewalk') &&
    view.cursor !== null &&
    !(view.draft?.dragging ?? false)
  ) {
    const snap = findPathSnap(map, scene, view.cursor);
    if (snap !== null) drawSnapHint(ctx, project(map, snap.point), snap.kind === 'endpoint');
  }

  // 拖曳既有路徑端點靠近另一條路徑時提示吸附位置
  if (view.dragSnapHint !== null) {
    drawSnapHint(ctx, project(map, view.dragSnapHint.point), view.dragSnapHint.kind === 'endpoint');
  }

  // 選取元素的錨點與 handle
  if (view.selectedId !== null) {
    const el =
      scene.roads.find((r) => r.id === view.selectedId) ??
      scene.sidewalks.find((s) => s.id === view.selectedId);
    if (el !== undefined) {
      drawAnchors(ctx, map, el.path.anchors);
    }
  }
}

function drawDraft(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  draft: NonNullable<EditorView['draft']>
): void {
  const segs = anchorsToSegments(map, draft.anchors);
  ctx.save();
  ctx.strokeStyle = COLORS.draft;
  ctx.lineWidth = 2;
  ctx.stroke(pathFromSegments(segs));

  // 最後一個錨點到游標的預覽線
  const last = draft.anchors[draft.anchors.length - 1];
  if (last !== undefined && draft.cursor !== null && !draft.dragging) {
    const p0 = project(map, last.p);
    const c1 = project(map, last.hOut ?? last.p);
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.bezierCurveTo(c1.x, c1.y, draft.cursor.x, draft.cursor.y, draft.cursor.x, draft.cursor.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  drawAnchors(ctx, map, draft.anchors);
  // 觸控裝置沒有 Enter/雙擊手勢不可靠,改用 #mobile-draft-bar 的按鈕,提示文字只在滑鼠裝置顯示
  if (draft.cursor !== null && !isCoarsePointer()) drawFinishHint(ctx, draft.cursor);
}

/**
 * locked=true:鎖定既有路徑端點,畫雙圈實心提示,代表座標會完全對齊該端點。
 * locked=false:吸附到路徑中段(T 字路口分支),畫較淡的單圈提示。
 */
function drawSnapHint(ctx: CanvasRenderingContext2D, p: Vec2, locked: boolean): void {
  ctx.save();
  ctx.strokeStyle = COLORS.snapHint;
  if (locked) {
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = COLORS.snapHint;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

function drawFinishHint(ctx: CanvasRenderingContext2D, cursor: Vec2): void {
  const text = '雙擊或按 Enter 完成';
  ctx.save();
  ctx.font = '12px sans-serif';
  const padX = 6;
  const padY = 4;
  const w = ctx.measureText(text).width + padX * 2;
  const x = cursor.x + 14;
  const y = cursor.y + 18;
  ctx.fillStyle = 'rgba(20, 20, 24, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x, y - 12 - padY, w, 12 + padY * 2, 4);
  ctx.fill();
  ctx.fillStyle = '#eee';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y);
  ctx.restore();
}

export function drawAnchors(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  anchors: Anchor[]
): void {
  ctx.save();
  for (const a of anchors) {
    const p = project(map, a.p);
    for (const h of [a.hIn, a.hOut]) {
      if (h === null) continue;
      const hp = project(map, h);
      ctx.strokeStyle = COLORS.handle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(hp.x, hp.y);
      ctx.stroke();
      ctx.fillStyle = COLORS.handle;
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.anchor;
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(p.x - 4, p.y - 4, 8, 8);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrafficLight(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  selected: boolean,
  multiSelected: boolean,
  groupBadge: string | null
): void {
  ctx.save();
  const w = 12;
  const h = 28;
  if (multiSelected) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(w, h) / 2 + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = '#1f2937';
  ctx.strokeStyle = selected ? COLORS.selection : 'rgba(255,255,255,0.5)';
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2, p.y - h / 2, w, h, 3);
  ctx.fill();
  ctx.stroke();
  const colors = ['#ef4444', '#facc15', '#22c55e'];
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(p.x, p.y - h / 2 + 5.5 + i * 8.5, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  if (groupBadge !== null) {
    const bx = p.x + w / 2 + 2;
    const by = p.y - h / 2;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(groupBadge, bx, by + 0.5);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/** 連線方向不合理時,常駐顯示在連線中點的黃色驚嘆號徽章 */
function drawJunctionWarning(ctx: CanvasRenderingContext2D, p: Vec2): void {
  ctx.save();
  ctx.fillStyle = COLORS.warning;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', p.x, p.y + 0.5);
  ctx.textAlign = 'left';
  ctx.restore();
}

/** 選取馬路時,每個車道頭尾的深紅色可拖曳 anchor,中間標車道編號 */
function drawLaneAnchor(ctx: CanvasRenderingContext2D, p: Vec2, laneNumber: number): void {
  ctx.save();
  ctx.fillStyle = COLORS.laneAnchor;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(laneNumber), p.x, p.y + 0.5);
  ctx.textAlign = 'left';
  ctx.restore();
}

/** 車道方向箭頭:去向/來向各畫一個箭頭,雙向兩個方向都畫、左右錯開避免重疊 */
function drawLaneDirectionArrows(
  ctx: CanvasRenderingContext2D,
  p: Vec2,
  dir: Vec2,
  direction: LaneDirection
): void {
  if (direction === 'both') {
    const perp = { x: -dir.y, y: dir.x };
    const offset = 4;
    drawArrow(
      ctx,
      { x: p.x + perp.x * offset, y: p.y + perp.y * offset },
      dir,
      6,
      LANE_DIR_ARROW_COLORS.forward
    );
    drawArrow(
      ctx,
      { x: p.x - perp.x * offset, y: p.y - perp.y * offset },
      { x: -dir.x, y: -dir.y },
      6,
      LANE_DIR_ARROW_COLORS.backward
    );
    return;
  }
  const arrowDir = direction === 'forward' ? dir : { x: -dir.x, y: -dir.y };
  drawArrow(ctx, p, arrowDir, 7, LANE_DIR_ARROW_COLORS[direction]);
}

/** 兩個車道把手之間的連線規劃;dashed=拖曳中的橡皮筋線 */
function drawConnectionLine(
  ctx: CanvasRenderingContext2D,
  a: Vec2,
  b: Vec2,
  invalid: boolean,
  selected: boolean,
  dashed = false
): void {
  ctx.save();
  ctx.strokeStyle = invalid ? '#ef4444' : '#22c55e';
  ctx.lineWidth = selected ? 3 : 2;
  if (dashed) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}
