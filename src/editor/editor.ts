/**
 * 編輯器狀態機:工具切換、pen tool 繪製、選取與拖曳編輯。
 * 互動慣例參考 Figma/Illustrator 的 pen tool。
 */

import type maplibregl from 'maplibre-gl';

import { nearestPointOnCubic, dist, type Vec2 } from '../geometry/bezier';
import { newId, type SceneStore } from '../model/store';
import {
  TW_DEFAULTS,
  type Anchor,
  type GeoPoint,
  type Road,
  type Sidewalk,
} from '../model/types';
import type { Overlay } from './overlay';
import { anchorsToSegments, metersPerPixel, project } from './render';

export type Tool = 'pan' | 'select' | 'road' | 'sidewalk' | 'crosswalk' | 'light' | 'spawn';

export interface DraftPath {
  kind: 'road' | 'sidewalk';
  anchors: Anchor[];
  cursor: Vec2 | null;
  dragging: boolean;
}

/** 提供給 render 的唯讀視圖狀態 */
export interface EditorView {
  tool: Tool;
  selectedId: string | null;
  cursor: Vec2 | null;
  draft: DraftPath | null;
  crosswalkStart: GeoPoint | null;
  /** 按住 Ctrl 多選中的紅綠燈 id(用於組成號誌群組) */
  multiSelect: string[];
}

type DragTarget =
  | { type: 'anchor'; id: string; index: number }
  | { type: 'handle'; id: string; index: number; side: 'hIn' | 'hOut' }
  | { type: 'point'; id: string; field: 'at' | 'a' | 'b' };

const ANCHOR_HIT_PX = 8;
const HANDLE_HIT_PX = 7;
const POINT_HIT_PX = 14;

export class Editor {
  private readonly map: maplibregl.Map;
  private readonly overlay: Overlay;
  private readonly store: SceneStore;

  private tool: Tool = 'pan';
  /** 模擬模式時鎖住編輯操作 */
  locked = false;
  private selectedId: string | null = null;
  private cursor: Vec2 | null = null;
  private draft: DraftPath | null = null;
  private crosswalkStart: GeoPoint | null = null;
  private drag: DragTarget | null = null;
  /** 中鍵拖曳平移時,上一個畫面座標(不受目前工具影響) */
  private middlePan: Vec2 | null = null;
  /** Ctrl+click 多選中的紅綠燈 id,插入順序 = 組內編號 */
  private multiSelect = new Set<string>();

  /** 視圖或選取變更時通知(重繪、更新面板) */
  onViewChange: (() => void) | null = null;
  onSelectionChange: ((id: string | null) => void) | null = null;
  onToolChange: ((tool: Tool) => void) | null = null;
  onMultiSelectChange: ((ids: string[]) => void) | null = null;

