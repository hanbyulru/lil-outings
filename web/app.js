import { filterEvents, filterPlaces, filterPrograms, whenRange } from './query.js';
import { initMap, showPins } from './map.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Interest colors (owner, Nov 2026). TEXT_COLORS: darker shades where the fill is too light to read as text (yellow).
const COLORS = { books: '#F2B705', art: '#B05CD6', nature: '#2E9E6B', science: '#3B6FE0', trains: '#F0614F', play: '#E4559B' };
const TEXT_COLORS = { books: '#9A6B00' };
const LABEL = { books: 'Storytime', art: 'Music & Art', nature: 'Animals & Nature', science: 'Science', trains: 'Trains & Planes', play: 'Play' };

// The headline's day picker. [value, phrase in the headline, menu label]
const WHEN = [['today', 'today', 'Today'], ['tomorrow', 'tomorrow', 'Tomorrow'], ['week', 'this week', 'This week'], ['weekend', 'this weekend', 'This weekend']];
// The headline's "what" picker (owner, Nov 2026). [value, underlined phrase, words after it, menu label, interest tag or null]
// Only the first part is the underlined menu; "to do" / "to go to" sit outside the underline. 'other' = no interest tag.
const WHAT = [
  ['all', 'Something good', 'to do', 'All Happenings', null],
  ['books', 'Storytime', 'to go to', 'Storytime', 'books'],
  ['art', 'Music & art things', 'to do', 'Music & Art', 'art'],
  ['science', 'Science things', 'to do', 'Science', 'science'],
  ['nature', 'Animal & nature things', 'to do', 'Animals & Nature', 'nature'],
  ['trains', 'Train & plane things', 'to do', 'Trains & Planes', 'trains'],
  ['play', 'Playful things', 'to do', 'Play', 'play'],
  ['other', 'Other things', 'to do', 'Other', null]
];
const whatOf = () => WHAT.find((w) => w[0] === S.what) || WHAT[0];
/** Does an event fit the headline's "what"? */
function fitsWhat(e) {
  if (S.what === 'all') return true;
  const t = tagsOf(e);
  return S.what === 'other' ? t.length === 0 : t.includes(S.what);
}
// The headline's age picker. [value, phrase after "a", menu label, menu hint, age range (years) or null for everyone].
// Upper bounds stop just short of the next group so a "babies 0-1" listing isn't also a toddler listing.
const AGE_GROUPS = [
  ['all', 'small person', 'All', 'Every age, 0–12', null],
  ['baby', 'baby', 'Baby', '0–12 months', [0, 0.99]],
  ['toddler', 'toddler', 'Toddler', '1–2 years', [1, 2.99]],
  ['preschool', 'preschooler', 'Preschooler', '3–5 years', [3, 5.99]],
  ['school', 'school-age kid', 'School age', '6–12 years', [6, 12]]
];
const AGE_KEY = 'lilOutings.age';
// From this hour (Portland time) little kids are winding down for bed, so the page opens on tomorrow.
const EVENING_HOUR = 18;
const EXPLORE_FALLBACK = [['indoor_play', 'Indoor Playgrounds'], ['playgrounds', 'Public Playgrounds'], ['art', 'Music & Art'], ['science', 'Science'], ['nature', 'Nature'], ['farms', 'Farms'], ['history', 'History'], ['trains_planes', 'Trains & Planes'], ['gymnastics', 'Gymnastics']].map(([id, label]) => ({ id, label }));
// "More to explore" icons: [mosaic tile shape, color] per config/vocab.json explore id.
const EXPLORE_LOOK = { indoor_play: ['d', '#E4559B'], playgrounds: ['a', '#F2A93B'], art: ['b', '#B05CD6'], science: ['c', '#3B6FE0'], nature: ['a', '#2E9E6B'], farms: ['d', '#7A9A2E'], history: ['c', '#C9773B'], trains_planes: ['b', '#F0614F'], gymnastics: ['d', '#1FA5B8'] };
const lookOf = (id) => EXPLORE_LOOK[id] || ['b', '#5B5F6B'];
const LOC_KEY = 'lilOutings.loc'; // remembered per browser: daily visitors usually look near home

let DATA, GEO;
let MAP = 'loading'; // 'loading' | true (real basemap) | false (illustrative fallback)
let mapItems = [];
let mapSel = null;
const S = { what: 'all', when: 'today', age: 'all', open: null /* 'what' | 'age' | 'when' | 'loc' */, loc: null /* null | {region} | {district} | {place} */, locOpen: null /* region expanded in the menu */, explore: 'indoor_play', showN: 24, sel: null, showMap: false };

