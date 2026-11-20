import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { seedInterestRules } from './adapters/manual.js';
import { runSummary, recordRun } from './runlog.js';
import { checkCurated } from './curated.js';
import { venueQuery } from './adapters/activenet.js';
import { EVENT_ADAPTERS, PLACE_ADAPTERS, PROGRAM_ADAPTERS, CLASS_ADAPTERS } from './adapters/index.js';
import { normalizeEvent, withinHorizon, normalizeVenueKey, guessVenue } from './normalize.js';
import { dedupe } from './dedupe.js';
import { classifyAll } from './classify/index.js';
import { extraInterests, ageFloor } from './classify/rules.js';
import { bandsFor, VOCAB, canonicalInterests } from './classify/validate.js';
import { locate, haversineMiles, GEO } from './lib/geo.js';
import { nearestPlace } from '../web/query.js';
import { portlandDate } from './lib/time.js';
import { buildOffline } from './offline.js';
import { addPlaceImages } from './images.js';
import { geocodeEvents } from './geocode.js';

const OUT_OF_AREA_MILES = 15; // events farther than this from every named place are out of the metro

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const PLACE_DEFAULTS = {
  playground: { age_min: 1, age_max: 10, interests: [], cost: 'free', setting: 'outdoor' },
  nature_reserve: { age_min: 2, age_max: 12, interests: ['nature'], cost: 'free', setting: 'outdoor' },
  water_park: { age_min: 1, age_max: 12, interests: [], cost: 'varies', setting: 'both' },
  museum: { age_min: 2, age_max: 12, interests: [], cost: 'paid', setting: 'indoor' },
  zoo: { age_min: 0, age_max: 12, interests: ['nature'], cost: 'paid', setting: 'outdoor' },
  aquarium: { age_min: 0, age_max: 12, interests: ['nature', 'science'], cost: 'paid', setting: 'indoor' },
  theme_park: { age_min: 2, age_max: 12, interests: [], cost: 'paid', setting: 'outdoor' },
  play: { age_min: 0, age_max: 10, interests: [], cost: 'paid', setting: 'indoor' },
  gym: { age_min: 1, age_max: 12, interests: [], cost: 'paid', setting: 'indoor' }
};

/** Is OSM feature f a place we already have? Same Wikidata item, same name, or (within ~150 m) one name inside the
 *  other or the same first word: "OMSI (Oregon Museum of Science and Industry)" = "Oregon Museum of Science and Industry". */
export function samePlace(p, f) {
  if (p.wikidata && f.wikidata && p.wikidata === f.wikidata) return true;
  const a = normalizeVenueKey(p.name), b = normalizeVenueKey(f.name);
  if (a === b) return true;
  if (haversineMiles(p, f) >= 0.1) return false;
  return a.split(' ')[0] === b.split(' ')[0] || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a)));
}

/** Interest tags the owner asked for on specific listings (event_overrides rules with only_interests / add_interests), after the classifier.
 *  Only known interest ids are added (model output and hand rules can't add vocabulary). */
