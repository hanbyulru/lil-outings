import { politeFetch } from '../lib/http.js';
import { decodeEntities } from '../lib/html.js';
import { withOffset } from '../lib/time.js';

/**
 * Clackamas County events list, library department (Oak Lodge and Gladstone libraries; verified Nov 2026):
 *   https://www.clackamas.us/events?dept=146
 * One page covers roughly two months. Each <div class="views-row"> holds the title link (/event/YYYY-MM-DD/slug),
 * the start and end as <time datetime="...Z"> (the first two time elements; see the note in the parser on wall time vs UTC), and the address line
 * ("Gladstone Library, 525 Portland Avenue Gladstone, OR 97027"). The page repeats rows in several widgets: dedupe by URL.
 * config: { url, site, venues: [{ match: 'Gladstone', name, address, lat, lon }] }
 */
const utcToPortland = (iso) => {
  // "2026-08-21T23:00:00Z" -> "2026-08-21T16:00:00-07:00" (Portland wall time with offset)
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return withOffset(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`);
};

export function parseClackamasEvents(html, source) {
  const out = [];
  const seen = new Set();
  const text = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  for (const row of html.split('<div class="views-row">').slice(1)) {
    const a = row.match(/<a href="(\/event\/\d{4}-\d\d-\d\d\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = source.config.site + a[1];
    if (seen.has(url)) continue;
    // Each <time> also shows its time as text ("10/19/2026 - 10:30"). Nov 2026: the county started writing Portland wall time
    // with a "Z" (10:30 am shown, datetime "...T10:30:00Z"); before, the datetime was true UTC. When the shown time matches the
    // datetime's digits, take it as wall time; otherwise convert from UTC.
    const times = [...row.matchAll(/<time datetime="(\d{4}-\d\d-\d\dT(\d\d:\d\d):\d\dZ)"[^>]*>([^<]*)/g)].map((m) => {
      const shown = m[3].match(/(\d{1,2}):(\d\d)/);
      const wall = shown && `${shown[1].padStart(2, '0')}:${shown[2]}` === m[2];
      return wall ? withOffset(m[1].slice(0, 19)) : utcToPortland(m[1]);
    });
    if (!times.length) continue;
    seen.add(url);
    const addr = text(row.match(/field-ccts-map-link[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/)?.[1]);
    const v = (source.config.venues || []).find((x) => addr.includes(x.match) || text(a[2]).includes(x.match));
    const title = text(a[2]).replace(/\s+[–-]\s+(Oak Lodge|Gladstone)( Public)? Library$/i, '');
    out.push({
      source_id: source.id,
      source_event_id: url,
      title,
      description: '',
      start: times[0],
      end: times[1] || null,
      all_day: false,
      url,
      venue_name: v?.name || addr.split(',')[0] || null,
      address: v?.address || addr || null,
      lat: v?.lat ?? null,
      lon: v?.lon ?? null,
      raw_categories: [],
      raw_audience: /\b18\+|adults?\b/i.test(a[2]) ? ['Adults'] : [],
      price_text: null,
      image: null,
      cancelled: /\bcancell?ed\b/i.test(a[2])
    });
  }
  return out;
}

export async function fetchClackamasEvents(source, ctx) {
  return parseClackamasEvents(await politeFetch(source.config.url, ctx.http), source);
}
