import { parseICal } from '../lib/ical.js';
import { politeFetch } from '../lib/http.js';

/**
 * Generic iCalendar adapter.
 *  - config.urls: list of .ics feed URLs (WordPress "The Events Calendar" ?ical=1, LibCal, Google Calendar public ICS, ...)
 *  - OR config.index_urls + config.link_regex + config.ics_template: scrape event ids off listing pages,
 *    then fetch one .ics per event. This is the Communico pattern (Multnomah County Library):
 *    listing page links like /event/12854476  ->  https://calendar-generator.communico.co/attend/12854476
 */
export async function fetchIcal(source, ctx) {
  const texts = [];
  if (source.config.urls) {
    for (const u of source.config.urls) texts.push(await politeFetch(u, ctx.http));
  } else if (source.config.index_urls) {
    const ids = new Set();
    const re = new RegExp(source.config.link_regex, 'g');
    for (const u of source.config.index_urls) {
      const html = await politeFetch(u, ctx.http);
      for (const m of html.matchAll(re)) ids.add(m[1]);
    }
    for (const id of [...ids].slice(0, source.config.max_events ?? 400)) {
      texts.push(await politeFetch(source.config.ics_template.replace('{id}', id), ctx.http));
    }
  }
  // Several category feeds can list the same event: keep one per UID + start (recurring events can share a UID).
  const byUid = new Map();
  for (const e of texts.flatMap((t) => parseICal(t))) byUid.set(`${e.uid || e.title}|${e.start}`, e);
  const skip = (source.config.exclude_categories || []).map((c) => c.toLowerCase());
  const skipLoc = (source.config.exclude_locations || []).map((c) => c.toLowerCase());
  const v = source.config.default_venue; // feeds that give only a room name (LibCal) or free text (CivicPlus)
  return [...byUid.values()]
    .filter((e) => !(e.categories || []).some((c) => skip.includes(String(c).trim().toLowerCase())))
    .filter((e) => !skipLoc.includes(String(e.location || '').trim().toLowerCase()))
    .map((e) => toRaw(source, e))
    .map((r) => (v && r.lat == null ? { ...r, venue_name: v.name, address: v.address || r.address, lat: v.lat, lon: v.lon, room: r.venue_name } : r));
}

/** An event's own page: the URL property when it's a real page, else the first link in the description
 *  (CivicPlus puts the feed's own relative path in URL and the event link in DESCRIPTION). */
function pageUrl(e) {
  if (e.url && /^https?:\/\//.test(e.url) && !/iCalendar\.aspx|ical_subscribe/i.test(e.url)) return e.url;
  return String(e.description || '').match(/https?:\/\/\S+/)?.[0] || null;
}

export function toRaw(source, e) {
  return {
    source_id: source.id,
    source_event_id: e.uid || e.url || `${e.title}|${e.start}`,
    title: e.title,
    description: e.description,
    start: e.start,
    end: e.end,
    all_day: e.allDay,
    url: pageUrl(e),
    venue_name: e.location,
    address: null,
    lat: e.lat,
    lon: e.lon,
    raw_categories: e.categories,
    raw_audience: [],
    price_text: null,
    image: e.image,
    cancelled: /cancel/i.test(e.status || '') || /cancel(l)?ed/i.test(e.title)
  };
}
