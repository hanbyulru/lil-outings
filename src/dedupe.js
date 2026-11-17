import { normalizeVenueKey } from './normalize.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function keyFor(e) {
  const t5 = e.start_min == null ? 'x' : Math.round(e.start_min / 5);
  return `${norm(e.title)}|${e.date}|${t5}|${normalizeVenueKey(e.venue_name)}`;
}

/** Collapse the same event listed by several sources. Highest-trust copy wins; others are recorded in also_listed_on. */
export function dedupe(events) {
  const byKey = new Map();
  const byUrl = new Map();
  for (const e of events) {
    const k = keyFor(e);
    // Same page AND same day: one series page (weekly storytime) lists many dates, and query strings can be the
    // only thing that tells events apart (calendar.aspx?EID=1114), so keep them.
    const u = e.url ? `${e.url.replace(/#.*$/, '').replace(/\/$/, '')}|${e.date}` : null;
    const existing = byKey.get(k) || (u && byUrl.get(u));
    if (!existing) {
      byKey.set(k, e);
      if (u) byUrl.set(u, e);
      continue;
    }
    const [keep, drop] = (e.source.trust > existing.source.trust) ? [e, existing] : [existing, e];
    keep.also_listed_on = [...new Set([...(keep.also_listed_on || []), ...(drop.also_listed_on || []), drop.source.name])];
    if (!keep.lat && drop.lat) { keep.lat = drop.lat; keep.lon = drop.lon; keep.neighborhood = drop.neighborhood; keep.district = drop.district; }
    if (!keep.description && drop.description) keep.description = drop.description;
    byKey.set(k, keep);
    if (u) byUrl.set(u, keep);
    if (keep !== existing) { /* replaced */ }
  }
  return [...new Set(byKey.values())];
}
