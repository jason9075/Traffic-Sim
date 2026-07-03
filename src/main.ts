/**
 * 進入點:組裝地圖、overlay、store、編輯器與 UI。
 */

import { Editor } from './editor/editor';
import { Overlay } from './editor/overlay';
import { renderScene } from './editor/render';
import { createMap } from './map/map';
import { SceneStore } from './model/store';
import { createPanel } from './ui/panel';
import { createToolbar } from './ui/toolbar';

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`找不到 #${id}`);
  return el;
}

const map = createMap(mustGet('map'));
const store = new SceneStore();
const overlay = new Overlay(mustGet('overlay') as HTMLCanvasElement, map);
const editor = new Editor(map, overlay, store);

createToolbar(mustGet('toolbar'), editor);
createPanel(mustGet('panel'), map, store, editor);

// rAF 去抖動的重繪
let rafId: number | null = null;
function requestRender(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    overlay.resize();
    const ctx = overlay.beginFrame();
    renderScene(ctx, map, store.get(), editor.getView());
  });
}

map.on('render', requestRender);
store.subscribe(requestRender);
editor.onViewChange = requestRender;
map.on('load', requestRender);
