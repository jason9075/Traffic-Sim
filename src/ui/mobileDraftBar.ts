/**
 * 手機版繪製路徑時的底部確定/取消按鈕。
 * 觸控裝置沒有鍵盤(Enter/Esc)、雙擊手勢也不可靠,改用明確的按鈕結束繪製。
 * 只在粗指標裝置(觸控)顯示,由 CSS media query 控制,滑鼠裝置維持原本雙擊/Enter 流程。
 */

import type { Editor } from '../editor/editor';

export interface MobileDraftBar {
  /** 依目前 EditorView 狀態同步顯示/隱藏 */
  sync(): void;
}

export function createMobileDraftBar(container: HTMLElement, editor: Editor): MobileDraftBar {
  const bar = document.createElement('div');
  bar.id = 'mobile-draft-bar';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mobile-bar-btn cancel';
  cancelBtn.textContent = '✕ 取消';
  cancelBtn.addEventListener('click', () => editor.cancelDraft());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'mobile-bar-btn confirm';
  confirmBtn.textContent = '✓ 確定';
  confirmBtn.addEventListener('click', () => editor.finishDraft());

  bar.append(cancelBtn, confirmBtn);
  container.appendChild(bar);

  return {
    sync(): void {
      bar.classList.toggle('visible', editor.getView().draft !== null);
    },
  };
}
