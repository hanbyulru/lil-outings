import { politeFetch } from '../lib/http.js';
import { decodeEntities } from '../lib/html.js';

/**
 * Nuxt + Strapi sites that render their events list server-side (verified Nov 2026: NCPRD, ncprd.org/events).
 * The page carries a __NUXT_DATA__ payload (devalue format: a flat array where objects point at other indexes).
 * Event objects look like { __typename: 'Event', title, slug, fullSlug, excerpt, address, startTime, endTime (UTC ISO),
 *   occurrences: { data: [{ attributes: { startTime, endTime, status: 'scheduled' } }] } }.
 * A series (Indoor Playground Tuesdays) has dated occurrences; a one-off has none and uses startTime.
 * config: { url, site, fallback_venue }; addresses are geocoded (config.geocode).
 */
export function readNuxtData(html) {
  const m = String(html).match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const d = JSON.parse(m[1]);
  const memo = new Map();
  const wrap = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'EmptyRef', 'EmptyShallowRef', 'NuxtError']);
  const val = (i, depth = 0) => {
    if (typeof i !== 'number') return i;
    if (memo.has(i)) return memo.get(i);
    const x = d[i];
    if (depth > 40) return null;
    let out;
    if (Array.isArray(x)) {
      if (typeof x[0] === 'string' && wrap.has(x[0])) out = val(x[1], depth + 1);
      else if (x[0] === 'Date') out = x[1];
      else { out = []; memo.set(i, out); for (const v of x) out.push(val(v, depth + 1)); return out; }
    } else if (x && typeof x === 'object') {
      out = {}; memo.set(i, out);
      for (const [k, v] of Object.entries(x)) out[k] = val(v, depth + 1);
      return out;
    } else out = x;
    memo.set(i, out);
    return out;
  };
  return { size: d.length, get: val, raw: d };
}

/** Every Event object in the payload, resolved. */
export function nuxtEvents(html) {
  const n = readNuxtData(html);
  if (!n) return [];
  const seen = new Set(), out = [];
  n.raw.forEach((x, i) => {
    if (x && typeof x === 'object' && !Array.isArray(x) && 'occurrences' in x && 'startTime' in x) {
      const e = n.get(i);
      const key = e.fullSlug || e.slug || e.title;
      if (!seen.has(key)) { seen.add(key); out.push(e); }
    }
  });
  return out;
}

export function parseNuxtStrapiEvents(html, source, today) {
  const fb = source.config.fallback_venue;
  const out = [];
  for (const e of nuxtEvents(html)) {
    const occ = (e.occurrences?.data || []).map((o) => o.attributes || o).filter((o) => (o.status || 'scheduled') === 'scheduled');
    const times = occ.length ? occ : [{ startTime: e.startTime, endTime: e.endTime }];
    const url = e.fullSlug ? new URL(`/${e.fullSlug}`, source.config.site).href : null;
    for (const t of times) {
      if (!t.startTime || (today && t.startTime.slice(0, 10) < today)) continue;
      out.push({
        source_id: source.id,
        source_event_id: `${e.slug || e.title}|${t.startTime}`,
        title: decodeEntities(e.title || '').trim(),
        description: decodeEntities(e.excerpt || '').trim(),
        start: t.startTime, // UTC ISO; normalize renders Portland time
        end: t.endTime || null,
        all_day: false,
        url,
        venue_name: e.address ? decodeEntities(e.address).replace(/\s+in\s+(.+)$/i, ', $1').split(',').slice(0, 2).join(',').trim() : fb?.name || null,
        address: e.address ? decodeEntities(e.address).replace(/\s+in\s+(.+)$/i, ', $1') : null,
        lat: null, lon: null,
        geo_fallback: fb ? { lat: fb.lat, lon: fb.lon } : null,
        raw_categories: [],
        raw_audience: [],
        price_text: null,
        image: null,
        cancelled: /cancel(l)?ed/i.test(e.title || '')
      });
    }
  }
  return out;
}

export async function fetchNuxtStrapiEvents(source, ctx) {
  return parseNuxtStrapiEvents(await politeFetch(source.config.url, ctx.http), source, ctx.today);
}
