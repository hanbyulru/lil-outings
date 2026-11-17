import { politeFetch } from './lib/http.js';

/**
 * Place photos from Wikimedia Commons (freely licensed, shown with a credit line).
 * A place can point at a photo three ways, strongest first:
 *   commons:  a Commons file name picked by hand (config/places.seed.json, or OSM wikimedia_commons=File:...)
 *   image:    an OSM image=* tag, used only when it is a Commons / upload.wikimedia.org link
 *   wikidata: a Wikidata item, whose P18 ("image") names the file
 * Business websites' own photos are deliberately not used (copyright).
 * Wikimedia asks API clients for a descriptive User-Agent; generic ones get rate limited.
 */
export const WIKIMEDIA_UA = 'LilOutings/0.2 (https://hanbyulru.github.io/lil-outings/; kids events site)';
const WIDTH = 640;
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const QID = /^Q\d+$/;

/** Commons file name from an OSM image / wikimedia_commons tag, or null if it isn't a Commons file. */
export function commonsFileFromTag(v) {
  if (!v) return null;
  v = String(v).trim();
  let m = v.match(/^File:(.+)$/i);
  if (m) return m[1].replace(/_/g, ' ');
  m = v.match(/^https?:\/\/commons\.wikimedia\.org\/wiki\/File:([^?#]+)/i);
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  m = v.match(/^https?:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]).replace(/_/g, ' ');
  return null;
}

const plain = (html) => String(html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Credit line from Commons extmetadata, e.g. "Photo: Jane Doe, CC BY-SA 4.0". */
export function creditFrom(meta = {}) {
  const artist = plain(meta.Artist?.value).slice(0, 60);
  const lic = plain(meta.LicenseShortName?.value);
  return ['Photo' + (artist ? `: ${artist}` : ''), lic].filter(Boolean).join(', ');
}

/** Adds image, image_credit, image_page to places that have a Commons photo. Never throws: a failure just means no photos. */
export async function addPlaceImages(places, http, log = () => {}) {
  // Photos rarely change: cache a month, and space requests out (the APIs rate limit shared IPs).
  const h = { ...http, headers: { ...(http.headers || {}), 'user-agent': WIKIMEDIA_UA }, ttlMs: 30 * 24 * 3600 * 1000, minGapMs: Math.max(http.minGapMs ?? 0, 2000) };
  const fileOf = new Map(); // place id -> Commons file name
  try {
    for (const p of places) {
      const f = commonsFileFromTag(p.commons && !/^File:/i.test(p.commons) ? `File:${p.commons}` : p.commons) || commonsFileFromTag(p.image);
      if (f) fileOf.set(p.id, f);
    }
    // A playground's wikidata tag usually points at its park or neighborhood, whose photo isn't the playground.
    const usesWikidata = (p) => !fileOf.has(p.id) && QID.test(p.wikidata || '') && p.kind !== 'playground';
    const qids = [...new Set(places.filter(usesWikidata).map((p) => p.wikidata))];
    const p18 = new Map();
    for (const ids of chunk(qids, 50)) {
      const j = JSON.parse(await politeFetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=claims&format=json`, h));
      for (const id of ids) { const v = j.entities?.[id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value; if (v) p18.set(id, v); }
    }
    for (const p of places) if (usesWikidata(p) && p18.has(p.wikidata)) fileOf.set(p.id, p18.get(p.wikidata));

    const info = new Map(); // normalized title -> { thumb, page, credit }
    const titles = [...new Set(fileOf.values())].map((f) => `File:${f}`);
    for (const ts of chunk(titles, 40)) {
      const url = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=${WIDTH}&iiextmetadatafilter=Artist|LicenseShortName&format=json&titles=${ts.map(encodeURIComponent).join('|')}`;
      const j = JSON.parse(await politeFetch(url, h));
      const norm = new Map((j.query?.normalized || []).map((n) => [n.to, n.from]));
      for (const pg of Object.values(j.query?.pages || {})) {
        const ii = pg.imageinfo?.[0];
        if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime || 'image/jpeg')) continue;
        const rec = { thumb: ii.thumburl || ii.url, page: ii.descriptionurl, credit: creditFrom(ii.extmetadata) };
        info.set(pg.title.replace(/^File:/, ''), rec);
        if (norm.has(pg.title)) info.set(norm.get(pg.title).replace(/^File:/, '').replace(/_/g, ' '), rec);
      }
    }
    let n = 0;
    for (const p of places) {
      const rec = info.get(fileOf.get(p.id));
      if (rec?.thumb) { p.image = rec.thumb; p.image_credit = rec.credit; p.image_page = rec.page; n++; }
      else delete p.image;
      delete p.commons;
    }
    log(`  Wikimedia Commons photos: ${n} places`);
  } catch (err) {
    for (const p of places) { if (!p.image_credit) delete p.image; delete p.commons; }
    log(`  Wikimedia Commons photos: FAILED (${err.message})`);
  }
  return places;
}
