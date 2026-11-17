import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addPlaceImages, commonsFileFromTag, creditFrom, WIKIMEDIA_UA } from '../src/images.js';
import { parseOverpass } from '../src/adapters/osm_places.js';

test('commonsFileFromTag accepts only Wikimedia Commons files', () => {
  assert.equal(commonsFileFromTag('File:Oregon_Zoo entrance.jpg'), 'Oregon Zoo entrance.jpg');
  assert.equal(commonsFileFromTag('https://commons.wikimedia.org/wiki/File:Powell_Butte.jpg'), 'Powell Butte.jpg');
  assert.equal(commonsFileFromTag('https://upload.wikimedia.org/wikipedia/commons/7/7b/Powell_Butte.jpg'), 'Powell Butte.jpg');
  assert.equal(commonsFileFromTag('https://example.com/our-playground.jpg'), null); // a business photo: not used
  assert.equal(commonsFileFromTag('Category:Parks in Portland'), null);
});

test('creditFrom strips HTML from the Commons artist field', () => {
  assert.equal(creditFrom({ Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">Jane &amp; Co</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } }), 'Photo: Jane & Co, CC BY-SA 4.0');
});

test('OSM photo tags are carried through', () => {
  const [p] = parseOverpass({ elements: [{ type: 'node', id: 1, lat: 45.5, lon: -122.6, tags: { name: 'X Park', leisure: 'playground', wikidata: 'Q1', wikimedia_commons: 'Category:X', image: 'https://example.com/a.jpg' } }] }, { id: 'osm' });
  assert.equal(p.wikidata, 'Q1');
  assert.equal(p.commons, null); // a category, not a file
  assert.equal(p.image, 'https://example.com/a.jpg'); // dropped later by addPlaceImages
});

test('addPlaceImages resolves hand-picked files and Wikidata P18, with credits', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, ua: opts.headers['user-agent'] });
    let body;
    if (url.includes('wikidata.org')) body = { entities: { Q7: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Mount Tabor pavilion.jpg' } } }] } }, Q8: { claims: {} } } };
    else body = { query: { normalized: [{ from: 'File:Powell_Butte.jpg', to: 'File:Powell Butte.jpg' }], pages: {
      1: { title: 'File:Powell Butte.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/t/pb.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Powell_Butte.jpg', extmetadata: { Artist: { value: 'Ennetws' }, LicenseShortName: { value: 'Public domain' } } }] },
      2: { title: 'File:Mount Tabor pavilion.jpg', imageinfo: [{ mime: 'image/jpeg', thumburl: 'https://upload.wikimedia.org/t/mt.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Mount_Tabor_pavilion.jpg', extmetadata: { Artist: { value: 'Finetooth' }, LicenseShortName: { value: 'CC BY-SA 3.0' } } }] } } } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const places = [
    { id: 'a', commons: 'Powell_Butte.jpg' },
    { id: 'b', wikidata: 'Q7' },
    { id: 'c', wikidata: 'Q8' },
    { id: 'e', wikidata: 'Q7', kind: 'playground' },
    { id: 'd', image: 'https://example.com/business.jpg' }
  ];
  await addPlaceImages(places, { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'img-')), minGapMs: 0 });
  assert.equal(places[0].image, 'https://upload.wikimedia.org/t/pb.jpg');
  assert.equal(places[0].image_credit, 'Photo: Ennetws, Public domain');
  assert.equal(places[1].image, 'https://upload.wikimedia.org/t/mt.jpg');
  assert.equal(places[1].image_page, 'https://commons.wikimedia.org/wiki/File:Mount_Tabor_pavilion.jpg');
  assert.equal(places[2].image, undefined);
  assert.equal(places[3].image, undefined); // a playground's neighborhood photo isn't used
  assert.equal(places[4].image, undefined); // never a business website photo
  assert.ok(places.every((p) => !('commons' in p)));
  assert.ok(seen.every((s) => s.ua === WIKIMEDIA_UA));
});

test('addPlaceImages fails soft', async () => {
  const places = [{ id: 'a', wikidata: 'Q7', image: 'https://example.com/x.jpg' }];
  const logs = [];
  await addPlaceImages(places, { fetchImpl: async () => { throw new Error('offline'); }, cacheDir: mkdtempSync(join(tmpdir(), 'img-')), minGapMs: 0, retries: 0 }, (m) => logs.push(m));
  assert.equal(places[0].image, undefined);
  assert.match(logs[0], /FAILED/);
});
