import { politeFetch } from '../lib/http.js';
import { htmlToText, decodeEntities } from '../lib/html.js';
import { withOffset, portlandDate, addDays } from '../lib/time.js';

/**
 * WordPress "The Events Calendar" REST API (verified Nov 2026: City of Sherwood, City of Happy Valley).
 *   GET <site>/wp-json/tribe/events/v1/events?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&per_page=50&page=N
 * -> { events: [{ id, title, description, url, start_date: 'YYYY-MM-DD HH:MM:SS' (site time), end_date, all_day,
 *      cost, categories: [{ name, slug }], venue: { venue, address, city, geo_lat, geo_lng } | [] }], total_pages }
 * config: { site, include_categories?: [names], include_uncategorized?: bool, exclude_categories?: [names], fallback_venue?: { name, lat, lon } }
 */
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);

export function parseTribeEvents(json, source) {
  const inc = (source.config.include_categories || []).map((c) => c.toLowerCase());
  const exc = (source.config.exclude_categories || []).map((c) => c.toLowerCase());
  const fb = source.config.fallback_venue;
  const out = [];
  for (const e of json?.events || []) {
    const cats = (e.categories || []).map((c) => decodeEntities(c.name || ''));
    const lc = cats.map((c) => c.toLowerCase());
    // An uncategorized event passes an include list only with include_uncategorized (the classifier is the backstop).
    if (inc.length && !lc.some((c) => inc.includes(c)) && !(source.config.include_uncategorized && !lc.length)) continue;
    if (lc.some((c) => exc.includes(c))) continue;
    const v = e.venue && !Array.isArray(e.venue) ? e.venue : null;
    const lat = num(v?.geo_lat), lon = num(v?.geo_lng);
    const iso = (s) => (s ? withOffset(s.replace(' ', 'T')) : null);
    out.push({
      source_id: source.id,
      source_event_id: String(e.id),
      title: htmlToText(e.title || ''),
      description: htmlToText(e.description || '').slice(0, 700),
      start: iso(e.start_date),
      end: iso(e.end_date),
      all_day: !!e.all_day,
      url: e.url || null,
      venue_name: v?.venue ? decodeEntities(v.venue) : fb?.name || null,
      address: v ? [v.address, v.city].filter(Boolean).join(', ') || null : null,
      lat: lat ?? fb?.lat ?? null,
      lon: lon ?? fb?.lon ?? null,
      raw_categories: cats,
      raw_audience: [],
      price_text: e.cost ? htmlToText(String(e.cost)) : null,
      image: e.image?.url || null,
      cancelled: /\bcancell?ed\b/i.test(e.title || '')
    });
  }
  return out;
}

export async function fetchTribeEvents(source, ctx) {
  const today = ctx.today || portlandDate();
  const out = [];
  for (let page = 1; page <= (source.config.max_pages ?? 10); page++) {
    const url = `${source.config.site}/wp-json/tribe/events/v1/events?start_date=${today}&end_date=${addDays(today, ctx.horizonDays ?? 60)}&per_page=50&page=${page}`;
    let json;
    try { json = JSON.parse(await politeFetch(url, ctx.http)); } catch (err) { if (page > 1 && /HTTP 400|HTTP 404/.test(err.message)) break; throw err; }
    out.push(...parseTribeEvents(json, source));
    if (page >= (json?.total_pages ?? 1)) break;
  }
  return out;
}
