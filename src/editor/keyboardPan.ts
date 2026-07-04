/**
 * WASD / 方向鍵平移視角。與目前工具、編輯鎖定狀態無關,任何時候都可平移鏡頭。
 */

import type maplibregl from 'maplibre-gl';

/** 像素/秒,實際位移會依 devicePixelRatio 無關,純螢幕座標 */
const PAN_SPEED_PX_S = 700;

const KEY_DELTA: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

/** 掛上全域鍵盤監聽,回傳可用於移除監聽的 cleanup 函式 */
export function attachKeyboardPan(map: maplibregl.Map): () => void {
  const held = new Set<string>();
  let rafId: number | null = null;
  let last = 0;

  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  function tick(now: number): void {
    const dt = last === 0 ? 0 : (now - last) / 1000;
    last = now;
    let dx = 0;
    let dy = 0;
    for (const key of held) {
      const d = KEY_DELTA[key];
      if (d === undefined) continue;
      dx += d[0];
      dy += d[1];
    }
    if ((dx !== 0 || dy !== 0) && dt > 0) {
      const len = Math.hypot(dx, dy) || 1;
      map.panBy(
        [(dx / len) * PAN_SPEED_PX_S * dt, (dy / len) * PAN_SPEED_PX_S * dt],
        { animate: false }
      );
    }
    if (held.size === 0) {
      rafId = null;
      last = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isTypingTarget(e.target)) return;
    const key = e.key.toLowerCase();
    if (!(key in KEY_DELTA)) return;
    e.preventDefault();
    held.add(key);
    if (rafId === null) rafId = requestAnimationFrame(tick);
  }

  function onKeyUp(e: KeyboardEvent): void {
    held.delete(e.key.toLowerCase());
  }

  function onBlur(): void {
    held.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (rafId !== null) cancelAnimationFrame(rafId);
  };
}
