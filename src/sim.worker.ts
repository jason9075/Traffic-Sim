/**
 * 模擬 Worker:fixed timestep 前進,定期回傳渲染快照。
 */

import { SimEngine } from './sim/engine';
import type { MainToWorker, SnapshotMsg } from './sim/protocol';
import type { SignalTiming } from './model/types';
import type { Network } from './geometry/network';
import type { PedNetwork } from './geometry/pednet';

const DT = 0.1;
const TICK_MS = 50;

let engine: SimEngine | null = null;
let net: Network | null = null;
let pedNet: PedNetwork | null = null;
let timings: Map<string, SignalTiming> = new Map();
let seed = 1;
let speedMult = 1;
let accumulator = 0;

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      net = msg.net;
      pedNet = msg.pedNet;
      timings = new Map(msg.timings);
      seed = msg.seed;
      engine = new SimEngine(net, timings, seed, pedNet);
      accumulator = 0;
      break;
    case 'setSpeed':
      speedMult = msg.mult;
      break;
    case 'reset':
      if (net !== null) engine = new SimEngine(net, timings, seed, pedNet);
      accumulator = 0;
      break;
  }
};

setInterval(() => {
  if (engine === null) return;
  if (speedMult > 0) {
    accumulator += (TICK_MS / 1000) * speedMult;
    // 高倍速時限制單次 tick 的步數,避免卡死
    let steps = 0;
    while (accumulator >= DT && steps < 400) {
      engine.step(DT);
      accumulator -= DT;
      steps++;
    }
  }

  const buf = engine.snapshotBuffer();
  const pedBuf = engine.snapshotPedBuffer();
  const ab = buf.buffer as ArrayBuffer;
  const pedAb = pedBuf.buffer as ArrayBuffer;
  const msg: SnapshotMsg = {
    type: 'snapshot',
    buf: ab,
    n: buf.length / 4,
    pedBuf: pedAb,
    nPeds: pedBuf.length / 3,
    stats: engine.stats(),
    flows: engine.edgeFlows(),
    signals: engine.signals().map((s) => ({
      nodeId: s.nodeId,
      colors: [...s.colors.entries()],
    })),
  };
  (self as unknown as Worker).postMessage(msg, [ab, pedAb]);
}, TICK_MS);
