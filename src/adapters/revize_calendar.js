import { politeFetch } from '../lib/http.js';
import { htmlToText } from '../lib/html.js';
import { withOffset, portlandDate, addDays, pad } from '../lib/time.js';

/**
 * Revize CMS calendars (City of Milwaukie: Ledding Library; verified Nov 2026).
 * GET https://www.milwaukieoregon.gov/_assets_/plugins/revizeCalendar/calendar_data_handler.php
 *       ?webspace=milwaukie&relative_revize_url=//cms2.revize.com&protocol=https:
 * returns every city calendar as JSON: [{ title, primary_calendar_name, start: 'YYYY-MM-DDTHH:MM:SS' (Portland wall time),
 * end, location, url, desc (URI-encoded HTML), rid, rrule? }]. Repeating events carry an iCal-style rrule block
 * ("DTSTART:...\nRDATE:...\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;UNTIL=...\nEXDATE:..."), expanded here.
 * config: { url, calendar: 'Library', site, venue: { name, address, lat, lon, match } }
 */

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // 20261117 -> 2026-11-17
const monthAdd = (d, n) => { const [y, m] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`; };
const daysInMonth = (d) => { const [y, m] = d.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/**
 * Dates (YYYY-MM-DD) an rrule block produces between from and to (inclusive). Supports what Revize emits:
 * FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY (list), BYSETPOS (nth / -1 last, monthly), UNTIL, COUNT, RDATE, EXDATE.
 */
export function expandRRule(block, firstDate, from, to) {
  const lines = String(block).split(/\n/);
  const rule = Object.fromEntries((lines.find((l) => l.startsWith('RRULE:')) || 'RRULE:').slice(6).split(';').filter(Boolean).map((kv) => kv.split('=')));
  const ex = new Set(lines.filter((l) => l.startsWith('EXDATE:')).flatMap((l) => l.slice(7).split(',')).map((s) => ymd(s.trim())));
  const extra = lines.filter((l) => l.startsWith('RDATE:')).flatMap((l) => l.slice(6).split(',')).map((s) => ymd(s.trim()));
  const until = rule.UNTIL ? ymd(rule.UNTIL) : null;
  const count = rule.COUNT ? +rule.COUNT : Infinity;
  const interval = +(rule.INTERVAL || 1);
  const byday = (rule.BYDAY || '').split(',').filter(Boolean);
  const setpos = rule.BYSETPOS ? +rule.BYSETPOS : null;
  const hardStop = addDays(to, 1);
  const occ = [];
  const push = (d) => { if (d >= firstDate && (!until || d <= until)) occ.push(d); };
  if (!rule.FREQ) occ.push(firstDate);
  else if (rule.FREQ === 'DAILY') {
    for (let d = firstDate; d <= hardStop && occ.length < count && (!until || d <= until); d = addDays(d, interval)) push(d);
  } else if (rule.FREQ === 'WEEKLY') {
    const wanted = byday.length ? byday.map((b) => DAYS[b]) : [dow(firstDate)];
    const weekStart = addDays(firstDate, -dow(firstDate)); // Sunday of the first week
    for (let w = weekStart; w <= hardStop && occ.length < count; w = addDays(w, 7 * interval)) {
      for (const k of [...wanted].sort()) { if (occ.length >= count) break; push(addDays(w, k)); }
      if (until && w > until) break;
    }
  } else if (rule.FREQ === 'MONTHLY') {
    for (let m = `${firstDate.slice(0, 7)}-01`; m <= hardStop && occ.length < count; m = monthAdd(m, interval)) {
      let days = [];
      if (byday.length) {
        for (let i = 0; i < daysInMonth(m); i++) { const d = addDays(m, i); if (byday.some((b) => DAYS[b.slice(-2)] === dow(d))) days.push(d); }
        if (setpos) days = [setpos > 0 ? days[setpos - 1] : days[days.length + setpos]].filter(Boolean);
      } else days = [`${m.slice(0, 7)}-${firstDate.slice(8, 10)}`];
      for (const d of days) { if (occ.length >= count) break; push(d); }
      if (until && m > until) break;
    }
  }
  return [...new Set([...occ, ...extra])].filter((d) => !ex.has(d) && d >= from && d <= to).sort();
}

export function parseRevizeEvents(json, source, { today, horizonDays = 60 } = {}) {
  const from = today || portlandDate();
  const to = addDays(from, horizonDays);
  const v = source.config.venue || {};
  const out = [];
  for (const e of json || []) {
    if (source.config.calendar && e.primary_calendar_name !== source.config.calendar) continue;
    if (!e.start || !e.title) continue;
    const date = e.start.slice(0, 10), time = e.start.slice(11, 19) || '00:00:00';
    const endTime = e.end ? e.end.slice(11, 19) : null;
    const dates = e.rrule ? expandRRule(e.rrule, date, from, to) : (date >= from && date <= to ? [date] : []);
    let desc = '';
    try { desc = htmlToText(decodeURIComponent(e.desc || '')); } catch { desc = htmlToText(e.desc || ''); }
    const loc = String(e.location || '').trim();
    const atLibrary = v.match ? (!loc || loc.includes(v.match)) : false;
    const fb = source.config.fallback_venue; // events elsewhere in town: town center, so they still land in the right district
    for (const d of dates) {
      out.push({
        source_id: source.id,
        source_event_id: `${e.rid || e.id}|${d}`,
        title: htmlToText(e.title),
        description: desc.slice(0, 700),
        start: withOffset(`${d}T${time}`),
        end: endTime ? withOffset(`${d}T${endTime}`) : null,
        all_day: false,
        url: /^https?:/.test(e.url || '') ? e.url : `${source.config.site}/calendar.php`,
        venue_name: atLibrary ? v.name : (loc.split(',')[0] || fb?.name || null),
        address: atLibrary ? v.address : loc || null,
        lat: atLibrary ? v.lat ?? null : fb?.lat ?? null,
        lon: atLibrary ? v.lon ?? null : fb?.lon ?? null,
        raw_categories: [],
        raw_audience: [],
        price_text: null,
        image: null,
        cancelled: /\bcancell?ed\b/i.test(e.title)
      });
    }
  }
  return out;
}

export async function fetchRevizeCalendar(source, ctx) {
  return parseRevizeEvents(JSON.parse(await politeFetch(source.config.url, ctx.http)), source, { today: ctx.today, horizonDays: ctx.horizonDays });
}
