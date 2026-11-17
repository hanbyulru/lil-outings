import { politeFetch } from '../lib/http.js';
import { decodeEntities, htmlToText } from '../lib/html.js';
import { withOffset, portlandDate, addDays } from '../lib/time.js';

/**
 * WordPress sites built by Juicebox (verified Nov 2026: City of Tualatin). Two calls:
 *   1. GET /wp-json/wp/v2/events?event_audience=125,130&event_category=93&per_page=100&_fields=id
 *      (the list has no dates, so it only gives ids; audiences/categories filter at the source)
 *   2. GET /wp-json/juicebox/v1/events/<id>
 *      -> { title, url, location: 'Venue, 8515 SW Tualatin Rd', all_day, event_category: [{name}], event_audience: [{name}],
 *           start_date: { date: { mysql: 'YYYY-MM-DD HH:MM:SS' } }, end_date: {...} }
 * Details are cached for a day; ids are newest first, capped at max_events.
 * config: { site, audiences: [ids], categories: [ids], town, fallback_venue }
 */
export function parseJuiceboxEvent(e, source) {
  const s = e?.start_date?.date?.mysql, en = e?.end_date?.date?.mysql;
  if (!s) return null;
  const loc = decodeEntities(e.location || '').trim();
  const fb = source.config.fallback_venue;
  const iso = (v) => (e.all_day ? v.slice(0, 10) : withOffset(v.replace(' ', 'T')));
  return {
    source_id: source.id,
    source_event_id: String(e.id),
    title: decodeEntities(e.title || '').trim(),
    description: htmlToText(e.description || e.excerpt || '').slice(0, 700),
    start: iso(s),
    end: en ? iso(en) : null,
    all_day: !!e.all_day,
    url: e.url || e.link || null,
    venue_name: loc.split(',')[0].trim() || fb?.name || null,
    address: loc ? (source.config.town && !loc.includes(source.config.town) ? `${loc}, ${source.config.town}` : loc) : null,
    lat: null, lon: null,
    geo_fallback: fb ? { lat: fb.lat, lon: fb.lon } : null,
    raw_categories: (e.event_category || []).map((c) => decodeEntities(c.name)),
    raw_audience: (e.event_audience || []).map((a) => decodeEntities(a.name)),
    price_text: null,
    image: null,
    cancelled: /cancel(l)?ed/i.test(e.title || '')
  };
}

export async function fetchJuiceboxEvents(source, ctx) {
  const c = source.config;
  const q = [c.audiences?.length ? `event_audience=${c.audiences.join(',')}` : '', c.categories?.length ? `event_category=${c.categories.join(',')}` : ''].filter(Boolean).join('&');
  const ids = JSON.parse(await politeFetch(`${c.site}/wp-json/wp/v2/events?${q}&per_page=100&_fields=id`, ctx.http)).map((x) => x.id);
  const today = ctx.today || portlandDate(), last = addDays(today, ctx.horizonDays ?? 60);
  const out = [];
  for (const id of ids.slice(0, c.max_events ?? 60)) {
    const e = parseJuiceboxEvent(JSON.parse(await politeFetch(`${c.site}/wp-json/juicebox/v1/events/${id}`, { ...ctx.http, ttlMs: ctx.http.ttlMs ? 24 * 3600 * 1000 : 0 })), source);
    if (e && e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= last) out.push(e);
  }
  return out;
}
