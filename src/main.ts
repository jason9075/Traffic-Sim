/**
 * 進入點:組裝地圖、overlay、store、編輯器、UI 與模擬模式。
 */

import { Editor } from './editor/editor';
import { attachKeyboardPan } from './editor/keyboardPan';
import { Overlay } from './editor/overlay';
import { renderScene } from './editor/render';
import { buildNetwork, type Network } from './geometry/network';
import { buildPedNetwork, type PedNetwork } from './geometry/pednet';
import { createProjection, type LocalProjection } from './geometry/projection';
import { createMap } from './map/map';
import { SceneStore } from './model/store';
import { renderSim, type SimFrame } from './render/simRender';
import type { MainToWorker, WorkerToMain } from './sim/protocol';
import { createPanel } from './ui/panel';
import { createSimPanel, type SimPanel } from './ui/sim-panel';
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
const panelEl = mustGet('panel');
attachKeyboardPan(map);

// ---- 模擬模式 ----

interface SimSession {
  worker: Worker;
  net: Network;
  pedNet: PedNetwork;
  proj: LocalProjection;
  panel: SimPanel;
  frame: SimFrame | null;
}

let sim: SimSession | null = null;

function enterSim(): void {
  const scene = store.get();
  if (scene.roads.length === 0) {
    alert('請先用 🛣 馬路工具畫至少一條路。');
    return;
  }
  if (scene.spawns.length < 2) {
    alert('需要至少兩個 🚗 出入口(放在道路端點附近)才能產生車流。');
    return;
  }
  const net = buildNetwork(scene);
  if (net.spawns.length < 2) {
    alert('出入口離路網太遠,請把 🚗 放在道路端點附近。');
    return;
  }

  editor.setTool('pan');
  editor.locked = true;
  editor.select(null);

  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  const pedNet = buildPedNetwork(scene, net);
  const lightOffsets: Array<[string, number]> = scene.lightGroups.flatMap((g) =>
    g.lightIds.map((lid) => [lid, g.offsetSec] as [string, number])
  );
  const init: MainToWorker = {
    type: 'init',
    net,
    pedNet,
    timings: scene.lights.map((l) => [l.id, l.timing]),
    lightOffsets,
    seed: 12345,
  };
  worker.postMessage(init);

  const panel = createSimPanel(
    panelEl,
    (mult) => worker.postMessage({ type: 'setSpeed', mult } satisfies MainToWorker),
    () => worker.postMessage({ type: 'reset' } satisfies MainToWorker)
  );

  sim = { worker, net, pedNet, proj: createProjection(net.origin), panel, frame: null };
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__sim = sim;
  }
  worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
    const msg = ev.data;
    if (msg.type !== 'snapshot' || sim === null) return;
    sim.frame = {
      buf: new Float32Array(msg.buf),
      n: msg.n,
      pedBuf: new Float32Array(msg.pedBuf),
      nPeds: msg.nPeds,
      flows: msg.flows,
      signals: msg.signals,
    };
    sim.panel.update(msg.stats);
    requestRender();
  };
  worker.onerror = (err) => {
    console.error('模擬 worker 錯誤', err);
    exitSim();
    alert('模擬發生錯誤,已停止。');
  };
  toolbar.setSimMode(true);
}

function exitSim(): void {
  if (sim === null) return;
  sim.worker.terminate();
  sim.panel.destroy();
  sim = null;
  editor.locked = false;
  toolbar.setSimMode(false);
  requestRender();
}

const toolbar = createToolbar(mustGet('toolbar'), editor, () => {
  if (sim === null) enterSim();
  else exitSim();
});
createPanel(panelEl, map, store, editor);

// ---- 渲染迴圈(rAF 去抖動) ----

let rafId: number | null = null;
function requestRender(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    overlay.resize();
    const ctx = overlay.beginFrame();
    renderScene(ctx, map, store.get(), editor.getView());
    if (sim !== null && sim.frame !== null) {
      renderSim(ctx, map, sim.proj, sim.net, sim.frame);
    }
  });
}

map.on('render', requestRender);
store.subscribe(requestRender);
editor.onViewChange = requestRender;
map.on('load', requestRender);
