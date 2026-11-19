// Isomorphic query logic: used by the Node API and by the browser UI. No imports, no Node APIs.

export function haversineMiles(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function dow(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }

/** Inclusive [from, to] date range for a "when" value. A literal YYYY-MM-DD picks that day. */
export const isFriday = (dateStr) => dow(dateStr) === 5;
export const isSunday = (dateStr) => dow(dateStr) === 0;
export const isSaturday = (dateStr) => dow(dateStr) === 6;

export function whenRange(when, today) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return [when, when];
  if (when === 'tomorrow') return [addDays(today, 1), addDays(today, 1)];
  // This week: today through Friday (owner, Nov 2026); on a weekend, through the coming Friday. The menu hides it on Fridays.
  // On a Sunday the week is over: "week" is the coming Monday-Friday and "weekend" the coming Saturday-Sunday (the app labels them
  // "Next week" / "Next weekend" and hides the separate Next week option; owner, Nov 2026).
  if (when === 'week') return dow(today) === 0 ? [addDays(today, 1), addDays(today, 5)] : [today, addDays(today, (5 - dow(today) + 7) % 7)];
  // Next week: the whole Monday-to-Sunday week after this one (owner, Nov 2026); on a Sunday that's tomorrow onward.
  // All upcoming days (owner, Nov 2026; offered only with the Holidays interest): everything from today on.
  if (when === 'upcoming') return [today, addDays(today, 400)];
  if (when === 'nextweek') { const mon = addDays(today, (8 - dow(today)) % 7 || 7); return [mon, addDays(mon, 6)]; }
  if (when === 'weekend') {
    const d = dow(today);
    if (d === 6) return [today, addDays(today, 1)];
    if (d === 0) return [addDays(today, 6), addDays(today, 7)];
    const sat = addDays(today, 6 - d);
    return [sat, addDays(sat, 1)];
  }
  return [today, today];
}

/** Max distance (miles) from a named place for an item to count as being in its district. */
export const PLACE_RADIUS_MILES = 5;

/** Every named place with its district: [{ name, lat, lon, district }]. */
const placeCache = new WeakMap();
export function allPlaces(geo) {
  if (!placeCache.has(geo)) placeCache.set(geo, geo.districts.flatMap((d) => d.places.map((p) => ({ ...p, district: d.id }))));
  return placeCache.get(geo);
}

/** Nearest named place within maxMiles (default PLACE_RADIUS_MILES) -> { place, district, miles } or null. */
export function nearestPlace(lat, lon, geo, maxMiles = PLACE_RADIUS_MILES) {
  if (!Number.isFinite(+lat) || !Number.isFinite(+lon) || lat === null || lon === null) return null;
  let best = null;
  for (const p of allPlaces(geo)) {
    const d = haversineMiles({ lat: +lat, lon: +lon }, p);
    if (!best || d < best.miles) best = { place: p.name, district: p.district, miles: d };
  }
  if (!best || best.miles > maxMiles) return null;
  const split = geo.districts.find((d) => d.id === best.district)?.split;
  if (split) best.place = splitPlace(+lat, +lon, split);
  return best;
}

/**
 * Districts split by a landmark instead of by nearest center (Lake Oswego, owner Nov 2026: Downtown LO / North of the Lake /
 * South of the Lake). split: { downtown: { place, lat, lon, miles }, north, south, lake: [[lon, lat], ...] outline }.
 * North or south: look straight up and down from the point; the lake edge you meet first decides (a point between two arms
 * of the lake goes with the nearer one). Past either end of the lake, compare with the lake's latitude at that end.
 */
export function splitPlace(lat, lon, split) {
  const dt = split.downtown;
  if (dt && haversineMiles({ lat, lon }, dt) <= dt.miles) return dt.place;
  const ring = split.lake;
  const ys = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    if ((x1 <= lon && lon < x2) || (x2 <= lon && lon < x1)) ys.push(y1 + ((lon - x1) / (x2 - x1)) * (y2 - y1));
  }
  if (!ys.length) {
    const xs = ring.map((p) => p[0]);
    const atWest = lon < Math.min(...xs);
    const end = [...ring].sort((p, q) => (atWest ? p[0] - q[0] : q[0] - p[0])).slice(0, 4);
    const endLat = end.reduce((t, p) => t + p[1], 0) / end.length;
    return lat >= endLat ? split.north : split.south;
  }
  const below = ys.filter((y) => y < lat), above = ys.filter((y) => y >= lat);
  if (!above.length) return split.north;
  if (!below.length) return split.south;
  return lat - Math.max(...below) <= Math.min(...above) - lat ? split.north : split.south;
}

