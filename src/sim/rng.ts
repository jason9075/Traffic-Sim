/**
 * 可重現的偽隨機數(mulberry32)。模擬需要決定性,不用 Math.random。
 */

export type Rng = () => number;

/** 回傳 [0,1) 均勻分布的 seeded RNG */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 指數分布抽樣(Poisson 到達間隔),rate = 每秒事件數 */
export function expSample(rng: Rng, rate: number): number {
  return -Math.log(1 - rng()) / rate;
}
