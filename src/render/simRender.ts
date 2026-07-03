/**
 * 模擬視覺化:流量 heatmap、號誌停止線、車輛。
 * Worker 快照使用局部公尺座標,這裡轉回地理座標再投影到螢幕。
 */

import type maplibregl from 'maplibre-gl';

import { metersPerPixel } from '../editor/render';
import type { Vec2 } from '../geometry/bezier';
import { LANE_WIDTH_M, type Network } from '../geometry/network';
import type { LocalProjection } from '../geometry/projection';
import type { SerializedSignal } from '../sim/protocol';
import type { EdgeFlow } from '../sim/engine';

const VEHICLE_LEN_M = 4.5;
const VEHICLE_W_M = 1.8;

export interface SimFrame {
  buf: Float32Array;
  n: number;
  pedBuf: Float32Array;
  nPeds: number;
  flows: EdgeFlow[];
  signals: SerializedSignal[];
}

function localToScreen(map: maplibregl.Map, proj: LocalProjection, p: Vec2): Vec2 {
  const g = proj.toGeo(p);
  const s = map.project([g.lng, g.lat]);
  return { x: s.x, y: s.y };
}

/** speedRatio 0(停死)→ 1(順暢)對應 紅 → 綠 */
function flowColor(ratio: number): string {
  const hue = Math.max(0, Math.min(120, ratio * 120));
  return `hsla(${hue}, 85%, 50%, 0.55)`;
}

export function renderSim(
  ctx: CanvasRenderingContext2D,
  map: maplibregl.Map,
  proj: LocalProjection,
  net: Network,
  frame: SimFrame
): void {
  const pxPerMeter = 1 / metersPerPixel(map);

  // 1. 流量 heatmap:有車的邊依平均速度染色
  ctx.save();
  ctx.lineCap = 'round';
  for (const flow of frame.flows) {
    const edge = net.edges[flow.edgeId];
    if (edge === undefined) continue;
    ctx.strokeStyle = flowColor(flow.speedRatio);
    ctx.lineWidth = Math.max(3, LANE_WIDTH_M * pxPerMeter);
    ctx.beginPath();
    for (let i = 0; i < edge.pts.length; i++) {
      const s = localToScreen(map, proj, edge.pts[i]!);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 2. 號誌停止線(每個進入邊尾端的橫線)
  ctx.save();
  for (const sig of frame.signals) {
    for (const [edgeId, color] of sig.colors) {
      const edge = net.edges[edgeId];
      if (edge === undefined || edge.pts.length < 2) continue;
      const end = edge.pts[edge.pts.length - 1]!;
      const prev = edge.pts[edge.pts.length - 2]!;
      const dx = end.x - prev.x;
      const dy = end.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      // 法線方向的短橫線,置於停止線位置
      const nx = -dy / len;
      const ny = dx / len;
      const half = LANE_WIDTH_M * 0.7;
      const a = localToScreen(map, proj, { x: end.x + nx * half, y: end.y + ny * half });
      const b = localToScreen(map, proj, { x: end.x - nx * half, y: end.y - ny * half });
      ctx.strokeStyle =
        color === 'green' ? '#22c55e' : color === 'yellow' ? '#facc15' : '#ef4444';
      ctx.lineWidth = Math.max(2, 0.6 * pxPerMeter);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 3. 車輛(旋轉矩形,停等紅色、行進黃色)
  ctx.save();
  const carLen = Math.max(3, VEHICLE_LEN_M * pxPerMeter);
  const carW = Math.max(1.5, VEHICLE_W_M * pxPerMeter);
  for (let i = 0; i < frame.n; i++) {
    const x = frame.buf[i * 4]!;
    const y = frame.buf[i * 4 + 1]!;
    const angle = frame.buf[i * 4 + 2]!;
    const v = frame.buf[i * 4 + 3]!;
    const s = localToScreen(map, proj, { x, y });
    ctx.translate(s.x, s.y);
    // 局部座標 y 朝北、螢幕 y 朝下 → 角度取負
    ctx.rotate(-angle);
    ctx.fillStyle = v < 0.5 ? '#ef4444' : '#fbbf24';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.roundRect(-carLen / 2, -carW / 2, carLen, carW, carW * 0.25);
    ctx.fill();
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ctx.restore();

  // 4. 行人(小圓點:行走藍、等待橘)
  ctx.save();
  const pedR = Math.max(2.5, 0.4 * pxPerMeter);
  for (let i = 0; i < frame.nPeds; i++) {
    const x = frame.pedBuf[i * 3]!;
    const y = frame.pedBuf[i * 3 + 1]!;
    const waiting = frame.pedBuf[i * 3 + 2]! > 0.5;
    const s = localToScreen(map, proj, { x, y });
    ctx.fillStyle = waiting ? '#fb923c' : '#38bdf8';
    ctx.beginPath();
    ctx.arc(s.x, s.y, pedR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