/** Regions a district belongs to (Tigard is in two). */
export const regionsOf = (districtId, geo) => geo.regions.filter((r) => r.districts.includes(districtId)).map((r) => r.id);

/** An item's district: stored by the pipeline, else worked out from its coordinates. */
function districtOf(item, geo) {
  if (item.district) return item.district;
  return nearestPlace(item.lat, item.lon, geo)?.district || null;
}

/** Resolve a location choice.
 *  loc: { region: 'westside' } | { district: 'tigard' } | { place: 'Bull Mountain' } | { zip } | null */
export function resolveLoc(loc, geo) {
  if (!loc) return null;
  // Several districts/towns picked in the "Narrow" step (owner, Nov 2026): a match on any of them counts.
  if (Array.isArray(loc.picks)) {
    const parts = loc.picks.map((x) => resolveLoc(x, geo)).filter(Boolean);
    if (parts.length <= 1) return parts[0] || null;
    return { kind: 'multi', parts, districts: [...new Set(parts.flatMap((x) => x.districts))], label: parts.map((x) => x.label).join(', ') };
  }
  if (loc.zip) {
    const z = geo.zips[String(loc.zip)];
    return z ? { kind: 'zip', point: { lat: z[0], lon: z[1] }, label: String(loc.zip) } : { kind: 'zip', unknown: true, label: String(loc.zip) };
  }
  if (loc.region) {
    const r = geo.regions.find((x) => x.id === loc.region);
    return r ? { kind: 'region', region: r.id, districts: r.districts, label: r.short } : null;
  }
  if (loc.district) {
    const d = geo.districts.find((x) => x.id === loc.district);
    return d ? { kind: 'district', district: d.id, districts: [d.id], label: d.name } : null;
  }
  if (loc.place) {
    const p = allPlaces(geo).find((x) => x.name === loc.place);
    return p ? { kind: 'place', place: p.name, district: p.district, districts: [p.district], point: { lat: p.lat, lon: p.lon }, label: p.name, split: !!geo.districts.find((d) => d.id === p.district)?.split } : null;
  }
  return null;
}

function ageOverlap(item, ageRange) {
  if (!ageRange) return true;
  if (item.age_min == null || item.age_max == null) return true;
  return item.age_min <= ageRange[1] && item.age_max >= ageRange[0];
}

function categoryMatch(item, category) {
  if (!category || category === 'all') return true;
  if (category === 'outdoors') return (item.categories || []).includes('outdoors') || item.setting === 'outdoor';
  return (item.categories || []).includes(category);
}

function locMatch(item, r, radiusMiles, geo) {
  if (!r) return { ok: true, miles: null };
  let miles = null;
  if (r.point && item.lat != null) miles = haversineMiles(r.point, item);
  if (r.kind === 'multi') {
    const hits = r.parts.map((x) => locMatch(item, x, radiusMiles, geo));
    const ms = hits.map((h) => h.miles).filter((m) => m != null);
    return { ok: hits.some((h) => h.ok), miles: ms.length ? Math.min(...ms) : null };
  }
  if (r.kind === 'region' || r.kind === 'district') return { ok: r.districts.includes(districtOf(item, geo)), miles };
  if (r.kind === 'place') {
    // A split district's parts (Lake Oswego) have hard edges: no 1.5-mile spill into the other side of the lake.
    if (r.split) return { ok: item.neighborhood ? item.neighborhood === r.place : item.lat != null && nearestPlace(item.lat, item.lon, geo)?.place === r.place, miles };
    return { ok: item.neighborhood === r.place || (miles != null && miles <= 1.5), miles };
  }
  if (r.kind === 'zip') return r.unknown ? { ok: true, miles: null } : { ok: miles != null && miles <= radiusMiles, miles };
  return { ok: true, miles };
}

