/**
 * Polyline 純函式工具(局部平面公尺座標)。
 */

import { dist, type Vec2 } from './bezier';

/** 總長度 */
export function polylineLength(pts: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

/** 依弧長 s 取點與切線方向(s 夾在 [0, length]) */
export function pointAt(pts: Vec2[], s: number): { point: Vec2; dir: Vec2 } {
  if (pts.length === 1) return { point: pts[0]!, dir: { x: 1, y: 0 } };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = dist(a, b);
    if (acc + d >= s || i === pts.length - 1) {
      const t = d === 0 ? 0 : Math.min(1, Math.max(0, (s - acc) / d));
      const dir = normalize({ x: b.x - a.x, y: b.y - a.y });
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir };
    }
    acc += d;
  }
  return { point: pts[pts.length - 1]!, dir: { x: 1, y: 0 } };
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len };
}

/**
 * 兩線段交點。回傳交點與兩線段上的參數 t/u ∈ [0,1],無交點回傳 null。
 */
export function segmentIntersection(
  a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2
): { point: Vec2; t: number; u: number } | null {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: { x: a1.x + t * dax, y: a1.y + t * day }, t, u };
}

/**
 * 找出兩條 polyline 的所有交點,回傳各自的弧長位置。
 */
export function polylineIntersections(
  a: Vec2[], b: Vec2[]
): Array<{ point: Vec2; sA: number; sB: number }> {
  const out: Array<{ point: Vec2; sA: number; sB: number }> = [];
  let accA = 0;
  for (let i = 1; i < a.length; i++) {
    const a1 = a[i - 1]!;
    const a2 = a[i]!;
    const lenA = dist(a1, a2);
    let accB = 0;
    for (let j = 1; j < b.length; j++) {
      const b1 = b[j - 1]!;
      const b2 = b[j]!;
      const lenB = dist(b1, b2);
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (hit !== null) {
        out.push({ point: hit.point, sA: accA + hit.t * lenA, sB: accB + hit.u * lenB });
      }
      accB += lenB;
    }
    accA += lenA;
  }
  return out;
}

/** 點到 polyline 的最近距離與弧長位置 */
export function nearestOnPolyline(
  pts: Vec2[], p: Vec2
): { distance: number; s: number; point: Vec2 } {
  let best = { distance: Infinity, s: 0, point: pts[0] ?? { x: 0, y: 0 } };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(p, q);
    if (d < best.distance) best = { distance: d, s: acc + t * len, point: q };
    acc += len;
  }
  return best;
}

/** 以弧長位置切割 polyline(cuts 需在 (0, length) 開區間內) */
export function splitPolyline(pts: Vec2[], cuts: number[]): Vec2[][] {
  const total = polylineLength(pts);
  const sorted = [...new Set(cuts)]
    .filter((s) => s > 0.01 && s < total - 0.01)
    .sort((x, y) => x - y);
  if (sorted.length === 0) return [pts];

  const parts: Vec2[][] = [];
  let current: Vec2[] = [pts[0]!];
  let acc = 0;
  let cutIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const segStart = acc;
    const segLen = dist(a, b);
    acc += segLen;
    // 這一段內可能有多個切點
    while (cutIdx < sorted.length && sorted[cutIdx]! <= acc) {
      const t = segLen === 0 ? 0 : (sorted[cutIdx]! - segStart) / segLen;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      current.push(q);
      parts.push(current);
      current = [q];
      cutIdx++;
    }
    current.push(b);
  }
  parts.push(current);
  return parts;
}

/** 沿行進方向向右偏移(台灣靠右行駛的車道中心線) */
export function offsetPolyline(pts: Vec2[], offset: number): Vec2[] {
  if (pts.length < 2) return pts.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const d = normalize({ x: next.x - prev.x, y: next.y - prev.y });
    // 右側法線(y 朝北、x 朝東,行進方向右側 = (d.y, -d.x))
    out.push({ x: pts[i]!.x + d.y * offset, y: pts[i]!.y - d.x * offset });
  }
  return out;
}

export function reversePolyline(pts: Vec2[]): Vec2[] {
  return [...pts].reverse();
}
