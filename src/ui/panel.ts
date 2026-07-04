/**
 * 右側面板:地點搜尋、選取元素屬性、場景匯出/匯入。
 */

import type maplibregl from 'maplibre-gl';

import type { Editor } from '../editor/editor';
import { geocode } from '../map/map';
import { newId, type SceneStore } from '../model/store';
import type { LightGroup } from '../model/types';

/** 手機版(pointer: coarse)右側收合圖示對應的面板 key */
type DockPanel = 'search' | 'props' | 'scene';

export function createPanel(
  container: HTMLElement,
  map: maplibregl.Map,
  store: SceneStore,
  editor: Editor
): void {
  const searchBox = document.createElement('div');
  searchBox.className = 'panel-box';
  searchBox.dataset.panel = 'search';
  container.appendChild(searchBox);

  const groupBox = document.createElement('div');
  groupBox.className = 'panel-box';
  groupBox.style.display = 'none';
  container.appendChild(groupBox);

  const propsBox = document.createElement('div');
  propsBox.className = 'panel-box';
  propsBox.dataset.panel = 'props';
  propsBox.style.display = 'none';
  container.appendChild(propsBox);

  const sceneBox = document.createElement('div');
  sceneBox.className = 'panel-box';
  sceneBox.dataset.panel = 'scene';
  container.appendChild(sceneBox);
  buildSceneBox(sceneBox, store, editor);

  // 手機版:右邊界圖示 dock,點擊展開對應面板(同時只開一個),避免面板一直遮住地圖
  const dock = document.createElement('div');
  dock.id = 'panel-dock';
  container.parentElement?.appendChild(dock);

  const boxes: Record<DockPanel, HTMLElement> = { search: searchBox, props: propsBox, scene: sceneBox };
  const searchIcon = dockIcon('🔍', '地點搜尋');
  const propsIcon = dockIcon('✎', '屬性');
  const sceneIcon = dockIcon('🗂', '場景');
  propsIcon.style.display = 'none'; // 只有選取元素時才出現
  dock.append(searchIcon, propsIcon, sceneIcon);
  const icons: Record<DockPanel, HTMLButtonElement> = { search: searchIcon, props: propsIcon, scene: sceneIcon };

  function closeAllPanels(): void {
    for (const key of Object.keys(boxes) as DockPanel[]) {
      boxes[key].classList.remove('open');
      icons[key].classList.remove('active');
    }
  }
  function openPanel(name: DockPanel): void {
    closeAllPanels();
    boxes[name].classList.add('open');
    icons[name].classList.add('active');
  }
  function togglePanel(name: DockPanel): void {
    if (boxes[name].classList.contains('open')) closeAllPanels();
    else openPanel(name);
  }

  searchIcon.addEventListener('click', () => togglePanel('search'));
  sceneIcon.addEventListener('click', () => togglePanel('scene'));
  propsIcon.addEventListener('click', () => {
    if (boxes.props.classList.contains('open')) {
      closeAllPanels();
      return;
    }
    renderProps(propsBox, store, editor, editor.getView().selectedId);
    openPanel('props');
  });

  buildSearch(searchBox, map, closeAllPanels);

  editor.onSelectionChange = (id) => {
    renderProps(propsBox, store, editor, id);
    propsIcon.style.display = id !== null ? '' : 'none';
    if (id !== null) openPanel('props');
    else if (boxes.props.classList.contains('open')) closeAllPanels();
  };
  editor.onMultiSelectChange = (ids) => renderGroupBuilder(groupBox, store, editor, ids);
}

function dockIcon(icon: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'dock-icon';
  btn.textContent = icon;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}

function renderGroupBuilder(box: HTMLElement, store: SceneStore, editor: Editor, ids: string[]): void {
  if (ids.length < 2) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  box.innerHTML = '<h3>號誌群組</h3>';
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = `已選取 ${ids.length} 個紅綠燈,建立群組後將依選取順序自動編號。`;
  box.appendChild(hint);

  const btn = smallButton('建立群組(此路口)');
  btn.style.marginTop = '8px';
  btn.addEventListener('click', () => {
    store.update((s) => {
      s.lightGroups.push({
        id: newId('lgrp'),
        label: nextGroupLabel(s.lightGroups),
        lightIds: [...ids],
        offsetSec: 0,
      });
    });
    editor.clearMultiSelect();
  });
  box.appendChild(btn);
}

function nextGroupLabel(existing: LightGroup[]): string {
  return `${String.fromCharCode(65 + (existing.length % 26))}小組`;
}

function buildSearch(box: HTMLElement, map: maplibregl.Map, onPicked: () => void): void {
  box.innerHTML = '<h3>地點搜尋</h3>';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '搜尋台灣地點,Enter 送出';
  const results = document.createElement('div');
  results.className = 'search-results';
  box.append(input, results);

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || input.value.trim() === '') return;
    results.textContent = '搜尋中…';
    try {
      const hits = await geocode(input.value.trim());
      results.textContent = hits.length === 0 ? '查無結果' : '';
      for (const hit of hits) {
        const btn = document.createElement('button');
        btn.textContent = hit.name;
        btn.addEventListener('click', () => {
          map.flyTo({ center: [hit.lng, hit.lat], zoom: 17 });
          onPicked(); // 手機版:選好地點後收合搜尋面板,避免一直遮住地圖
        });
        results.appendChild(btn);
      }
    } catch (err) {
      results.textContent = '搜尋失敗,稍後再試';
      console.error('geocode 失敗', err);
    }
  });
}