function loadLoc() {
  try {
    const v = JSON.parse(localStorage.getItem(LOC_KEY) || 'null');
    if (v?.region && regionById(v.region)) return { region: v.region };
    if (v?.district && districtById(v.district)) return { district: v.district };
    if (v?.place && districtOfPlace(v.place)) return { place: v.place };
  } catch { /* storage blocked: start with anywhere */ }
  return null;
}
function loadAge() { try { const v = localStorage.getItem(AGE_KEY); return AGE_GROUPS.some((a) => a[0] === v) ? v : 'all'; } catch { return 'all'; } }
function saveAge() { try { localStorage.setItem(AGE_KEY, S.age); } catch { /* not critical */ } }
const ageGroup = () => AGE_GROUPS.find((a) => a[0] === S.age) || AGE_GROUPS[0];
function saveLoc() { try { localStorage.setItem(LOC_KEY, JSON.stringify(S.loc)); } catch { /* not critical */ } }
// Geography (config/geo.json): regions ("a quick drive from home") > districts > named towns/neighborhoods.
const regionById = (id) => GEO.regions.find((r) => r.id === id);
const districtById = (id) => GEO.districts.find((d) => d.id === id);
const districtOfPlace = (name) => GEO.districts.find((d) => d.places.some((p) => p.name === name));
const districtOfLoc = (loc) => (loc?.district ? districtById(loc.district) : loc?.place ? districtOfPlace(loc.place) : null);
/** The region to show expanded for a choice (Tigard sits in two; the first wins). */
const regionOfLoc = (loc) => (loc?.region ? regionById(loc.region) : GEO.regions.find((r) => r.districts.includes(districtOfLoc(loc)?.id)) || null);
/** The words after "in": Portland (anywhere), a region, a district, or a town. */
const locPhrase = (loc) => (!loc ? 'Portland' : loc.region ? regionById(loc.region).short : loc.district ? districtById(loc.district).name : loc.place);
/** One step wider: town -> its district -> its region -> anywhere. */
const widerLoc = (loc) => (loc?.place ? { district: districtOfLoc(loc).id } : loc?.district ? { region: regionOfLoc(loc).id } : null);

async function load() {
  if (window.__DATA__) return window.__DATA__;
  const j = (p) => fetch(p).then((r) => r.json());
  const [events, places, programs, meta, geo] = await Promise.all([j('data/events.json'), j('data/places.json'), j('data/programs.json'), j('data/meta.json'), j('data/geo.json')]);
  return { events, places, programs, meta, geo };
}

/** The visitor's date and time in Portland. Demo data is pinned to the day it was generated. */
function portlandNow() {
  if (String(DATA.meta.mode).startsWith('demo')) return { date: DATA.meta.today, min: null, hour: 10 };
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const hour = +p.hour, min = hour * 60 + +p.minute;
  return { date: `${p.year}-${p.month}-${p.day}`, min, hour };
}

