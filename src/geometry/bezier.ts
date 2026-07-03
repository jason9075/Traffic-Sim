/**
 * Cubic Bézier 純函式工具。座標系無關(螢幕 px 或局部平面公尺皆可)。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 一段 cubic Bézier 的四個控制點 */
export interface CubicSegment {
  p0: Vec2;
  c1: Vec2;
  c2: Vec2;
  p3: Vec2;
}

/** 在 t ∈ [0,1] 取曲線上的點 */
export function evalCubic(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p3.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p3.y,
  };
}

/** 在 t 取一階導數(切線向量,未正規化) */
export function evalCubicDeriv(s: CubicSegment, t: number): Vec2 {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (s.c1.x - s.p0.x) + b * (s.c2.x - s.c1.x) + c * (s.p3.x - s.c2.x),
    y: a * (s.c1.y - s.p0.y) + b * (s.c2.y - s.c1.y) + c * (s.p3.y - s.c2.y),
  };
}

/** 以 n 等分 t 取樣(含端點),回傳 n+1 個點 */
export function sampleCubic(s: CubicSegment, n: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    pts.push(evalCubic(s, i / n));
  }
  return pts;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 依 arc-length 均勻重取樣:回傳點間距約為 spacing 的 polyline(含頭尾端點)。
 * 先密集取樣再線性插值,精度對渲染與模擬取樣足夠。
 */
export function sampleCubicByArcLength(s: CubicSegment, spacing: number): Vec2[] {
  const dense = sampleCubic(s, 64);
  const cum: number[] = [0];
  for (let i = 1; i < dense.length; i++) {
    cum.push(cum[i - 1]! + dist(dense[i - 1]!, dense[i]!));
  }
  const total = cum[cum.length - 1]!;
  if (total === 0) return [dense[0]!];

  const n = Math.max(1, Math.round(total / spacing));
  const out: Vec2[] = [dense[0]!];
  let seg = 1;
  for (let i = 1; i < n; i++) {
    const target = (total * i) / n;
    while (seg < cum.length - 1 && cum[seg]! < target) seg++;
    const t0 = cum[seg - 1]!;
    const t1 = cum[seg]!;
    const r = t1 === t0 ? 0 : (target - t0) / (t1 - t0);
    const a = dense[seg - 1]!;
    const b = dense[seg]!;
    out.push({ x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r });
  }
  out.push(dense[dense.length - 1]!);
  return out;
}

/** 點到曲線的最近距離(粗取樣 + 局部細化),用於 hit-testing */
export function nearestPointOnCubic(
  s: CubicSegment,
  p: Vec2
): { point: Vec2; t: number; distance: number } {
  let bestT = 0;
  let bestD = Infinity;
  const COARSE = 24;
  for (let i = 0; i <= COARSE; i++) {
    const t = i / COARSE;
    const d = dist(evalCubic(s, t), p);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // 黃金比例縮小區間細化
  let lo = Math.max(0, bestT - 1 / COARSE);
  let hi = Math.min(1, bestT + 1 / COARSE);
  for (let i = 0; i < 20; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (dist(evalCubic(s, m1), p) < dist(evalCubic(s, m2), p)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const point = evalCubic(s, t);
  return { point, t, distance: dist(point, p) };
}
