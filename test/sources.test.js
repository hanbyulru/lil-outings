import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDrupalCalendarMonth } from '../src/adapters/drupal_calendar.js';
import { parseClackamasEvents } from '../src/adapters/clackamas_events.js';
import { parseBiblioCommons, fetchBiblioCommons } from '../src/adapters/bibliocommons.js';
import { fetchIcal } from '../src/adapters/ical.js';
import { refresh } from '../src/pipeline.js';

const quiet = () => {};

// Real markup, Lake Oswego (Nov 2026): title nested in views-field, time before link.
const LO = `<div class="calendar-39838-field_date-0.0 contents">
  <div class="views-field views-field-field-date">        <div class="field-content"><span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-11-01T14:00:00-08:00">02:00pm</span></div>  </div>
  <div class="views-field views-field-title">        <span class="field-content"><a href="/library/rover-library-bookmobile/rover-great-pumpkin-toss-open-public?date=0">Rover at the Great Pumpkin Toss (Open to the public)</a></span>  </div>          </div>
<div class="calendar-37940-field_date-0.0 contents">
  <span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-11-01T13:00:00-08:00">01:00pm</span>                      <a href="/library/tiny-art-show?date=0">Tiny Art Show</a>          </div>`;
// Real markup, West Linn (Nov 2026): link before time; an all-day entry.
const WL = `<div class="calendar.54804.field_calendar_date.586.0 contents">
  <div class="views-field views-field-title aha_ada_fixes_span">        <div class="field-content aha_ada_fixes_span"><a href="/library/storywalk%C2%AE-fields-bridge-park">StoryWalk® at Fields Bridge Park! </a></div>  </div>
  <div class="views-field views-field-field-calendar-date">        <div class="field-content"><span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-11-08T00:00:00-08:00">(All day)</span></div>  </div>
  <div class="views-field views-field-field-calendar-date-1">        <div class="field-content"><span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-11-08T00:00:00-08:00">11/08/2026 (All day)</span></div>  </div>          </div>
<div class="calendar.55172.field_calendar_date.42.0 contents">
  <div class="views-field views-field-title aha_ada_fixes_span">        <div class="field-content aha_ada_fixes_span"><a href="/library/family-storytime-10">Family Storytime</a></div>  </div>
  <div class="views-field views-field-field-calendar-date">        <div class="field-content"><span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-11-08T10:45:00-08:00">10:45am</span></div>  </div>
  <div class="views-field views-field-field-calendar-date-1">        <div class="field-content"><span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-11-08T10:45:00-08:00">11/08/2026 - 10:45am</span></div>  </div>          </div>`;

test('Drupal calendar month view: Lake Oswego and West Linn markup', () => {
  const venue = { name: 'Lake Oswego Public Library', lat: 45.4198, lon: -122.6683 };
  const lo = parseDrupalCalendarMonth(LO, { id: 'lo', config: { site: 'https://www.ci.oswego.or.us', venue } });
  assert.equal(lo.length, 2);
  assert.equal(lo[0].title, 'Rover at the Great Pumpkin Toss (Open to the public)');
  assert.equal(lo[0].start, '2026-11-01T14:00:00-08:00');
  assert.equal(lo[0].url, 'https://www.ci.oswego.or.us/library/rover-library-bookmobile/rover-great-pumpkin-toss-open-public');
  assert.equal(lo[1].lat, 45.4198);
  const wl = parseDrupalCalendarMonth(WL, { id: 'wl', config: { site: 'https://westlinnoregon.gov', venue: {} } });
  assert.deepEqual(wl.map((e) => [e.title, e.start, e.all_day]), [
    ['StoryWalk® at Fields Bridge Park!', '2026-11-08T00:00:00-08:00', true],
    ['Family Storytime', '2026-11-08T10:45:00-08:00', false]
  ]);
});