const NOW = () => portlandNow();
const ctx = () => { const n = NOW(); return { today: n.date, nowMin: n.min, geo: GEO }; };
const fmtMin = (m) => { if (m == null) return ''; const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const utc = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
const fmtDay = (d, o) => utc(d).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const dayLabel = (d) => { const t = NOW().date; const base = fmtDay(d, { weekday: 'long', month: 'short', day: 'numeric' }); return d === t ? `Today · ${base}` : base; };
/** "Tue, Nov 17" or "Sat, Nov 21 – Sun, Nov 22" for a when value. */
function rangeLabel(when) {
  const [a, b] = whenRange(when, NOW().date);
  const one = (d) => fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' });
  return a === b ? one(a) : `${one(a)} – ${one(b)}`;
}
const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
// An event's color follows its first interest; a storytime with no interest tag still counts as Storytime.
const primary = (e) => tagsOf(e)[0] || null;
const colorOf = (e) => COLORS[primary(e)] || '#5B5F6B';
const textColorOf = (e) => TEXT_COLORS[primary(e)] || colorOf(e);
// Numbers on a colored circle: dark on the light yellow, white on the rest.
const onFill = (c) => (c === COLORS.books ? '#16181D' : '#fff');

function tile(kind, c, size = 120) {
  const shapes = {
    a: `<path d="M10 60A50 50 0 0 1 60 10h50v50A50 50 0 0 1 60 110H10z"/>`,
    b: `<circle cx="60" cy="60" r="50"/>`,
    c: `<path d="M10 10h50a50 50 0 0 1 50 50v50H10z"/>`,
    d: `<path d="M60 10a50 50 0 0 1 50 50 50 50 0 0 1-50 50H10V60A50 50 0 0 1 60 10z"/>`
  };
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" fill="${c}">${shapes[kind]}<circle cx="60" cy="60" r="14" fill="#fff" opacity=".9"/></svg>`;
}

/** Items at the same spot (e.g. six storytimes at one branch) share one pin. */
function groupPins(items) {
  const m = new Map();
  for (const e of items) {
    const k = `${(+e.lat).toFixed(4)},${(+e.lon).toFixed(4)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return [...m.values()].map((g, i) => ({ id: g[0].id, lat: g[0].lat, lon: g[0].lon, n: g[0]._n ?? i + 1, color: g[0]._c || colorOf(g[0]), ink: onFill(g[0]._c || colorOf(g[0])), count: g.length, items: g }));
}

const pinLabel = (g) => `${g.n}${g.count > 1 ? `<b class="cnt">+${g.count - 1}</b>` : ''}`;
const whenOf = (e) => (e.start_min != null ? fmtMin(e.start_min) : e.kind || 'All day');

function mapCard(g) {
  if (!g) return '';
  if (g.count === 1) {
    const e = g.items[0];
    return `<div class="mapcard"><div class="ev kicker" style="padding:0;border:0;font-size:12px">${esc(whenOf(e))}</div><div class="t">${esc(e.title || e.name)}</div><div class="m">${esc(e.venue_name || e.address || '')}${e.neighborhood ? ' · ' + esc(e.neighborhood) : ''}</div></div>`;
  }
  const f = g.items[0];
  const where = f.venue_name || f.address || 'Same location';
  const shown = g.items.slice(0, 4);
  return `<div class="mapcard group"><div class="m">${esc(where)}${f.neighborhood ? ' · ' + esc(f.neighborhood) : ''}</div><div class="t">${g.count} ${f.title ? 'events' : 'places'} here</div>
    <ul>${shown.map((e) => `<li><button class="${S.sel === e.id ? 'on' : ''}" data-ev="${e.id}"><span class="n" style="background:${e._c || colorOf(e)};color:${onFill(e._c || colorOf(e))}">${e._n ?? ''}</span><span class="w">${esc(e.start_min != null ? fmtMin(e.start_min) : '')}</span><span class="tt">${esc(e.title || e.name)}</span></button></li>`).join('')}</ul>
    ${g.count > shown.length ? `<div class="m">+${g.count - shown.length} more in the list</div>` : ''}</div>`;
}

function mapHtml(items) {
  const groups = groupPins(items.filter((e) => e.lat != null && e.lon != null));
  const selG = groups.find((g) => g.items.some((e) => e.id === S.sel));
  const card = mapCard(selG);
  if (MAP !== false) {
    mapItems = groups.map(({ items: _, ...g }) => g);
    mapSel = selG?.id || null;
    return `<div class="mapbox" id="mapslot">${MAP === 'loading' ? '<div class="maploading">Loading map…</div>' : ''}</div>${card}`;
  }
  const B = { n: 45.66, s: 45.33, w: -122.98, e: -122.35 };
  const xy = (e) => [((e.lon - B.w) / (B.e - B.w)) * 100, ((B.n - e.lat) / (B.n - B.s)) * 100];
  const pins = groups.map((g) => { const [x, y] = xy(g); const on = selG === g; return `<button class="pin ${on ? 'on' : ''}" data-pin="${g.id}" style="left:${x}%;top:${y}%;background:${g.color};z-index:${on ? 5 : 1}">${pinLabel(g)}</button>`; }).reverse().join('');
  return `<div class="mapbox sketch"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#F3EEE4"/><path d="M0 8 C 30 12, 40 4, 100 2 L100 0 L0 0Z" fill="#E7E2D6"/><path d="M62 0 C 58 20, 70 30, 63 46 C 58 58, 40 52, 36 70 C 34 80, 40 92, 38 100" stroke="#BFD9EA" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M88 62 C 76 66, 70 56, 63 46" stroke="#BFD9EA" stroke-width="1.6" fill="none"/><path d="M8 50 C 20 56, 26 40, 40 44" stroke="#DCE9D0" stroke-width="5" fill="none" opacity=".6"/></svg>${pins}</div>${card}<p class="notice">Illustrative map. Positions come from each venue's coordinates.</p>`;
}

/** After each render: hand the real map its new slot and pins. */
function syncMap() {
  const slot = $('#mapslot');
  // Desktop overlays the card on the map (so pan the pin below it); phones show it under the map.
  const card = $('.map .mapcard');
  const overlay = card && getComputedStyle(card).position === 'absolute' ? card.offsetHeight : 0;
  if (MAP === true && slot) showPins(slot, mapItems, mapSel, overlay);
}

function srcLine(e) { const also = (e.also_listed_on || []).length ? ` + ${e.also_listed_on.length} more` : ''; return `<span class="src">via ${esc(e.source?.name || '')}${also}</span>`; }

/** Interest tags (an event can have several). Categories are tags too, but hidden on cards for now (owner, Nov 2026). */
function tagsOf(e) {
  const t = [...(e.interests || [])];
  if (!t.includes('books') && (e.categories || []).includes('storytime')) t.unshift('books');
  return t.filter((k) => LABEL[k]);
}
function tagChips(e) {
  const t = tagsOf(e);
  return t.length ? `<div class="tags">${t.map((k) => `<span class="tag" style="--c:${COLORS[k]};--t:${TEXT_COLORS[k] || COLORS[k]}">${esc(LABEL[k])}</span>`).join('')}</div>` : '';
}

function renderEvent(e, n) {
  const age = e.age_min != null ? (e.age_max >= 12 ? `Ages ${e.age_min}+` : `Ages ${e.age_min}–${e.age_max}`) : '';
  const cost = e.cost_type === 'free' ? '<span class="free">Free</span>' : e.cost_amount ? `$${e.cost_amount}` : e.cost_type === 'paid' ? 'Paid' : '';
  const reg = e.registration === 'drop_in' ? 'Drop-in' : e.registration === 'required' ? 'Registration required' : '';
  return `<article class="ev ${S.sel === e.id ? 'sel' : ''}" data-ev="${e.id}"><span class="bar4" style="background:${colorOf(e)}"></span>
    <div class="time"><div class="num" style="background:${colorOf(e)};color:${onFill(colorOf(e))}">${n}</div><div class="big">${esc(e.start_min != null ? fmtMin(e.start_min).replace(' ', '') : 'All day')}</div>${e.end_min != null ? `<div class="small">to ${esc(fmtMin(e.end_min))}</div>` : ''}</div>
    <div class="body">${tagChips(e)}
    <h3>${esc(e.title)}</h3><div class="where">${e.venue_name ? `<b>${esc(e.venue_name)}</b>` : 'Location on source page'}${e.neighborhood ? ' · ' + esc(e.neighborhood) : ''}${e.miles != null ? ` · ${e.miles.toFixed(1)} mi` : ''}</div>
    <p>${esc((e.description || '').replace(/https?:\/\/\S+/g, '').trim())}</p>
    <div class="meta"><span>${esc(age)}</span>${cost}<span>${esc(reg)}</span>${srcLine(e)}${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">Details ↗</a>` : ''}</div></div></article>`;
}

/** Card banner: a Wikimedia Commons photo with its credit, or a mosaic of the category's tiles. */
function banner(p, catId) {
  // The mosaic sits under the photo, so a photo that fails to load (some sites block hotlinking) leaves the mosaic.
  const tiles = `<div class="tiles" aria-hidden="true">${mosaic(p.id || p.name, catId)}</div>`;
  if (!p.image) return `<div class="banner mosaic">${tiles}</div>`;
  // A logo: shown whole on a tinted tile, not cropped. If it fails to load, the tile turns back into the mosaic.
  if (p.image_logo) return `<div class="banner logo" style="--c:${lookOf(catId)[1]}">${tiles}<img src="${esc(p.image)}" alt="${esc(p.name)} logo" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.className='banner mosaic';this.remove()"></div>`;
  return `<div class="banner">${tiles}<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.querySelector('.credit')?.remove();this.remove()">${p.image_page ? `<a class="credit" href="${esc(p.image_page)}" target="_blank" rel="noopener">${esc(p.image_credit || 'Photo: Wikimedia Commons')}</a>` : ''}</div>`;
}
/** A strip of rounded tiles in the category's color, varied per place so neighbors don't match. */
function mosaic(seed, catId) {
  const [, c] = lookOf(catId);
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const kinds = ['a', 'b', 'c', 'd'], ops = [1, 0.55, 0.8, 0.35, 0.65];
  const shapes = { a: 'M10 60A50 50 0 0 1 60 10h50v50A50 50 0 0 1 60 110H10z', b: 'M110 60A50 50 0 1 1 10 60a50 50 0 1 1 100 0z', c: 'M10 10h50a50 50 0 0 1 50 50v50H10z', d: 'M60 10a50 50 0 0 1 50 50 50 50 0 0 1-50 50H10V60A50 50 0 0 1 60 10z' };
  // Two offset rows of small tiles; shape, shade and turn come from the place's id.
  let g = '', r = h || 1;
  const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) >>> 16) / 65536;
  for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
    if (rnd() < 0.22) continue; // gaps keep it airy
    const k = kinds[Math.floor(rnd() * 4)], o = ops[Math.floor(rnd() * ops.length)], rot = Math.floor(rnd() * 4) * 90;
    const x = i * 46 - (row % 2 ? 0 : 23), y = row * 40 - 14;
    g += `<g transform="translate(${x} ${y}) rotate(${rot} 21 21) scale(.35)"><path d="${shapes[k]}" fill="${c}" opacity="${o}"/></g>`;
  }
  return `<svg viewBox="0 0 400 100" preserveAspectRatio="xMidYMid slice" width="100%" height="100%"><rect width="400" height="100" fill="${c}" opacity=".12"/>${g}</svg>`;
}