/**
 * filterEvents(events, opts, ctx)
 * opts: { age: [min,max]|null, interest, category, when, loc, free, dropin, indoor, radius, sort }
 * ctx:  { today: 'YYYY-MM-DD', geo, nowMin? }  nowMin (minutes since midnight, Portland) hides today's events that are over
 */
export function filterEvents(events, opts = {}, ctx) {
  const [from, to] = whenRange(opts.when || 'today', ctx.today);
  const r = resolveLoc(opts.loc, ctx.geo);
  const radius = opts.radius ?? 10;
  const out = [];
  for (const e of events) {
    if (e.date < from || e.date > to) continue;
    if (e.date === ctx.today && isOver(e, ctx.nowMin)) continue;
    if (!ageOverlap(e, opts.age)) continue;
    if (opts.interest && opts.interest !== 'all' && !(e.interests || []).includes(opts.interest)) continue;
    if (!categoryMatch(e, opts.category)) continue;
    if (opts.free && e.cost_type !== 'free') continue;
    if (opts.dropin && e.registration !== 'drop_in') continue;
    if (opts.indoor && e.setting !== 'indoor') continue;
    const l = locMatch(e, r, radius, ctx.geo);
    if (!l.ok) continue;
    out.push({ ...e, miles: l.miles });
  }
  return sortItems(out, opts.sort || 'soonest');
}

/** True when an event today has already ended (no end time: assume an hour). All-day events never end early. */
export function isOver(e, nowMin) {
  if (nowMin == null || e.start_min == null) return false;
  const end = e.end_min ?? e.start_min + 60;
  return end <= nowMin;
}

export function sortItems(items, sort) {
  const byTime = (a, b) => (a.date + String(a.start_min ?? 0).padStart(4, '0')).localeCompare(b.date + String(b.start_min ?? 0).padStart(4, '0')) || a.title.localeCompare(b.title);
  const arr = [...items];
  if (sort === 'closest') arr.sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9) || byTime(a, b));
  else if (sort === 'cheapest') arr.sort((a, b) => (a.cost_type === 'free' ? 0 : a.cost_amount ?? 999) - (b.cost_type === 'free' ? 0 : b.cost_amount ?? 999) || byTime(a, b));
  else arr.sort(byTime);
  return arr;
}

/** Evergreen places directory. */
export function filterPlaces(places, opts = {}, ctx) {
  const r = resolveLoc(opts.loc, ctx.geo);
  const radius = opts.radius ?? 15;
  const out = [];
  for (const p of places) {
    if (!ageOverlap(p, opts.age)) continue;
    if (opts.explore && !(p.explore || []).includes(opts.explore)) continue; // "More to explore" pill
    if (opts.interest && opts.interest !== 'all' && !(p.interests || []).includes(opts.interest)) continue;
    if (opts.category === 'outdoors' && p.setting !== 'outdoor' && p.setting !== 'both') continue;
    if (opts.category === 'seasonal' || opts.category === 'storytime') continue;
    if (opts.category === 'babies_toddlers' && p.age_min > 2) continue;
    if (opts.free && p.cost !== 'free') continue;
    if (opts.indoor && p.setting !== 'indoor') continue;
    const l = locMatch(p, r, radius, ctx.geo);
    if (!l.ok) continue;
    out.push({ ...p, miles: l.miles });
  }
  out.sort((a, b) => (r?.point ? (a.miles ?? 1e9) - (b.miles ?? 1e9) : a.name.localeCompare(b.name)));
  return out;
}

/** Evergreen class/program listings (no dates). Location match uses the program's regions. */
export function filterPrograms(programs, opts = {}, ctx) {
  const r = resolveLoc(opts.loc, ctx.geo);
  const out = [];
  for (const p of programs) {
    if (!ageOverlap(p, opts.age)) continue;
    // Programs list the regions they're offered in (from PP&R's own region headings).
    if (r && r.kind !== 'zip' && !r.districts.some((d) => regionsOf(d, ctx.geo).some((x) => (p.regions || []).includes(x)))) continue;
    if (opts.category === 'seasonal' || opts.category === 'storytime' || opts.category === 'outdoors') continue;
    if (opts.category === 'babies_toddlers' && p.age_min > 2) continue;
    out.push(p);
  }
  return out.sort((a, b) => a.age_min - b.age_min || a.name.localeCompare(b.name));
}