// Real row, Clackamas County events (Nov 2026), trimmed; the page repeats rows in other widgets.
const CC_ROW = `<div class="views-row"><div class="views-field views-field-title"><span class="field-content"><a href="/event/2026-08-21/teen-craft-drop-in-gladstone-library" hreflang="en">Teen Craft Drop-in – Gladstone Library</a></span></div><div class="views-field views-field-field-ccts-start-date"><div class="field-content"><time datetime="2026-08-21T23:00:00Z">08/21/2026 - 16:00</time>
</div></div><div class="views-field views-field-field-ccts-end-date"><div class="field-content"><time datetime="2026-08-22T00:30:00Z">08/21/2026 - 17:30</time>
</div></div><div class="views-field views-field-field-ccts-department"><div class="field-content">Library</div></div><div class="views-field views-field-field-ccts-start-date-1"><div class="field-content"><time datetime="2026-08-21T16:00:00Z">4:00 pm</time>
</div></div><div class="views-field views-field-field-ccts-map-link"><div class="field-content"><a href="https://maps.app.goo.gl/eei8phnqX65Bh9qC6">Gladstone Library, 525 Portland Avenue Gladstone, OR 97027</a></div></div></div>`;

test('Clackamas County events: UTC times to Portland, branch venue, deduped rows', () => {
  const src = { id: 'cc', config: { site: 'https://www.clackamas.us', venues: [{ match: 'Gladstone', name: 'Gladstone Library', lat: 45.3809, lon: -122.5936 }] } };
  const ev = parseClackamasEvents(CC_ROW + CC_ROW, src);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].title, 'Teen Craft Drop-in');
  assert.equal(ev[0].start, '2026-08-21T16:00:00-07:00');
  assert.equal(ev[0].end, '2026-08-21T17:30:00-07:00');
  assert.equal(ev[0].venue_name, 'Gladstone Library');
  assert.equal(ev[0].lat, 45.3809);
  const adult = parseClackamasEvents(CC_ROW.replace(/Teen Craft Drop-in/g, 'Bricks for Better Brains (18+)'), src);
  assert.deepEqual(adult[0].raw_audience, ['Adults']);
});

test('Clackamas County events: wall time written with a Z (Nov 2026) is not shifted', () => {
  const src = { id: 'cc', config: { site: 'https://www.clackamas.us', venues: [{ match: 'Oak Lodge', name: 'Oak Lodge Library' }] } };
  const row = `<div class="views-row"><a href="/event/2026-11-23/drop-in-playgroup-oak-lodge-library" hreflang="en">Drop-In Playgroup – Oak Lodge Library</a>
    <time datetime="2026-11-23T10:30:00Z">11/23/2026 - 10:30</time><time datetime="2026-11-23T12:00:00Z">11/23/2026 - 12:00</time>
    <div class="views-field views-field-field-ccts-map-link"><a href="#">Oak Lodge Library, 3783 SE Concord Rd., Oak Lodge OR 97267</a></div></div>`;
  const [e] = parseClackamasEvents(row, src);
  assert.equal(e.start, '2026-11-23T10:30:00-08:00');
  assert.equal(e.end, '2026-11-23T12:00:00-08:00');
});

test('BiblioCommons: audience/type ids become names; pages are walked; far branches skipped', async () => {
  const page = (n, pages, ids) => JSON.stringify({ events: { pagination: { page: n, pages } }, entities: {
    events: Object.fromEntries(ids.map((id) => [id, { id, definition: { id, title: `Storytime ${id}`, start: '2026-11-18T10:30', branchLocationId: id === 'c' ? 'FAR' : 'V', audienceIds: ['a1'], typeIds: ['t1'] } }])),
    locations: { V: { name: 'Vancouver Community Library', mapLocation: { centrePoint: { lat: 45.6285, lng: -122.6688 } } }, FAR: { name: 'Stevenson Community Library' } },
    eventAudiences: { a1: { name: 'Toddlers' } }, eventTypes: { t1: { name: 'Storytime & Early Literacy ' } }
  } });
  const asked = [];
  const fetchImpl = async (url) => { asked.push(new URL(url).searchParams.get('page')); const p = +new URL(url).searchParams.get('page'); return { ok: true, status: 200, text: async () => (p === 1 ? page(1, 2, ['a', 'b']) : page(2, 2, ['c'])) }; };
  const src = { id: 'fvrl', config: { site: 'https://x', api: 'https://gateway.example/events/search', queries: [{ audiences: 'a1' }], exclude_locations: ['Stevenson Community Library'] } };
  const ev = await fetchBiblioCommons(src, { today: '2026-11-17', horizonDays: 60, http: { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'bc-')), minGapMs: 0, ttlMs: 0 } });
  assert.deepEqual(asked, ['1', '2']);
  assert.deepEqual(ev.map((e) => e.title), ['Storytime a', 'Storytime b']);
  assert.deepEqual(ev[0].raw_audience, ['Toddlers']);
  assert.deepEqual(ev[0].raw_categories, ['Storytime & Early Literacy']);
  assert.equal(parseBiblioCommons(JSON.parse(page(1, 1, ['a'])), src)[0].lat, 45.6285);
});

