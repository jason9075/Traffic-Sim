import { describe, expect, test } from 'bun:test';

import { buildNetwork } from '../src/geometry/network';
import { buildSignalPlans, evalSignals } from '../src/sim/signals';
import { emptyScene, type Anchor, type GeoPoint, type Road, type Scene, type SignalTiming } from '../src/model/types';

const BASE: GeoPoint = { lng: 121.5654, lat: 25.033 };
const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG = 111320 * Math.cos((BASE.lat * Math.PI) / 180);

function geo(x: number, y: number): GeoPoint {
  return { lng: BASE.lng + x / M_PER_DEG_LNG, lat: BASE.lat + y / M_PER_DEG_LAT };
}
function anchor(x: number, y: number): Anchor {
  return { p: geo(x, y), hIn: null, hOut: null };
}
function road(id: string, from: [number, number], to: [number, number]): Road {
  return {
    id, kind: 'road',
    path: { anchors: [anchor(...from), anchor(...to)] },
    lanes: 1, speedLimit: 50,
  };
}

function crossScene(): { scene: Scene; timing: SignalTiming } {
  const scene = emptyScene('t');
  scene.roads = [road('ew', [-100, 0], [100, 0]), road('ns', [0, -100], [0, 100])];
  const timing: SignalTiming = { green: 20, yellow: 3, allRed: 2 };
  scene.lights = [{ id: 'L1', kind: 'light', at: geo(0, 0), timing }];
  return { scene, timing };
}

describe('buildSignalPlans / evalSignals 的組間時間差', () => {
  test('offsetSec=0 時與原本行為一致', () => {
    const { scene } = crossScene();
    const net = buildNetwork(scene);
    const plans = buildSignalPlans(net, new Map([['L1', scene.lights[0]!.timing]]));
    expect(plans[0]!.offsetSec).toBe(0);
    const [colorA] = evalSignals(plans, 5)[0]!.groupColors;
    expect(colorA).toBe('green');
  });

  test('offsetSec 會把週期往後平移,錯開的組在同一時刻可能不同色', () => {
    const { scene } = crossScene();
    const net = buildNetwork(scene);
    const timings = new Map([['L1', scene.lights[0]!.timing]]);

    const plansNoOffset = buildSignalPlans(net, timings);
    const plansOffset = buildSignalPlans(net, timings, new Map([['L1', 25]]));
    expect(plansOffset[0]!.offsetSec).toBe(25);

    const t = 5;
    const stateNoOffset = evalSignals(plansNoOffset, t)[0]!;
    const stateOffset = evalSignals(plansOffset, t)[0]!;
    // cycle = 2*(20+3+2) = 50;offset 25 = 半週期,兩相位應該對調
    expect(stateNoOffset.groupColors[0]).toBe('green');
    expect(stateOffset.groupColors[0]).toBe('red');
  });

  test('負數 offsetSec 也能正確 wrap', () => {
    const { scene } = crossScene();
    const net = buildNetwork(scene);
    const timings = new Map([['L1', scene.lights[0]!.timing]]);
    const plans = buildSignalPlans(net, timings, new Map([['L1', -25]]));
    const state = evalSignals(plans, 5)[0]!;
    expect(state.groupColors[0]).toBe('red');
  });
});
