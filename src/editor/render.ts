/**
 * 場景渲染:把 Scene(地理座標)投影到螢幕後畫在 overlay canvas 上。
 */

import type maplibregl from 'maplibre-gl';

import type { Vec2, CubicSegment } from '../geometry/bezier';
import { evalCubic, evalCubicDeriv } from '../geometry/bezier';
import type { Anchor, GeoPoint, Scene } from '../model/types';
import type { EditorView } from './editor';

/** 車道寬(公尺,台灣市區標準) */
const LANE_WIDTH_M = 3.2;

const COLORS = {
  road: '#3f4045',
  roadSelected: '#52545c',
  centerLine: '#f5c542', // 台灣雙向道路中央線為黃色
  edgeLine: '#e5e7eb',
  sidewalk: '#7cb47c',
  crosswalk: '#f3f4f6',
  draft: '#60a5fa',
  anchor: '#ffffff',
  handle: '#93c5fd',
  selection: '#3b82f6',
  spawn: '#2563eb',
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
    const lanes = road.lanesForward + road.lanesBackward;
    const widthPx = Math.max(4, lanes * LANE_WIDTH_M * pxPerMeter);
    const selected = road.id === view.selectedId;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 路面
    ctx.strokeStyle = selected ? COLORS.roadSelected : COLORS.road;
    ctx.globalAlpha = 0.92;
    ctx.lineWidth = widthPx;
    ctx.stroke(path);
    // 邊線
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = selected ? COLORS.selection : COLORS.edgeLine;
    ctx.lineWidth = Math.max(1, 0.15 * pxPerMeter);
    ctx.setLineDash([]);
    ctx.stroke(path);
    // 雙向:黃色中央線;單行道:方向箭頭
    if (road.lanesBackward > 0) {
      ctx.strokeStyle = COLORS.centerLine;
      ctx.lineWidth = Math.max(1, 0.15 * pxPerMeter);
      ctx.setLineDash([10 * pxPerMeter * 0.3, 10 * pxPerMeter * 0.3]);
      ctx.stroke(path);
    }
    ctx.setLineDash([]);
    // 行進方向箭頭(順向 = 繪製方向,靠右)
    if (widthPx > 8) {
      for (const s of segs) {
        const at = evalCubic(s, 0.5);
        const dir = evalCubicDeriv(s, 0.5);
        drawArrow(ctx, at, dir, Math.min(widthPx * 0.35, 10), 'rgba(255,255,255,0.6)');
      }
    }
    ctx.restore();
  }

  for (const cw of scene.crosswalks) {
    const a = project(map, cw.a);
    const b = project(map, cw.b);
    ctx.save();
    ctx.strokeStyle = cw.id === view.selectedId ? COLORS.selection : COLORS.crosswalk;
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
    drawTrafficLight(ctx, p, light.id === view.selectedId);
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
  if (view.crosswalkStart !== null) {
    const p = project(map, view.crosswalkStart);
    ctx.save();
    ctx.fillStyle = COLORS.draft;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (view.cursor !== null) {
      ctx.strokeStyle = COLORS.draft;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(view.cursor.x, view.cursor.y);
      ctx.stroke();
    }
    ctx.restore();
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

function drawTrafficLight(ctx: CanvasRenderingContext2D, p: Vec2, selected: boolean): void {
  ctx.save();
  const w = 12;
  const h = 28;
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
  ctx.restore();
}