test('iCal: default venue for room-only feeds, excluded categories/locations, one copy per event across feeds', async () => {
  const ics = (rows) => ['BEGIN:VCALENDAR', ...rows.flatMap(([uid, start, title, loc, cat]) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;TZID=America/Los_Angeles:${start}`, `SUMMARY:${title}`, `LOCATION:${loc}`, ...(cat ? [`CATEGORIES:${cat}`] : []), 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const a = ics([['1', '20261118T103000', 'Preschool Storytime', 'Community Room', 'Storytime'], ['2', '20261119T000000', 'Creative Kit', 'At Home', 'Disability Community, Activity Kits'], ['3', '20261125T103000', 'Weekly Storytime', 'Community Room', null]]);
  const b = ics([['1', '20261118T103000', 'Preschool Storytime', 'Community Room', 'Storytime'], ['3', '20261202T103000', 'Weekly Storytime', 'Community Room', null]]);
  const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => (url.endsWith('a') ? a : b) });
  const src = { id: 'oc', config: { urls: ['https://feed/a', 'https://feed/b'], exclude_categories: ['Activity Kits'], default_venue: { name: 'Oregon City Public Library', lat: 45.3566, lon: -122.603 } } };
  const ev = await fetchIcal(src, { http: { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'ic-')), minGapMs: 0, ttlMs: 0 } });
  assert.deepEqual(ev.map((e) => e.title).sort(), ['Preschool Storytime', 'Weekly Storytime', 'Weekly Storytime'], 'kit dropped, duplicate merged, recurring dates kept');
  assert.equal(ev[0].venue_name, 'Oregon City Public Library');
  assert.equal(ev[0].lat, 45.3566);
});

test('offline refresh: Vancouver and South Metro sources land in their regions; Gorge branch and kits dropped', async () => {
  const out = mkdtempSync(join(tmpdir(), 'lo-out-'));
  const { events, meta } = await refresh({ offline: true, now: new Date('2026-11-16T12:00:00-08:00'), useLLM: false, outDir: out, log: quiet, cacheDir: mkdtempSync(join(tmpdir(), 'lo-cache-')) });
  for (const id of ['fvrl', 'oregon_city_library', 'wilsonville_library', 'lake_oswego_library', 'west_linn_library', 'clackamas_libraries', 'happy_valley_library', 'ledding_library', 'lake_oswego_parks', 'west_linn_parks', 'milwaukie_community', 'wilsonville_parks', 'sherwood_city', 'happy_valley_city']) {
    assert.ok(meta.sources.find((s) => s.id === id)?.ok, `${id} ran`);
    assert.ok(events.some((e) => e.source.id === id || (e.also_listed_on || []).some((x) => x.id === id)), `${id} has events`);
  }
  const by = (t) => events.find((e) => e.title === t);
  assert.equal(by('Family Lego Build')?.district, 'east-vancouver-camas');
  const from = (id) => events.filter((e) => e.source.id === id);
  assert.ok(from('lake_oswego_library').every((e) => e.district === 'lake-oswego'));
  assert.ok(from('west_linn_library').every((e) => e.district === 'west-linn'));
  assert.ok(from('wilsonville_library').every((e) => e.district === 'wilsonville'));
  assert.ok(from('oregon_city_library').every((e) => e.district === 'oregon-city-gladstone'));
  assert.ok(!events.some((e) => e.title === 'Gorge Storytime'), 'Stevenson branch excluded');
  assert.ok(!events.some((e) => /Creative Kit/.test(e.title)), 'take-home kits excluded');
});

import { dedupe } from '../src/dedupe.js';
test('dedupe: one series page with many dates keeps every date; same event from two sources still merges', () => {
  const ev = (o) => ({ title: 'Family Storytime', date: '2026-11-18', start_min: 645, venue_name: 'West Linn Public Library', source: { id: 'wl', name: 'WL', trust: 8 }, url: 'https://westlinnoregon.gov/library/family-storytime-10', ...o });
  const out = dedupe([ev({}), ev({ date: '2026-11-25' }), ev({ date: '2026-12-02' })]);
  assert.equal(out.length, 3);
  const civic = dedupe([ev({ title: 'A', url: 'https://w.org/calendar.aspx?EID=1' }), ev({ title: 'B', url: 'https://w.org/calendar.aspx?EID=2' })]);
  assert.equal(civic.length, 2, 'query string tells events apart');
  const merged = dedupe([ev({}), ev({ source: { id: 'x', name: 'Other', trust: 5 }, url: 'https://other.example/e/1' })]);
  assert.equal(merged.length, 1);
});

import { expandRRule, parseRevizeEvents } from '../src/adapters/revize_calendar.js';
test('Revize RRULE expansion: weekly, every other week, nth weekday of month, UNTIL/COUNT/EXDATE', () => {
  const from = '2026-11-17', to = '2027-01-16';
  // Real Ledding rule: weekly Tuesdays until Dec 30 2026, one week skipped.
  assert.deepEqual(expandRRule('DTSTART:20250805T100000\nRDATE:20250805T100000\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;UNTIL=20261230T000000\nEXDATE:20261124T100000', '2025-08-05', from, to),
    ['2026-11-17', '2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']); // Nov 24 skipped
  // Third Tuesday monthly (Ledding Book Club), until Dec 16.
  assert.deepEqual(expandRRule('RRULE:FREQ=MONTHLY;INTERVAL=1;BYSETPOS=3;BYDAY=TU;UNTIL=20261216T000000', '2026-03-17', from, to), ['2026-11-17', '2026-12-15']);
  // Every other Thursday, COUNT=2, starting in range.
  assert.deepEqual(expandRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;COUNT=2', '2026-11-19', from, to), ['2026-11-19', '2026-12-03']);
  // COUNT counts from DTSTART, even before the window.
  assert.deepEqual(expandRRule('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=2', '2026-11-09', from, to), [], 'both dates (Nov 9, 16) are before the window');
  assert.deepEqual(expandRRule('', '2026-11-20', from, to), ['2026-11-20']);
});

test('Revize events: only the Library calendar, one listing per date, library venue unless elsewhere', () => {
  const json = [
    { title: 'Sing &amp; Sign', primary_calendar_name: 'Library', start: '2026-11-17T10:30:00', end: '2026-11-17T11:15:00', location: 'Ledding Library, 10660 SE 21st Ave, Milw', rid: '7', desc: encodeURIComponent('<p>Songs and signs for babies.</p>'), rrule: 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=2' },
    { title: 'Storytime in the Park', primary_calendar_name: 'Library', start: '2026-11-20T10:00:00', location: 'Scott Park, Milwaukie', rid: '8' },
    { title: 'Planning Commission', primary_calendar_name: 'City Meetings', start: '2026-11-18T18:00:00', rid: '9' }
  ];
  const src = { id: 'ledding', config: { calendar: 'Library', site: 'https://www.milwaukieoregon.gov', venue: { name: 'Ledding Library', match: 'Ledding', lat: 45.44615, lon: -122.64036 } } };
  const ev = parseRevizeEvents(json, src, { today: '2026-11-17', horizonDays: 60 });
  assert.deepEqual(ev.map((e) => [e.title, e.start.slice(0, 16)]), [['Sing & Sign', '2026-11-17T10:30'], ['Sing & Sign', '2026-11-24T10:30'], ['Storytime in the Park', '2026-11-20T10:00']]);
  assert.equal(ev[0].end, '2026-11-17T11:15:00-08:00');
  assert.equal(ev[0].description, 'Songs and signs for babies.');
  assert.equal(ev[0].lat, 45.44615);
  assert.equal(ev[2].venue_name, 'Scott Park');
  assert.equal(ev[2].lat, null);
});

import { parseTribeEvents } from '../src/adapters/tribe_events.js';
test('The Events Calendar API: category include/exclude, venue geo, fallback venue', () => {
  const json = { events: [
    { id: 1, title: 'Movies in the Park &#8211; Paddington', start_date: '2026-12-05 18:00:00', end_date: '2026-12-05 20:00:00', categories: [{ name: 'Movies in the Parks' }], venue: { venue: 'Stella Olsen Park', geo_lat: '45.3535', geo_lng: '-122.8366' }, cost: 'Free' },
    { id: 2, title: 'Baby Storytime', start_date: '2026-12-01 09:30:00', categories: [{ name: 'Library' }], venue: [] },
    { id: 3, title: 'Music on the Green', start_date: '2026-12-06 12:00:00', categories: [{ name: 'Music on the Green' }], venue: [] }
  ] };
  const src = { id: 's', config: { include_categories: ['Movies in the Parks', 'Music on the Green'], fallback_venue: { name: 'Sherwood', lat: 45.357, lon: -122.841 } } };
  const ev = parseTribeEvents(json, src);
  assert.deepEqual(ev.map((e) => e.title), ['Movies in the Park – Paddington', 'Music on the Green']);
  assert.equal(ev[0].start, '2026-12-05T18:00:00-08:00');
  assert.equal(ev[0].lat, 45.3535);
  assert.equal(ev[0].price_text, 'Free');
  assert.equal(ev[1].venue_name, 'Sherwood');
  assert.equal(ev[1].lat, 45.357);
  const json2 = { events: [{ id: 4, title: 'Christmas Sweater Family Social', start_date: '2026-12-05 14:00:00', categories: [], venue: [] }, { id: 5, title: 'Blues Night', start_date: '2026-12-05 21:00:00', categories: [{ name: 'Live Music' }], venue: [] }] };
  assert.deepEqual(parseTribeEvents(json2, { id: 's', config: { include_categories: ['Family & Kids'], include_uncategorized: true } }).map((e) => e.title), ['Christmas Sweater Family Social'], 'uncategorized passes with include_uncategorized');
  assert.equal(parseTribeEvents(json2, src).length, 0);
});

import { parseGreshamEvents, parseTimeRange } from '../src/adapters/gresham_events.js';
test('Gresham events service: times, cancellations, address for geocoding', () => {
  assert.deepEqual(parseTimeRange('6:00 pm - 8:00 pm'), { start: '18:00', end: '20:00' });
  assert.deepEqual(parseTimeRange('10 - 11:30 am'), { start: '10:00', end: '11:30' });
  assert.equal(parseTimeRange(''), null);
  const src = { id: 'g', config: { site: 'https://www.greshamoregon.gov', fallback_venue: { name: 'Gresham', lat: 45.4985, lon: -122.4302 } } };
  const ev = parseGreshamEvents({ events: [
    { start: '2026-12-11', end: '2026-12-11', canceled: false, title: 'Reindeer in Rockwood', url: '/events/2026/community-events/reindeer/', time: '4:00 pm - 7:00 pm', location: 'Rockwood Market Hall, 458 SE 185th Avenue' },
    { start: '2026-11-18', end: '2026-11-18', canceled: true, title: 'Youth and Family Movie Night', url: '/events/x/', time: '6:00 pm', location: 'The Underground PDX' }
  ] }, src, 'Community Events');
  assert.equal(ev[0].start, '2026-12-11T16:00:00-08:00');
  assert.equal(ev[0].end, '2026-12-11T19:00:00-08:00');
  assert.equal(ev[0].url, 'https://www.greshamoregon.gov/events/2026/community-events/reindeer/');
  assert.equal(ev[0].venue_name, 'Rockwood Market Hall');
  assert.equal(ev[0].address, 'Rockwood Market Hall, 458 SE 185th Avenue, Gresham');
  assert.deepEqual(ev[0].geo_fallback, { lat: 45.4985, lon: -122.4302 });
  assert.equal(ev[1].cancelled, true);
  assert.equal(ev[1].address, null); // no street address: town pin
});

import { parseJuiceboxEvent } from '../src/adapters/juicebox_events.js';
test('Juicebox (Tualatin) event detail', () => {
  const src = { id: 't', config: { town: 'Tualatin, OR', fallback_venue: { name: 'Tualatin Community Park', lat: 45.3866, lon: -122.7625 } } };
  const e = parseJuiceboxEvent({ id: 14400, title: 'Kids Night Out (Parents Night Off)', url: 'https://parks.tualatinoregon.gov/events/kno/', location: 'Van Raden Community Center', all_day: false,
    event_category: [{ name: 'Parks &amp; Recreation' }], event_audience: [{ name: 'Kids' }],
    start_date: { date: { mysql: '2026-12-11 17:30:00' } }, end_date: { date: { mysql: '2026-12-11 21:00:00' } } }, src);
  assert.equal(e.start, '2026-12-11T17:30:00-08:00');
  assert.equal(e.address, 'Van Raden Community Center, Tualatin, OR');
  assert.deepEqual(e.raw_categories, ['Parks & Recreation']);
  assert.deepEqual(e.raw_audience, ['Kids']);
  assert.equal(parseJuiceboxEvent({ id: 1, title: 'x' }, src), null);
});

import { parseNuxtStrapiEvents } from '../src/adapters/nuxt_strapi_events.js';
test('Nuxt/Strapi (NCPRD) events: series occurrences from the __NUXT_DATA__ payload', () => {
  // devalue: a flat array whose objects point at other indexes
  const data = [['ShallowReactive', 1], { events: 2 }, [3, 12], { __typename: 4, title: 5, slug: 6, fullSlug: 7, excerpt: 8, address: 9, startTime: 10, endTime: 11, occurrences: 13 },
    'Event', 'Indoor Playground', 'indoor-playground-thursdays', 'events/indoor-playground-thursdays', 'Playtime for young children and their caregivers.', '3811 S.E. Concord Rd. in Oak Grove', '2026-09-10T16:00:00.000Z', '2026-09-10T17:30:00.000Z',
    { __typename: 4, title: 18, slug: 19, fullSlug: 20, excerpt: 21, address: 21, startTime: 22, endTime: 21, occurrences: 23 },
    { data: 14 }, [15, 16], { attributes: 17 }, { attributes: 24 }, { startTime: 25, endTime: 26, status: 27 },
    'Planting Party', 'planting', 'events/planting', null, '2026-11-21T18:00:00.000Z', { data: 28 },
    { startTime: 29, endTime: 29, status: 30 }, '2026-11-19T17:00:00.000Z', '2026-11-19T18:30:00.000Z', 'scheduled', [], '2026-11-12T17:00:00.000Z', 'cancelled'];
  const html = `<html><script type="application/json" id="__NUXT_DATA__" data-ssr="true">${JSON.stringify(data)}</script></html>`;
  const ev = parseNuxtStrapiEvents(html, { id: 'n', config: { site: 'https://ncprd.org' } }, '2026-11-17');
  assert.deepEqual(ev.map((e) => [e.title, e.start]), [['Indoor Playground', '2026-11-19T17:00:00.000Z'], ['Planting Party', '2026-11-21T18:00:00.000Z']]); // past + cancelled occurrences skipped
  assert.equal(ev[0].url, 'https://ncprd.org/events/indoor-playground-thursdays');
  assert.equal(ev[0].address, '3811 S.E. Concord Rd., Oak Grove');
});

import { parseVancouverEvents, parseVanWhen } from '../src/adapters/vancouver_events.js';
test('Vancouver, WA calendar: events tab only, department, venue lines', () => {
  assert.deepEqual(parseVanWhen('Friday, December 11, 2026', '6:00 pm - 8:00 pm'), { start: '2026-12-11T18:00:00-08:00', end: '2026-12-11T20:00:00-08:00', all_day: false });
  const html = `<div id="tab1"><div id="section1" class="expanding-containerevt"><h3>City Council Meeting</h3><h5 class="m-0"> Monday, December 7, 2026 <br><span> 6:30 pm</span></h5></div></div>
  <div id="tab2"><ul><li><a href="#section1"><div class="event_det"> <div class="h6">Parks, Recreation and Cultural Services </div><h3>Pizza with Santa</h3></div></a></li></ul>
  <div id="section1" class="expanding-containerevt"><div class="exp_left"><h3>Pizza with Santa</h3><h5 class="m-0"> Friday, December 11, 2026 <br><span> 6:00 pm - 8:00 pm</span></h5>
  <div class="addeventatc"><span class="description">Pizza, crafts &amp; photos with Santa.</span></div></div><h4> Firstenburg Community Center </br> 700 NE 136th Ave </br> Vancouver , WA 98684 </h4>
  <a class="link" href="https://www.cityofvancouver.us/events/pizza-with-santa/">Learn More</a></div></div>`;
  const ev = parseVancouverEvents(html, { id: 'v', config: {} });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].title, 'Pizza with Santa');
  assert.equal(ev[0].start, '2026-12-11T18:00:00-08:00');
  assert.equal(ev[0].venue_name, 'Firstenburg Community Center');
  assert.equal(ev[0].address, 'Firstenburg Community Center, 700 NE 136th Ave, Vancouver, WA 98684');
  assert.deepEqual(ev[0].raw_categories, ['Parks, Recreation and Cultural Services']);
  assert.match(ev[0].description, /photos with Santa/);
});

import { splitCivicLocation } from '../src/adapters/ical.js';
test('CivicPlus LOCATION split into venue + street address (THPRD)', () => {
  const fb = { name: 'THPRD', lat: 45.48, lon: -122.8 };
  const f = (l) => { const r = splitCivicLocation({ venue_name: l }, fb); return [r.venue_name, r.address]; };
  assert.deepEqual(f('Conestoga Recreation &amp\; Aquatic Center - 9985 SW 125th Avenue  Beaverton OR 97008'), ['Conestoga Recreation & Aquatic Center', '9985 SW 125th Avenue, Beaverton, OR 97008']);
  assert.deepEqual(f('- Tualatin Hills Nature Center  15655 SW Millikan Way  Beaverton OR 97003'), ['Tualatin Hills Nature Center', '15655 SW Millikan Way, Beaverton, OR 97003']);
  assert.deepEqual(f('<p>Free Admission! 80+ vendors\\, music.</p> - 5550 SW Hall Blvd  Beaverton OR 97005'), ['THPRD', '5550 SW Hall Blvd, Beaverton, OR 97005']);
  assert.deepEqual(f(' -   Beaverton OR 97006'), ['THPRD', null]);
});

import { geocodeEvents, queriesFor } from '../src/geocode.js';
test('geocoder: tidy queries, opt-in per source, town fallback on a miss', async () => {
  assert.deepEqual(queriesFor('3811 S.E. Concord Rd. in Oak Grove'.replace(' in ', ', ')), ['3811 SE Concord Rd, Oak Grove']);
  assert.deepEqual(queriesFor('Rockwood Market Hall, 458 SE 185th Avenue, Gresham'), ['Rockwood Market Hall, 458 SE 185th Avenue, Gresham', '458 SE 185th Avenue, Gresham']);
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const calls = [];
  const fetchImpl = async (url) => { calls.push(decodeURIComponent(url)); return { ok: true, status: 200, text: async () => JSON.stringify(url.includes('458') ? [{ lat: '45.519761', lon: '-122.472011' }] : []) }; };
  const on = { config: { geocode: true } }, off = { config: {} };
  const raws = [
    { r: { address: 'Rockwood Market Hall, 458 SE 185th Avenue, Gresham', lat: null, geo_fallback: { lat: 1, lon: 2 } }, src: on },
    { r: { address: 'Nowhere Hall', lat: null, geo_fallback: { lat: 1, lon: 2 } }, src: on },
    { r: { address: '458 SE 185th Avenue', lat: null }, src: off }
  ];
  await geocodeEvents(raws, { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'geo-')), minGapMs: 0 });
  assert.deepEqual([raws[0].r.lat, raws[0].r.lon, raws[0].r.geo_source], [45.51976, -122.47201, 'geocoded']);
  assert.deepEqual([raws[1].r.lat, raws[1].r.geo_source], [1, 'town']);
  assert.equal(raws[2].r.lat, null); // source didn't opt in
  assert.ok(calls.every((u) => u.includes('nominatim.openstreetmap.org') && u.includes('bounded=1')));
});

test('every event source has a category (admin dashboard groups by it)', () => {
  const cfg = JSON.parse(readFileSync('config/sources.json', 'utf8'));
  const ok = ['library', 'parks', 'city', 'attraction', 'community', 'curated'];
  for (const s of cfg.events) assert.ok(ok.includes(s.category), `${s.id}: category ${s.category}`);
});
