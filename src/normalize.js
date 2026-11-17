import { createHash } from 'node:crypto';
import { wall } from './lib/time.js';
import { locate, zipPoint } from './lib/geo.js';

const idOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

export function normalizeVenueKey(s) {
  return String(s || '').toLowerCase().replace(/\b(library|branch|park|center|centre|the)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Raw adapter output -> canonical event (no tags yet). Returns null for events we should drop outright. */
export function normalizeEvent(raw, source, { horizonDays = 60, today } = {}) {
  if (!raw.title || !raw.start || raw.cancelled) return null;
  const w = wall(raw.start);
  if (!w) return null;
  if (today && w.date < today) return null;
  const endW = raw.end ? wall(raw.end) : null;
  const lat = raw.lat ?? null, lon = raw.lon ?? null;
  const loc = lat != null ? locate(lat, lon) : null;
  return {
    id: idOf(`${raw.source_id}|${raw.source_event_id}`),
    source: { id: source.id, name: source.name, trust: source.trust ?? 5 },
    also_listed_on: [],
    title: raw.title.replace(/\s+/g, ' ').trim(),
    description: (raw.description || '').trim().slice(0, 900),
    start: raw.start,
    end: raw.end || null,
    date: w.date,
    start_min: raw.all_day ? null : w.minutes,
    end_min: endW && endW.date === w.date ? endW.minutes : null,
    all_day: !!raw.all_day,
    venue_name: raw.venue_name || null,
    address: raw.address || null,
    lat, lon,
    neighborhood: loc?.neighborhood || null,
    district: loc?.district || null,
    url: raw.url || null,
    price_text: raw.price_text || null,
    image: raw.image || null,
    raw_categories: raw.raw_categories || [],
    raw_audience: raw.raw_audience || [],
    horizonDays
  };
}

export function withinHorizon(ev, today, horizonDays) {
  const [y, m, d] = today.split('-').map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + horizonDays)).toISOString().slice(0, 10);
  return ev.date <= limit;
}

/**
 * Feeds like portland.gov/parks list no venue. Guess one by finding a known place name inside the title/description
 * (longest match wins, 6+ chars after normalizing). Marks geo_source so the UI/review queue can tell it was inferred.
 */
export function guessVenue(ev, places) {
  const hay = ` ${normalizeVenueKey(`${ev.title} ${ev.description || ''}`)} `;
  let best = null;
  for (const p of places) {
    const k = normalizeVenueKey(p.name);
    if (k.length < 6 || !hay.includes(` ${k} `)) continue;
    if (!best || k.length > best.k.length) best = { k, p };
  }
  if (!best) return ev;
  const loc = locate(best.p.lat, best.p.lon);
  return { ...ev, venue_name: best.p.name, lat: best.p.lat, lon: best.p.lon, neighborhood: loc?.neighborhood || null, district: loc?.district || null, geo_source: 'place-name' };
}
