/**
 * 模擬控制面板:速度控制、即時統計、停等車輛 sparkline。
 */

import type { SimStats } from '../sim/engine';

export interface SimPanel {
  root: HTMLElement;
  update(stats: SimStats): void;
  destroy(): void;
}

export function createSimPanel(
  container: HTMLElement,
  onSpeed: (mult: number) => void,
  onReset: () => void
): SimPanel {
  const box = document.createElement('div');
  box.className = 'panel-box';
  box.innerHTML = '<h3>模擬中</h3>';
  container.prepend(box);

  // 速度控制
  const speedRow = document.createElement('div');
  speedRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px';
  const speeds: Array<[string, number]> = [['⏸', 0], ['1x', 1], ['4x', 4], ['16x', 16]];
  const speedBtns: HTMLButtonElement[] = [];
  for (const [label, mult] of speeds) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText =
      'flex:1;border:none;background:rgba(255,255,255,.12);color:#ddd;padding:6px 0;' +
      'border-radius:6px;cursor:pointer;font-size:12px';
    btn.addEventListener('click', () => {
      onSpeed(mult);
      for (const b of speedBtns) b.style.background = 'rgba(255,255,255,.12)';
      btn.style.background = '#2563eb';
    });
    speedRow.appendChild(btn);
    speedBtns.push(btn);
  }
  speedBtns[1]!.style.background = '#2563eb';
  box.appendChild(speedRow);

  const resetBtn = document.createElement('button');
  resetBtn.textContent = '↺ 重新開始';
  resetBtn.style.cssText =
    'width:100%;border:none;background:rgba(255,255,255,.12);color:#ddd;padding:6px 0;' +
    'border-radius:6px;cursor:pointer;font-size:12px;margin-bottom:8px';
  resetBtn.addEventListener('click', onReset);
  box.appendChild(resetBtn);

  // 統計
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = 'font-size:12px;line-height:1.8;font-variant-numeric:tabular-nums';
  box.appendChild(statsDiv);

  // 停等車輛 sparkline
  const sparkLabel = document.createElement('div');
  sparkLabel.className = 'hint';
  sparkLabel.textContent = '停等車輛(近 5 分鐘)';
  sparkLabel.style.marginTop = '6px';
  box.appendChild(sparkLabel);
  const spark = document.createElement('canvas');
  spark.width = 236;
  spark.height = 40;
  spark.style.cssText = 'width:100%;height:40px;background:rgba(255,255,255,.05);border-radius:6px';
  box.appendChild(spark);

  const history: Array<{ t: number; stopped: number }> = [];

  function fmtTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function update(stats: SimStats): void {
    statsDiv.innerHTML =
      `模擬時間 <b>${fmtTime(stats.time)}</b><br>` +
      `路上車輛 <b>${stats.active}</b>(停等 <b style="color:#f87171">${stats.stopped}</b>)<br>` +
      `完成旅次 <b>${stats.completed}</b><br>` +
      `平均旅行時間 <b>${stats.avgTravel.toFixed(0)} 秒</b><br>` +
      `平均塞車延滯 <b style="color:#fbbf24">${stats.avgDelay.toFixed(0)} 秒</b><br>` +
      (stats.queuedAtSpawn > 0 ? `入口等待 <b>${stats.queuedAtSpawn}</b> 輛<br>` : '');

    history.push({ t: stats.time, stopped: stats.stopped });
    const cutoff = stats.time - 300;
    while (history.length > 0 && history[0]!.t < cutoff) history.shift();
    drawSpark();
  }

  function drawSpark(): void {
    const ctx = spark.getContext('2d');
    if (ctx === null || history.length < 2) return;
    ctx.clearRect(0, 0, spark.width, spark.height);
    const maxV = Math.max(4, ...history.map((h) => h.stopped));
    const t0 = history[0]!.t;
    const t1 = history[history.length - 1]!.t;
    const span = Math.max(1, t1 - t0);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    history.forEach((h, i) => {
      const x = ((h.t - t0) / span) * (spark.width - 4) + 2;
      const y = spark.height - 3 - (h.stopped / maxV) * (spark.height - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  return {
    root: box,
    update,
    destroy() {
      box.remove();
    },
  };
}
