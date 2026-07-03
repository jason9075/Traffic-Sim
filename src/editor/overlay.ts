/**
 * 疊在 MapLibre 上的 Canvas overlay:
 * 處理 DPR 縮放、尺寸同步,以及工具啟用時把 wheel 事件轉發給地圖(維持縮放手感)。
 */

import type maplibregl from 'maplibre-gl';

export class Overlay {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  private readonly map: maplibregl.Map;

  constructor(canvas: HTMLCanvasElement, map: maplibregl.Map) {
    this.canvas = canvas;
    this.map = map;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('無法取得 2D context');
    this.ctx = ctx;

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas.parentElement ?? document.body);
    this.resize();

    canvas.addEventListener('wheel', (e) => this.forwardWheel(e), { passive: false });
  }

  /** 工具啟用時攔截 pointer 事件;pan 模式讓事件穿透給地圖 */
  setActive(active: boolean): void {
    this.canvas.classList.toggle('active', active);
  }

  /** 依容器尺寸與 devicePixelRatio 重設 canvas,回傳是否有變動 */
  resize(): void {
    const parent = this.canvas.parentElement;
    if (parent === null) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
  }

  /** 清空並依 DPR 設定 transform,回傳可用的 ctx */
  beginFrame(): CanvasRenderingContext2D {
    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    return this.ctx;
  }

  private forwardWheel(e: WheelEvent): void {
    e.preventDefault();
    // 複製事件丟給地圖 canvas,讓編輯中仍可縮放
    this.map.getCanvas().dispatchEvent(new WheelEvent(e.type, e));
  }
}