function renderPlace(p, catId) {
  const c = lookOf(catId)[1];
  return `<article class="place">${banner(p, catId)}<div class="kind">${dot(c)}${esc(p.kind || 'place')}${p.neighborhood ? ' · ' + esc(p.neighborhood) : ''}${p.miles != null ? ` · ${p.miles.toFixed(1)} mi` : ''}</div><h3>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)} ↗</a>` : esc(p.name)}</h3>${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}${p.note ? `<p>${esc(p.note)}</p>` : ''}<p style="font-size:14px">${p.cost === 'free' ? 'Free' : p.cost === 'paid' ? 'Paid' : ''} · Ages ${p.age_min ?? 0}–${p.age_max ?? 12}${p.hours_text ? ' · ' + esc(p.hours_text) : ''}${p.verified ? '' : ' · from OpenStreetMap'}</p></article>`;
}

function renderProgram(p) {
  return `<article class="place">${banner(p, 'gymnastics')}<div class="kind">${dot(lookOf('gymnastics')[1])}${esc(p.age_label)} · ages ${p.age_min}–${p.age_max}</div><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p style="font-size:14px">${esc(p.location_text || '')}${p.region ? ` · ${esc(p.region)}` : ''}</p><p style="font-size:14px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="font-weight:600;text-decoration:underline">Check availability ↗</a>` : ''} <span class="src">via ${esc(p.source?.name || '')}</span></p></article>`;
}

