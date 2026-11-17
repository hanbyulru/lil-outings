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
export function whenRange(when, today) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return [when, when];
  if (when === 'tomorrow') return [addDays(today, 1), addDays(today, 1)];
  if (when === 'week') return [today, addDays(today, 6)];
  if (when === 'weekend') {
    const d = dow(today);
    if (d === 6) return [today, addDays(today, 1)];
    if (d === 0) return [today, today];
    const sat = addDays(today, 6 - d);
    return [sat, addDays(sat, 1)];
  }
  return [today, today];
}

/** Resolve a location choice to { point?, area?, neighborhood? }.
 *  loc: { zip } | { area: 'NW' } | { neighborhood: 'Pearl District' } | null */
export function resolveLoc(loc, geo) {
  if (!loc) return null;
  if (loc.zip) {
    const z = geo.zips[String(loc.zip)];
    return z ? { kind: 'zip', point: { lat: z[0], lon: z[1] }, label: String(loc.zip) } : { kind: 'zip', unknown: true, label: String(loc.zip) };
  }
  if (loc.neighborhood) {
    const n = geo.neighborhoods.find((x) => x.name === loc.neighborhood);
    return n ? { kind: 'neighborhood', neighborhood: n.name, area: n.area, point: { lat: n.lat, lon: n.lon }, label: `${n.name} · ${n.area}` } : null;
  }
  if (loc.area) return { kind: 'area', area: loc.area, label: loc.area === 'N' ? 'All North Portland' : `All ${loc.area}` };
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

function locMatch(item, r, radiusMiles) {
  if (!r) return { ok: true, miles: null };
  let miles = null;
  if (r.point && item.lat != null) miles = haversineMiles(r.point, item);
  if (r.kind === 'area') return { ok: item.area === r.area, miles };
  if (r.kind === 'neighborhood') return { ok: item.neighborhood === r.neighborhood || (miles != null && miles <= 1.5), miles };
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
    const l = locMatch(e, r, radius);
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
    if (opts.interest && opts.interest !== 'all' && !(p.interests || []).includes(opts.interest)) continue;
    if (opts.category === 'outdoors' && p.setting !== 'outdoor' && p.setting !== 'both') continue;
    if (opts.category === 'seasonal' || opts.category === 'storytime') continue;
    if (opts.category === 'babies_toddlers' && p.age_min > 2) continue;
    if (opts.free && p.cost !== 'free') continue;
    if (opts.indoor && p.setting !== 'indoor') continue;
    const l = locMatch(p, r, radius);
    if (!l.ok) continue;
    out.push({ ...p, miles: l.miles });
  }
  out.sort((a, b) => (r?.point ? (a.miles ?? 1e9) - (b.miles ?? 1e9) : a.name.localeCompare(b.name)));
  return out;
}

/** Evergreen class/program listings (no dates). Area match uses the program's region areas. */
export function filterPrograms(programs, opts = {}, ctx) {
  const r = resolveLoc(opts.loc, ctx.geo);
  const out = [];
  for (const p of programs) {
    if (!ageOverlap(p, opts.age)) continue;
    if (r && r.area && !(p.areas || []).includes(r.area)) continue;
    if (opts.category === 'seasonal' || opts.category === 'storytime' || opts.category === 'outdoors') continue;
    if (opts.category === 'babies_toddlers' && p.age_min > 2) continue;
    out.push(p);
  }
  return out.sort((a, b) => a.age_min - b.age_min || a.name.localeCompare(b.name));
}
