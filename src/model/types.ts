/**
 * 場景資料模型。所有座標存地理座標 (lng/lat, WGS84),
 * 只在渲染與模擬時才投影成螢幕或局部平面座標。
 */

/** WGS84 地理座標 */
export interface GeoPoint {
  lng: number;
  lat: number;
}

/**
 * Bézier spline 的錨點。相鄰兩錨點構成一段 cubic Bézier:
 * P0 = a[i].p, C1 = a[i].hOut ?? a[i].p, C2 = a[i+1].hIn ?? a[i+1].p, P3 = a[i+1].p
 * handle 為 null 表示該側退化為直線。
 */
export interface Anchor {
  p: GeoPoint;
  hIn: GeoPoint | null;
  hOut: GeoPoint | null;
}

/** 開放式 Bézier spline 路徑 */
export interface BezierPath {
  anchors: Anchor[];
}

/** 馬路(台灣規則:靠右行駛;forward = 沿繪製方向) */
export interface Road {
  id: string;
  kind: 'road';
  path: BezierPath;
  /** 順向車道數(MVP 固定 1) */
  lanesForward: number;
  /** 逆向車道數(0 = 單行道) */
  lanesBackward: number;
  /** 速限 km/h(台灣市區預設 50) */
  speedLimit: number;
}

/** 人行道 */
export interface Sidewalk {
  id: string;
  kind: 'sidewalk';
  path: BezierPath;
}

/** 斑馬線:一條橫跨馬路的線段,連接兩側人行道 */
export interface Crosswalk {
  id: string;
  kind: 'crosswalk';
  a: GeoPoint;
  b: GeoPoint;
}

/** 紅綠燈時相設定(fixed-time) */
export interface SignalTiming {
  /** 綠燈秒數 */
  green: number;
  /** 黃燈秒數 */
  yellow: number;
  /** 全紅秒數(行人時相在對向綠燈時放行) */
  allRed: number;
}

/** 紅綠燈,放置於路口;graph build 時 snap 到最近的 intersection node */
export interface TrafficLight {
  id: string;
  kind: 'light';
  at: GeoPoint;
  timing: SignalTiming;
}

/** 車流/人流的產生點,graph build 時 snap 到最近的路網端點 */
export interface SpawnPoint {
  id: string;
  kind: 'spawn';
  at: GeoPoint;
  /** 每小時進入車輛數 */
  vehiclesPerHour: number;
  /** 每小時進入行人數 */
  pedsPerHour: number;
}

export type SceneElement = Road | Sidewalk | Crosswalk | TrafficLight | SpawnPoint;
export type ElementKind = SceneElement['kind'];

/** 完整場景(可序列化) */
export interface Scene {
  version: 1;
  name: string;
  roads: Road[];
  sidewalks: Sidewalk[];
  crosswalks: Crosswalk[];
  lights: TrafficLight[];
  spawns: SpawnPoint[];
}

/** 台灣市區預設值 */
export const TW_DEFAULTS = {
  speedLimit: 50,
  signal: { green: 40, yellow: 3, allRed: 2 } satisfies SignalTiming,
  vehiclesPerHour: 300,
  pedsPerHour: 60,
} as const;

/** 建立空場景 */
export function emptyScene(name = '未命名場景'): Scene {
  return {
    version: 1,
    name,
    roads: [],
    sidewalks: [],
    crosswalks: [],
    lights: [],
    spawns: [],
  };
}