/** "Something good to do with a small person [today ▾] in [SW ▾]": both underlined phrases are menus. */
function renderHeadline() {
  const cur = WHEN.find((w) => w[0] === S.when);
  const whenMenu = S.open === 'when' ? `<span class="whenmenu menu" role="menu">${WHEN.map(([v, , label]) => `<button role="menuitemradio" aria-checked="${v === S.when}" class="${v === S.when ? 'on' : ''}" data-when="${v}"><span>${label}</span><small>${esc(rangeLabel(v))}</small></button>`).join('')}</span>` : '';
  let locMenu = '';
  if (S.open === 'loc') {
    const isOn = (k, v) => S.loc?.[k] === v;
    const rows = GEO.regions.map((r) => {
      const open = S.locOpen === r.id;
      const dists = r.districts.map(districtById);
      const detail = open ? `<span class="regdetail">${dists.map((d) => `<span class="dist"><button class="opt distbtn ${isOn('district', d.id) ? 'on' : ''}" data-locdistrict="${d.id}">${esc(d.name)}</button>${d.places.map((p) => `<button class="opt town ${isOn('place', p.name) ? 'on' : ''}" data-locplace="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</span>`).join('')}</span>` : '';
      return `<span class="regrow ${open ? 'open' : ''}"><button class="reg ${isOn('region', r.id) ? 'on' : ''}" data-locregion="${r.id}"><b>${esc(r.name)}</b><small>${esc(dists.map((d) => d.name).join(' · '))}</small></button><button class="regmore" data-locexpand="${r.id}" aria-expanded="${open}" aria-label="${open ? 'Close' : 'Narrow down'} ${esc(r.name)}"><span class="lbl">${open ? 'Close' : 'Narrow'} </span><span aria-hidden="true">${open ? '▴' : '▾'}</span></button>${detail}</span>`;
    }).join('');
    locMenu = `<span class="locmenu menu" role="dialog" aria-label="Choose where">
      <button class="opt any ${!S.loc ? 'on' : ''}" data-locany>Anywhere in Portland &amp; the metro</button>
      <span class="reglist">${rows}</span>
    </span>`;
  }
  const ag = ageGroup();
  const ageMenu = S.open === 'age' ? `<span class="whenmenu agemenu menu" role="menu">${AGE_GROUPS.map(([v, , label, hint]) => `<button role="menuitemradio" aria-checked="${v === S.age}" class="${v === S.age ? 'on' : ''}" data-agegroup="${v}"><span>${label}</span><small>${hint}</small></button>`).join('')}</span>` : '';
  const whatMenu = S.open === 'what' ? `<span class="whenmenu whatmenu menu" role="menu">${WHAT.map(([v, , , label, tag]) => `<button role="menuitemradio" aria-checked="${v === S.what}" class="${v === S.what ? 'on' : ''}" data-what="${v}"><span>${tag ? `<i class="swatch" style="background:${COLORS[tag]}"></i>` : `<i class="swatch ${v}"></i>`}${label}</span></button>`).join('')}</span>` : '';
  const trigger = (kind, text, open) => `<button class="whenbtn" data-menu="${kind}" aria-haspopup="${kind === 'loc' ? 'dialog' : 'menu'}" aria-expanded="${open}"><span class="whentext">${esc(text)}</span><span class="caret" aria-hidden="true">▾</span></button>`;
  $('#headline').innerHTML = `<span class="whenwrap whatwrap">${trigger('what', whatOf()[1], S.open === 'what')}${whatMenu}</span> ${esc(whatOf()[2])} with a <span class="whenwrap">${trigger('age', ag[1], S.open === 'age')}${ageMenu}</span> <span class="whenwrap">${trigger('when', cur[1], S.open === 'when')}${whenMenu}</span> in <span class="whenwrap">${trigger('loc', locPhrase(S.loc), S.open === 'loc')}${locMenu}</span>`;
  // Keep an open menu on screen (the phrase can sit near either edge).
  const m = $('#headline .menu');
  if (m && getComputedStyle(m).position === 'absolute') {
    const r = m.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    let shift = Math.min(0, vw - 16 - r.right); // pull left if it runs off the right edge
    if (r.left + shift < 16) shift = 16 - r.left; // but never off the left edge
    if (shift) m.style.left = `${shift}px`;
  }
}

function closeMenu() { if (S.open) { S.open = null; renderHeadline(); } }

/** The day's list, right under the headline, with the map beside it. */
function renderToday() {
  const c = ctx();
  const opts = { when: S.when, loc: S.loc, age: ageGroup()[4] };
  const events = filterEvents(DATA.events, opts, c).filter(fitsWhat);
  const over = S.when === 'today' ? filterEvents(DATA.events, opts, { ...c, nowMin: null }).filter(fitsWhat).length - events.length : 0;
  events.forEach((e, i) => { e._n = i + 1; });
  const multiDay = S.when === 'weekend' || S.when === 'week';
  const bar = `<div class="todaybar"><span class="count">${events.length} ${events.length === 1 ? 'thing' : 'things'} to do</span><span class="muted">${esc(rangeLabel(S.when))}${over > 0 ? ` · ${over} earlier ${over === 1 ? 'one is' : 'ones are'} over` : ''}</span><button class="tog maptoggle ${S.showMap ? 'on' : ''}" data-showmap>${S.showMap ? 'Hide map' : 'Map'}</button></div>`;
  let body;
  if (!events.length) {
    const next = S.when === 'today' ? `<button class="btn-ink" data-when="tomorrow">See tomorrow</button>` : S.when === 'tomorrow' ? `<button class="btn-ink" data-when="weekend">See this weekend</button>` : '';
    const phrase = WHEN.find((w) => w[0] === S.when)[1];
    const where = (S.what !== 'all' ? ` under ${whatOf()[3]}` : '') + (S.age !== 'all' ? ` for a ${ageGroup()[1]}` : '') + (S.loc ? ` in ${locPhrase(S.loc)}` : '');
    const msg = S.when === 'today' && over > 0 && !S.loc && S.what === 'all' ? 'That’s everything for today.' : `Nothing listed${where} ${phrase}.`;
    const w = widerLoc(S.loc);
    const wider = w ? `<button class="btn-ink" ${w.district ? `data-locdistrict="${w.district}"` : `data-locregion="${w.region}"`}>See all of ${esc(locPhrase(w))}</button>` : S.loc ? `<button class="btn-ink" data-locany>See anywhere in Portland</button>` : next;
    const allAges = S.age !== 'all' ? `<button class="${w || S.loc ? 'textbtn' : 'btn-ink'}" data-agegroup="all">See all ages</button>` : '';
    const allWhat = S.what !== 'all' ? `<button class="${w || S.loc || S.age !== 'all' ? 'textbtn' : 'btn-ink'}" data-what="all">See all happenings</button>` : '';
    body = `<div class="empty"><h3>${esc(msg)}</h3><div class="empty-actions">${wider}${allWhat}${allAges}${S.loc || S.age !== 'all' || S.what !== 'all' ? next.replace('btn-ink', 'textbtn') : ''}</div></div>`;
  } else {
    let list;
    if (multiDay) {
      const days = {}; events.forEach((e) => (days[e.date] ||= []).push(e));
      list = Object.entries(days).map(([d, es]) => `<div class="daytitle">${esc(dayLabel(d))}</div>${es.map((e) => renderEvent(e, e._n)).join('')}`).join('');
    } else list = events.map((e) => renderEvent(e, e._n)).join('');
    body = `<div class="split today-split ${S.showMap ? 'showmap' : ''}"><div class="list">${list}</div><aside class="map">${mapHtml(events)}</aside></div>`;
  }
  $('#today-inner').innerHTML = bar + body;
  syncMap();
}

/** Below the fold: "More to explore" pills over the places directory (and PP&R class series under Classes).
 *  Independent of the headline's age / day / place choices (owner's call, Nov 2026). */
function renderMore() {
  const c = ctx();
  const pills = DATA.meta.vocab?.explore || EXPLORE_FALLBACK;
  const placesFor = (id) => filterPlaces(DATA.places, { explore: id }, c);
  // Under Gymnastics: the PP&R class series that are gymnastics or tumbling.
  const programs = filterPrograms(DATA.programs || [], {}, c).filter((p) => /gymnast|tumbl|vault|acrobat/i.test(`${p.name} ${p.description || ''} ${p.title || ''}`));
  const count = (id) => placesFor(id).length + (id === 'gymnastics' ? programs.length : 0);
  const cur = pills.find((x) => x.id === S.explore) || pills[0];
  const items = placesFor(cur.id);
  const shown = items.slice(0, S.showN);
  let body = items.length ? `<div class="places">${shown.map((p) => renderPlace(p, cur.id)).join('')}</div>` : '';
  if (items.length > shown.length) body += `<button class="textbtn more-btn" data-showmore>Show ${Math.min(24, items.length - shown.length)} more of ${items.length - shown.length}</button>`;
  if (cur.id === 'gymnastics' && programs.length) body += `<h3 class="subhead">Portland Parks &amp; Recreation gymnastics classes</h3><p class="notice" style="margin:4px 0 0">Dates, times and prices are in the registration system, so each card links there.</p><div class="places">${programs.map(renderProgram).join('')}</div>`;
  if (!items.length && !(cur.id === 'gymnastics' && programs.length)) body = `<div class="empty"><h3>Nothing under ${esc(cur.label)} yet.</h3></div>`;
  $('#results-inner').innerHTML = `<h2>Places to explore</h2>
    <div class="explore-list" role="group" aria-label="Kinds of places">${pills.map((x) => { const [k, col] = lookOf(x.id), on = x.id === cur.id; return `<button class="${on ? 'on' : ''}" style="--c:${col}" data-explore="${x.id}" aria-pressed="${on}"><span class="ic">${tile(k, col, 40)}</span><span class="nm">${esc(x.label)}<small>${esc(x.hint || '')}</small></span><span class="n">${count(x.id)}</span><span class="arr" aria-hidden="true">${on ? '↓' : '→'}</span></button>`; }).join('')}</div>
    <div id="explore-results"><h3 class="explore-title"><span class="ic">${tile(lookOf(cur.id)[0], lookOf(cur.id)[1], 28)}</span>${esc(cur.label)}</h3>${body}</div>`;
}

function renderFoot() {
  const m = DATA.meta;
  const when = new Date(m.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' });
  $('#foot').innerHTML = `Data last refreshed ${esc(when)} (Pacific). Sources: ${m.sources.map((s) => `${esc(s.name)} <em>(${esc(s.status)}${s.ok ? '' : ', failed'})</em>`).join(', ')}. Always confirm details on the source page before you go.`;
  if (String(m.mode).startsWith('demo')) { const d = $('#demo'); d.hidden = false; d.textContent = 'Demo data: sample listings generated in the real feeds’ formats, not live Portland events. Run the refresh with network access for real data.'; }
}

function setWhen(v) { S.when = v; S.open = null; S.sel = null; renderHeadline(); renderToday(); }
function setLoc(loc) { S.loc = loc; S.open = null; S.sel = null; saveLoc(); renderHeadline(); renderToday(); }
function setAge(v) { S.age = v; S.open = null; S.sel = null; saveAge(); renderHeadline(); renderToday(); }

document.addEventListener('click', (ev) => {
  // Any click outside the day menu closes it.
  if (S.open && !ev.target.closest('.whenwrap')) closeMenu();
  const t = ev.target.closest('button, a[data-nav]'); if (!t) return;
  const d = t.dataset;
  if (d.menu) {
    S.open = S.open === d.menu ? null : d.menu;
    if (S.open === 'loc') S.locOpen = S.loc && !S.loc.region ? regionOfLoc(S.loc)?.id || null : null;
    renderHeadline();
    if (S.open === 'when' || S.open === 'age' || S.open === 'what') $('#headline .whenmenu [aria-checked="true"]')?.focus();
    if (S.open === 'loc') ($('.locmenu .on') || $('.locmenu .any'))?.focus();
    return;
  }
  if (d.locexpand) {
    S.locOpen = S.locOpen === d.locexpand ? null : d.locexpand;
    renderHeadline();
    const btn = $(`.locmenu [data-locexpand="${d.locexpand}"]`);
    btn?.focus({ preventScroll: true });
    btn?.closest('.regrow')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // phones: the opened row may be below the fold
    return;
  }
  if (d.what) { S.what = d.what; S.open = null; S.sel = null; renderHeadline(); renderToday(); if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.agegroup) { setAge(d.agegroup); if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.locany !== undefined) return setLoc(null);
  if (d.locregion) return setLoc({ region: d.locregion });
  if (d.locdistrict) return setLoc({ district: d.locdistrict });
  if (d.locplace) return setLoc({ place: d.locplace });
  if (d.when) { setWhen(d.when); if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.showmap !== undefined) { S.showMap = !S.showMap; return renderToday(); }
  if (d.explore) {
    S.explore = d.explore; S.showN = 24; renderMore();
    // Phones: the list of kinds is tall, so bring the cards into view.
    if (matchMedia('(max-width:700px)').matches) $('#explore-results').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (d.showmore !== undefined) { S.showN += 24; return renderMore(); }
  if (d.pin) { S.sel = d.pin; return renderToday(); }
});
document.addEventListener('click', (ev) => { const c = ev.target.closest('[data-ev]'); if (c && !ev.target.closest('a')) { S.sel = c.dataset.ev; const y = scrollY; renderToday(); scrollTo(0, y); } });
document.addEventListener('keydown', (ev) => {
  if (!S.open) return;
  if (ev.key === 'Escape') { const k = S.open; closeMenu(); $(`[data-menu="${k}"]`)?.focus(); return; }
  if ((S.open === 'when' || S.open === 'age' || S.open === 'what') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    const items = [...document.querySelectorAll('#headline .whenmenu button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    ev.preventDefault();
  }
});

/** Events and Places are two views, switched by the toggle in the header (#events / #places, so links and Back work). */
function viewFromHash() { return location.hash === '#places' ? 'places' : 'events'; }
function showView(v) {
  document.body.dataset.view = v;
  $('#today').hidden = v !== 'events';
  $('#more').hidden = v !== 'places';
  for (const a of document.querySelectorAll('.viewtoggle [data-view]')) a.setAttribute('aria-selected', String(a.dataset.view === v));
  if (v === 'events' && DATA) renderToday(); // the map needs a visible container to size itself
}
addEventListener('hashchange', () => { const v = viewFromHash(); if (v !== document.body.dataset.view) { showView(v); scrollTo(0, 0); } });
showView(viewFromHash());

initMap().then((ok) => { MAP = ok; if (DATA) renderToday(); });
load().then((d) => {
  DATA = d; GEO = d.geo;
  S.loc = loadLoc();
  S.age = loadAge();
  if (NOW().hour >= EVENING_HOUR) S.when = 'tomorrow';
  renderHeadline(); renderToday(); renderMore(); renderFoot();
}).catch((e) => { $('#today-inner').innerHTML = `<p>Could not load data: ${esc(e.message)}. Run <code>npm run refresh:demo</code> then <code>npm run serve</code>.</p>`; });
