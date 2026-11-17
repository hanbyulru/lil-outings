import { politeFetch } from '../lib/http.js';
import { decodeEntities } from '../lib/html.js';
import { parseClock, pad, withOffset } from '../lib/time.js';

/**
 * portland.gov (Drupal) event lists, e.g. https://www.portland.gov/parks/events?page=0
 * Verified structure (Nov 2026): event links look like /parks/events/2026/12/5/<slug> (the date is in the URL),
 * each followed by a "9:00 am to 12:00 pm" line and a label ("Volunteer event", "Public meeting", ...).
 * Note: PP&R's /events feed is mostly volunteer days and public meetings. The classifier drops those; kid programming
 * lives in the PP&R class catalog (not adapted yet).
 */
export function parsePortlandGovList(html, source) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+href="((?:https?:\/\/www\.portland\.gov)?\/[a-z\/-]*?events\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([a-z0-9-]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  const matches = [...html.matchAll(re)];
  matches.forEach((m, i) => {
    const [, href, y, mo, d, slug, inner] = m;
    const url = href.startsWith('http') ? href : 'https://www.portland.gov' + href;
    if (seen.has(url)) return;
    seen.add(url);
    const title = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!title) return;
    const from = m.index + m[0].length;
    const to = Math.min(from + 700, matches[i + 1] ? matches[i + 1].index : Infinity);
    const after = html.slice(from, to);
    const t = after.match(/(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:to|-|–)\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
    const label = after.match(/(?:Label:\s*)?(Volunteer event|Public meeting|Community event|Meeting|Class|Festival|Workshop)/i)?.[1] || null;
    const desc = decodeEntities(after.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/^\s*(\d{1,2}(?::\d{2})?\s*[ap]m\s*(?:to|-|–)\s*\d{1,2}(?::\d{2})?\s*[ap]m)?\s*(Label:\s*[A-Za-z ]+?(?=\s{2,}|$|[A-Z][a-z]+ ))?/, '').trim().slice(0, 400);
    const startMin = t ? parseClock(t[1]) : null;
    const endMin = t ? parseClock(t[2]) : null;
    const date = `${y}-${pad(+mo)}-${pad(+d)}`;
    const iso = (min) => (min == null ? `${date}T00:00:00` : `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`);
    out.push({
      source_id: source.id,
      source_event_id: url,
      title,
      description: desc,
      start: withOffset(iso(startMin)),
      end: endMin == null ? null : withOffset(iso(endMin)),
      all_day: startMin == null,
      url,
      venue_name: null,
      address: null,
      lat: null,
      lon: null,
      raw_categories: label ? [label] : [],
      raw_audience: [],
      price_text: null,
      image: null,
      cancelled: false,
      slug
    });
  });
  return out;
}

export async function fetchPortlandGov(source, ctx) {
  const all = [];
  for (let page = 0; page < (source.config.max_pages ?? 3); page++) {
    const html = await politeFetch(`${source.config.url}?page=${page}`, ctx.http);
    const excl = (source.config.exclude_labels || []).map((l) => l.toLowerCase());
    const batch = parsePortlandGovList(html, source);
    const keep = batch.filter((e) => !(e.raw_categories || []).some((l) => excl.includes(l.toLowerCase())));
    if (!batch.length) break;
    all.push(...keep);
  }
  return all;
}
