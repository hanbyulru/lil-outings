import { politeFetch } from '../lib/http.js';

/** OpenStreetMap places via Overpass. Evergreen venues: playgrounds, indoor play, museums, zoos, aquariums, water parks, gymnastics gyms. */
export function overpassQuery(bbox) {
  const [s, w, n, e] = bbox;
  const box = `${s},${w},${n},${e}`;
  // Most playgrounds in OSM have no name: they sit inside a named park. Fetch those too, plus named parks with their
  // bounding boxes, so parseOverpass can call them "<Park> playground". Nature reserves are left out (Nature is curated).
  return `[out:json][timeout:120];(
    nwr["leisure"="playground"](${box});
    nwr["leisure"="indoor_play"]["name"](${box});
    nwr["tourism"~"^(museum|zoo|aquarium|theme_park)$"]["name"](${box});
    nwr["leisure"="water_park"]["name"](${box});
    nwr["sport"~"gymnastics"]["name"](${box});
  );out center tags;
  (way["leisure"="park"]["name"](${box});relation["leisure"="park"]["name"](${box}););out tags bb;`;
}

/** Which "More to explore" pills an OSM feature belongs to (config/vocab.json explore ids). */
export function exploreFor(t) {
  if (/(^|;)\s*gymnastics\b/.test(t.sport || '') && t.leisure !== 'playground') return ['gymnastics']; // gyms (not school gyms or pitches)
  if (t.leisure === 'playground' && /^(private|no)$/.test(t.access || '')) return []; // HOA/apartment playgrounds aren't public
  const indoor = t.indoor === 'yes' || t.location === 'indoor' || (t.building && t.building !== 'no');
  if (t.leisure === 'indoor_play' || (t.leisure === 'playground' && (indoor || t.access === 'customers' || t.fee === 'yes'))) return ['indoor_play']; // play cafes, PlayPlaces
  if (t.leisure === 'playground') return ['playgrounds'];
  if (t.tourism === 'zoo' || t.tourism === 'aquarium') return ['nature'];
  if (t.tourism === 'museum') {
    const m = String(t.museum || '').toLowerCase();
    if (/^(art|arts)$/.test(m)) return ['art'];
    if (/science|technology|children/.test(m)) return ['science'];
    if (/railway|transport|aviation|aerospace/.test(m)) return ['trains_planes'];
    if (/history|local|heritage|military|archaeolog/.test(m)) return ['history'];
    // No (or an unusual) museum=* tag: go by the name; most small local museums are historical.
    const n = String(t.name || '').toLowerCase();
    if (/children'?s museum|\bplay\b/.test(n)) return ['indoor_play'];
    if (/\b(rail|railway|train|trolley|streetcar|aviation|air|aerospace|space)\b/.test(n)) return ['trains_planes'];
    if (/\b(science|discovery|technology|tek|computer)\b/.test(n)) return ['science'];
    if (/\b(art|arts|gallery)\b/.test(n)) return ['art'];
    if (!m || /^(yes|museum)$/.test(m)) return ['history'];
  }
  return [];
}

const placeOf = (el, t, source, lat, lon) => {
  const kind = t.leisure === 'playground' ? 'playground' : t.leisure === 'indoor_play' ? 'play' : /gymnastics/.test(t.sport || '') ? 'gym' : t.tourism || t.leisure;
  return {
    source_id: source.id,
    source_place_id: `${el.type}/${el.id}`,
    name: t.name,
    kind,
    lat, lon,
    address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ') || null,
    url: t.website || t['contact:website'] || null,
    hours_text: t.opening_hours || null,
    description: t.description || null,
    tags: { fee: t.fee || null, wheelchair: t.wheelchair || null },
    // photo pointers, resolved to Wikimedia Commons images in src/images.js
    wikidata: t.wikidata || null,
    commons: /^File:/i.test(t.wikimedia_commons || '') ? t.wikimedia_commons : null,
    image: t.image || null,
    explore: exploreFor(t)
  };
};

/** The smallest named park whose bounding box holds the point (bounding boxes: cheap, and close enough for parks). */
export function parkAt(lat, lon, parks) {
  let best = null;
  for (const p of parks) {
    const b = p.bounds;
    if (lat < b.minlat || lat > b.maxlat || lon < b.minlon || lon > b.maxlon) continue;
    const area = (b.maxlat - b.minlat) * (b.maxlon - b.minlon);
    if (!best || area < best.area) best = { park: p, area };
  }
  return best?.park || null;
}

export function parseOverpass(json, source) {
  const els = json.elements || [];
  const parks = els.filter((el) => el.tags?.leisure === 'park' && el.tags?.name && el.bounds);
  const out = [];
  const parkHasPlayground = new Set();
  const pos = (el) => [el.lat ?? el.center?.lat, el.lon ?? el.center?.lon];
  // Named features first, so a park's named playground wins over its unnamed ones.
  for (const el of els) {
    const t = el.tags || {};
    if (t.leisure === 'park' || !t.name) continue;
    const [lat, lon] = pos(el);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push(placeOf(el, t, source, lat, lon));
    if (t.leisure === 'playground') { const pk = parkAt(lat, lon, parks); if (pk) parkHasPlayground.add(pk.id); }
  }
  for (const el of els) {
    const t = el.tags || {};
    if (t.leisure !== 'playground' || t.name || !exploreFor(t).length) continue; // private ones don't claim the park
    const [lat, lon] = pos(el);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pk = parkAt(lat, lon, parks);
    if (!pk || parkHasPlayground.has(pk.id)) continue; // no park to name it after, or the park already has one
    parkHasPlayground.add(pk.id);
    const pt = pk.tags;
    // The park's Wikidata item and photo tags describe the park around the playground: fine for the card banner.
    out.push({ ...placeOf(el, { ...t, name: `${pt.name} playground`, wikidata: pt.wikidata, wikimedia_commons: pt.wikimedia_commons, image: pt.image, website: t.website || pt.website }, source, lat, lon), park: pt.name });
  }
  return out;
}

export async function fetchOsmPlaces(source, ctx) {
  const body = 'data=' + encodeURIComponent(overpassQuery(source.config.bbox));
  const text = await politeFetch(source.config.endpoint || 'https://overpass-api.de/api/interpreter', { ...ctx.http, method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, ttlMs: 24 * 3600 * 1000, timeoutMs: 180000 });
  return parseOverpass(JSON.parse(text), source);
}
