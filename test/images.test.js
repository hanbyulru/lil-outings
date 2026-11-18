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
    if (url.includes('wikidata.org')) body = { entities: { Q7: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Mount Tabor pavilion.jpg' } } }] } }, Q8: { claims: {} },
      Q9: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Mount Tabor pavilion.jpg' } } }], P31: [{ mainsnak: { datavalue: { value: { id: 'Q22698' } } } }] } } } };
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
    { id: 'f', wikidata: 'Q9', kind: 'playground' },
    { id: 'd', image: 'https://example.com/business.jpg' }
  ];
  await addPlaceImages(places, { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'img-')), minGapMs: 0 });
  assert.equal(places[0].image, 'https://upload.wikimedia.org/t/pb.jpg');
  assert.equal(places[0].image_credit, 'Photo: Ennetws, Public domain');
  assert.equal(places[1].image, 'https://upload.wikimedia.org/t/mt.jpg');
  assert.equal(places[1].image_page, 'https://commons.wikimedia.org/wiki/File:Mount_Tabor_pavilion.jpg');
  assert.equal(places[2].image, undefined);
  assert.equal(places[3].image, undefined); // a playground's neighborhood photo isn't used
  assert.equal(places[5].image, undefined); // never a business website photo
  assert.equal(places[4].image, 'https://upload.wikimedia.org/t/mt.jpg'); // the playground's item is a park: its photo fits
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

import { shareImage, addWebsiteImages } from '../src/images.js';
test('shareImage: photos first, logos as the fallback', () => {
  assert.deepEqual(shareImage('<meta property="og:site_name" content="DiG PDX"><meta content="/uploads/sandbox.jpg" property="og:image">', 'https://digpdx.com/'), { image: 'https://digpdx.com/uploads/sandbox.jpg', site: 'DiG PDX', logo: false });
  assert.equal(shareImage('<meta name="twitter:image" content="https://x.com/a.jpg?w=1&amp;h=2">', 'https://www.x.com/').image, 'https://x.com/a.jpg?w=1&h=2');
  assert.equal(shareImage('<meta name="twitter:image" content="https://x.com/a.jpg">', 'https://www.x.com/').site, 'x.com');
  assert.deepEqual(shareImage('<meta property="og:image" content="https://x.com/site-logo.png">', 'https://x.com/'), { image: 'https://x.com/site-logo.png', site: 'x.com', logo: true }, 'a logo share image is used, flagged as a logo');
  assert.equal(shareImage('<meta property="og:image" content="http://static1.squarespace.com/static/5f/t/barn.jpg?format=1500w">', 'https://leefarmsoregon.squarespace.com').image, 'https://static1.squarespace.com/static/5f/t/barn.jpg?format=1500w', 'http share images are upgraded to https');
  assert.equal(shareImage('<title>no share image</title>', 'https://x.com/'), null, 'nothing at all: mosaic');
  assert.equal(shareImage('<meta property="og:image" content="https://cdn.x.com/icons-site/hero-photo.jpg">', 'https://x.com/').image, 'https://cdn.x.com/icons-site/hero-photo.jpg', 'a folder named icons is fine');
  assert.equal(shareImage('<meta property="og:image" content="https://x.com/img/Little-Gym_logo.png">', 'https://x.com/').logo, true);
  assert.equal(shareImage('<meta property="og:image" content="https://x.com/hero.jpg">', 'https://x.com/').logo, false);
  // no share image: the site's logo
  assert.deepEqual(shareImage('<header><img class="site-logo" src="/img/farm.png" alt="Smith Berry Barn"></header><img src="/a.jpg">', 'https://farm.example/'), { image: 'https://farm.example/img/farm.png', site: 'farm.example', logo: true });
  assert.equal(shareImage('<script type="application/ld+json">{"@type":"Organization","logo":"https://gym.example/brand.png"}</script>', 'https://gym.example/').image, 'https://gym.example/brand.png');
  assert.equal(shareImage('<img src="/style/icon/read-more.png"><link rel="apple-touch-icon" href="/touch.png">', 'https://gym.example/').image, 'https://gym.example/touch.png', 'an arrow in an icon folder is not the logo');
  assert.equal(shareImage('<link rel="apple-touch-icon" href="/apple-touch-icon.png">', 'https://gym.example/').image, 'https://gym.example/apple-touch-icon.png');
  assert.equal(shareImage('<script type="application/ld+json">{"@type":"LocalBusiness","image":["https:\\/\\/x.com\\/barn.jpg"]}</script>', 'https://x.com/').image, 'https://x.com/barn.jpg', 'JSON-LD image');
});

test('addWebsiteImages: only businesses without a photo, credited to the site', async () => {
  const fetched = [];
  const fetchImpl = async (url) => { fetched.push(url); if (url.includes('down')) throw new Error('ECONNRESET'); return { ok: true, status: 200, text: async () => '<meta property="og:site_name" content="PlayDate PDX"><meta property="og:image" content="https://playdatepdx.com/hero.jpg">' }; };
  const places = [
    { id: 'a', url: 'https://playdatepdx.com/', explore: ['indoor_play'] },
    { id: 'b', url: 'https://parks.example/', explore: ['playgrounds'] }, // public park: Commons only
    { id: 'c', url: 'https://farm.example/', explore: ['farms'], image: 'https://upload.wikimedia.org/x.jpg', image_credit: 'Photo: X, CC0' },
    { id: 'd', url: 'https://down.example/', explore: ['gymnastics'] }
  ];
  await addWebsiteImages(places, { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'web-')), minGapMs: 0 });
  assert.deepEqual(fetched, ['https://playdatepdx.com/', 'https://down.example/']);
  assert.equal(places[0].image, 'https://playdatepdx.com/hero.jpg');
  assert.equal(places[0].image_credit, 'Photo: PlayDate PDX');
  assert.equal(places[0].image_page, 'https://playdatepdx.com/');
  assert.equal(places[2].image, 'https://upload.wikimedia.org/x.jpg'); // a Commons photo wins
  assert.equal(places[3].image, undefined); // unreachable site: mosaic banner
});

test('addWebsiteImages: museums and parks take a website photo but not a logo', async () => {
  const pages = {
    'https://museum.example/': '<meta property="og:site_name" content="Museum"><meta property="og:image" content="https://museum.example/hall.jpg">',
    'https://city.example/park': '<meta property="og:site_name" content="City"><meta property="og:image" content="https://city.example/city-logo.png">',
    'https://cafe.example/': '<meta property="og:site_name" content="Cafe"><meta property="og:image" content="https://cafe.example/logo.png">'
  };
  const fetchImpl = async (url) => ({ ok: true, status: 200, text: async () => pages[url] });
  const places = [
    { id: 'm', url: 'https://museum.example/', explore: ['history'] },
    { id: 'p', url: 'https://city.example/park', explore: ['nature'] },
    { id: 'c', url: 'https://cafe.example/', explore: ['eateries'] }
  ];
  await addWebsiteImages(places, { fetchImpl, cacheDir: mkdtempSync(join(tmpdir(), 'web-')), minGapMs: 0 });
  assert.equal(places[0].image, 'https://museum.example/hall.jpg');
  assert.equal(places[1].image, undefined, "a city's logo is not the park's picture");
  assert.equal(places[2].image, 'https://cafe.example/logo.png');
  assert.equal(places[2].image_logo, true);
});
