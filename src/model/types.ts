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

/** 車道方向標籤:去向(順著繪製方向)、來向(逆著繪製方向)、雙向(兩向皆可) */
export type LaneDirection = 'forward' | 'backward' | 'both';

/**
 * 馬路。一律單向(沿繪製方向前進),車道間以白色虛線分隔。
 * 雙向道路請另外反向再拉一條路。
 */
export interface Road {
  id: string;
  kind: 'road';
  path: BezierPath;
  /** 車道數 */
  lanes: number;
  /** 每條車道的方向標籤,長度等於 lanes,索引對應車道排列順序 */
  laneDirections: LaneDirection[];
  /** 速限 km/h(台灣市區預設 50) */
  speedLimit: number;
}

/** 人行道 */
export interface Sidewalk {
  id: string;
  kind: 'sidewalk';
  path: BezierPath;
}

/**
 * 斑馬線:一條橫跨馬路的線段,連接兩側人行道。
 * 由 geometry/crosswalks.ts 依人行道與馬路的幾何交叉點自動推導,不手動鋪設、不存進 Scene。
 */
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

export type SceneElement = Road | Sidewalk | TrafficLight | SpawnPoint;
export type ElementKind = SceneElement['kind'];

/**
 * 一個路口的號誌燈群組:同路口的多顆燈(各方向各一顆)歸為一組,
 * 組內依 lightIds 順序自動編號;不同組(=不同路口)可設定 offsetSec 讓週期互相錯開。
 */
export interface LightGroup {
  id: string;
  label: string;
  lightIds: string[];
  /** 與全域模擬時間的相位差(秒) */
  offsetSec: number;
}

/**
 * 路口內兩條路特定車道端點的連線規劃。純使用者標記,只影響編輯器視覺化,不影響模擬。
 * end 只接受頭尾端點,不支援 T 字路口中段(被穿過的那條路在觸碰點沒有真正的車道端點)。
 */
export interface LaneConnection {
  id: string;
  fromRoadId: string;
  fromLane: number;
  fromEnd: 'head' | 'tail';
  toRoadId: string;
  toLane: number;
  toEnd: 'head' | 'tail';
}

/** 完整場景(可序列化) */
export interface Scene {
  version: 1;
  name: string;
  roads: Road[];
  sidewalks: Sidewalk[];
  lights: TrafficLight[];
  spawns: SpawnPoint[];
  lightGroups: LightGroup[];
  laneConnections: LaneConnection[];
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
    lights: [],
    spawns: [],
    lightGroups: [],
    laneConnections: [],
  };
}
