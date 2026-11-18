import { politeFetch } from '../lib/http.js';

/** OpenStreetMap places via Overpass. Evergreen venues: playgrounds, indoor play, museums, zoos, aquariums, water parks. */
export function overpassQuery(bbox) {
  const [s, w, n, e] = bbox;
  const box = `${s},${w},${n},${e}`;
  // No shared element cap: an `out ... 400` limit used to fill up with tiny nature reserves and cut playgrounds to ~45.
  // Nature reserves are left out (the Nature list is curated: the zoo and stroller-friendly trails).
  return `[out:json][timeout:90];(
    nwr["leisure"="playground"]["name"](${box});
    nwr["leisure"="indoor_play"]["name"](${box});
    nwr["tourism"~"^(museum|zoo|aquarium|theme_park)$"]["name"](${box});
    nwr["leisure"="water_park"]["name"](${box});
  );out center tags;`;
}

/** Which "More to explore" pills an OSM feature belongs to (config/vocab.json explore ids). */
export function exploreFor(t) {
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

export function parseOverpass(json, source) {
  return (json.elements || []).filter((el) => el.tags?.name).map((el) => {
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const t = el.tags;
    const kind = t.leisure === 'playground' ? 'playground' : t.leisure === 'indoor_play' ? 'play' : t.tourism || t.leisure;
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
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

export async function fetchOsmPlaces(source, ctx) {
  const body = 'data=' + encodeURIComponent(overpassQuery(source.config.bbox));
  const text = await politeFetch(source.config.endpoint || 'https://overpass-api.de/api/interpreter', { ...ctx.http, method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, ttlMs: 24 * 3600 * 1000, timeoutMs: 150000 });
  return parseOverpass(JSON.parse(text), source);
}
