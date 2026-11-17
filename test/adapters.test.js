import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortlandGovList } from '../src/adapters/portland_gov.js';
import { parseJsonLdEvents } from '../src/adapters/jsonld.js';
import { parseOverpass } from '../src/adapters/osm_places.js';
import { parseBiblioCommons } from '../src/adapters/bibliocommons.js';

const src = { id: 't', name: 'Test', config: { site: 'https://example.org' } };

test('portland.gov list: date comes from URL, time and label from following text', () => {
  const html = `<article><h3><a href="/parks/events/2026/12/5/oaks-bottom-planting">Oaks Bottom Planting Event</a></h3>
    <div>10:00 am to 1:00 pm</div><div>Label: Volunteer event</div></article>
    <article><a href="https://www.portland.gov/parks/nature/events/2026/12/9/marquam-trail-work">Marquam Trail Work</a> 9:00 am to 12:00 pm</article>`;
  const ev = parsePortlandGovList(html, src);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].start, '2026-12-05T10:00:00-08:00');
  assert.equal(ev[0].end, '2026-12-05T13:00:00-08:00');
  assert.deepEqual(ev[0].raw_categories, ['Volunteer event']);
  assert.equal(ev[1].url, 'https://www.portland.gov/parks/nature/events/2026/12/9/marquam-trail-work');
});

test('JSON-LD: finds Events inside @graph and ItemList, reads price and geo', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [
    { '@type': 'Event', name: 'Reptile Show', startDate: '2026-12-05T11:00:00', url: 'https://x.org/e/1', offers: { price: 0 }, location: { '@type': 'Place', name: 'Library', geo: { latitude: '45.5', longitude: '-122.7' } } },
    { '@type': 'WebSite', name: 'ignore me' }
  ] })}</script><script type="application/ld+json">{bad json</script>`;
  const ev = parseJsonLdEvents(html, src);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].price_text, 'Free');
  assert.equal(ev[0].lat, 45.5);
  assert.equal(ev[0].start, '2026-12-05T11:00:00-08:00');
});

test('Overpass: uses center for ways, skips unnamed', () => {
  const p = parseOverpass({ elements: [
    { type: 'way', id: 5, center: { lat: 45.5, lon: -122.6 }, tags: { name: 'Big Park', leisure: 'nature_reserve' } },
    { type: 'node', id: 6, lat: 45.4, lon: -122.6, tags: { leisure: 'playground' } }
  ] }, src);
  assert.equal(p.length, 1);
  assert.equal(p[0].source_place_id, 'way/5');
});

test('BiblioCommons parser is defensive about missing fields', () => {
  const ev = parseBiblioCommons({ entities: { events: { e1: { id: 'e1', definition: { title: 'Toddler Time', start: '2026-12-03T10:00:00', branchLocationId: 'b1' } } }, locations: { b1: { name: 'Tigard', latitude: 45.4, longitude: -122.7 } } } }, src);
  assert.equal(ev[0].venue_name, 'Tigard');
  assert.equal(ev[0].start, '2026-12-03T10:00:00-08:00');
  assert.deepEqual(parseBiblioCommons({}, src), []);
});

test('portland.gov list: each description stops at the next event (no bleed)', () => {
  const html = `<a href="/parks/events/2026/12/5/a-walk">A Walk</a> 10:00 am to 1:00 pm Label: Community event <p>Family fun in the park.</p>
    <a href="/parks/events/2026/12/6/b-meeting">B Meeting</a> 5:00 pm to 7:00 pm Label: Public meeting`;
  const [a, b] = parsePortlandGovList(html, src);
  assert.match(a.description, /Family fun/);
  assert.doesNotMatch(a.description, /Meeting/);
  assert.deepEqual(b.raw_categories, ['Public meeting']);
});

import { parsePortlandGovPrograms } from '../src/adapters/portland_gov_programs.js';
const progHtml = `<h2>North and Northeast Portland</h2><h3>Child with Adult</h3><table><tr><th>Class</th><th>Location</th><th>Register</th></tr><tr><td>Soccer</td><td>Peninsula Park Community Center</td><td><a href="https://anc.example/search?x=1&amp;y=2">Check availability</a></td></tr></table>
<h3>Adult</h3><table><tr><th>Class</th><th>Description</th><th>Location</th><th>Register</th></tr><tr><td>Pickleball</td><td>x</td><td>y</td><td><a href="/z">r</a></td></tr></table>
<h2>Southwest Portland</h2><h3>Youth</h3><table><tr><th>Class</th><th>Description</th><th>Location</th><th>Register</th></tr><tr><td>Tae Kwon Do</td><td>Martial arts</td><td>SW CC</td><td><a href="/reg">r</a></td></tr></table><h3>Intergenerational</h3><table><tr><th>Class</th></tr><tr><td>Walking</td></tr></table>`;
test('PP&R programs: region/age sections, adult + intergenerational skipped, tolerant of missing Description column', () => {
  const p = parsePortlandGovPrograms(progHtml, { id: 'x' });
  assert.deepEqual(p.map((x) => x.name), ['Soccer', 'Tae Kwon Do']);
  assert.deepEqual(p[0].areas, ['N', 'NE']);
  assert.deepEqual([p[0].age_min, p[0].age_max], [0, 5]);
  assert.equal(p[0].url, 'https://anc.example/search?x=1&y=2');
  assert.deepEqual(p[1].areas, ['SW']);
  assert.deepEqual([p[1].age_min, p[1].age_max], [6, 12]);
});

test('portland.gov events: exclude_labels drops volunteer/meeting rows at the source', async () => {
  const { fetchPortlandGov } = await import('../src/adapters/portland_gov.js');
  const html = `<a href="/parks/events/2026/12/5/a">Work Day</a> 9:00 am to 11:00 am Label: Volunteer event
    <a href="/parks/events/2026/12/6/b">Lantern Walk</a> 4:00 pm to 5:00 pm Label: Community event`;
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => html });
  const out = await fetchPortlandGov({ id: 't', config: { url: 'https://www.portland.gov/parks/events', max_pages: 1, exclude_labels: ['Volunteer event'] } }, { http: { fetchImpl, cacheDir: '/tmp/lo-x', minGapMs: 0, ttlMs: 0 } });
  assert.deepEqual(out.map((e) => e.title), ['Lantern Walk']);
});
