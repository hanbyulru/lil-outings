import { withOffset, TZ } from './time.js';
import { htmlToText } from './html.js';

/** Unfold RFC 5545 folded lines. */
function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function unescapeText(s) {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
}

/** Split "NAME;PARAM=x;PARAM2=y:value" safely (colons can appear inside quoted params). */
function parseLine(line) {
  let inQuote = false, idx = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) { idx = i; break; }
  }
  if (idx < 0) return null;
  const left = line.slice(0, idx), value = line.slice(idx + 1);
  const [name, ...paramParts] = left.split(';');
  const params = {};
  for (const p of paramParts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** "20260818T180000" | "20260818T180000Z" | "20260818" -> ISO with offset, or {date} for all-day. */
export function parseICalDate(value, params = {}) {
  const v = value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    if (m[7] === 'Z') {
      // UTC -> Portland wall time
      const d = new Date(local + 'Z');
      const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
      const wallISO = parts.replace(' ', 'T');
      return { iso: withOffset(wallISO), allDay: false };
    }
    return { iso: withOffset(local, params.TZID || TZ), allDay: false };
  }
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}T00:00:00${withOffset(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).slice(19)}`, allDay: true };
  return null;
}

/** Parse an .ics string into plain event objects. */
export function parseICal(text) {
  const lines = unfold(text).split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(finish(cur)); cur = null; continue; }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
      case 'X-ALT-DESC': cur.descriptionHtml = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'GEO': { const [la, lo] = p.value.split(';').map(Number); if (Number.isFinite(la) && Number.isFinite(lo)) { cur.lat = la; cur.lon = lo; } break; }
      case 'DTSTART': cur.start = parseICalDate(p.value, p.params); break;
      case 'DTEND': cur.end = parseICalDate(p.value, p.params); break;
      case 'URL': cur.url = p.value; break;
      case 'CATEGORIES': cur.categories = unescapeText(p.value).split(','); break;
      case 'STATUS': cur.status = p.value; break;
      case 'RRULE': cur.rrule = p.value; break;
      case 'ATTACH': cur.image = p.value; break;
      default: break;
    }
  }
  return events;
}

function finish(e) {
  const desc = e.descriptionHtml ? htmlToText(e.descriptionHtml) : e.description || '';
  const url = e.url || (e.description || '').match(/https?:\/\/\S+/)?.[0];
  return {
    uid: e.uid,
    title: (e.title || '').trim(),
    description: desc.trim(),
    location: e.location ? e.location.split('\n')[0].trim() : null,
    lat: e.lat ?? null,
    lon: e.lon ?? null,
    start: e.start?.iso || null,
    end: e.end?.iso || null,
    allDay: !!e.start?.allDay,
    url: url || null,
    status: e.status || null,
    image: e.image || null,
    categories: e.categories || [],
    rrule: e.rrule || null
  };
}
