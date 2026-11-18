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
  const list = [e({ title: 'baby', age_min: 0, age_max: 1 }), e({ title: 'dino', age_min: 3, age_max: 8, interests: ['science'] }), e({ title: 'walk', setting: 'outdoor', categories: ['outdoors'], cost_type: 'paid', cost_amount: 5 })];
  const titles = (o) => filterEvents(list, o, ctx).map((x) => x.title).sort();
  assert.deepEqual(titles({ age: [3, 5] }), ['dino', 'walk']);
  assert.deepEqual(titles({ interest: 'science' }), ['dino']);
  assert.deepEqual(titles({ category: 'outdoors' }), ['walk']);
  assert.deepEqual(titles({ free: true }), ['baby', 'dino']);
});

test('region / district / place / zip location filters', () => {
  // Hollywood (Inner NE) and Tigard; neither carries a district, so it is worked out from coordinates.
  const list = [e({ title: 'ne', lat: 45.537, lon: -122.621 }), e({ title: 'sw', neighborhood: 'Tigard', lat: 45.43, lon: -122.77 }), e({ title: 'far', lat: 45.30, lon: -122.97 })];
  const t = (loc, extra = {}) => filterEvents(list, { loc, ...extra }, ctx).map((x) => x.title);
  assert.deepEqual(t({ region: 'north-east' }), ['ne']);
  assert.deepEqual(t({ region: 'westside' }), ['sw']);
  assert.deepEqual(t({ region: 'south-metro' }), ['sw'], 'Tigard is in two regions');
  assert.deepEqual(t({ district: 'tigard' }), ['sw']);
  assert.deepEqual(t({ place: 'Tigard' }), ['sw']);
  assert.deepEqual(t({ place: 'Bull Mountain' }), [], '2.6 mi away is not "in" Bull Mountain');
  assert.deepEqual(t(null).length, 3, 'anywhere includes places outside every district (Newberg)');
  assert.deepEqual(t({ zip: '97212' }, { radius: 5 }), ['ne']); // Tigard is ~10 mi from 97212
  assert.equal(t({ zip: '97212' }, { radius: 20 }).length, 2); // Tigard yes, Newberg (~25 mi) no
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
  const progs = [{ name: 'A', age_min: 0, age_max: 5, regions: ['se-clackamas'] }, { name: 'B', age_min: 6, age_max: 12, regions: ['westside'] }];
  assert.deepEqual(filterPrograms(progs, { age: [6, 8] }, ctx).map((p) => p.name), ['B']);
  assert.deepEqual(filterPrograms(progs, { loc: { region: 'se-clackamas' } }, ctx).map((p) => p.name), ['A']);
  assert.deepEqual(filterPrograms(progs, { loc: { district: 'tigard' } }, ctx).map((p) => p.name), ['B']);
});

test('tomorrow is the next day only', () => {
  assert.deepEqual(whenRange('tomorrow', '2026-11-16'), ['2026-11-17', '2026-11-17']);
  assert.deepEqual(whenRange('tomorrow', '2026-12-31'), ['2027-01-01', '2027-01-01']);
});

test("today hides events that are already over; other days and all-day events stay", () => {
  const list = [
    e({ title: 'done', start_min: 600, end_min: 660 }),            // 10:00-11:00, over at 13:00
    e({ title: 'noend', start_min: 690 }),                         // 11:30, assumed 1h, over at 13:00
    e({ title: 'running', start_min: 720, end_min: 840 }),         // 12:00-14:00, still on
    e({ title: 'later', start_min: 960 }),
    e({ title: 'allday', start_min: null }),
    e({ title: 'tomorrow', date: '2026-11-17', start_min: 600, end_min: 660 })
  ];
  const at1pm = { ...ctx, nowMin: 780 };
  assert.deepEqual(filterEvents(list, { when: 'today' }, at1pm).map((x) => x.title).sort(), ['allday', 'later', 'running']);
  assert.deepEqual(filterEvents(list, { when: 'week' }, at1pm).map((x) => x.title).sort(), ['allday', 'later', 'running', 'tomorrow']);
  assert.equal(filterEvents(list, { when: 'today' }, ctx).length, 5); // no clock given: nothing hidden
});

test('headline age groups: babies, toddlers, preschoolers, school-age kids; untagged listings always show', () => {
  const list = [e({ title: 'babies', age_min: 0, age_max: 1 }), e({ title: 'toddlers', age_min: 1, age_max: 3 }), e({ title: 'family', age_min: 0, age_max: 12 }),
    e({ title: 'school', age_min: 6, age_max: 10 }), e({ title: 'untagged', age_min: null, age_max: null })];
  const t = (age) => filterEvents(list, { age }, ctx).map((x) => x.title).sort();
  assert.deepEqual(t([0, 0.99]), ['babies', 'family', 'untagged']);
  assert.deepEqual(t([1, 2.99]), ['babies', 'family', 'toddlers', 'untagged']);
  assert.deepEqual(t([3, 4.99]), ['family', 'toddlers', 'untagged']);
  assert.deepEqual(t([5, 12]), ['family', 'school', 'untagged']);
});