  constructor(map: maplibregl.Map, overlay: Overlay, store: SceneStore) {
    this.map = map;
    this.overlay = overlay;
    this.store = store;

    const c = overlay.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('dblclick', (e) => this.onDblClick(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  getView(): EditorView {
    return {
      tool: this.tool,
      selectedId: this.selectedId,
      cursor: this.cursor,
      draft: this.draft,
      crosswalkStart: this.crosswalkStart,
      multiSelect: [...this.multiSelect],
    };
  }

  /** 清空紅綠燈多選(建立群組後或放棄時呼叫) */
  clearMultiSelect(): void {
    if (this.multiSelect.size === 0) return;
    this.multiSelect.clear();
    this.onMultiSelectChange?.([]);
    this.notify();
  }

  setTool(tool: Tool): void {
    if (this.locked && tool !== 'pan') return;
    if (this.tool === tool) return;
    this.commitDraft();
    this.crosswalkStart = null;
    this.clearMultiSelect();
    this.tool = tool;
    this.overlay.setActive(tool !== 'pan');
    this.overlay.canvas.style.cursor = tool === 'select' || tool === 'pan' ? '' : 'crosshair';
    this.onToolChange?.(tool);
    this.notify();
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.onSelectionChange?.(id);
    this.notify();
  }

  private toggleMultiSelect(id: string): void {
    if (this.multiSelect.has(id)) this.multiSelect.delete(id);
    else this.multiSelect.add(id);
    if (this.selectedId !== null) {
      this.selectedId = null;
      this.onSelectionChange?.(null);
    }
    this.onMultiSelectChange?.([...this.multiSelect]);
    this.notify();
  }

  private notify(): void {
    this.onViewChange?.();
  }

  private toGeo(e: PointerEvent | MouseEvent): GeoPoint {
    const rect = this.overlay.canvas.getBoundingClientRect();
    const ll = this.map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return { lng: ll.lng, lat: ll.lat };
  }

  private toScreen(e: PointerEvent | MouseEvent): Vec2 {
    const rect = this.overlay.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ---- pointer events ----

  private onPointerDown(e: PointerEvent): void {
    if (e.button === 1) {
      // 中鍵拖曳平移:任何工具下都可用,不影響原有工具邏輯
      e.preventDefault();
      this.overlay.canvas.setPointerCapture(e.pointerId);
      this.middlePan = this.toScreen(e);
      return;
    }
    if (e.button !== 0 || this.locked) return;
    this.overlay.canvas.setPointerCapture(e.pointerId);
    const screen = this.toScreen(e);
    const geo = this.toGeo(e);

    switch (this.tool) {
      case 'road':
      case 'sidewalk':
        this.penDown(geo, screen);
        break;
      case 'select':
        this.selectDown(screen, e.ctrlKey || e.metaKey);
        break;
      case 'crosswalk':
        if (this.crosswalkStart === null) {
          this.crosswalkStart = geo;
        } else {
          const id = newId('cw');
          this.store.update((s) => {
            s.crosswalks.push({ id, kind: 'crosswalk', a: this.crosswalkStart!, b: geo });
          });
          this.crosswalkStart = null;
          this.select(id);
        }
        this.notify();
        break;
      case 'light': {
        const id = newId('tl');
        this.store.update((s) => {
          s.lights.push({ id, kind: 'light', at: geo, timing: { ...TW_DEFAULTS.signal } });
        });
        this.select(id);
        break;
      }
      case 'spawn': {
        const id = newId('sp');
        this.store.update((s) => {
          s.spawns.push({
            id,
            kind: 'spawn',
            at: geo,
            vehiclesPerHour: TW_DEFAULTS.vehiclesPerHour,
            pedsPerHour: TW_DEFAULTS.pedsPerHour,
          });
        });
        this.select(id);
        break;
      }
      case 'pan':
        break;
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.middlePan !== null) {
      const cur = this.toScreen(e);
      this.map.panBy([this.middlePan.x - cur.x, this.middlePan.y - cur.y], { animate: false });
      this.middlePan = cur;
      return;
    }
    this.cursor = this.toScreen(e);
    const geo = this.toGeo(e);

    if (this.draft !== null) {
      this.draft.cursor = this.cursor;
      if (this.draft.dragging) {
        const last = this.draft.anchors[this.draft.anchors.length - 1];
        if (last !== undefined && dist(project(this.map, last.p), this.cursor) > 3) {
          last.hOut = geo;
          last.hIn = mirror(last.p, geo);
        }
      }
      this.notify();
      return;
    }

    if (this.drag !== null) {
      this.applyDrag(geo, e.altKey);
      return;
    }

    if (this.crosswalkStart !== null) this.notify();
  }

  private onPointerUp(e: PointerEvent): void {
    this.overlay.canvas.releasePointerCapture(e.pointerId);
    if (this.middlePan !== null) {
      this.middlePan = null;
      return;
    }
    if (this.draft !== null) {
      this.draft.dragging = false;
      this.notify();
    }
    this.drag = null;
  }

  private onDblClick(e: MouseEvent): void {
    e.preventDefault();
    if (this.draft !== null) {
      // 雙擊的第二下已多加一個重複錨點,移除後結束
      if (this.draft.anchors.length > 1) this.draft.anchors.pop();
      this.commitDraft();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (this.locked) return;
    switch (e.key) {
      case 'Escape':
        this.draft = null;
        this.crosswalkStart = null;
        this.clearMultiSelect();
        this.select(null);
        this.notify();
        break;
      case 'Enter':
        this.commitDraft();
        break;
      case 'Delete':
      case 'Backspace':
        if (this.selectedId !== null) {
          this.store.removeById(this.selectedId);
          this.select(null);
        }
        break;
      case '1': this.setTool('pan'); break;
      case '2': this.setTool('select'); break;
      case '3': this.setTool('road'); break;
      case '4': this.setTool('sidewalk'); break;
      case '5': this.setTool('crosswalk'); break;
      case '6': this.setTool('light'); break;
      case '7': this.setTool('spawn'); break;
    }
  }

  // ---- pen tool ----

  private penDown(geo: GeoPoint, _screen: Vec2): void {
    if (this.draft === null) {
      this.draft = {
        kind: this.tool === 'road' ? 'road' : 'sidewalk',
        anchors: [],
        cursor: null,
        dragging: false,
      };
    }
    this.draft.anchors.push({ p: geo, hIn: null, hOut: null });
    this.draft.dragging = true;
    this.notify();
  }

  private commitDraft(): void {
    const draft = this.draft;
    this.draft = null;
    if (draft === null || draft.anchors.length < 2) {
      this.notify();
      return;
    }
    const id = newId(draft.kind === 'road' ? 'rd' : 'sw');
    this.store.update((s) => {
      if (draft.kind === 'road') {
        const road: Road = {
          id,
          kind: 'road',
          path: { anchors: draft.anchors },
          lanesForward: 1,
          lanesBackward: 1,
          speedLimit: TW_DEFAULTS.speedLimit,
        };
        s.roads.push(road);
      } else {
        const sw: Sidewalk = { id, kind: 'sidewalk', path: { anchors: draft.anchors } };
        s.sidewalks.push(sw);
      }
    });
    this.select(id);
  }

  // ---- select tool ----

  private selectDown(screen: Vec2, ctrl: boolean): void {
    if (ctrl) {
      // 按住 Ctrl:只用於多選紅綠燈組成號誌群組,不影響其他元素的一般選取
      const scene = this.store.get();
      for (const light of scene.lights) {
        if (dist(project(this.map, light.at), screen) < POINT_HIT_PX) {
          this.toggleMultiSelect(light.id);
          return;
        }
      }
      return;
    }
    this.clearMultiSelect();

    // 1. 已選取路徑的錨點 / handle
    const selectedPath = this.getSelectedPath();
    if (selectedPath !== null) {
      const { id, anchors } = selectedPath;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i]!;
        for (const side of ['hIn', 'hOut'] as const) {
          const h = a[side];
          if (h !== null && dist(project(this.map, h), screen) < HANDLE_HIT_PX) {
            this.drag = { type: 'handle', id, index: i, side };
            return;
          }
        }
        if (dist(project(this.map, a.p), screen) < ANCHOR_HIT_PX) {
          this.drag = { type: 'anchor', id, index: i };
          return;
        }
      }
    }

    // 2. 點狀元素(紅綠燈、spawn)
    const scene = this.store.get();
    for (const el of [...scene.lights, ...scene.spawns]) {
      if (dist(project(this.map, el.at), screen) < POINT_HIT_PX) {
        this.select(el.id);
        this.drag = { type: 'point', id: el.id, field: 'at' };
        return;
      }
    }

    // 3. 斑馬線端點(已選取時)與本體
    for (const cw of scene.crosswalks) {
      if (cw.id === this.selectedId) {
        if (dist(project(this.map, cw.a), screen) < POINT_HIT_PX) {
          this.drag = { type: 'point', id: cw.id, field: 'a' };
          return;
        }
        if (dist(project(this.map, cw.b), screen) < POINT_HIT_PX) {
          this.drag = { type: 'point', id: cw.id, field: 'b' };
          return;
        }
      }
      if (distToSegment(screen, project(this.map, cw.a), project(this.map, cw.b)) < 8) {
        this.select(cw.id);
        return;
      }
    }

    // 4. 道路 / 人行道本體
    const mpp = metersPerPixel(this.map);
    for (const road of scene.roads) {
      const widthPx =
        ((road.lanesForward + road.lanesBackward) * 3.2) / mpp;
      if (this.hitPath(road.path.anchors, screen, Math.max(6, widthPx / 2))) {
        this.select(road.id);
        return;
      }
    }
    for (const sw of scene.sidewalks) {
      if (this.hitPath(sw.path.anchors, screen, 8)) {
        this.select(sw.id);
        return;
      }
    }

    this.select(null);
  }

  private getSelectedPath(): { id: string; anchors: Anchor[] } | null {
    if (this.selectedId === null) return null;
    const s = this.store.get();
    const el =
      s.roads.find((r) => r.id === this.selectedId) ??
      s.sidewalks.find((w) => w.id === this.selectedId);
    return el === undefined ? null : { id: el.id, anchors: el.path.anchors };
  }

  private hitPath(anchors: Anchor[], screen: Vec2, threshold: number): boolean {
    const segs = anchorsToSegments(this.map, anchors);
    return segs.some((seg) => nearestPointOnCubic(seg, screen).distance < threshold);
  }

  private applyDrag(geo: GeoPoint, breakMirror: boolean): void {
    const drag = this.drag;
    if (drag === null) return;
    this.store.update((s) => {
      if (drag.type === 'point') {
        const el = this.store.findById(drag.id);
        if (el === undefined) return;
        if (drag.field === 'at' && (el.kind === 'light' || el.kind === 'spawn')) {
          el.at = geo;
        } else if (el.kind === 'crosswalk' && (drag.field === 'a' || drag.field === 'b')) {
          el[drag.field] = geo;
        }
        return;
      }
      const path =
        s.roads.find((r) => r.id === drag.id)?.path ??
        s.sidewalks.find((w) => w.id === drag.id)?.path;
      const a = path?.anchors[drag.index];
      if (a === undefined) return;
      if (drag.type === 'anchor') {
        const dLng = geo.lng - a.p.lng;
        const dLat = geo.lat - a.p.lat;
        a.p = geo;
        if (a.hIn !== null) a.hIn = { lng: a.hIn.lng + dLng, lat: a.hIn.lat + dLat };
        if (a.hOut !== null) a.hOut = { lng: a.hOut.lng + dLng, lat: a.hOut.lat + dLat };
      } else {
        a[drag.side] = geo;
        // 預設對稱鏡射,按住 Alt 拆開
        const other = drag.side === 'hIn' ? 'hOut' : 'hIn';
        if (!breakMirror && a[other] !== null) {
          a[other] = mirror(a.p, geo);
        }
      }
    });
  }
}

function mirror(center: GeoPoint, h: GeoPoint): GeoPoint {
  return { lng: 2 * center.lng - h.lng, lat: 2 * center.lat - h.lat };
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}
