/**
 * 主執行緒 ↔ 模擬 Worker 的訊息協定。
 */

import type { Network } from '../geometry/network';
import type { PedNetwork } from '../geometry/pednet';
import type { SignalTiming } from '../model/types';
import type { EdgeFlow, SimStats } from './engine';
import type { LightColor } from './signals';

export type MainToWorker =
  | {
      type: 'init';
      net: Network;
      pedNet: PedNetwork;
      timings: Array<[string, SignalTiming]>;
      seed: number;
    }
  | { type: 'setSpeed'; mult: number }
  | { type: 'reset' };

export interface SerializedSignal {
  nodeId: number;
  colors: Array<[number, LightColor]>;
}

export interface SnapshotMsg {
  type: 'snapshot';
  /** [x, y, angle, v] × n(局部公尺座標) */
  buf: ArrayBuffer;
  n: number;
  /** [x, y, waiting] × nPeds */
  pedBuf: ArrayBuffer;
  nPeds: number;
  stats: SimStats;
  flows: EdgeFlow[];
  signals: SerializedSignal[];
}

export type WorkerToMain = SnapshotMsg;
