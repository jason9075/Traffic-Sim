/**
 * 地理座標 ↔ 局部平面座標(公尺)。
 * 以場景中心做 equirectangular 近似,公里級範圍誤差可忽略;
 * 模擬與圖形運算全程使用公尺座標。
 */

import type { GeoPoint } from '../model/types';
import type { Vec2 } from './bezier';

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQ = 111320;

export interface LocalProjection {
  origin: GeoPoint;
  toLocal(g: GeoPoint): Vec2;
  toGeo(p: Vec2): GeoPoint;
}

/** 建立以 origin 為 (0,0) 的局部投影。y 軸朝北。 */
export function createProjection(origin: GeoPoint): LocalProjection {
  const mPerDegLng = M_PER_DEG_LNG_EQ * Math.cos((origin.lat * Math.PI) / 180);
  return {
    origin,
    toLocal(g: GeoPoint): Vec2 {
      return {
        x: (g.lng - origin.lng) * mPerDegLng,
        y: (g.lat - origin.lat) * M_PER_DEG_LAT,
      };
    },
    toGeo(p: Vec2): GeoPoint {
      return {
        lng: origin.lng + p.x / mPerDegLng,
        lat: origin.lat + p.y / M_PER_DEG_LAT,
      };
    },
  };
}

/** 取一組點的中心當投影原點 */
export function centroidOf(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lng: 0, lat: 0 };
  let lng = 0;
  let lat = 0;
  for (const p of points) {
    lng += p.lng;
    lat += p.lat;
  }
  return { lng: lng / points.length, lat: lat / points.length };
}
