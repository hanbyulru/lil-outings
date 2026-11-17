import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { EVENT_ADAPTERS, PLACE_ADAPTERS, PROGRAM_ADAPTERS } from './adapters/index.js';
import { normalizeEvent, withinHorizon, normalizeVenueKey, guessVenue } from './normalize.js';
import { dedupe } from './dedupe.js';
import { classifyAll } from './classify/index.js';
import { bandsFor, VOCAB } from './classify/validate.js';
import { locate, haversineMiles, GEO } from './lib/geo.js';
import { nearestPlace } from '../web/query.js';
import { portlandDate } from './lib/time.js';
import { buildOffline } from './offline.js';

const OUT_OF_AREA_MILES = 15; // events farther than this from every named place are out of the metro

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const PLACE_DEFAULTS = {
  playground: { age_min: 1, age_max: 10, interests: [], cost: 'free', setting: 'outdoor' },
  nature_reserve: { age_min: 2, age_max: 12, interests: ['nature'], cost: 'free', setting: 'outdoor' },
  water_park: { age_min: 1, age_max: 12, interests: [], cost: 'varies', setting: 'both' },
  museum: { age_min: 2, age_max: 12, interests: [], cost: 'paid', setting: 'indoor' },
  zoo: { age_min: 0, age_max: 12, interests: ['animals'], cost: 'paid', setting: 'outdoor' },
  aquarium: { age_min: 0, age_max: 12, interests: ['animals', 'science'], cost: 'paid', setting: 'indoor' },
  theme_park: { age_min: 2, age_max: 12, interests: [], cost: 'paid', setting: 'outdoor' }
};

export async function refresh({ offline = false, now = new Date(), useLLM = true, outDir = 'data/public', horizonDays = 60, log = console.log, llmOptions = {}, cacheDir = 'data/cache' } = {}) {
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
        const dup = places.find((p) => normalizeVenueKey(p.name) === normalizeVenueKey(f.name) || (haversineMiles(p, f) < 0.1 && normalizeVenueKey(p.name).split(' ')[0] === normalizeVenueKey(f.name).split(' ')[0]));
        if (dup) continue;
        const d = PLACE_DEFAULTS[f.kind] || { age_min: 0, age_max: 12, interests: [], cost: 'varies', setting: 'unknown' };
        places.push({ id: `osm-${f.source_place_id.replace('/', '-')}`, name: f.name, kind: f.kind, lat: f.lat, lon: f.lon, address: f.address, url: f.url, hours_text: f.hours_text, note: f.description || '', ...d, source: 'osm', verified: false });
      }
      placeStatus.push({ id: src.id, name: src.name, ok: true, fetched: found.length });
      log(`  ${src.name} places: ${found.length}`);
    } catch (err) {
      placeStatus.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err) });
      log(`  ${src.name} places: FAILED (${err.message})`);
    }
  }
  places = places.map((p) => { const l = locate(p.lat, p.lon); return { ...p, age_bands: bandsFor(p.age_min, p.age_max), neighborhood: l?.neighborhood || null, district: l?.district || null }; });

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

  // ---- events ----
  let raw = [];
  for (const src of sources.events.filter((s) => s.enabled)) {
    const t0 = Date.now();
    try {
      let items;
      if (src.type === 'manual' && off) items = off.manual.map((e) => ({ source_id: src.id, all_day: false, address: null, raw_categories: [], raw_audience: [], cancelled: false, ...e }));
      else items = await EVENT_ADAPTERS[src.type](src, ctx);
      items = items.map((e) => ({ ...e, source_id: src.id }));
      raw.push(...items.map((r) => ({ r, src })));
      status.push({ id: src.id, name: src.name, ok: true, fetched: items.length, ms: Date.now() - t0, status: src.status });
      log(`  ${src.name}: ${items.length} listings`);
    } catch (err) {
      status.push({ id: src.id, name: src.name, ok: false, error: String(err.message || err), status: src.status });
      log(`  ${src.name}: FAILED (${err.message})`);
    }
  }

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
    kept.push({
      ...e,
      age_min: t.age_min, age_max: t.age_max, age_bands: bandsFor(t.age_min, t.age_max),
      interests: t.interests, categories: t.categories, setting: t.setting, registration: t.registration,
      cost_type: t.cost_type, cost_amount: t.cost_amount,
      confidence: t.confidence, needs_review: t.needs_review, tag_source: t.tag_source
    });
  }
  kept.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)));

  mkdirSync(outDir, { recursive: true });
  const meta = {
    generated_at: now.toISOString(), today, mode: offline ? 'demo (sample feeds)' : 'live',
    counts: { raw: raw.length, normalized: beforeDedupe, after_dedupe: events.length, kid_events: kept.length, dropped_not_for_kids: notKids, dropped, places: places.length, programs: programs.length, needs_review: kept.filter((e) => e.needs_review).length },
    sources: status, place_sources: placeStatus, program_sources: programStatus,
    vocab: { age_bands: VOCAB.age_bands, interests: VOCAB.interests, categories: VOCAB.categories }
  };
  writeFileSync(`${outDir}/events.json`, JSON.stringify(kept, null, 1));
  writeFileSync(`${outDir}/programs.json`, JSON.stringify(programs, null, 1));
  writeFileSync(`${outDir}/places.json`, JSON.stringify(places, null, 1));
  writeFileSync(`${outDir}/meta.json`, JSON.stringify(meta, null, 1));
  writeFileSync(`${outDir}/review.json`, JSON.stringify(kept.filter((e) => e.needs_review).map((e) => ({ id: e.id, title: e.title, source: e.source.name, url: e.url, confidence: e.confidence, ages: [e.age_min, e.age_max], tag_source: e.tag_source })), null, 1));
  log(`published ${kept.length} events, ${programs.length} programs, ${places.length} places -> ${outDir}`);
  return { events: kept, places, programs, meta };
}
