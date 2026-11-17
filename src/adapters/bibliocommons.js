import { politeFetch } from '../lib/http.js';
import { htmlToText } from '../lib/html.js';
import { withOffset } from '../lib/time.js';

/**
 * BiblioCommons events (used by Washington County Cooperative Library Services, wccls.bibliocommons.com).
 * STATUS: EXPERIMENTAL. The calendar page and its filter parameters are verified (types=…, audiences=…), but the JSON
 * gateway shape below is written from memory of BiblioCommons' v2 gateway and must be checked against a live response
 * (run `node src/cli.js probe wccls`). The parser is defensive: it accepts entities.events[*].definition.
 */
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const addressOf = (a) => {
  if (!a) return null;
  if (typeof a === 'string') return a;
  const street = [a.number, a.street].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ');
  return [street, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
};

export function parseBiblioCommons(json, source) {
  const events = json?.entities?.events || {};
  const locations = json?.entities?.locations || {};
  return Object.values(events).map((ev) => {
    const d = ev.definition || ev;
    const loc = locations[d.branchLocationId] || {};
    const start = d.start ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(d.start) ? d.start : withOffset(d.start.replace(/\.\d+$/, ''))) : null;
    const end = d.end ? (/[zZ]|[+-]\d{2}:?\d{2}$/.test(d.end) ? d.end : withOffset(d.end.replace(/\.\d+$/, ''))) : null;
    return {
      source_id: source.id,
      source_event_id: String(ev.id || d.id),
      title: htmlToText(d.title || ''),
      description: htmlToText(d.description || ''),
      start, end,
      all_day: false,
      url: d.id ? `${source.config.site}/events/${ev.id || d.id}` : null,
      venue_name: loc.name || d.branchLocationName || null,
      address: addressOf(loc.address),
      // Verified Nov 2026: branch coordinates live in mapLocation.centrePoint {lat, lng}; latitude/longitude are absent.
      lat: num(loc.mapLocation?.centrePoint?.lat ?? loc.latitude ?? loc.lat),
      lon: num(loc.mapLocation?.centrePoint?.lng ?? loc.longitude ?? loc.lon),
      raw_categories: (d.typeNames || d.types || []).map(String),
      raw_audience: (d.audienceNames || d.audiences || []).map(String),
      price_text: null,
      image: d.featuredImage?.url || null,
      // WCCLS sometimes marks a cancellation only in the title ("PJ Storytime - Cancelled").
      cancelled: !!d.isCancelled || /\bcancell?ed\b/i.test(d.title || '')
    };
  });
}

export async function fetchBiblioCommons(source, ctx) {
  const out = [];
  for (const q of source.config.queries) {
    const url = `${source.config.api}?${new URLSearchParams(q).toString()}`;
    out.push(...parseBiblioCommons(JSON.parse(await politeFetch(url, ctx.http)), source));
  }
  return out;
}
