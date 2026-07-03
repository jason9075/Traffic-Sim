/**
 * MapLibre 初始化(Esri World Imagery 衛星底圖)與 Nominatim 地點搜尋。
 */

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const ESRI_ATTRIBUTION =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/** 建立全螢幕衛星地圖,預設視角:台北市 */
export function createMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: [ESRI_IMAGERY],
          tileSize: 256,
          maxzoom: 19,
          attribution: ESRI_ATTRIBUTION,
        },
      },
      layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
    },
    center: [121.5654, 25.033], // 台北市政府附近
    zoom: 16,
    maxZoom: 20,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  // 畫路需要精確座標,關閉旋轉避免混淆
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  return map;
}

export interface GeocodeResult {
  name: string;
  lng: number;
  lat: number;
}

/**
 * Nominatim 地點搜尋(免費、無 key;請勿高頻呼叫)。
 * @throws fetch 失敗或非 2xx 時丟出 Error
 */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'tw');

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Nominatim 回應 ${res.status}`);
  }
  const data = (await res.json()) as Array<{ display_name: string; lon: string; lat: string }>;
  return data.map((d) => ({
    name: d.display_name,
    lng: Number(d.lon),
    lat: Number(d.lat),
  }));
}
