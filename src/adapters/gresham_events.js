import { politeFetch } from '../lib/http.js';
import { decodeEntities } from '../lib/html.js';
import { withOffset } from '../lib/time.js';

/**
 * City of Gresham events web service (verified Nov 2026), the JSON behind greshamoregon.gov/calendar:
 *   GET /webservices/events/?DateSpan=60&category=56&pageSize=100&page=1
 * -> { page, totalPages, events: [{ start: 'YYYY-MM-DD', end, canceled, title, url: '/events/...', time: '6:00 pm - 8:00 pm', location: 'Venue, 123 St' }] }
 * Categories: 46 Arts and Culture, 49 Community Events, 52 Parks and Rec, 56 Youth Events.
 * config: { site, categories: [{ id, name }], fallback_venue }; addresses are geocoded (config.geocode).
 */
const to24 = (h, m, ap) => { h = +h % 12 + (/p/i.test(ap) ? 12 : 0); return `${String(h).padStart(2, '0')}:${m || '00'}`; };

export function parseTimeRange(s) {
  const m = String(s || '').match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)?(?:\s*[-–]\s*(\d{1,2})(?::(\d\d))?\s*(am|pm))?/i);
  if (!m) return null;
  const ap1 = m[3] || m[6]; // "10 - 11:30 am"
  if (!ap1) return null;
  return { start: to24(m[1], m[2], ap1), end: m[4] ? to24(m[4], m[5], m[6]) : null };
}

export function parseGreshamEvents(json, source, category) {
  const fb = source.config.fallback_venue;
  return (json?.events || []).map((e) => {
    const t = parseTimeRange(e.time);
    const loc = decodeEntities(e.location || '').trim();
    const name = loc.split(',')[0].trim() || null;
    const url = e.url ? new URL(e.url, source.config.site).href : null;
    return {
      source_id: source.id,
      source_event_id: url || `${e.title}|${e.start}`,
      title: decodeEntities(e.title || '').trim(),
      description: '',
      start: t ? withOffset(`${e.start}T${t.start}:00`) : e.start,
      end: t?.end ? withOffset(`${e.end || e.start}T${t.end}:00`) : null,
      all_day: !t,
      url,
      venue_name: name,
      address: loc.includes(',') ? `${loc}, Gresham` : null,
      lat: null, lon: null,
      geo_fallback: fb ? { lat: fb.lat, lon: fb.lon } : null,
      raw_categories: category ? [category] : [],
      raw_audience: [],
      price_text: null,
      image: null,
      cancelled: !!e.canceled
    };
  });
}

export async function fetchGreshamEvents(source, ctx) {
  const out = new Map(); // an event can sit in two categories
  const span = Math.min(ctx.horizonDays ?? 60, 90);
  for (const c of source.config.categories) {
    for (let page = 1; page <= 5; page++) {
      const json = JSON.parse(await politeFetch(`${source.config.site}/webservices/events/?DateSpan=${span}&category=${c.id}&pageSize=100&page=${page}`, ctx.http));
      for (const e of parseGreshamEvents(json, source, c.name)) if (!out.has(`${e.source_event_id}|${e.start}`)) out.set(`${e.source_event_id}|${e.start}`, e);
      if (page >= (json.totalPages ?? 1)) break;
    }
  }
  return [...out.values()];
}
