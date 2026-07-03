/**
 * 右側面板:地點搜尋、選取元素屬性、場景匯出/匯入。
 */

import type maplibregl from 'maplibre-gl';

import type { Editor } from '../editor/editor';
import { geocode } from '../map/map';
import type { SceneStore } from '../model/store';

export function createPanel(
  container: HTMLElement,
  map: maplibregl.Map,
  store: SceneStore,
  editor: Editor
): void {
  const searchBox = document.createElement('div');
  searchBox.className = 'panel-box';
  container.appendChild(searchBox);
  buildSearch(searchBox, map);

  const propsBox = document.createElement('div');
  propsBox.className = 'panel-box';
  propsBox.style.display = 'none';
  container.appendChild(propsBox);

  const sceneBox = document.createElement('div');
  sceneBox.className = 'panel-box';
  container.appendChild(sceneBox);
  buildSceneBox(sceneBox, store, editor);

  editor.onSelectionChange = (id) => renderProps(propsBox, store, editor, id);
}

function buildSearch(box: HTMLElement, map: maplibregl.Map): void {
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
      box.appendChild(
        checkboxField('單行道', el.lanesBackward === 0, (checked) => {
          store.update(() => { el.lanesBackward = checked ? 0 : 1; });
        })
      );
      break;
    case 'light':
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
      break;
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

function checkboxField(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;cursor:pointer';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
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
