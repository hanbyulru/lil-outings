import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterEvents, filterPlaces, whenRange, resolveLoc } from '../web/query.js';

const geo = JSON.parse(readFileSync('config/geo.json', 'utf8'));
const ctx = { today: '2026-11-16', geo }; // a Monday
const e = (o) => ({ title: 'x', date: '2026-11-16', start_min: 600, age_min: 0, age_max: 12, interests: [], categories: [], setting: 'indoor', cost_type: 'free', registration: 'drop_in', lat: 45.53, lon: -122.62, neighborhood: 'Hollywood', area: 'NE', ...o });

test('when ranges: today, weekend (from a Monday, from Saturday, from Sunday), week', () => {
  assert.deepEqual(whenRange('today', '2026-11-16'), ['2026-11-16', '2026-11-16']);
  assert.deepEqual(whenRange('weekend', '2026-11-16'), ['2026-11-21', '2026-11-22']);
  assert.deepEqual(whenRange('weekend', '2026-11-21'), ['2026-11-21', '2026-11-22']);
  assert.deepEqual(whenRange('weekend', '2026-11-22'), ['2026-11-22', '2026-11-22']);
  assert.deepEqual(whenRange('week', '2026-11-16'), ['2026-11-16', '2026-11-22']);
});

test('age overlap, interest, category, cost filters', () => {
  const list = [e({ title: 'baby', age_min: 0, age_max: 1 }), e({ title: 'dino', age_min: 3, age_max: 8, interests: ['dinosaurs'] }), e({ title: 'walk', setting: 'outdoor', categories: ['outdoors'], cost_type: 'paid', cost_amount: 5 })];
  const titles = (o) => filterEvents(list, o, ctx).map((x) => x.title).sort();
  assert.deepEqual(titles({ age: [3, 5] }), ['dino', 'walk']);
  assert.deepEqual(titles({ interest: 'dinosaurs' }), ['dino']);
  assert.deepEqual(titles({ category: 'outdoors' }), ['walk']);
  assert.deepEqual(titles({ free: true }), ['baby', 'dino']);
});

test('area / neighborhood / zip location filters', () => {
  const list = [e({ title: 'ne', area: 'NE' }), e({ title: 'sw', area: 'SW', neighborhood: 'Tigard', lat: 45.43, lon: -122.77 })];
  const t = (loc, extra = {}) => filterEvents(list, { loc, ...extra }, ctx).map((x) => x.title);
  assert.deepEqual(t({ area: 'NE' }), ['ne']);
  assert.deepEqual(t({ neighborhood: 'Tigard' }), ['sw']);
  assert.deepEqual(t({ zip: '97212' }, { radius: 5 }), ['ne']); // Tigard is ~10 mi from 97212
  assert.equal(t({ zip: '97212' }, { radius: 30 }).length, 2);
  assert.equal(resolveLoc({ zip: '00000' }, geo).unknown, true);
});

test('sorting: soonest, closest, cheapest', () => {
  const list = [e({ title: 'late', start_min: 900, lat: 45.53, lon: -122.62 }), e({ title: 'early', start_min: 540, lat: 45.40, lon: -122.70, cost_type: 'paid', cost_amount: 8 })];
  const names = (sort) => filterEvents(list, { sort, loc: { zip: '97212' }, radius: 30 }, ctx).map((x) => x.title);
  assert.deepEqual(names('soonest'), ['early', 'late']);
  assert.deepEqual(names('closest'), ['late', 'early']);
  assert.deepEqual(names('cheapest'), ['late', 'early']);
});

test('places filter respects outdoors and free', () => {
  const places = [{ name: 'Park', setting: 'outdoor', cost: 'free', age_min: 1, age_max: 10, interests: ['nature'], lat: 45.5, lon: -122.6, area: 'NE' }, { name: 'Museum', setting: 'indoor', cost: 'paid', age_min: 2, age_max: 12, interests: ['science'], lat: 45.5, lon: -122.6, area: 'SE' }];
  assert.deepEqual(filterPlaces(places, { category: 'outdoors' }, ctx).map((p) => p.name), ['Park']);
  assert.deepEqual(filterPlaces(places, { free: true }, ctx).map((p) => p.name), ['Park']);
  assert.deepEqual(filterPlaces(places, { interest: 'science' }, ctx).map((p) => p.name), ['Museum']);
});

import { filterPrograms } from '../web/query.js';
test('programs filter by age overlap and area', () => {
  const progs = [{ name: 'A', age_min: 0, age_max: 5, areas: ['SE'] }, { name: 'B', age_min: 6, age_max: 12, areas: ['SW'] }];
  assert.deepEqual(filterPrograms(progs, { age: [6, 8] }, ctx).map((p) => p.name), ['B']);
  assert.deepEqual(filterPrograms(progs, { loc: { area: 'SE' } }, ctx).map((p) => p.name), ['A']);
});
