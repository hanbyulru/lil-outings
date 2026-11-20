import { politeFetch } from '../lib/http.js';
import { htmlToText, decodeEntities } from '../lib/html.js';
import { withOffset, portlandDate, addDays } from '../lib/time.js';

/**
 * Locable community calendars (verified Nov 2026: Downtown Hillsboro, downtownhillsboro.org/community-calendar/).
 * No feed: the calendar is server-rendered HTML, ~12 events a page (?page=N), each card with title, link, start
 * ("Nov 21, 2026, 2:00 PM PST") and a one-line blurb. Each event's own page has schema.org microdata: location name,
 * address, date, "2:00 PM PST to 7:00 PM PST", price and the full description, so it's fetched (cached a day).
 * The PST/PDT labels are unreliable (December events say PDT); times are read as Portland wall-clock time.
 * config: { site, path: '/community-calendar/', max_pages, town, fallback_venue: { name, lat, lon } }
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

/** "Nov 21, 2026" -> "2026-11-21". */
export function locableDate(s) {
  const m = String(s || '').match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})/);
  return m && MONTHS[m[1].toLowerCase()] ? `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}` : null;
}
/** "2:00 PM PST" -> "14:00". */
export function locableTime(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d\d)\s*([AP])M/i);
  if (!m) return null;
  let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
  return `${pad(h)}:${m[2]}`;
}

/** List page -> [{ url, title, date, time, blurb }] and whether there's a next page. */
export function parseLocableList(html, site) {
  const out = [];
  const re = /<a class="title styled-widget-link" href="([^"]+)">([\s\S]*?)<\/a>\s*<div class="time">\s*<div class="start-datetime">(?:<i[^>]*><\/i>)?([^<]+)<\/div>[\s\S]*?<div class="description">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    out.push({ url: new URL(m[1], site).href, title: decodeEntities(htmlToText(m[2])).replace(/\s+/g, ' ').trim(), date: locableDate(m[3]), time: locableTime(m[3]), blurb: htmlToText(m[4]).trim() });
  }
  return out;
}

/** Event page microdata -> { venue, address, date, start, end, price, description, link }. */
export function parseLocableEvent(html) {
  const prop = (name, tag = '[a-z0-9]+') => {
    const m = html.match(new RegExp(`<(${tag})[^>]*itemprop="${name}"[^>]*>([\\s\\S]*?)</\\1>`, 'i'));
    return m ? decodeEntities(htmlToText(m[2])).replace(/\s+/g, ' ').trim() : null;
  };
  const timeLine = (html.match(/<span itemprop="doorTime">([^<]*)<\/span>([^<]*)/) || []);
  return {
    venue: prop('location', 'h4'),
    address: prop('address', 'span'),
    date: locableDate(prop('startDate', 'span')),
    start: locableTime(timeLine[1]),
    end: locableTime((timeLine[2] || '').replace(/^[\s\S]*?to/i, '')),
    price: prop('price', 'span'),
    description: prop('description', 'div')
  };
}

export async function fetchLocableEvents(source, ctx) {
  const c = source.config;
  const today = ctx.today || portlandDate(), last = addDays(today, ctx.horizonDays ?? 60);
  const fb = c.fallback_venue;
  const cards = [];
  for (let page = 1; page <= (c.max_pages ?? 6); page++) {
    const html = await politeFetch(`${c.site}${c.path || '/community-calendar/'}${page > 1 ? `?page=${page}` : ''}`, ctx.http);
    const found = parseLocableList(html, c.site);
    cards.push(...found);
    // Listed soonest first: stop once past the horizon or out of pages.
    if (!found.length || found.some((e) => e.date && e.date > last) || !html.includes(`?page=${page + 1}`)) break;
  }
  const out = [];
  for (const card of cards) {
    if (!card.date || card.date < today || card.date > last) continue;
    let d = {};
    try { d = parseLocableEvent(await politeFetch(card.url, { ...ctx.http, ttlMs: ctx.http.ttlMs ? 24 * 3600 * 1000 : 0 })); } catch { /* the card alone will do */ }
    const date = d.date || card.date, start = d.start || card.time;
    const address = d.address ? d.address.replace(/\.,/g, ',') : null;
    out.push({
      source_id: source.id,
      source_event_id: card.url.match(/\/\d{4}\/\d{1,2}\/\d{1,2}\/(\d+)\//)?.[1] || card.url,
      title: card.title,
      description: (d.description || card.blurb || '').slice(0, 700),
      start: start ? withOffset(`${date}T${start}:00`) : date,
      end: d.end ? withOffset(`${date}T${d.end}:00`) : null,
      all_day: !start,
      url: card.url,
      venue_name: d.venue || fb?.name || null,
      address: address && c.town && !address.includes(c.town.split(',')[0]) ? `${address}, ${c.town}` : address,
      lat: null, lon: null,
      geo_fallback: fb ? { lat: fb.lat, lon: fb.lon } : null,
      raw_categories: [],
      raw_audience: [],
      price_text: d.price || null,
      image: null,
      cancelled: /cancel(l)?ed/i.test(card.title)
    });
  }
  return out;
}