function buildSceneBox(box: HTMLElement, store: SceneStore, editor: Editor): void {
  box.innerHTML = '<h3>場景</h3>';

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    '快捷鍵 1–7 切換工具。畫路:點擊放錨點、按住拖曳拉出弧度,雙擊或 Enter 結束,Esc 取消。Delete 刪除選取。';
  box.appendChild(hint);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  box.appendChild(row);

  const exportBtn = smallButton('匯出 JSON');
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'traffic-scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importBtn = smallButton('匯入');
  importBtn.addEventListener('click', () => {
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/json';
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (f === undefined) return;
      try {
        store.importJson(await f.text());
      } catch (err) {
        alert(`匯入失敗:${err instanceof Error ? err.message : String(err)}`);
      }
    });
    file.click();
  });

  const clearBtn = smallButton('清空');
  clearBtn.addEventListener('click', () => {
    if (confirm('確定清空整個場景?')) {
      editor.select(null);
      store.update((s) => {
        s.roads = [];
        s.sidewalks = [];
        s.crosswalks = [];
        s.lights = [];
        s.spawns = [];
        s.lightGroups = [];
      });
    }
  });

  row.append(exportBtn, importBtn, clearBtn);
}

function renderProps(
  box: HTMLElement,
  store: SceneStore,
  editor: Editor,
  id: string | null
): void {
  if (id === null) {
    box.style.display = 'none';
    return;
  }
  const el = store.findById(id);
  if (el === undefined) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  box.innerHTML = `<h3>${kindLabel(el.kind)}</h3>`;

  switch (el.kind) {
    case 'road':
      box.appendChild(
        numberField('速限 (km/h)', el.speedLimit, 10, 110, (v) => {
          store.update(() => { el.speedLimit = v; });
        })
      );
      break;
    case 'light': {
      box.appendChild(
        numberField('綠燈 (秒)', el.timing.green, 5, 180, (v) => {
          store.update(() => { el.timing.green = v; });
        })
      );
      box.appendChild(
        numberField('黃燈 (秒)', el.timing.yellow, 1, 10, (v) => {
          store.update(() => { el.timing.yellow = v; });
        })
      );
      box.appendChild(
        numberField('全紅 (秒)', el.timing.allRed, 0, 10, (v) => {
          store.update(() => { el.timing.allRed = v; });
        })
      );

      const group = store.get().lightGroups.find((g) => g.lightIds.includes(id));
      if (group !== undefined) {
        const idx = group.lightIds.indexOf(id) + 1;
        const header = document.createElement('p');
        header.className = 'hint';
        header.style.marginTop = '8px';
        header.textContent = `所屬群組:第 ${idx}/${group.lightIds.length} 顆`;
        box.appendChild(header);
        box.appendChild(
          textField('群組名稱', group.label, (v) => {
            store.update(() => { group.label = v; });
          })
        );
        box.appendChild(
          numberField('與其他組時間差 (秒)', group.offsetSec, -300, 300, (v) => {
            store.update(() => { group.offsetSec = v; });
          })
        );
        const leave = smallButton('移出此群組');
        leave.addEventListener('click', () => {
          store.update((s) => {
            s.lightGroups = s.lightGroups
              .map((g) => (g.id === group.id ? { ...g, lightIds: g.lightIds.filter((lid) => lid !== id) } : g))
              .filter((g) => g.lightIds.length > 1);
          });
          renderProps(box, store, editor, id);
        });
        box.appendChild(leave);
      } else {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.style.marginTop = '8px';
        hint.textContent = '按住 Ctrl 點選同路口的其他紅綠燈可建立群組。';
        box.appendChild(hint);
      }
      break;
    }
    case 'spawn':
      box.appendChild(
        numberField('車流量 (輛/小時)', el.vehiclesPerHour, 0, 3000, (v) => {
          store.update(() => { el.vehiclesPerHour = v; });
        })
      );
      box.appendChild(
        numberField('人流量 (人/小時)', el.pedsPerHour, 0, 3000, (v) => {
          store.update(() => { el.pedsPerHour = v; });
        })
      );
      break;
    case 'sidewalk':
    case 'crosswalk':
      break;
  }

  const del = smallButton('刪除此元素');
  del.style.marginTop = '8px';
  del.addEventListener('click', () => {
    store.removeById(id);
    editor.select(null);
  });
  box.appendChild(del);
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    road: '馬路',
    sidewalk: '人行道',
    crosswalk: '斑馬線',
    light: '紅綠燈',
    spawn: '出入口',
  };
  return labels[kind] ?? kind;
}

function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (v: number) => void
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.style.cssText =
    'width:72px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
    'border-radius:6px;color:#eee;padding:4px 6px;font-size:13px';
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  });
  wrap.append(span, input);
  return wrap;
}

function textField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.style.cssText =
    'width:96px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);' +
    'border-radius:6px;color:#eee;padding:4px 6px;font-size:13px';
  input.addEventListener('change', () => onChange(input.value));
  wrap.append(span, input);
  return wrap;
}

function smallButton(text: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText =
    'border:none;background:rgba(255,255,255,.12);color:#ddd;padding:6px 10px;' +
    'border-radius:6px;cursor:pointer;font-size:12px';
  return btn;
}
