import { politeFetch } from '../lib/http.js';
import { htmlToText } from '../lib/html.js';
import { withOffset, portlandDate, addDays } from '../lib/time.js';

/**
 * BiblioCommons events via the v2 gateway (Washington County / WCCLS; Fort Vancouver Regional Libraries / fvrlibraries).
 * Verified Nov 2026: GET https://gateway.bibliocommons.com/v2/libraries/<lib>/events/search?audiences=a,b&startDate=&endDate=&page=N
 * returns 50 events per page in date order ({events: {pagination: {page, pages}}, entities: {events, locations,
 * eventAudiences, eventTypes}}). Events carry audienceIds/typeIds; names come from the entities.
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
  const names = (ids, table) => (ids || []).map((id) => table?.[id]?.name?.trim()).filter(Boolean);
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
      // The id is on the outer event object (Nov 2026: definition has none); pages live at <site>/v2/events/<id>.
      url: ev.id || d.id ? `${source.config.site}/events/${ev.id || d.id}` : null,
      venue_name: loc.name || d.branchLocationName || null,
      address: addressOf(loc.address),
      // Verified Nov 2026: branch coordinates live in mapLocation.centrePoint {lat, lng}; latitude/longitude are absent.
      lat: num(loc.mapLocation?.centrePoint?.lat ?? loc.latitude ?? loc.lat),
      lon: num(loc.mapLocation?.centrePoint?.lng ?? loc.longitude ?? loc.lon),
      raw_categories: d.typeIds ? names(d.typeIds, json.entities.eventTypes) : (d.typeNames || d.types || []).map(String),
      raw_audience: d.audienceIds ? names(d.audienceIds, json.entities.eventAudiences) : (d.audienceNames || d.audiences || []).map(String),
      price_text: null,
      image: d.featuredImage?.url || null,
      // WCCLS sometimes marks a cancellation only in the title ("PJ Storytime - Cancelled").
      cancelled: !!d.isCancelled || /\bcancell?ed\b/i.test(d.title || '')
    };
  });
}

export async function fetchBiblioCommons(source, ctx) {
  const today = ctx.today || portlandDate();
  const window = { startDate: today, endDate: addDays(today, ctx.horizonDays ?? 60) };
  const seen = new Map();
  for (const q of source.config.queries) {
    // The gateway returns 50 per page whatever `limit` says, so walk the pages.
    for (let page = 1; page <= (source.config.max_pages ?? 25); page++) {
      const url = `${source.config.api}?${new URLSearchParams({ ...window, ...q, page: String(page) }).toString()}`;
      const json = JSON.parse(await politeFetch(url, ctx.http));
      for (const e of parseBiblioCommons(json, source)) if (!seen.has(e.source_event_id)) seen.set(e.source_event_id, e);
      if (page >= (json?.events?.pagination?.pages ?? 1)) break;
    }
  }
  const skip = new Set((source.config.exclude_locations || []).map((s) => s.toLowerCase()));
  return [...seen.values()].filter((e) => !skip.has(String(e.venue_name || '').toLowerCase()));
}
