import { politeFetch } from './lib/http.js';

/**
 * Street addresses -> coordinates via OpenStreetMap Nominatim, for feeds that give an address but no lat/lon
 * (Gresham, Vancouver, Tualatin, NCPRD). Only sources with config.geocode = true are looked up.
 * Nominatim's policy: max 1 request/second, an identifying User-Agent, and cache results. Venues repeat,
 * so results are cached for six months and each run looks up at most `max` new addresses.
 * An address it can't place keeps the adapter's town-level fallback (geo_fallback).
 */
export const GEOCODE_UA = 'LilOutings/0.2 (https://liloutings.com/; kids events site)';
const VIEWBOX = '-123.3,45.9,-122.2,45.1'; // Portland metro + Vancouver

/** "Name, 123 Main St, Town" -> candidate queries, most specific first. */
export function queriesFor(address) {
  const a = String(address || '').replace(/\b([NS])\.\s?([EW])\./g, '$1$2').replace(/\b([NSEW])\.(?=\s)/g, '$1').replace(/\b(Rd|St|Ave|Blvd|Dr|Pkwy|Ct|Ln)\./g, '$1').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  if (!a) return [];
  const parts = a.split(', ');
  const qs = [a];
  const i = parts.findIndex((p) => /^\d+\s/.test(p)); // drop a leading venue name before the street number
  if (i > 0) qs.push(parts.slice(i).join(', '));
  return [...new Set(qs)];
}

export async function geocodeEvents(raws, http, { log = () => {}, max = 60, town = 'OR' } = {}) {
  const h = { ...http, headers: { ...(http.headers || {}), 'user-agent': GEOCODE_UA }, ttlMs: 180 * 24 * 3600 * 1000, minGapMs: Math.max(http.minGapMs ?? 0, 1100), retries: 1 };
  const memo = new Map();
  let looked = 0, found = 0;
  const lookup = async (address, state) => {
    const key = `${address}|${state}`;
    if (memo.has(key)) return memo.get(key);
    let hit = null;
    for (const q of queriesFor(address)) {
      if (looked >= max) break;
      looked++;
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(/\b(OR|WA|Oregon|Washington)\b/.test(q) ? q : `${q}, ${state}`)}`;
      const j = JSON.parse(await politeFetch(url, h));
      if (j[0]) { hit = { lat: +(+j[0].lat).toFixed(5), lon: +(+j[0].lon).toFixed(5) }; break; }
    }
    memo.set(key, hit);
    return hit;
  };
  for (const { r, src } of raws) {
    if (!src.config?.geocode || r.lat != null) continue;
    let hit = null;
    if (r.address) {
      try { hit = await lookup(r.address, src.config.geocode_state || town); } catch (err) { log(`  geocode failed for "${r.address}": ${err.message}`); }
    }
    if (hit) { r.lat = hit.lat; r.lon = hit.lon; r.geo_source = 'geocoded'; found++; }
    else if (r.geo_fallback) { r.lat = r.geo_fallback.lat; r.lon = r.geo_fallback.lon; r.geo_source = 'town'; }
    delete r.geo_fallback;
  }
  if (looked || found) log(`  geocoded ${found} events (${looked} new lookups)`);
}
