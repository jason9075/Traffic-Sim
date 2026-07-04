/**
 * 場景狀態管理:單一 Scene 物件 + 變更通知 + localStorage 自動存檔。
 */

import { emptyScene, type LaneDirection, type Road, type Scene, type SceneElement } from './types';

const STORAGE_KEY = 'traffic-sim:scene';
const AUTOSAVE_DELAY_MS = 800;

export type StoreListener = (scene: Scene) => void;

export class SceneStore {
  private scene: Scene;
  private listeners = new Set<StoreListener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.scene = loadFromStorage() ?? emptyScene();
  }

  get(): Scene {
    return this.scene;
  }

  subscribe(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 以 mutator 修改場景後廣播並排程自動存檔 */
  update(mutator: (scene: Scene) => void): void {
    mutator(this.scene);
    this.notify();
  }

  replace(scene: Scene): void {
    this.scene = scene;
    this.notify();
  }

  /** 依 id 找元素(所有類型) */
  findById(id: string): SceneElement | undefined {
    const s = this.scene;
    return (
      s.roads.find((e) => e.id === id) ??
      s.sidewalks.find((e) => e.id === id) ??
      s.lights.find((e) => e.id === id) ??
      s.spawns.find((e) => e.id === id)
    );
  }

  removeById(id: string): void {
    this.update((s) => {
      s.roads = s.roads.filter((e) => e.id !== id);
      s.sidewalks = s.sidewalks.filter((e) => e.id !== id);
      s.lights = s.lights.filter((e) => e.id !== id);
      s.spawns = s.spawns.filter((e) => e.id !== id);
      s.lightGroups = s.lightGroups
        .map((g) => ({ ...g, lightIds: g.lightIds.filter((lid) => lid !== id) }))
        .filter((g) => g.lightIds.length > 1);
      s.laneConnections = s.laneConnections.filter(
        (c) => c.fromRoadId !== id && c.toRoadId !== id
      );
    });
  }

  /** 移除單一路口連線規劃 */
  removeLaneConnection(id: string): void {
    this.update((s) => {
      s.laneConnections = s.laneConnections.filter((c) => c.id !== id);
    });
  }

  /** 調整車道數,同步裁切/補齊 laneDirections,並移除索引超出新車道數的 laneConnections */
  setRoadLanes(roadId: string, lanes: number): void {
    this.update((s) => {
      const road = s.roads.find((r) => r.id === roadId);
      if (road === undefined) return;
      road.lanes = lanes;
      road.laneDirections = normalizeLaneDirections(road.laneDirections, lanes);
      s.laneConnections = s.laneConnections.filter(
        (c) => !(c.fromRoadId === roadId && c.fromLane >= lanes) && !(c.toRoadId === roadId && c.toLane >= lanes)
      );
    });
  }

  exportJson(): string {
    return JSON.stringify(this.scene, null, 2);
  }

  importJson(json: string): void {
    const parsed: unknown = JSON.parse(json);
    if (!isScene(parsed)) {
      throw new Error('無效的場景檔:格式不符');
    }
    this.replace(normalizeScene(parsed));
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.scene);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.scene));
      } catch (err) {
        console.warn('自動存檔失敗', err);
      }
    }, AUTOSAVE_DELAY_MS);
  }
}

function loadFromStorage(): Scene | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isScene(parsed) ? normalizeScene(parsed) : null;
  } catch {
    return null;
  }
}

function isScene(v: unknown): v is Scene {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    s.version === 1 &&
    Array.isArray(s.roads) &&
    Array.isArray(s.sidewalks) &&
    Array.isArray(s.lights) &&
    Array.isArray(s.spawns)
  );
}

/**
 * 補上舊存檔沒有的欄位(lightGroups、laneConnections),
 * 並把舊版雙向車道欄位(lanesForward/lanesBackward)遷移成 lanes,補齊 laneDirections。
 */
function normalizeScene(s: Scene): Scene {
  return {
    ...s,
    lightGroups: Array.isArray(s.lightGroups) ? s.lightGroups : [],
    laneConnections: Array.isArray(s.laneConnections) ? s.laneConnections : [],
    roads: s.roads.map(normalizeRoad),
  };
}

function normalizeRoad(r: Road): Road {
  const legacy = r as unknown as Record<string, unknown>;
  const lanes =
    typeof legacy.lanesForward === 'number'
      ? legacy.lanesForward + (typeof legacy.lanesBackward === 'number' ? legacy.lanesBackward : 0)
      : r.lanes;
  return {
    id: r.id,
    kind: 'road',
    path: r.path,
    lanes,
    speedLimit: r.speedLimit,
    laneDirections: normalizeLaneDirections(legacy.laneDirections as LaneDirection[] | undefined, lanes),
  };
}

/** 補齊/裁切車道方向陣列到指定長度,缺的補 'forward' */
function normalizeLaneDirections(existing: LaneDirection[] | undefined, lanes: number): LaneDirection[] {
  const arr = Array.isArray(existing) ? existing : [];
  return Array.from({ length: lanes }, (_, i) => arr[i] ?? 'forward');
}

/** 產生元素 id */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
