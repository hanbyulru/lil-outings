import { politeFetch } from '../lib/http.js';
import { decodeEntities, htmlToText } from '../lib/html.js';
import { withOffset } from '../lib/time.js';

/**
 * City of Vancouver, WA calendar (verified Nov 2026): cityofvancouver.us/government/calendar/ renders
 * Meetings (tab 1) and Events (tab 2) server-side. Each event has a grid card (department in .h6) and a detail
 * section with an "Add to Calendar" block:
 *   <div id="sectionN" class="expanding-containerevt"> <h3>Title</h3> <h5>Thursday, November 19, 2026 <span>6:00 pm - 7:30 pm</span></h5>
 *     <span class="start">Thursday, November 19, 2026 6:00 pm</span> ... <span class="description">…</span>
 *     <h4>Venue </br> 700 NE 136th Ave </br> Vancouver , WA 98684</h4> … <a class="link" href="…">Learn More</a>
 * Only tab 2 (events) is read. config: { url, exclude_departments?: [names], fallback_venue }; addresses are geocoded.
 */
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const flat = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** "Thursday, November 19, 2026" + "6:00 pm - 7:30 pm" -> { start, end } ISO with Portland offset. */
export function parseVanWhen(dateText, timeText) {
  const d = String(dateText).match(/([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/);
  if (!d || !MONTHS[d[1].toLowerCase()]) return null;
  const date = `${d[3]}-${String(MONTHS[d[1].toLowerCase()]).padStart(2, '0')}-${d[2].padStart(2, '0')}`;
  const t = [...String(timeText || '').matchAll(/(\d{1,2}):(\d\d)\s*(am|pm)/gi)].map((m) => `${String(+m[1] % 12 + (/p/i.test(m[3]) ? 12 : 0)).padStart(2, '0')}:${m[2]}`);
  if (!t.length) return { start: date, end: null, all_day: true };
  return { start: withOffset(`${date}T${t[0]}:00`), end: t[1] ? withOffset(`${date}T${t[1]}:00`) : null, all_day: false };
}

export function parseVancouverEvents(html, source) {
  const s = String(html);
  const tab = s.indexOf('id="tab2"');
  const body = tab >= 0 ? s.slice(tab) : s;
  // department per section number, from the grid cards (they link to #sectionN)
  const dept = new Map();
  for (const m of body.matchAll(/href="#section(\d+)"[\s\S]*?<div class="h6">([\s\S]*?)<\/div>/g)) dept.set(m[1], flat(m[2]));
  const skipDept = (source.config.exclude_departments || []).map((x) => x.toLowerCase());
  const fb = source.config.fallback_venue;
  const out = [];
  for (const m of body.matchAll(/<div id="section(\d+)" class="expanding-containerevt">([\s\S]*?)(?=<div id="section\d+" class="expanding-containerevt">|$)/g)) {
    const [, n, sec] = m;
    const title = flat(sec.match(/<h3>([\s\S]*?)<\/h3>/)?.[1]);
    const h5 = sec.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1] || '';
    const when = parseVanWhen(flat(h5.replace(/<span>[\s\S]*$/, '')), flat(h5.match(/<span>([\s\S]*?)<\/span>/)?.[1]));
    if (!title || !when) continue;
    const d = dept.get(n) || '';
    if (d && skipDept.includes(d.toLowerCase())) continue;
    const lines = (sec.match(/<h4>([\s\S]*?)<\/h4>/)?.[1] || '').split(/<\/?br\s*\/?>/i).map(flat).filter(Boolean).map((x) => x.replace(/\s+,/g, ','));
    const url = sec.match(/<a class="link" href="([^"]+)"/)?.[1] || null;
    out.push({
      source_id: source.id,
      source_event_id: `${url || title}|${when.start}`,
      title,
      description: htmlToText(sec.match(/<span class="description">([\s\S]*?)<\/span>/)?.[1] || '').slice(0, 700),
      start: when.start,
      end: when.end,
      all_day: when.all_day,
      url,
      venue_name: lines[0] || fb?.name || null,
      address: lines.length ? lines.join(', ') : null,
      lat: null, lon: null,
      geo_fallback: fb ? { lat: fb.lat, lon: fb.lon } : null,
      raw_categories: d ? [d] : [],
      raw_audience: [],
      price_text: null,
      image: null,
      cancelled: /cancel(l)?ed/i.test(title)
    });
  }
  return out;
}

export async function fetchVancouverEvents(source, ctx) {
  return parseVancouverEvents(await politeFetch(source.config.url, ctx.http), source);
}
