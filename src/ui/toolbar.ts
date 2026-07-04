/**
 * 上方工具列:編輯工具切換 + 模擬模式開關。
 */

import type { Editor, Tool } from '../editor/editor';

const TOOLS: Array<{ tool: Tool; icon: string; text: string; key: string }> = [
  { tool: 'pan', icon: '✋', text: '移動', key: '1' },
  { tool: 'select', icon: '▢', text: '選取', key: '2' },
  { tool: 'road', icon: '🛣', text: '馬路', key: '3' },
  { tool: 'sidewalk', icon: '🚶', text: '人行道', key: '4' },
  { tool: 'light', icon: '🚦', text: '紅綠燈', key: '5' },
  { tool: 'spawn', icon: '🚗', text: '出入口', key: '6' },
];

export interface Toolbar {
  /** 進入/離開模擬模式時更新按鈕狀態 */
  setSimMode(on: boolean): void;
}

/** icon 與文字分開包 span,手機版可用 CSS 只隱藏文字,縮小按鈕避免超出螢幕 */
function buttonContent(icon: string, text: string): string {
  return `<span class="tool-icon">${icon}</span><span class="tool-label"> ${text}</span>`;
}

export function createToolbar(
  container: HTMLElement,
  editor: Editor,
  onSimToggle: () => void
): Toolbar {
  const buttons = new Map<Tool, HTMLButtonElement>();

  for (const { tool, icon, text, key } of TOOLS) {
    const btn = document.createElement('button');
    btn.innerHTML = buttonContent(icon, text);
    btn.title = `快捷鍵 ${key}`;
    btn.addEventListener('click', () => editor.setTool(tool));
    container.appendChild(btn);
    buttons.set(tool, btn);
  }

  const divider = document.createElement('div');
  divider.className = 'divider';
  container.appendChild(divider);

  const simBtn = document.createElement('button');
  simBtn.innerHTML = buttonContent('▶', '模擬');
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
      simBtn.innerHTML = on ? buttonContent('■', '停止模擬') : buttonContent('▶', '模擬');
      simBtn.style.color = on ? '#f87171' : '#4ade80';
      for (const [tool, btn] of buttons) {
        btn.disabled = on && tool !== 'pan';
        btn.style.opacity = btn.disabled ? '0.35' : '';
      }
    },
  };
}
