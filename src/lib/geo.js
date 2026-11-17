import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const GEO = JSON.parse(readFileSync(join(here, '../../config/geo.json'), 'utf8'));

export function haversineMiles(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest neighborhood centroid -> { neighborhood, area, miles }. Null if farther than maxMiles. */
export function locate(lat, lon, maxMiles = 8) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  for (const n of GEO.neighborhoods) {
    const d = haversineMiles({ lat, lon }, n);
    if (!best || d < best.miles) best = { neighborhood: n.name, area: n.area, miles: d };
  }
  return best && best.miles <= maxMiles ? best : null;
}

export function zipPoint(zip) {
  const z = GEO.zips[String(zip)];
  return z ? { lat: z[0], lon: z[1] } : null;
}

export function neighborhoodPoint(name) {
  const n = GEO.neighborhoods.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  return n ? { lat: n.lat, lon: n.lon, area: n.area } : null;
}
