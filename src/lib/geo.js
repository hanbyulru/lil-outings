import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { nearestPlace } from '../../web/query.js';

const here = dirname(fileURLToPath(import.meta.url));
export const GEO = JSON.parse(readFileSync(join(here, '../../config/geo.json'), 'utf8'));

export function haversineMiles(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest named place (within 5 miles) -> { neighborhood, district, miles }, or null outside the mapped metro. */
export function locate(lat, lon) {
  const n = nearestPlace(lat, lon, GEO);
  return n ? { neighborhood: n.place, district: n.district, miles: n.miles } : null;
}

export function zipPoint(zip) {
  const z = GEO.zips[String(zip)];
  return z ? { lat: z[0], lon: z[1] } : null;
}
