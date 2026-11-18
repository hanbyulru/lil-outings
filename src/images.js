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
// Wikidata 'instance of' values that make an item's photo fit a playground: park, urban park, playground, garden, city park
const PARK_TYPES = new Set(['Q22698', 'Q22746', 'Q11875349', 'Q1107656', 'Q2945655']);

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

/** Adds image, image_credit, image_page: a Commons photo, else (for businesses) the place's website share image. Never throws. */
export async function addPlaceImages(places, http, log = () => {}) {
  // Photos rarely change: cache a month, and space requests out (the APIs rate limit shared IPs).
  const h = { ...http, headers: { ...(http.headers || {}), 'user-agent': WIKIMEDIA_UA }, ttlMs: 30 * 24 * 3600 * 1000, minGapMs: Math.max(http.minGapMs ?? 0, 2000) };
  const fileOf = new Map(); // place id -> Commons file name
  try {
    for (const p of places) {
      const f = commonsFileFromTag(p.commons && !/^File:/i.test(p.commons) ? `File:${p.commons}` : p.commons) || commonsFileFromTag(p.image);
      if (f) fileOf.set(p.id, f);
    }
    const usesWikidata = (p) => !fileOf.has(p.id) && QID.test(p.wikidata || '');
    const qids = [...new Set(places.filter(usesWikidata).map((p) => p.wikidata))];
    const p18 = new Map(), parky = new Set();
    for (const ids of chunk(qids, 50)) {
      const j = JSON.parse(await politeFetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=claims&format=json`, h));
      for (const id of ids) {
        const c = j.entities?.[id]?.claims || {};
        const v = c.P18?.[0]?.mainsnak?.datavalue?.value;
        if (v) p18.set(id, v);
        if ((c.P31 || []).some((s) => PARK_TYPES.has(s.mainsnak?.datavalue?.value?.id))) parky.add(id);
      }
    }
    // A playground's wikidata tag often points at its neighborhood (a townhouse photo): only take parks and playgrounds.
    for (const p of places) if (usesWikidata(p) && p18.has(p.wikidata) && (p.kind !== 'playground' || parky.has(p.wikidata))) fileOf.set(p.id, p18.get(p.wikidata));

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
  await addWebsiteImages(places, http, log);
  return places;
}

// Businesses rarely have free photos. Owner's call (Nov 2026): places with no Commons photo use their own website's
// share image (og:image), credited to the site and linking back to it. Every kind on the Places tab (Public Playgrounds is hidden).
export const WEBSITE_PHOTO_KINDS = ['indoor_play', 'farms', 'gymnastics', 'art', 'eateries', 'science', 'nature', 'history', 'trains_planes'];
// A business's logo is a fair stand-in for a photo (owner: don't skip logos); a museum or park page's logo is usually the
// city's or agency's, so other kinds take a website photo only.
export const WEBSITE_LOGO_KINDS = ['indoor_play', 'farms', 'gymnastics', 'art', 'eateries'];

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
const unent = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();

/** The page's share image (og:image, twitter:image, image_src) and site name, or null. Logos and icons are skipped. */
export function shareImage(html, pageUrl) {
  const r = pickShareImage(html, pageUrl);
  return r.image ? r : null;
}

/**
 * The site's own picture for a place card: { image, site, logo } or { why }.
 * A photo (the share image) wins; if the share image is a logo, or there is none, the site's logo is used
 * (owner's call, Nov 2026) and flagged logo: true so the card shows it whole on a tile instead of cropping it.
 * Logo sources, in order: the share image, JSON-LD "logo", an <img> named/classed/alt'd logo, apple-touch-icon.
 */
export function pickShareImage(html, pageUrl) {
  html = String(html);
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (keys) => { for (const k of keys) for (const t of metas) if ((attr(t, 'property') || attr(t, 'name') || '').toLowerCase() === k) { const c = attr(t, 'content'); if (c) return unent(c); } return null; };
  const abs = (src) => {
    if (!src || /^data:/i.test(src)) return null;
    try { return new URL(src.trim(), pageUrl).href.replace(/^http:\/\//, 'https://'); } catch { return null; } // http share images: their CDNs serve https
  };
  const fileOf = (u) => decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
  const LOGOISH = /(^|[^a-z])(logo|favicon|icon|brand|mark)s?([^a-z]|$)|apple-touch/i;
  const site = meta(['og:site_name']) || new URL(pageUrl).hostname.replace(/^www\./, '');

  // 1. share image (og / twitter / image_src / JSON-LD image)
  let share = meta(['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
  if (!share) { const l = links.find((t) => /\brel\s*=\s*["']image_src["']/i.test(t)); share = l ? unent(attr(l, 'href')) : null; }
  const ldBlocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const ld = (key) => { for (const b of ldBlocks) { const m = b.match(new RegExp(`"${key}"\\s*:\\s*(?:\\[\\s*)?(?:\\{[^}]*?"url"\\s*:\\s*)?"([^"]+)"`)); if (m) return m[1].replace(/\\\//g, '/'); } return null; };
  if (!share) share = ld('image');
  const shareAbs = abs(share);
  let why = shareAbs ? null : `no share image (${html.length} bytes, title "${(html.match(/<title[^>]*>([^<]{0,50})/i)?.[1] || '').trim()}")`;
  if (shareAbs && /^https:\/\//.test(shareAbs) && !/\.(ico)(\?|$)/i.test(shareAbs)) {
    const w = +meta(['og:image:width']);
    const isLogo = LOGOISH.test(fileOf(shareAbs)) || /\.svg(\?|$)/i.test(shareAbs) || (w && w < 300);
    if (!isLogo) return { image: shareAbs, site, logo: false };
    // the share image is the logo: keep it as the logo candidate, but look for a better logo file first? No: it's the site's own choice.
    return { image: shareAbs, site, logo: true };
  }
  // 2. no share image: the site's logo
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imgSrc = (t) => attr(t, 'src') || attr(t, 'data-src') || attr(t, 'data-image') || (attr(t, 'srcset') || '').split(/[ ,]/)[0];
  // An <img> counts as the logo only if its class, alt, id or file name says "logo" (folder names like /icon/ don't count).
  const fname = (u) => { try { return decodeURIComponent(new URL(u, pageUrl).pathname.split('/').pop()); } catch { return ''; } };
  const logoImg = imgs.find((t) => imgSrc(t) && /logo/i.test(`${attr(t, 'class') || ''} ${attr(t, 'alt') || ''} ${attr(t, 'id') || ''} ${fname(imgSrc(t))}`));
  const touch = links.find((t) => /\brel\s*=\s*["'][^"']*apple-touch-icon/i.test(t));
  for (const c of [ld('logo'), logoImg && imgSrc(logoImg), touch && attr(touch, 'href')]) {
    const u = abs(c && unent(c));
    if (u && /^https:\/\//.test(u) && !/\.ico(\?|$)/i.test(u)) return { image: u, site, logo: true };
  }
  return { why: why || 'no usable image' };
}

export async function addWebsiteImages(places, http, log = () => {}) {
  const todo = places.filter((p) => !p.image && !p.no_site_image && p.url && /^https?:\/\//.test(p.url) && (p.explore || []).some((e) => WEBSITE_PHOTO_KINDS.includes(e)));
  let n = 0, failed = 0, logos = 0;
  const misses = [];
  for (const p of todo) {
    try {
      const html = await politeFetch(p.url, { ...http, ttlMs: 30 * 24 * 3600 * 1000, timeoutMs: 15000, retries: 0, headers: { ...(http.headers || {}), accept: 'text/html' } });
      const got = pickShareImage(html.slice(0, 400000), p.url);
      if (got.image && got.logo && !(p.explore || []).some((e) => WEBSITE_LOGO_KINDS.includes(e))) misses.push(`${p.name}: only a logo`);
      else if (got.image) {
        p.image = got.image; p.image_credit = got.logo ? got.site : `Photo: ${got.site}`; p.image_page = p.url; p.image_source = 'website';
        if (got.logo) { p.image_logo = true; logos++; }
        n++;
      }
      else misses.push(`${p.name}: ${/cf-chl|challenge-platform|<title>Just a moment|Attention Required! \| Cloudflare/i.test(html) ? 'bot check page' : got.why}`);
    } catch (err) { failed++; misses.push(`${p.name}: ${String(err.message).slice(0, 60)}`); }
  }
  if (todo.length) log(`  website photos: ${n} of ${todo.length} places (${logos} of them logos)${failed ? ` (${failed} sites unreachable)` : ''}`);
  for (const m of misses) log(`    - ${m}`);
}
