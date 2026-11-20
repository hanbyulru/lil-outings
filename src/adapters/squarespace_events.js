import { politeFetch } from '../lib/http.js';
import { htmlToText, decodeEntities } from '../lib/html.js';
import { withOffset, portlandDate, addDays } from '../lib/time.js';

/**
 * Squarespace events collections (verified Nov 2026: Christmas Ships, christmasships.org/parade-schedule).
 * Any Squarespace collection page answers ?format=json:
 *   { upcoming: [{ id, title, fullUrl, startDate (epoch ms), endDate, body (HTML), tags,
 *                  location: { addressTitle, addressLine1, addressLine2, mapLat, mapLng } }], past: [...] }
 * An item with no location carries Squarespace's default map point (New York); it borrows the location of another
 * item whose place name appears in its title ("Riverplace Marina to Milwaukie" -> Riverplace Marina), else the
 * source's fallback venue.
 * config: { site, path: '/parade-schedule', title_prefix?, title_replace?: [[regex, replacement]], fallback_venue }
 */
const PORTLAND = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** Epoch ms -> "2026-12-08T19:00:00-08:00" (Portland). */
export function portlandIso(ms) {
  const p = Object.fromEntries(PORTLAND.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return withOffset(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`);
}

/** Squarespace's placeholder map point when no address is set. */
const isDefaultPoint = (lat, lon) => Math.abs(lat - 40.7207559) < 0.001 && Math.abs(lon + 74.0007613) < 0.001;

/** Body HTML -> readable text: drops the inline CSS Squarespace puts in text blocks, one line per paragraph. */
export function bodyText(html) {
  const noCss = String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/#block-[\s\S]*?(?=<|$)/g, '');
  return htmlToText(noCss.replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n'))
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function parseSquarespaceEvents(json, source) {
  const c = source.config;
  const fb = c.fallback_venue;
  const items = json?.upcoming || [];
  const located = (e) => e.location && e.location.addressTitle && Number.isFinite(e.location.mapLat) && !isDefaultPoint(e.location.mapLat, e.location.mapLng);
  const places = [...new Map(items.filter(located).map((e) => [e.location.addressTitle.trim().toLowerCase(), e.location])).entries()];
  // A map point shared by two differently named places is a copy-paste slip on the site (Christmas Ships' Grant Street
  // Pier carried the Gleason ramp's point): drop it so the street address gets geocoded instead.
  const names = new Map();
  for (const e of items.filter(located)) { const k = `${e.location.mapLat.toFixed(4)},${e.location.mapLng.toFixed(4)}`; names.set(k, (names.get(k) || new Set()).add(e.location.addressTitle.trim().toLowerCase())); }
  const trusted = (l) => names.get(`${l.mapLat.toFixed(4)},${l.mapLng.toFixed(4)}`)?.size === 1;
  const replace = (c.title_replace || []).map(([re, to]) => [new RegExp(re, 'i'), to]);
  return items.map((e) => {
    const loc = located(e) ? e.location : places.find(([name]) => e.title.toLowerCase().includes(name))?.[1] || null;
    const address = loc ? [loc.addressLine1, loc.addressLine2].map((s) => (s || '').trim()).filter(Boolean).join(', ') : null;
    let title = decodeEntities(e.title || '').replace(/\s+/g, ' ').trim();
    for (const [re, to] of replace) title = title.replace(re, to);
    return {
      source_id: source.id,
      source_event_id: String(e.id),
      title: `${c.title_prefix || ''}${title}`,
      description: bodyText(e.body).replace(/\n/g, ' · ').slice(0, 900),
      start: portlandIso(e.startDate),
      end: e.endDate ? portlandIso(e.endDate) : null,
      all_day: false,
      url: new URL(e.fullUrl, c.site).href,
      venue_name: loc?.addressTitle?.trim() || fb?.name || null,
      address,
      lat: loc && trusted(loc) ? loc.mapLat : null,
      lon: loc && trusted(loc) ? loc.mapLng : null,
      geo_fallback: fb ? { lat: fb.lat, lon: fb.lon } : null,
      raw_categories: (e.tags || []).map(String),
      raw_audience: [],
      price_text: c.price_text || null,
      image: e.assetUrl || null,
      cancelled: /cancel(l)?ed/i.test(e.title || '')
    };
  });
}

export async function fetchSquarespaceEvents(source, ctx) {
  const c = source.config;
  const json = JSON.parse(await politeFetch(`${c.site}${c.path}?format=json`, ctx.http));
  const today = ctx.today || portlandDate(), last = addDays(today, ctx.horizonDays ?? 60);
  return parseSquarespaceEvents(json, source).filter((e) => e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= last);
}
