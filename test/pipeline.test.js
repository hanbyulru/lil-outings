import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refresh } from '../src/pipeline.js';
import { dedupe } from '../src/dedupe.js';
import { locate, zipPoint } from '../src/lib/geo.js';

const NOW = new Date('2026-11-16T12:00:00-08:00');

test('offline refresh: runs every adapter, drops non-kid events, tags and locates the rest', async () => {
  const out = mkdtempSync(join(tmpdir(), 'lo-out-'));
  const cache = mkdtempSync(join(tmpdir(), 'lo-cache-'));
  const { events, places, meta } = await refresh({ offline: true, now: NOW, outDir: out, cacheDir: cache, log: () => {} });
  assert.ok(meta.sources.every((s) => s.ok), 'all demo sources succeed');
  assert.ok(events.length >= 40);
  const titles = new Set(events.map((e) => e.title));
  assert.ok(!titles.has('Microsoft Word with Goodwill Industries'), 'adult class dropped');
  assert.ok(!titles.has('Teen Anime Club'), 'teen-only dropped');
  assert.ok(![...titles].some((t) => /volunteer|stewardship|board meeting/i.test(t)), 'volunteer/meeting dropped');
  assert.ok(titles.has('Winter Lantern Walk at Mt. Tabor'), 'community event from parks feed kept');
  for (const e of events) {
    assert.ok(e.age_min != null && e.age_max != null, e.title);
    assert.ok(e.date >= '2026-11-16');
  }
  const inMetro = events.filter((e) => e.district);
  assert.ok(inMetro.length >= events.length - 2, 'nearly every demo event lands in a district');
  assert.ok(new Set(inMetro.map((e) => e.district)).size >= 8, 'events spread across many districts');
  assert.ok(places.some((p) => p.source === 'osm') && places.some((p) => p.source === 'curated'));
  const written = JSON.parse(readFileSync(join(out, 'events.json'), 'utf8'));
  assert.equal(written.length, events.length);
});

test('dedupe merges same event from two sources, keeping the higher-trust copy', () => {
  const mk = (src, trust, extra = {}) => ({ source: { id: src, name: src, trust }, also_listed_on: [], title: 'Dino Storytime', date: '2026-12-05', start_min: 630, venue_name: 'Hollywood Library', url: null, lat: null, lon: null, description: '', ...extra });
  const out = dedupe([mk('b', 5, { lat: 45.5, lon: -122.6 }), mk('a', 9)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source.id, 'a');
  assert.deepEqual(out[0].also_listed_on, ['b']);
  assert.equal(out[0].lat, 45.5);
});

test('dedupe keeps different venues/times apart', () => {
  const mk = (venue, min) => ({ source: { id: 'a', name: 'a', trust: 5 }, also_listed_on: [], title: 'Storytime', date: '2026-12-05', start_min: min, venue_name: venue, url: null, description: '' });
  assert.equal(dedupe([mk('Hollywood Library', 630), mk('Belmont Library', 630), mk('Hollywood Library', 780)]).length, 3);
});

test('geo: neighborhood + area from coordinates, ZIP lookup', () => {
  assert.equal(locate(45.5360, -122.6240).district, 'inner-ne'); // Hollywood
  assert.equal(locate(45.5880, -122.7540).district, 'north-portland'); // St. Johns
  assert.equal(locate(45.4207, -122.6706).neighborhood, 'Downtown Lake Oswego');
  assert.equal(locate(45.3843, -122.7585).district, 'tualatin-sherwood'); // Tualatin library
  assert.equal(locate(45.6290, -122.6730).district, 'vancouver-central');
  assert.equal(locate(45.30, -122.97), null, 'Newberg: outside every district');
  assert.equal(locate(40.7, -74.0), null, 'far away -> no district');
  assert.ok(zipPoint('97214'));
  assert.equal(zipPoint('00000'), null);
});

import { guessVenue } from '../src/normalize.js';
test('guessVenue infers location from a known place name in the title', () => {
  const places = [{ name: 'Mt. Tabor Park', lat: 45.5119, lon: -122.5937 }, { name: 'Park', lat: 0, lon: 0 }];
  const e = guessVenue({ title: 'Winter Lantern Walk at Mt. Tabor', description: '' }, places);
  assert.equal(e.venue_name, 'Mt. Tabor Park');
  assert.equal(e.district, 'inner-se');
  assert.equal(e.geo_source, 'place-name');
  assert.equal(guessVenue({ title: 'Something else', description: '' }, places).lat, undefined);
});

import { samePlace } from '../src/pipeline.js';
test('samePlace: a curated place and its OSM twin are one place', () => {
  const omsi = { name: 'OMSI (Oregon Museum of Science and Industry)', lat: 45.50835, lon: -122.66566, wikidata: 'Q174617' };
  assert.ok(samePlace(omsi, { name: 'Oregon Museum of Science and Industry', lat: 45.50835, lon: -122.66597, wikidata: 'Q174617' }));
  assert.ok(samePlace({ ...omsi, wikidata: undefined }, { name: 'Oregon Museum of Science and Industry', lat: 45.50835, lon: -122.66597 }), 'name inside name, same spot');
  assert.ok(!samePlace(omsi, { name: 'USS Blueback', lat: 45.5079, lon: -122.6670, wikidata: 'Q2468659' }), 'a neighbour is not a duplicate');
});
