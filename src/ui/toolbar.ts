/**
 * 上方工具列:編輯工具切換 + 模擬模式開關。
 */

import type { Editor, Tool } from '../editor/editor';

const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: 'pan', label: '✋ 移動', key: '1' },
  { tool: 'select', label: '▢ 選取', key: '2' },
  { tool: 'road', label: '🛣 馬路', key: '3' },
  { tool: 'sidewalk', label: '🚶 人行道', key: '4' },
  { tool: 'crosswalk', label: '🦓 斑馬線', key: '5' },
  { tool: 'light', label: '🚦 紅綠燈', key: '6' },
  { tool: 'spawn', label: '🚗 出入口', key: '7' },
];

export interface Toolbar {
  /** 進入/離開模擬模式時更新按鈕狀態 */
  setSimMode(on: boolean): void;
}

export function createToolbar(
  container: HTMLElement,
  editor: Editor,
  onSimToggle: () => void
): Toolbar {
  const buttons = new Map<Tool, HTMLButtonElement>();

  for (const { tool, label, key } of TOOLS) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = `快捷鍵 ${key}`;
    btn.addEventListener('click', () => editor.setTool(tool));
    container.appendChild(btn);
    buttons.set(tool, btn);
  }

  const divider = document.createElement('div');
  divider.className = 'divider';
  container.appendChild(divider);

  const simBtn = document.createElement('button');
  simBtn.textContent = '▶ 模擬';
  simBtn.style.color = '#4ade80';
  simBtn.addEventListener('click', onSimToggle);
  container.appendChild(simBtn);

  const sync = (tool: Tool): void => {
    for (const [t, btn] of buttons) btn.classList.toggle('selected', t === tool);
  };
  editor.onToolChange = sync;
  sync('pan');

  return {
    setSimMode(on: boolean): void {
      simBtn.textContent = on ? '■ 停止模擬' : '▶ 模擬';
      simBtn.style.color = on ? '#f87171' : '#4ade80';
      for (const [tool, btn] of buttons) {
        btn.disabled = on && tool !== 'pan';
        btn.style.opacity = btn.disabled ? '0.35' : '';
      }
    },
  };
}
