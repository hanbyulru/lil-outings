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
  return texts.flatMap((t) => parseICal(t)).map((e) => toRaw(source, e));
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
    url: e.url,
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