export function overrideInterests(e, interests, cfg) {
  const known = new Set(VOCAB.interests);
  let out = [...interests];
  for (const r of cfg?.rules || []) {
    if (!(r.add_interests || r.only_interests) || (e.source?.id || e.source_id) !== r.source || !new RegExp(r.title, 'i').test(e.title || '')) continue;
    if (r.only_interests) out = r.only_interests.filter((t) => known.has(t));
    for (const t of r.add_interests || []) if (known.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Apply config/event_overrides.json rules ({ source, title regex, set }) to raw listings, in place. */
export function applyEventOverrides(items, cfg) {
  const rules = (cfg?.rules || []).map((r) => ({ ...r, re: new RegExp(r.title, 'i') }));
  for (const e of items) for (const r of rules) if (r.set && e.source_id === r.source && r.re.test(e.title || '')) Object.assign(e, r.set);
}

export async function refresh({ offline = false, now = new Date(), useLLM = true, outDir = 'data/public', horizonDays = 60, log = console.log, llmOptions = {}, cacheDir = 'data/cache' } = {}) {
  const startedAt = new Date();
  const sources = readJson('config/sources.json');
  const today = portlandDate(now);
  const off = offline ? buildOffline(today) : null;
  const ctx = { today, horizonDays, http: { fetchImpl: off ? off.fetchImpl : fetch, cacheDir: off ? `${cacheDir}/offline-http` : `${cacheDir}/http`, minGapMs: off ? 0 : 1500, ttlMs: off ? 0 : 30 * 60 * 1000 } };
  const status = [];

  // ---- places ----
  const placeStatus = [];
  let places = readJson('config/places.seed.json').map((p) => ({ ...p, source: 'curated', verified: true }));
  for (const src of sources.places.filter((s) => s.enabled)) {
    try {
      const found = await PLACE_ADAPTERS[src.type](src, ctx);
      for (const f of found) {
        const dup = places.find((p) => samePlace(p, f));
        if (dup) continue;
        const d = PLACE_DEFAULTS[f.kind] || { age_min: 0, age_max: 12, interests: [], cost: 'varies', setting: 'unknown' };
        places.push({ id: `osm-${f.source_place_id.replace('/', '-')}`, name: f.name, kind: f.kind, lat: f.lat, lon: f.lon, address: f.address, url: f.url, hours_text: f.hours_text, note: f.description || '', ...d, explore: f.explore || [], wikidata: f.wikidata || undefined, commons: f.commons || undefined, image: f.image || undefined, source: 'osm', verified: false });
      }
      placeStatus.push({ id: src.id, name: src.name, ok: true, fetched: found.length });
      log(`  ${src.name} places: ${found.length}`);
    } catch (err) {
      placeStatus.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err) });
      log(`  ${src.name} places: FAILED (${err.message})`);
    }
  }
  // Hand corrections on top of OSM (dead links etc.): config/place_overrides.json, keyed by place id.
  const overrides = readJson('config/place_overrides.json');
  places = places.map((p) => (overrides[p.id] ? { ...p, ...Object.fromEntries(Object.entries(overrides[p.id]).filter(([k]) => !k.startsWith('_'))) } : p));
  if (!offline) await addPlaceImages(places, ctx.http, log); // the demo has no photo fixtures: cards show their mosaic banner
  else for (const p of places) delete p.commons;
  places = places.map((p) => { const l = locate(p.lat, p.lon); return { ...p, interests: canonicalInterests(p.interests), age_bands: bandsFor(p.age_min, p.age_max), neighborhood: l?.neighborhood || null, district: l?.district || null }; });

  // ---- programs (evergreen classes, no dates) ----
  let programs = [];
  const programStatus = [];
  for (const src of (sources.programs || []).filter((s) => s.enabled)) {
    try {
      const found = await PROGRAM_ADAPTERS[src.type](src, { ...ctx, log });
      const seen = new Set();
      for (const f of found) {
        if (seen.has(f.program_key)) continue;
        seen.add(f.program_key);
        programs.push({ id: `${src.id}-${programs.length + 1}`, source: { id: src.id, name: src.name, trust: src.trust }, ...f });
      }
      programStatus.push({ id: src.id, name: src.name, ok: true, fetched: found.length, status: src.status });
      log(`  ${src.name} programs: ${found.length}`);
    } catch (err) {
      programStatus.push({ id: src.id, name: src.name, ok: false, error: err.message, status: src.status });
      log(`  ${src.name} programs: FAILED (${err.message})`);
    }
  }

  // ---- classes (sign-up classes and series with dates, e.g. Parks & Rec registration; admin dashboard only for now) ----
  let classes = [];
  const classStatus = [];
  for (const src of (sources.classes || []).filter((s) => s.enabled)) {
    const t0 = Date.now();
    try {
      const found = await CLASS_ADAPTERS[src.type](src, { ...ctx, log });
      classes.push(...found);
      classStatus.push({ id: src.id, name: src.name, ok: true, fetched: found.length, published: found.length, ms: Date.now() - t0, status: src.status });
      log(`  ${src.name}: ${found.length} classes`);
    } catch (err) {
      classStatus.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err), ms: Date.now() - t0, status: src.status });
      log(`  ${src.name} classes: FAILED (${err.message})`);
    }
  }
  // Place each venue once (geocoded and cached like event addresses), then give classes their district.
  const venueSrc = new Map((sources.classes || []).map((s) => [s.id, s]));
  const venues = new Map();
  for (const c of classes) { const q = venueQuery(c.venue, venueSrc.get(c.source.id)?.config?.venue_aliases); if (q && !venues.has(`${c.source.id}|${c.venue}`)) venues.set(`${c.source.id}|${c.venue}`, { r: { address: `${q}, ${venueSrc.get(c.source.id)?.config?.venue_town || 'Portland, OR'}`, lat: null, lon: null }, src: { config: { geocode: true } } }); }
  if (!off && venues.size) await geocodeEvents([...venues.values()], ctx.http, { log });
  classes = classes.map((c) => {
    const v = venues.get(`${c.source.id}|${c.venue}`)?.r;
    const l = v?.lat != null ? locate(v.lat, v.lon) : null;
    return { ...c, lat: v?.lat ?? null, lon: v?.lon ?? null, neighborhood: l?.neighborhood || null, district: l?.district || null };
  });

  // ---- events ----
  let raw = [];
  for (const src of sources.events.filter((s) => s.enabled)) {
    const t0 = Date.now();
    try {
      let items;
      if (src.type === 'manual' && off) items = off.manual.map((e) => ({ source_id: src.id, all_day: false, address: null, raw_categories: [], raw_audience: [], cancelled: false, ...e }));
      else items = await EVENT_ADAPTERS[src.type](src, ctx);
      // Any source can drop titles at the source (volunteer days, teen-only programs): config.exclude_titles regexes.
      const skip = (src.config?.exclude_titles || []).map((re) => new RegExp(re, 'i'));
      items = items.filter((e) => !skip.some((re) => re.test(e.title || ''))).map((e) => ({ ...e, source_id: src.id }));
      raw.push(...items.map((r) => ({ r, src })));
      status.push({ id: src.id, name: src.name, ok: true, fetched: items.length, ms: Date.now() - t0, status: src.status });
      log(`  ${src.name}: ${items.length} listings`);
    } catch (err) {
      status.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err), status: src.status });
      log(`  ${src.name}: FAILED (${err.message})`);
    }
  }

  // Hand corrections (config/event_overrides.json): e.g. an off-site program the feed lists with no venue.
  const eventOverrides = readJson('config/event_overrides.json');
  // Curated events (config/events.seed.json) set their own interest tags ("interests").
  for (const src of sources.events.filter((x) => x.enabled && x.type === 'manual')) eventOverrides.rules = [...(eventOverrides.rules || []), ...seedInterestRules(src.config?.file || 'config/events.seed.json', src.id)];
  applyEventOverrides(raw.map((x) => x.r), eventOverrides);

  // Feeds with a street address but no coordinates (config.geocode): look them up, else a town-level pin.
  if (!off) await geocodeEvents(raw, ctx.http, { log });
  else for (const x of raw) if (x.r.lat == null && x.r.geo_fallback) { x.r.lat = x.r.geo_fallback.lat; x.r.lon = x.r.geo_fallback.lon; }
  for (const x of raw) delete x.r.geo_fallback;
  const seen = new Set();
  let events = [];
  let dropped = { past_or_far: 0, invalid: 0, out_of_area: 0 };
  for (const { r, src } of raw) {
    const e = normalizeEvent(r, src, { today });
    if (!e) { dropped.invalid++; continue; }
    if (!withinHorizon(e, today, horizonDays)) { dropped.past_or_far++; continue; }
    // Regional systems (FVRL) reach far beyond the metro: drop anything 15+ miles from every named place.
    if (e.lat != null && !nearestPlace(e.lat, e.lon, GEO, OUT_OF_AREA_MILES)) { dropped.out_of_area++; continue; }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    delete e.horizonDays;
    events.push(e);
  }
  const beforeDedupe = events.length;
  events = dedupe(events).map((e) => (e.lat == null ? guessVenue(e, places) : e));

  const tags = await classifyAll(events, { cachePath: `${cacheDir}/classify${off ? '.demo' : ''}.json`, useLLM: useLLM && !off, llmOptions, log });
  let notKids = 0;
  const kept = [];
  for (const e of events) {
    const t = tags.get(e.id);
    if (!t.kid_relevant) { notKids++; continue; }
    const [ageMin, ageMax] = ageFloor(e, t.age_min, t.age_max); // e.g. chess is never for babies (owner)
    kept.push({
      ...e,
      age_min: ageMin, age_max: ageMax, age_bands: bandsFor(ageMin, ageMax),
      interests: overrideInterests(e, extraInterests({ ...e, categories: t.categories }, canonicalInterests(t.interests)), eventOverrides), categories: t.categories, setting: t.setting, registration: t.registration,
      cost_type: t.cost_type, cost_amount: t.cost_amount,
      confidence: t.confidence, needs_review: t.needs_review, tag_source: t.tag_source
    });
  }
  kept.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)));

  // Events each source contributes to the site, after dedupe and the kids filter (admin dashboard).
  const perSource = {};
  for (const e of kept) perSource[e.source.id] = (perSource[e.source.id] || 0) + 1;
  for (const st of status) if (st.ok) st.published = perSource[st.id] || 0;

  // Curated (hand-entered) events: check each organizer's page and the entries' dates (admin dashboard).
  const manualSrc = sources.events.find((x) => x.type === 'manual' && x.enabled);
  const curated = manualSrc ? await checkCurated({ seedFile: manualSrc.config?.file || 'config/events.seed.json', statePath: `${cacheDir}/curated-state.json`, http: ctx.http, today, kept, sourceId: manualSrc.id, offline: !!off, log }) : [];

  mkdirSync(outDir, { recursive: true });
  const meta = {
    generated_at: now.toISOString(), today, mode: offline ? 'demo (sample feeds)' : 'live',
    counts: { raw: raw.length, normalized: beforeDedupe, after_dedupe: events.length, kid_events: kept.length, dropped_not_for_kids: notKids, dropped, places: places.length, programs: programs.length, needs_review: kept.filter((e) => e.needs_review).length },
    sources: status, place_sources: placeStatus, program_sources: programStatus, class_sources: classStatus,
    vocab: { age_bands: VOCAB.age_bands, interests: VOCAB.interests, categories: VOCAB.categories, explore: VOCAB.explore }
  };
  writeFileSync(`${outDir}/events.json`, JSON.stringify(kept, null, 1));
  writeFileSync(`${outDir}/programs.json`, JSON.stringify(programs, null, 1));
  writeFileSync(`${outDir}/places.json`, JSON.stringify(places, null, 1));
  writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta, null, 1));
  writeFileSync(`${outDir}/review.json`, JSON.stringify(kept.filter((e) => e.needs_review).map((e) => ({ id: e.id, title: e.title, source: e.source.name, url: e.url, confidence: e.confidence, ages: [e.age_min, e.age_max], tag_source: e.tag_source })), null, 1));
  // Admin dashboard: the configured sources (enabled or not) and the run log, kept across runs in the cache.
  writeFileSync(`${outDir}/sources.json`, JSON.stringify(Object.fromEntries(['events', 'places', 'programs', 'classes'].map((k) => [k, (sources[k] || []).map(({ id, name, category, type, enabled, trust, status: st, homepage, notes }) => ({ id, name, category: category || null, type, enabled, trust, status: st, homepage: homepage || null, notes: notes || null }))])), null, 1));
  const history = recordRun(`${cacheDir}/runs${off ? '.demo' : ''}.json`, runSummary({ meta, curated, startedAt, finishedAt: new Date() }));
  writeFileSync(`${outDir}/runs.json`, JSON.stringify(history));
  writeFileSync(`${outDir}/curated.json`, JSON.stringify(curated, null, 1));
  writeFileSync(`${outDir}/classes.json`, JSON.stringify(classes));
  log(`published ${kept.length} events, ${programs.length} programs, ${places.length} places -> ${outDir}`);
  return { events: kept, places, programs, meta };
}
