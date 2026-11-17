import { politeFetch } from '../lib/http.js';
import { decodeEntities } from '../lib/html.js';
import { portlandDate, addDays } from '../lib/time.js';

/**
 * Drupal 7 Calendar module month views (verified Nov 2026):
 *   Lake Oswego Public Library  https://www.ci.oswego.or.us/calendar/month/2026-12?og_group_ref_target_id=13
 *   West Linn Public Library    https://westlinnoregon.gov/library/calendar/2026-12
 * Each entry is a `.contents` block holding a title link and
 * <span class="date-display-single" content="2026-11-08T10:45:00-08:00">. "(All day)" entries start at 00:00.
 * The month view has no descriptions or locations, so every event gets the source's library as its venue.
 * config: { url_template: '...{month}...' (month = YYYY-MM), site, venue: { name, address, lat, lon }, months?: 2 }
 */
export function parseDrupalCalendarMonth(html, source) {
  const out = [];
  const seen = new Set();
  const base = source.config.site;
  // Split on each entry; a block runs until the next one.
  for (const block of html.split(/<div class="calendar[.-][^"]*\bcontents"/).slice(1)) {
    const a = block.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const d = block.match(/content="(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d)"[^>]*>([^<]*)</);
    if (!a || !d) continue;
    const title = decodeEntities(a[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const path = a[1].replace(/\?date=\d+$/, '');
    const url = path.startsWith('http') ? path : base + path;
    const allDay = /all day/i.test(d[2]);
    const key = `${url}|${d[1]}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const v = source.config.venue || {};
    out.push({
      source_id: source.id,
      source_event_id: key,
      title,
      description: '',
      start: d[1],
      end: null,
      all_day: allDay,
      url,
      venue_name: v.name || null,
      address: v.address || null,
      lat: v.lat ?? null,
      lon: v.lon ?? null,
      raw_categories: [],
      raw_audience: [],
      price_text: null,
      image: null,
      cancelled: /\bcancell?ed\b/i.test(title)
    });
  }
  return out;
}

export async function fetchDrupalCalendar(source, ctx) {
  const today = ctx.today || portlandDate();
  const months = [...new Set(Array.from({ length: source.config.months ?? 2 }, (_, i) => addDays(`${today.slice(0, 7)}-15`, i * 30).slice(0, 7)))];
  const out = [];
  for (const m of months) out.push(...parseDrupalCalendarMonth(await politeFetch(source.config.url_template.replace('{month}', m), ctx.http), source));
  return out;
}
