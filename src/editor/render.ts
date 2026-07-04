/**
 * 場景渲染:把 Scene(地理座標)投影到螢幕後畫在 overlay canvas 上。
 */

import type maplibregl from 'maplibre-gl';

import { evalCubic, evalCubicDeriv, type Vec2, type CubicSegment } from '../geometry/bezier';
import { deriveCrosswalks } from '../geometry/crosswalks';
import type { Anchor, GeoPoint, Scene } from '../model/types';
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
} as const;

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
