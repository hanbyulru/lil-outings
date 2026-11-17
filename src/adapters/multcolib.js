import { politeFetch } from '../lib/http.js';
import { decodeEntities, htmlToText } from '../lib/html.js';
import { parseClock, pad, withOffset, portlandDate, addDays } from '../lib/time.js';

/**
 * Multnomah County Library, https://multcolib.org/events-classes (Drupal, server-rendered).
 * Verified structure (Nov 2026): 20 cards per page, paged with ?page=N, filterable by
 * field_event_ages_target_id (667 Birth-12 months, 665 Kids and Family, 30 Tweens, 15 Teens, 8 Adults).
 * Each card: h2.event__title > a[href=/events-classes/<slug>-<n>], .event__date "Mon Nov 16 2026",
 * .event__time "10:15 AM - 11:00 AM", .event__location "<branch>", .event__summary (truncated),
 * optional .event__modified "This event has been canceled", optional Register link to events.multcolib.org.
 * Branch coordinates come from the Leaflet map JSON on /hours-and-locations.
 */
const SITE = 'https://multcolib.org';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const text = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const field = (card, cls) => card.match(new RegExp(`class="${cls}[^"]*"[^>]*>([\\s\\S]*?)</div>`))?.[1];

export function parseMultcolibList(html, source, audience = null) {
  const out = [];
  const cards = html.split(/<div class="event row\b/).slice(1);
  for (const card of cards) {
    const a = card.match(/class="event__title"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const url = a[1].startsWith('http') ? a[1] : SITE + a[1];
    const title = text(a[2]);
    const d = text(field(card, 'event__date col')).match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);
    if (!title || !d || !MONTHS[d[1].toLowerCase()]) continue;
    const date = `${d[3]}-${pad(MONTHS[d[1].toLowerCase()])}-${pad(+d[2])}`;
    const t = text(field(card, 'event__time')).match(/(\d{1,2}(?::\d{2})?\s*[ap]m)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i);
    const startMin = t ? parseClock(t[1]) : null;
    const endMin = t ? parseClock(t[2]) : null;
    const iso = (min) => `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
    const summary = card.match(/class="event__summary"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div class="col-md-3/)?.[1] || '';
    const regAt = card.indexOf('class="event__registration');
    const register = regAt < 0 ? null : card.slice(regAt).match(/<a href="([^"]+)"/)?.[1];
    const img = card.match(/<img[^>]+src="([^"]+)"/)?.[1];
    out.push({
      source_id: source.id,
      source_event_id: url,
      title,
      description: htmlToText(summary).slice(0, 600),
      start: withOffset(startMin == null ? `${date}T00:00:00` : iso(startMin)),
      end: endMin == null ? null : withOffset(iso(endMin)),
      all_day: startMin == null,
      url,
      venue_name: text(field(card, 'event__location')) || null,
      address: null,
      lat: null,
      lon: null,
      raw_categories: register ? ['Registration required'] : [],
      raw_audience: audience ? [audience] : [],
      price_text: null,
      image: img ? (img.startsWith('http') ? img : SITE + img) : null,
      registration_url: register ? decodeEntities(register) : null,
      cancelled: /cancel/i.test(text(field(card, 'event__modified')))
    });
  }
  return out;
}

/** Branch name -> { lat, lon } from the Leaflet "features" on /hours-and-locations. */
export function parseMultcolibBranches(html) {
  const out = {};
  const re = /"lat":(-?[\d.]+),"lon":(-?[\d.]+),[^{}]*?"popup":\{"value":"((?:[^"\\]|\\.)*)"/g;
  for (const m of html.matchAll(re)) {
    let popup;
    try { popup = JSON.parse(`"${m[3]}"`); } catch { continue; }
    const name = text(popup.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
    if (name) out[name] = { lat: +(+m[1]).toFixed(6), lon: +(+m[2]).toFixed(6) };
  }
  return out;
}

export async function fetchMultcolib(source, ctx) {
  const cfg = source.config;
  const lastDate = addDays(ctx.today || portlandDate(), cfg.days_ahead ?? ctx.horizonDays ?? 60);
  // multcolib.org sits behind Cloudflare and returns 429 at the default 1.5s spacing.
  const http = ctx.http.minGapMs ? { ...ctx.http, minGapMs: Math.max(ctx.http.minGapMs, cfg.min_gap_ms ?? 0) } : ctx.http;
  let branches = {};
  if (cfg.locations_url) {
    try { branches = parseMultcolibBranches(await politeFetch(cfg.locations_url, { ...http, ttlMs: 7 * 24 * 3600 * 1000 })); } catch { /* events still useful without coordinates */ }
  }
  const byUrl = new Map();
  for (const { id, label } of cfg.ages) {
    for (let page = 0; page < (cfg.max_pages ?? 40); page++) {
      const html = await politeFetch(`${cfg.url}?field_event_ages_target_id=${id}&page=${page}`, http);
      const batch = parseMultcolibList(html, source, label);
      if (!batch.length) break;
      for (const e of batch) {
        const prev = byUrl.get(e.url);
        if (prev) { if (!prev.raw_audience.includes(label)) prev.raw_audience.push(label); continue; }
        const b = branches[e.venue_name];
        byUrl.set(e.url, b ? { ...e, lat: b.lat, lon: b.lon } : e);
      }
      if (batch.every((e) => e.start.slice(0, 10) > lastDate)) break; // listing is date-ordered
    }
  }
  return [...byUrl.values()]; // cancelled ones are dropped in normalize
}
