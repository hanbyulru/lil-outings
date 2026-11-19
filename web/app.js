import { filterEvents, filterPlaces, filterPrograms, whenRange, isFriday, isSaturday, isSunday, markSeries, collapseSeries } from './query.js';
import { initMap, showPins } from './map.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Interest colors (owner, Nov 2026). TEXT_COLORS: darker shades where the fill is too light to read as text (yellow).
const COLORS = { books: '#F2B705', art: '#B05CD6', nature: '#2E9E6B', science: '#3B6FE0', trains: '#F0614F', play: '#E4559B', holidays: '#9AA3AE' };
const TEXT_COLORS = { books: '#9A6B00', holidays: '#5E6672' };
const LABEL = { books: 'Storytime', art: 'Music & Art', nature: 'Animals & Nature', science: 'Science', trains: 'Vehicles', play: 'Play', holidays: 'Holidays' };

// The headline's day picker. [value, phrase in the headline, menu label]
const WHEN = [['today', 'today', 'Today'], ['tomorrow', 'tomorrow', 'Tomorrow'], ['week', 'this week', 'This week'], ['weekend', 'this weekend', 'This weekend'], ['nextweek', 'next week', 'Next week'], ['upcoming', 'all upcoming days', 'All upcoming days']];
// The headline's "what" picker (owner, Nov 2026). [value, underlined phrase, words after it, menu label, interest tag or null]
// Only the first part is the underlined menu; "to do" / "to go to" sit outside the underline. 'other' = no interest tag.
const WHAT = [
  ['all', 'Something good', 'to do', 'All Happenings', null],
  ['books', 'Storytimes', 'to go to', 'Storytime', 'books'], // "Storytimes to go to" (owner, Nov 2026)
  ['art', 'Music & art things', 'to do', 'Music & Art', 'art'],
  ['science', 'Science things', 'to do', 'Science', 'science'],
  ['nature', 'Animal & nature things', 'to do', 'Animals & Nature', 'nature'],
  ['trains', 'Vehicle things', 'to do', 'Vehicles', 'trains'],
  ['play', 'Playful things', 'to do', 'Play', 'play'],
  ['holidays', 'Holiday things', 'to do', 'Holidays', 'holidays'], // only while the holiday guide is live (holidaySeason)
  ['other', 'Other things', 'to do', 'Other', null]
];
// Interests left out of the menu for now (owner, Nov 2026): Vehicles has no events at the moment. Its tag, colors and Places kind stay.
const HIDDEN_WHAT = ['trains'];
/**
 * The holiday guide's season (owner, Nov 2026; winter holidays only). 'soon' from Nov 1 to the day before Thanksgiving ("Coming soon"
 * in the interest menu and on the Places tab), 'live' from Thanksgiving Day through Jan 1, else 'off' (no Holidays
 * anywhere). Preview any state with ?holidays=soon|live|off.
 */
function holidaySeason(dateStr = NOW().date) {
  const q = new URLSearchParams(location.search).get('holidays');
  if (q === 'soon' || q === 'live' || q === 'off') return q;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m === 1 && d === 1) return 'live';
  if (m < 11) return 'off';
  return dateStr < thanksgiving(y) ? 'soon' : 'live'; // live from Thanksgiving Day (owner: before the LO tree lighting on Friday)
}
const holidaysLive = () => holidaySeason() === 'live';
/** Holiday mode: Holidays is the one interest picked. It unlocks "All upcoming days" and themes the Events page. */
const holidayMode = () => holidaysLive() && S.whats.length === 1 && S.whats[0] === 'holidays';
/** The page's holiday theme (owner, Nov 2026): midnight, silver and gold like the launch splash, on Events in holiday mode and on
 *  Places when the Holidays kind is open. */
function applyTheme() {
  const v = document.body.dataset.view;
  document.body.classList.toggle('holimode', holidaysLive() && (v === 'places' ? S.explore === 'holidays' : holidayMode()));
}
// "What" and "who" are multi-select (owner, Nov 2026): S.whats / S.ages hold the picks in menu order; empty = everything.
const joinList = (xs) => (xs.length < 3 ? xs.join(' + ') : `${xs.slice(0, -1).join(', ')} + ${xs[xs.length - 1]}`);
const pickedWhats = () => S.whats.map((v) => WHAT.find((w) => w[0] === v)).filter(Boolean);
/** The "what" phrase and the words after it: nothing picked = "Something good … to do"; several = their labels joined. */
function whatPhrase() {
  const ws = pickedWhats();
  if (!ws.length) return { text: WHAT[0][1], after: WHAT[0][2] };
  if (ws.length === 1) return { text: ws[0][1], after: ws[0][2] };
  return { text: joinList(ws.map((w) => w[3])), after: 'to do' };
}
/** Does an event fit the headline's "what"? Any picked interest counts. */
function fitsWhat(e) {
  if (!S.whats.length) return true;
  const t = tagsOf(e);
  return S.whats.some((v) => (v === 'other' ? t.length === 0 : t.includes(v)));
}
/** Toggle v in a pick list, keeping the menu's order; picking every option is the same as picking none. */
function togglePickIn(list, v, order) {
  const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const sorted = order.filter((o) => next.includes(o));
  return sorted.length === order.length ? [] : sorted;
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
const EXPLORE_FALLBACK = [['indoor_play', 'Indoor Playgrounds'], ['playgrounds', 'Public Playgrounds'], ['art', 'Music & Art'], ['science', 'Science'], ['nature', 'Animals & Nature'], ['history', 'History'], ['trains_planes', 'Vehicles'], ['gymnastics', 'Sports'], ['eateries', 'Eateries'], ['holidays', 'Holidays', true]].map(([id, label, soon]) => ({ id, label, soon }));
// "More to explore" icons: [mosaic tile shape, color] per config/vocab.json explore id.
const EXPLORE_LOOK = { indoor_play: ['d', '#E4559B'], playgrounds: ['a', '#F2A93B'], art: ['b', '#B05CD6'], science: ['c', '#3B6FE0'], nature: ['a', '#2E9E6B'], farms: ['d', '#7A9A2E'], history: ['c', '#C9773B'], trains_planes: ['b', '#F0614F'], gymnastics: ['d', '#1FA5B8'], eateries: ['c', '#F2B705'], holidays: ['sparkle', '#8E97A3'] };
const lookOf = (id) => EXPLORE_LOOK[id] || ['b', '#5B5F6B'];
const LOC_KEY = 'lilOutings.loc'; // remembered per browser: daily visitors usually look near home

let DATA, GEO;
let DEFAULT_WHEN = 'today'; // what the day menu opened on (tomorrow in the evening)
const INK = '#16181D'; // headline underline once a menu is changed from its default (owner); gray until then
let MAP = 'loading'; // 'loading' | true (real basemap) | false (illustrative fallback)
let mapItems = [];
let mapSel = null;
const S = { expanded: new Set() /* event ids whose description is opened */, whats: [], when: 'today', ages: [], open: null /* 'what' | 'age' | 'when' | 'loc' */, loc: null /* null | {region} | {district} | {place} */, locOpen: null /* region expanded in the menu */, explore: 'indoor_play', showN: 24, sel: null, showMap: false };

function loadLoc() {
  try {
    const v = JSON.parse(localStorage.getItem(LOC_KEY) || 'null');
    if (v?.region && regionById(v.region)) return { region: v.region };
    if (v?.district && districtById(v.district)) return { district: v.district };
    if (v?.place && districtOfPlace(v.place)) return { place: v.place };
    if (Array.isArray(v?.picks)) { const ok = v.picks.filter((x) => (x.district && districtById(x.district)) || (x.place && districtOfPlace(x.place))); if (ok.length) return ok.length === 1 ? ok[0] : { picks: ok }; }
  } catch { /* storage blocked: start with anywhere */ }
  return null;
}
const AGE_IDS = AGE_GROUPS.slice(1).map((a) => a[0]);
function loadAges() {
  try {
    const raw = localStorage.getItem(AGE_KEY);
    const v = raw && raw.startsWith('[') ? JSON.parse(raw) : [raw]; // older visits stored one group as a plain string
    return AGE_IDS.filter((id) => v.includes(id));
  } catch { return []; }
}
function saveAges() { try { localStorage.setItem(AGE_KEY, JSON.stringify(S.ages)); } catch { /* not critical */ } }
const pickedAges = () => S.ages.map((v) => AGE_GROUPS.find((a) => a[0] === v)).filter(Boolean);
// Several groups: each starts with a capital ("Toddler + Preschooler", owner Nov 2026).
const agePhrase = (caps = true) => (S.ages.length ? joinList(pickedAges().map((g) => (caps ? g[1].charAt(0).toUpperCase() + g[1].slice(1) : g[1]))) : AGE_GROUPS[0][1]);
/** Does an event fit the picked age groups? Any overlap with any picked group; listings without ages always fit. */
function fitsAge(e) {
  if (!S.ages.length || e.age_min == null || e.age_max == null) return true;
  return pickedAges().some((g) => e.age_min <= g[4][1] && e.age_max >= g[4][0]);
}
// First visit: a little "Click me" bubble on the first menu phrase, gone for good once any headline menu is opened (owner, Nov 2026).
const HINT_KEY = 'lilOutings.menuHint';
function hintSeen() { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } }
function markHintSeen() { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* not critical */ } }
const hintText = () => (matchMedia('(hover: none)').matches ? 'Tap me!' : 'Click me!');
function saveLoc() { try { localStorage.setItem(LOC_KEY, JSON.stringify(S.loc)); } catch { /* not critical */ } }
// Geography (config/geo.json): regions ("a quick drive from home") > districts > named towns/neighborhoods.
const regionById = (id) => GEO.regions.find((r) => r.id === id);
const districtById = (id) => GEO.districts.find((d) => d.id === id);
const districtOfPlace = (name) => GEO.districts.find((d) => d.places.some((p) => p.name === name));
const districtOfLoc = (loc) => (loc?.picks ? districtOfLoc(loc.picks[0]) : loc?.district ? districtById(loc.district) : loc?.place ? districtOfPlace(loc.place) : null);
/** The region to show expanded for a choice (Tigard sits in two; the first wins). */
const regionOfLoc = (loc) => (loc?.region ? regionById(loc.region) : GEO.regions.find((r) => r.districts.includes(districtOfLoc(loc)?.id)) || null);
/** Districts and towns picked in the Narrow step: several can be on at once (owner, Nov 2026). */
const picksOf = (loc) => (loc?.picks ? loc.picks : loc?.district || loc?.place ? [loc] : []);
const samePick = (a, b) => (a.district && a.district === b.district) || (a.place && a.place === b.place);
const pickName = (p) => (p.district ? districtById(p.district).name : p.place);
/** Turn one district/town on or off; the menu stays open so more can be picked. None left: the region whose list is open. */
function togglePick(pick) {
  const cur = picksOf(S.loc);
  const next = cur.some((x) => samePick(x, pick)) ? cur.filter((x) => !samePick(x, pick)) : [...cur, pick];
  S.loc = next.length === 0 ? (S.locOpen ? { region: S.locOpen } : null) : next.length === 1 ? next[0] : { picks: next };
  const scroll = $('.locmenu')?.scrollTop ?? 0; // phones: the menu is a scrolling sheet; keep its place between taps
  S.sel = null; S.showN = 24; saveLoc(); renderHeadline(); renderToday(); renderMore();
  if ($('.locmenu')) $('.locmenu').scrollTop = scroll;
  $(`.locmenu [data-loc${pick.district ? 'district' : 'place'}="${CSS.escape(pick.district || pick.place)}"]`)?.focus({ preventScroll: true });
}
/** The words after "in": Portland (anywhere), a region, a district, or a town. */
const locPhrase = (loc) => {
  if (!loc) return 'Portland';
  if (loc.region) return regionById(loc.region).short;
  const n = picksOf(loc).map(pickName);
  // "+" joins picks: area names already contain "&" (Beaverton & Cedar Mill)
  return n.length <= 2 ? n.join(' + ') : n.length === 3 ? `${n[0]}, ${n[1]} + ${n[2]}` : `${n[0]}, ${n[1]} + ${n.length - 2} more`;
};
/** One step wider: town -> its district -> its region -> anywhere. */
const widerLoc = (loc) => (loc?.picks ? { region: regionOfLoc(loc).id } : loc?.place ? { district: districtOfLoc(loc).id } : loc?.district ? { region: regionOfLoc(loc).id } : null);

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
/** Thanksgiving: the fourth Thursday of November, as YYYY-MM-DD. */
function thanksgiving(year) {
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return `${year}-11-${String(1 + ((4 - firstDow + 7) % 7) + 21).padStart(2, '0')}`;
}
const rangeHas = (when, day) => { const [a, b] = whenRange(when, NOW().date); return a <= day && day <= b; };
// A little autumn leaf tile for the Thanksgiving week option (the site's mosaic tile shape, in fall colors).
const LEAF = '<svg class="leafic" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 12A9 9 0 0 1 12 3h9v9a9 9 0 0 1-9 9H3z" fill="#E8772E"/><path d="M12 3h9v9z" fill="#C8452F"/><path d="M3 21l9-9" stroke="#FBF8F3" stroke-width="1.6" stroke-linecap="round"/><circle cx="17" cy="16" r="2.2" fill="#F2B705"/></svg>';
function rangeLabel(when) {
  if (when === 'upcoming') return 'From today on';
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
  // Holidays (owner, Nov 2026): glimmery silver. A brushed-silver disc whose highlight band sweeps across every few seconds,
  // a white four-point star, and gold sparkles that twinkle (CSS, .tw; owner: keep them gold). No sweep with reduced motion.
  const star = (x, y, r) => `M${x} ${y - r}Q${x + r * .18} ${y - r * .18} ${x + r} ${y}Q${x + r * .18} ${y + r * .18} ${x} ${y + r}Q${x - r * .18} ${y + r * .18} ${x - r} ${y}Q${x - r * .18} ${y - r * .18} ${x} ${y - r}z`;
  if (kind === 'sparkle') {
    const id = `ag${tile.n = (tile.n || 0) + 1}`;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sweep = still ? '' : `<animateTransform attributeName="gradientTransform" type="translate" values="-1.2 0;1.2 0;1.2 0" keyTimes="0;.45;1" dur="3.6s" repeatCount="indefinite"/>`;
    return `<svg class="sparkly" viewBox="0 0 120 120" width="${size}" height="${size}"><defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F6F8"/><stop offset=".35" stop-color="#B9C0C8"/><stop offset=".55" stop-color="#E3E7EB"/><stop offset=".8" stop-color="#8E97A3"/><stop offset="1" stop-color="#C9CFD6"/></linearGradient><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2=".35"><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/>${sweep}</linearGradient></defs><circle cx="60" cy="60" r="46" fill="url(#${id}b)"/><circle cx="60" cy="60" r="46" fill="url(#${id}g)"/><circle cx="60" cy="60" r="45.5" fill="none" stroke="#7E8794" stroke-opacity=".45"/><path d="${star(60, 60, 26)}" fill="#fff" stroke="#7E8794" stroke-opacity=".35" stroke-width="1.5"/><path class="tw" d="${star(101, 19, 15)}" fill="#F2B705"/><path class="tw t2" d="${star(20, 102, 11)}" fill="#F2B705"/><path class="tw t3" d="${star(104, 96, 8)}" fill="#F2B705"/></svg>`;
  }
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
  return `<div class="mapcard group"><div class="t">${esc(where)}${f.neighborhood ? ' · ' + esc(f.neighborhood) : ''}</div>
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
  return t.filter((k) => LABEL[k] && (k !== 'holidays' || holidaysLive()));
}
function tagChips(e) {
  const t = tagsOf(e);
  return t.length ? `<div class="tags">${t.map((k) => `<span class="tag" style="--c:${COLORS[k]};--t:${TEXT_COLORS[k] || COLORS[k]}">${esc(LABEL[k])}</span>`).join('')}</div>` : '';
}

/** Show "more" under descriptions that are cut off (two lines), and "less" under opened ones. */
function showMoreButtons() {
  for (const p of document.querySelectorAll('#today-inner .ev p.desc')) {
    const btn = p.nextElementSibling;
    if (btn?.dataset.more) btn.hidden = !(p.classList.contains('open') || p.scrollHeight > p.clientHeight + 2);
  }
}
addEventListener('resize', () => requestAnimationFrame(showMoreButtons));

/** "Repeats weekdays until Dec 17" for an event in a repeating series (markSeries in query.js); nothing on its last date. */
function repeatsLine(e) {
  const r = e.series; if (!r || e.date >= r.last) return '';
  const until = fmtDay(r.last, { month: 'short', day: 'numeric' });
  return `<div class="repeats">${r.pattern === 'daily' ? 'Repeats daily' : 'Repeats weekdays'} until ${esc(until)}</div>`;
}
function renderEvent(e, n) {
  const age = e.age_min != null ? (e.age_max >= 12 ? `Ages ${e.age_min}+` : `Ages ${e.age_min}–${e.age_max}`) : '';
  const cost = e.cost_type === 'free' ? '<span class="free">Free</span>' : e.cost_amount ? `$${e.cost_amount}` : e.cost_type === 'paid' ? 'Paid' : '';
  const reg = e.registration === 'drop_in' ? 'Drop-in' : e.registration === 'required' ? 'Registration required' : '';
  const desc = esc((e.description || '').replace(/https?:\/\/\S+/g, '').trim());
  const open = S.expanded.has(e.id);
  return `<article class="ev ${S.sel === e.id ? 'sel' : ''}" data-ev="${e.id}">
    <div class="time"><div class="num" style="background:${colorOf(e)};color:${onFill(colorOf(e))}">${n}</div><div class="big">${esc(e.start_min != null ? fmtMin(e.start_min).replace(' ', '') : 'All day')}</div>${e.end_min != null ? `<div class="small">to ${esc(fmtMin(e.end_min))}</div>` : ''}</div>
    <span class="bar4" style="background:${colorOf(e)}"></span>
    <div class="body">${tagChips(e)}
    <h3>${esc(e.title)}</h3><div class="where">${e.venue_name ? `<b>${esc(e.venue_name)}</b>` : 'Location on source page'}${e.neighborhood ? ' · ' + esc(e.neighborhood) : ''}${e.miles != null ? ` · ${e.miles.toFixed(1)} mi` : ''}</div>
    ${repeatsLine(e)}
    ${desc ? `<p class="desc ${open ? 'open' : ''}">${desc}</p><button class="more" type="button" data-more="${e.id}" aria-expanded="${open}" hidden>${open ? 'less' : 'more'}</button>` : ''}
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

/**
 * Chains (owner, Nov 2026): when several locations of one business (seed field `chain`, e.g. The Circuit, Sky Zone) match the
 * chosen area, show one card listing them instead of a card each. A lone match stays a normal card.
 */
function groupChains(items) {
  const out = [], byChain = new Map();
  for (const p of items) {
    if (!p.chain) { out.push(p); continue; }
    let g = byChain.get(p.chain);
    if (!g) { g = { chainGroup: true, name: p.chain, locs: [] }; byChain.set(p.chain, g); out.push(g); }
    g.locs.push(p);
  }
  return out.map((g) => (g.chainGroup && g.locs.length === 1 ? g.locs[0] : g));
}
function renderChain(g, catId) {
  const c = lookOf(catId)[1], f = g.locs[0];
  const label = (p) => p.name.replace(g.name, '').replace(/^[\s·–-]+/, '').trim() || p.neighborhood || p.address;
  const locs = g.locs.map((p) => `<li><b>${p.url && p.url !== f.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(label(p))} ↗</a>` : esc(label(p))}</b>${p.neighborhood && p.neighborhood !== label(p) ? ` · ${esc(p.neighborhood)}` : ''}<br><span class="addr">${esc(p.address || '')}</span>${p.alert ? `<br><span class="alert">${esc(p.alert)}</span>` : ''}</li>`).join('');
  return `<article class="place chain">${banner(f, catId)}<div class="kind">${dot(c)}${esc(f.kind || 'place')} · ${g.locs.length} locations</div><h3>${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(g.name)} ↗</a>` : esc(g.name)}</h3>${f.note ? `<p>${esc(f.note)}</p>` : ''}<ul class="locs">${locs}</ul><p style="font-size:14px">${f.cost === 'free' ? 'Free' : f.price ? esc(f.price) : f.cost === 'paid' ? 'Paid' : ''} · Ages ${f.age_min ?? 0}–${f.age_max ?? 12}${f.hours_text ? ' · ' + esc(f.hours_text) : ''}</p></article>`;
}
function renderPlace(p, catId) {
  if (p.chainGroup) return renderChain(p, catId);
  const c = lookOf(catId)[1];
  return `<article class="place">${banner(p, catId)}<div class="kind">${dot(c)}${esc(p.kind || 'place')}${p.neighborhood ? ' · ' + esc(p.neighborhood) : ''}${p.miles != null ? ` · ${p.miles.toFixed(1)} mi` : ''}</div><h3>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)} ↗</a>` : esc(p.name)}</h3>${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}${p.alert ? `<p class="alert">${esc(p.alert)}</p>` : ''}${p.note ? `<p>${esc(p.note)}</p>` : ''}<p style="font-size:14px">${p.cost === 'free' ? 'Free' : p.price ? esc(p.price) : p.cost === 'paid' ? 'Paid' : ''} · Ages ${p.age_min ?? 0}–${p.age_max ?? 12}${p.hours_text ? ' · ' + esc(p.hours_text) : ''}${p.verified ? '' : ' · from OpenStreetMap'}</p></article>`;
}

function renderProgram(p) {
  return `<article class="place">${banner(p, 'gymnastics')}<div class="kind">${dot(lookOf('gymnastics')[1])}${esc(p.age_label)} · ages ${p.age_min}–${p.age_max}</div><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p style="font-size:14px">${esc(p.location_text || '')}${p.region ? ` · ${esc(p.region)}` : ''}</p><p style="font-size:14px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="font-weight:600;text-decoration:underline">Check availability ↗</a>` : ''} <span class="src">via ${esc(p.source?.name || '')}</span></p></article>`;
}

/** "Something good to do with a small person [today ▾] in [SW ▾]": both underlined phrases are menus. */
/** The day menu's options for today (owner, Nov 2026). Fridays and Saturdays: no "This week". Sundays: the week is over, so
 *  "This week" becomes "Next week" (Mon-Fri) and "This weekend" becomes "Next weekend" (Sat-Sun); the full Next week option is hidden. */
function whenOptions() {
  const d = NOW().date;
  let opts = holidaysLive() ? WHEN : WHEN.filter((w) => w[0] !== 'upcoming'); // All upcoming days is a holiday-season option
  if (isFriday(d) || isSaturday(d)) opts = WHEN.filter((w) => w[0] !== 'week'); // Fri: today ends the week; Sat: it's over
  else if (isSunday(d)) opts = WHEN.filter((w) => w[0] !== 'nextweek').map((w) => (w[0] === 'week' ? ['week', 'next week', 'Next week'] : w[0] === 'weekend' ? ['weekend', 'next weekend', 'Next weekend'] : w));
  // The week with Thanksgiving in it is "Thanksgiving week", with autumn colors (owner, Nov 2026).
  return opts.map((w) => (/week$/.test(w[0]) && rangeHas(w[0], thanksgiving(+d.slice(0, 4))) ? [w[0], 'Thanksgiving week', 'Thanksgiving week', 'autumn'] : w));
}
function renderHeadline() {
  applyTheme();
  const whens = whenOptions();
  if (!whens.some((w) => w[0] === S.when)) S.when = 'today';
  const cur = whens.find((w) => w[0] === S.when);
  const whenMenu = S.open === 'when' ? `<span class="whenmenu menu" role="menu">${whens.map(([v, , label, special]) => v === 'upcoming'
    ? `<button role="menuitemradio" aria-checked="${v === S.when}" class="${v === S.when ? 'on' : ''} upcomingitem"${holidayMode() ? '' : ' disabled aria-disabled="true"'} data-when="${v}"><span>${tile('sparkle', '#8E97A3', 14)}${label}</span><small>(Holidays only)</small></button>`
    : `<button role="menuitemradio" aria-checked="${v === S.when}" class="${v === S.when ? 'on' : ''}${special ? ` ${special}` : ''}" data-when="${v}"><span>${special === 'autumn' ? LEAF : ''}${label}</span><small>${esc(rangeLabel(v))}</small></button>`).join('')}</span>` : '';
  let locMenu = '';
  if (S.open === 'loc') {
    const isOn = (k, v) => (k === 'region' ? S.loc?.region === v : picksOf(S.loc).some((x) => x[k] === v));
    const rows = GEO.regions.map((r) => {
      const open = S.locOpen === r.id;
      const dists = r.districts.map(districtById);
      // Narrow step: districts and towns are toggles (the original pill look; several can be on), then Done.
      const tog = (cls, k, v, label) => `<button class="opt ${cls} ${isOn(k, v) ? 'on' : ''}" aria-pressed="${isOn(k, v)}" data-loc${k === 'district' ? 'district' : 'place'}="${esc(v)}">${esc(label)}</button>`;
      const detail = open ? `<span class="regdetail">${dists.map((d) => `<span class="dist">${tog('distbtn', 'district', d.id, d.name)}${d.places.map((p) => tog('town', 'place', p.name, p.name)).join('')}</span>`).join('')}<button class="btn-ink pickdone" data-locdone>Done</button></span>` : '';
      return `<span class="regrow ${open ? 'open' : ''}"><button class="reg ${isOn('region', r.id) ? 'on' : ''}" data-locregion="${r.id}"><b>${esc(r.name)}</b><small>${esc(dists.map((d) => d.name).join(' · '))}</small></button><button class="regmore" data-locexpand="${r.id}" aria-expanded="${open}" aria-label="${open ? 'Close' : 'Narrow down'} ${esc(r.name)}"><span class="lbl">${open ? 'Close' : 'Narrow'} </span><span aria-hidden="true">${open ? '▴' : '▾'}</span></button>${detail}</span>`;
    }).join('');
    locMenu = `<span class="locmenu menu" role="dialog" aria-label="Choose where">
      <button class="opt any ${!S.loc ? 'on' : ''}" data-locany>Anywhere in Portland &amp; the metro</button>
      <span class="reglist">${rows}</span>
    </span>`;
  }
  // Interest and age menus are multi-select like the location's Narrow step (owner, Nov 2026): tap to toggle, "All" clears, Done closes.
  const onAge = (v) => (v === 'all' ? !S.ages.length : S.ages.includes(v));
  const onWhat = (v) => (v === 'all' ? !S.whats.length : S.whats.includes(v));
  const done = '<button class="pickdone" data-menudone>Done</button>';
  // Holidays is announced but not live yet (owner, Nov 2026): a greyed-out row with the sparkle tile and "Coming soon".
  const HOLIDAYS_SOON = holidaySeason() === 'soon' ? `<button class="soonitem" disabled aria-disabled="true"><span>${tile('sparkle', '#8E97A3', 24)}Holidays</span><small>Coming soon</small></button>` : '';
  const hiddenWhat = holidaysLive() ? HIDDEN_WHAT : [...HIDDEN_WHAT, 'holidays'];
  const ageMenu = S.open === 'age' ? `<span class="whenmenu agemenu menu" role="menu">${AGE_GROUPS.map(([v, , label, hint]) => `<button role="menuitemcheckbox" aria-checked="${onAge(v)}" class="${onAge(v) ? 'on' : ''}" data-agegroup="${v}"><span>${label}</span><small>${hint}</small></button>`).join('')}${done}</span>` : '';
  const whatMenu = S.open === 'what' ? `<span class="whenmenu whatmenu menu" role="menu">${WHAT.filter((w) => !hiddenWhat.includes(w[0])).map(([v, , , label, tag]) => `<button role="menuitemcheckbox" aria-checked="${onWhat(v)}" class="${onWhat(v) ? 'on' : ''}${tag === 'holidays' ? ' festiveitem' : ''}" data-what="${v}"><span>${tag === 'holidays' ? tile('sparkle', '#8E97A3', 24) : tag ? `<i class="swatch" style="background:${COLORS[tag]}"></i>` : `<i class="swatch ${v}"></i>`}${label}</span></button>`).join('')}${HOLIDAYS_SOON}${done}</span>` : '';
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1); // each menu phrase starts with a capital (owner, Nov 2026)
  // look: null = default gray underline; 'mosaic' = chosen (the six-color strip); a color = one interest picked, underlined in its color.
  const trigger = (kind, text, open, look) => `<button class="whenbtn${look === 'mosaic' ? ' active' : look === 'autumn' || look === 'festive' ? ` active ${look}` : look ? ' solid' : ''}"${look && !['mosaic', 'autumn', 'festive'].includes(look) ? ` style="--ul:${look}"` : ''} data-menu="${kind}" aria-haspopup="${kind === 'loc' ? 'dialog' : 'menu'}" aria-expanded="${open}"><span class="whentext">${esc(cap(text))}</span><span class="caret" aria-hidden="true">▾</span></button>`;
  // The strip under chosen phrases: the six-color mosaic, or a themed one for every chosen phrase while a themed choice is on
  // (Thanksgiving week: fall colors; Holidays: silver and gold; owner, Nov 2026).
  const strip = holidayMode() || S.when === 'upcoming' ? 'festive' : cur[3] === 'autumn' ? 'autumn' : 'mosaic';
  const onPlaces = document.body.dataset.view === 'places'; // one location menu, shown under whichever headline is visible
  const locTrigger = `<span class="whenwrap">${trigger('loc', locPhrase(S.loc), S.open === 'loc', S.loc ? strip : null)}${onPlaces ? '' : locMenu}</span>`;
  $('#placeshead').innerHTML = `<span class="filler">Somewhere good to go in</span> <span class="whenwrap">${trigger('loc', locPhrase(S.loc), S.open === 'loc', S.loc ? strip : null)}${onPlaces ? locMenu : ''}</span>`;
  const wp = whatPhrase(), ws = pickedWhats();
  const whatLook = !ws.length ? null : ws.length > 1 ? strip : ws[0][0] === 'holidays' ? 'festive' : ws[0][4] ? COLORS[ws[0][4]] : INK; // one interest keeps its color (owner)
  const hint = S.hint && !S.open ? `<span class="menuhint" aria-hidden="true">${hintText()}</span>` : '';
  $('#headline').innerHTML = `<span class="whenwrap whatwrap">${hint}${trigger('what', wp.text, S.open === 'what', whatLook)}${whatMenu}</span> <span class="filler">${esc(wp.after)} with a</span> <span class="whenwrap">${trigger('age', agePhrase(), S.open === 'age', S.ages.length ? strip : null)}${ageMenu}</span> <span class="whenwrap">${trigger('when', cur[1], S.open === 'when', strip)}${whenMenu}</span> <span class="filler">in</span> ${locTrigger}`;
  // Keep an open menu on screen (the phrase can sit near either edge).
  const m = $(`${onPlaces ? '#placeshead' : '#headline'} .menu`);
  if (m && getComputedStyle(m).position === 'absolute') {
    const r = m.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    let shift = Math.min(0, vw - 16 - r.right); // pull left if it runs off the right edge
    if (r.left + shift < 16) shift = 16 - r.left; // but never off the left edge
    if (shift) m.style.left = `${shift}px`;
  }
}

/** After a tap in the interest or age menu: the menu stays open (multi-select) and keeps focus; elsewhere (e.g. "See all happenings" on an empty day) it's a one-off. */
function afterPick(t, kind, sel) {
  S.sel = null;
  if (kind === 'what') { if (holidayMode()) S.when = 'upcoming'; else if (S.when === 'upcoming') S.when = DEFAULT_WHEN; } // owner, Nov 2026
  const inMenu = !!t.closest('.menu');
  if (!inMenu) S.open = null;
  renderHeadline(); renderToday();
  if (inMenu) $(`#headline .whenmenu ${sel}`)?.focus({ preventScroll: true });
  else if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' });
}
function closeMenu() { if (S.open) { S.open = null; renderHeadline(); } }

/** The day's list, right under the headline, with the map beside it. */
function renderToday() {
  const c = ctx();
  const opts = { when: S.when, loc: S.loc, age: null }; // ages are filtered below (several groups can be picked)
  const multiDay = S.when === 'weekend' || S.when === 'week' || S.when === 'nextweek' || S.when === 'upcoming';
  // A repeating series shows once, on its soonest date in view, labeled "Repeats weekdays until Dec 17" (owner, Nov 2026).
  let events = filterEvents(DATA.events, opts, c).filter(fitsWhat).filter(fitsAge);
  if (multiDay) events = collapseSeries(events);
  const over = S.when === 'today' ? filterEvents(DATA.events, opts, { ...c, nowMin: null }).filter(fitsWhat).filter(fitsAge).length - events.length : 0;
  events.forEach((e, i) => { e._n = i + 1; });
  const bar = `<div class="todaybar"><span class="count">${events.length} ${events.length === 1 ? 'thing' : 'things'} to do</span><span class="muted">${esc(rangeLabel(S.when))}${over > 0 ? ` · ${over} earlier ${over === 1 ? 'one is' : 'ones are'} over` : ''}</span><button class="tog maptoggle ${S.showMap ? 'on' : ''}" data-showmap>${S.showMap ? 'Hide map' : 'Map'}</button></div>`;
  let body;
  if (!events.length) {
    const next = S.when === 'today' ? `<button class="btn-ink" data-when="tomorrow">See tomorrow</button>` : S.when === 'tomorrow' ? `<button class="btn-ink" data-when="weekend">See this weekend</button>` : '';
    const phrase = whenOptions().find((w) => w[0] === S.when)[1];
    const where = (S.whats.length ? ` under ${joinList(pickedWhats().map((w) => w[3]))}` : '') + (S.ages.length ? ` for a ${agePhrase(false)}` : '') + (S.loc ? ` in ${locPhrase(S.loc)}` : '');
    const msg = S.when === 'today' && over > 0 && !S.loc && !S.whats.length ? 'That’s everything for today.' : `No events listed${where} ${phrase}.`;
    const w = widerLoc(S.loc);
    const wider = w ? `<button class="btn-ink" ${w.district ? `data-locsetdistrict="${w.district}"` : `data-locregion="${w.region}"`}>See all of ${esc(locPhrase(w))}</button>` : S.loc ? `<button class="btn-ink" data-locany>See anywhere in Portland</button>` : '';
    const allAges = S.ages.length ? `<button class="${w || S.loc ? 'textbtn' : 'btn-ink'}" data-agegroup="all">See all ages</button>` : '';
    const allWhat = S.whats.length ? `<button class="${w || S.loc || S.ages.length ? 'textbtn' : 'btn-ink'}" data-what="all">See all happenings</button>` : '';
    // The next day is a dark button only when nothing else is offered; otherwise a text link (shown once).
    const nextBtn = wider || allAges || allWhat ? next.replace('btn-ink', 'textbtn') : next;
    body = `<div class="empty"><h3>${esc(msg)}</h3><div class="empty-actions">${wider}${allWhat}${allAges}${nextBtn}<a class="textbtn" href="#places" data-gokind="${S.whats.length === 1 ? INTEREST_KIND[S.whats[0]] || '' : ''}">Explore places instead</a></div></div>${missingEventCard()}`;
  } else {
    let list;
    if (multiDay) {
      const days = {}; events.forEach((e) => (days[e.date] ||= []).push(e));
      list = Object.entries(days).map(([d, es]) => `<div class="daytitle">${esc(dayLabel(d))}</div>${es.map((e) => renderEvent(e, e._n)).join('')}`).join('');
    } else list = events.map((e) => renderEvent(e, e._n)).join('');
    body = `<div class="split today-split ${S.showMap ? 'showmap' : ''}"><div class="list">${list}${missingEventCard()}</div><aside class="map">${mapHtml(events)}</aside></div>`;
  }
  $('#today-inner').innerHTML = bar + body;
  requestAnimationFrame(showMoreButtons);
  syncMap();
}

/** Below the fold: "More to explore" pills over the places directory (and PP&R class series under Classes).
 *  Independent of the headline's age / day / place choices (owner's call, Nov 2026). */
/** The Places tab: "Somewhere good to go in [Portland▾]" (the same location menu as Events), kinds of places listed on the
 *  left, the chosen kind's cards on the right (owner, Nov 2026). Public Playgrounds is left off the list for now. */
const HIDDEN_KINDS = ['playgrounds'];
function renderMore() {
  applyTheme();
  const c = ctx();
  // Holidays places follow the holiday season: "Soon" before launch, hidden out of season (holidaySeason).
  const season = holidaySeason();
  const pills = (DATA.meta.vocab?.explore || EXPLORE_FALLBACK).filter((x) => !HIDDEN_KINDS.includes(x.id) && !(x.id === 'holidays' && season === 'off'))
    .map((x) => (x.id === 'holidays' ? { ...x, soon: season === 'soon' } : x));
  const placesFor = (id) => filterPlaces(DATA.places, { explore: id, loc: S.loc }, c);
  // Under Sports (id 'gymnastics'; owner renamed it Nov 2026): the PP&R class series for sports and movement.
  const programs = filterPrograms(DATA.programs || [], { loc: S.loc }, c).filter((p) => /gymnast|tumbl|vault|acrobat|soccer|basketball|baseball|t-?ball|softball|lacrosse|hockey|skateboard|ollie|martial|karate|ninja|obstacle|sport/i.test(`${p.name} ${p.description || ''} ${p.title || ''}`));
  const count = (id) => groupChains(placesFor(id)).length + (id === 'gymnastics' ? programs.length : 0);
  const cur = pills.find((x) => x.id === S.explore) || pills[0];
  const items = groupChains(placesFor(cur.id));
  const shown = items.slice(0, S.showN);
  // Last card in each kind (owner, Nov 2026): a blank "Missing a spot?" card asking for suggestions, from parents or businesses.
  const missing = items.length === shown.length ? missingCard(cur) : '';
  let body = items.length ? `<div class="places">${shown.map((p) => renderPlace(p, cur.id)).join('')}${missing}</div>` : '';
  if (items.length > shown.length) body += `<button class="textbtn more-btn" data-showmore>Show ${Math.min(24, items.length - shown.length)} more of ${items.length - shown.length}</button>`;
  if (cur.id === 'gymnastics' && programs.length) body += `<h3 class="subhead">Portland Parks &amp; Recreation sports classes</h3><p class="notice" style="margin:4px 0 0">Dates, times and prices are in the registration system, so each card links there.</p><div class="places">${programs.map(renderProgram).join('')}</div>`;
  if (cur.soon) body = `<div class="soon">${tile(lookOf(cur.id)[0], lookOf(cur.id)[1], 64)}<p>Coming soon</p><button class="btn-ink subcta" type="button" data-subscribe="holidays">Tell me when it’s live</button></div>`;
  else if (!items.length && !(cur.id === 'gymnastics' && programs.length)) body = `<div class="empty"><h3>Nothing under ${esc(cur.label)}${S.loc ? ` in ${esc(locPhrase(S.loc))}` : ''} yet.</h3>${S.loc ? '<div class="empty-actions"><button class="btn-ink" data-locany>See anywhere in Portland</button></div>' : ''}</div>`;
  $('#results-inner').innerHTML = `<div class="placesgrid">
    <div class="explore-list" role="group" aria-label="Kinds of places">${pills.map((x) => { const [k, col] = lookOf(x.id), on = x.id === cur.id; return `<button class="${on ? 'on' : ''}" style="--c:${col}" data-explore="${x.id}" aria-pressed="${on}"><span class="ic">${tile(k, col, 34)}</span><span class="nm">${esc(x.label)}</span><span class="n">${x.soon ? 'Soon' : count(x.id)}</span><span class="arr" aria-hidden="true">→</span></button>`; }).join('')}</div>
    <div id="explore-results"><h3 class="explore-title"><span class="ic">${tile(lookOf(cur.id)[0], lookOf(cur.id)[1], 28)}</span>${esc(cur.label)}</h3>${cur.hint ? `<p class="explore-hint">${esc(cur.hint)}</p>` : ''}${body}</div>
  </div>`;
}

const CONTACT = 'hello@liloutings.com';
const mailto = (subject) => `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`;
function missingCard(cur) {
  const col = lookOf(cur.id)[1];
  return `<div class="place missing" style="--c:${col}"><div class="plus" aria-hidden="true"></div><h3>Missing a spot?</h3><p>Know a place that belongs here, or run one?</p><button class="btn-ink tellus" type="button" data-suggest="Place" data-category="${esc(cur.label)}" data-kind="${esc(cur.id)}">Tell us about it</button></div>`;
}

/** The Events list's last card (owner, Nov 2026), like the Places one: ask for missing events, from parents or hosts. */
function missingEventCard() {
  const one = S.whats.length === 1 ? S.whats[0] : null, col = one && COLORS[one] ? COLORS[one] : '#8A8E98';
  return `<div class="missing-ev" style="--c:${col}"><div class="plus" aria-hidden="true"></div><div class="txt"><h3>Missing an event?</h3><p>Know a kids’ event we should list, or hosting one?</p></div><button class="btn-ink tellus" type="button" data-suggest="Event" data-category="${one ? esc(pickedWhats()[0][3]) : ''}">Tell us about it</button></div>`;
}

function renderFoot() {
  const m = DATA.meta;
  const when = new Date(m.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' });
  // Short footer (owner, Nov 2026): no per-source list; the sources are in the README.
  $('#foot').innerHTML = `<p>Lil’ Outings gathers kids’ events from local libraries and parks &amp; rec calendars, updated every morning (last ${esc(when)}). Times and details can change, so check the event’s own page before you go.</p><p>We use Google Analytics to learn what’s helpful.</p><p class="partner">Run a kid-friendly business? <button class="textbtn" type="button" data-partner>Partner with us →</button></p>`;
  if (String(m.mode).startsWith('demo')) { const d = $('#demo'); d.hidden = false; d.textContent = 'Demo data: sample listings generated in the real feeds’ formats, not live Portland events. Run the refresh with network access for real data.'; }
}

/** Google Analytics event (no-op on local previews, where the tag isn't loaded). Names: see README > Analytics. */
const track = (name, params = {}) => { try { window.gtag?.('event', name, params); } catch {} };

// "Explore places instead" on an empty day opens the Places kind that matches the chosen interest (owner, Nov 2026).
// Storytime has no kind of its own: Indoor Playgrounds (owner). All / Other open the Places tab as it was.
const INTEREST_KIND = { holidays: 'holidays', books: 'indoor_play', art: 'art', science: 'science', nature: 'nature', trains: 'trains_planes', play: 'indoor_play' };
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-gokind]'); if (!a || !a.dataset.gokind) return;
  S.explore = a.dataset.gokind; S.showN = 24; renderMore(); // the link's #places hash then switches the tab
});

function setWhen(v) { track('choose_day', { day: v }); S.when = v; S.open = null; S.sel = null; renderHeadline(); renderToday(); }
function setLoc(loc) { track('choose_area', { area: loc ? loc.region || loc.district || loc.place : 'anywhere' }); S.loc = loc; S.open = null; S.sel = null; S.showN = 24; saveLoc(); renderHeadline(); renderToday(); renderMore(); }


/**
 * "Portland, OR metro" pill: ask visitors elsewhere which city they want next, then (optionally) their email.
 * Turned back on (owner, Nov 2026). Answers go to the forms Google Sheet (FORMS_ENDPOINT, "Cities" tab) unless
 * SIGNUP_ENDPOINT names another service.
 */
const SIGNUP_ENDPOINT = '';

// "Partner with us" (owner, Nov 2026): footer link opens a short pitch, then a form; "Missing a spot/event?" cards open
// the suggestion form. Both POST to a Google Apps Script web app that adds a row to the owner's Sheet
// (docs/forms-apps-script.gs). With no FORMS_ENDPOINT, Send opens an email to hello@ with the answers instead.
const FORMS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxFaat8cJMdCbY5WrtfdQRWBU9D-NQCidv_BghP2N-jucUbE0UONSe1fX18Ce5VBlTfEg/exec';
function formStep(d, name) {
  for (const el of d.querySelectorAll('.step')) el.hidden = el.dataset.step !== name;
  d.querySelector('.scroll').scrollTop = 0;
  d.querySelector(`[data-step="${name}"] input:not([type=radio]):not(.hp)`)?.focus();
}
function openForm(d, step) {
  for (const f of d.querySelectorAll('form')) f.reset();
  d.querySelector('.err')?.remove(); d.classList.remove('joined');
  d.showModal(); formStep(d, step);
}
function syncSuggestType(form) {
  const place = form.type.value === 'Place';
  form.querySelector('[data-detailslabel]').textContent = place ? 'Where is it?' : 'Where and when';
  form.name.placeholder = place ? 'e.g. a play cafe, farm, or museum' : 'e.g. a storytime, festival, or class';
  form.details.placeholder = place ? 'Neighborhood or address' : 'e.g. Sat Dec 6, 10am, Sellwood Park';
}
const formFields = (form) => {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = out[k] ? `${out[k]}, ${v}` : String(v).trim();
  return out;
};
async function sendForm(kind, fields) {
  if (fields.website2) return 'sent'; // honeypot
  if (!FORMS_ENDPOINT) {
    const labels = kind === 'partner' ? { business: 'Business', name: 'Name', email: 'Email', website: 'Website', interest: 'Interested in', message: 'Message' }
      : { type: 'Event or place', category: 'Category', name: 'Name', link: 'Link', details: 'Where & when', note: 'Note', email: 'My email' };
    const body = Object.entries(labels).filter(([k]) => fields[k]).map(([k, l]) => `${l}: ${fields[k]}`).join('\n');
    location.href = `${mailto(kind === 'partner' ? 'Partnering with Lil’ Outings' : `${fields.type || 'Event or place'} suggestion`)}&body=${encodeURIComponent(body)}`;
    return 'mail';
  }
  // Apps Script answers through a redirect without CORS headers, so the reply can't be read: a network error is the only failure we see.
  await fetch(FORMS_ENDPOINT, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ form: kind, ...fields, page: location.href }) });
  return 'sent';
}
document.addEventListener('change', (ev) => { const f = ev.target.closest('form[data-form="suggest"]'); if (f && ev.target.name === 'type') syncSuggestType(f); });
document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('form[data-form="suggest"], form[data-form="partner"]');
  if (!form) return;
  ev.preventDefault();
  const kind = form.dataset.form, d = form.closest('dialog'), btn = form.querySelector('button[type=submit]');
  btn.disabled = true; d.querySelector('.err')?.remove();
  try {
    const fields = formFields(form);
    const how = await sendForm(kind, fields);
    track(kind === 'partner' ? 'partner_enquiry' : 'suggest', kind === 'partner' ? { interest: fields.interest || '' } : { type: fields.type || '', kind: d.dataset.kind || '' });
    d.querySelector('[data-donemsg]').textContent = how === 'mail' ? 'Your email app should open with your answers filled in. Just hit send.'
      : kind === 'partner' ? 'We’ll be in touch soon.' : 'We’ll take a look and add it if it fits.';
    d.classList.add('joined'); formStep(d, 'done');
  } catch { form.insertAdjacentHTML('afterend', '<p class="err">Sorry, that didn’t go through. Please try again, or email hello@liloutings.com.</p>'); }
  finally { btn.disabled = false; }
});
document.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-contact]');
  if (c) { track('contact', { from: c.dataset.contact, kind: c.dataset.kind || '' }); return; }
  const fd = ev.target.closest('dialog.formdlg');
  if (ev.target.closest('[data-formclose]')) { fd.close(); return; }
  // A click outside closes only the "Thank you!" step (owner, Nov 2026): on a form it's too easy to lose a half-typed answer.
  if (fd && ev.target === fd && !fd.querySelector('[data-step="done"]').hidden) { const r = fd.getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) fd.close(); return; }
  const ps = ev.target.closest('[data-partnerstep]');
  if (ps) { formStep($('#partner'), ps.dataset.partnerstep); track('open_partner_form'); return; }
  const sg = ev.target.closest('[data-suggest]');
  if (sg) {
    const d = $('#suggest'); openForm(d, 'form');
    const form = d.querySelector('form'); form.type.value = sg.dataset.suggest; form.category.value = sg.dataset.category || ''; d.dataset.kind = sg.dataset.kind || '';
    syncSuggestType(form); form.name.focus();
    track('open_suggest', { type: sg.dataset.suggest, kind: sg.dataset.kind || '' });
    return;
  }
  if (!ev.target.closest('[data-partner]')) return;
  // Only places in the kinds people can browse (Public Playgrounds are hidden), one per chain; rounded down ("160+").
  const places = groupChains(DATA.places.filter((p) => (p.explore || []).some((k) => !HIDDEN_KINDS.includes(k) && k !== 'holidays'))).length, events = (DATA.events || []).length;
  const n = (x) => { const r = x >= 1000 ? 100 : 10; return x >= r ? `${(Math.floor(x / r) * r).toLocaleString('en-US')}+` : String(x); };
  $('#partner-stats').innerHTML = `<b>${n(places)}</b> places · <b>${n(events)}</b> upcoming events`;
  openForm($('#partner'), 'pitch'); track('open_partner');
});
async function sendSignup(fields) {
  // Same Google Apps Script as the suggestion/partner forms (FORMS_ENDPOINT, docs/forms-apps-script.gs): "Cities" tab.
  const url = SIGNUP_ENDPOINT || FORMS_ENDPOINT;
  if (!url) { console.warn('Lil\' Outings: no endpoint set; not sent', fields); return; }
  await fetch(url, { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ form: 'city', ...fields, page: location.href }) });
}
/**
 * "Get updates" (owner, Nov 2026): newsletter sign-up for new activities, new places and the Holidays guide.
 * Emails go straight from the visitor's browser to Kit; this site never stores them.
 * 1) Kit's v3 API (form subscribe), which answers with JSON, so a rejected sign-up shows an error. The v3 *API key* only adds
 *    subscribers and is meant for public forms; the API *secret* (and v4 keys) must never go here.
 * 2) If v3 is gone (Kit calls it deprecated) or unreachable, the form's own endpoint, as Kit's embed script does; if the browser
 *    can't read that reply (no CORS), the request was still sent, so it counts as done.
 * Nov 2026: early sign-ups failed only because the owner's Kit account email wasn't confirmed yet.
 */
const KIT = { form: '10210670', apiKey: '-I6SGYHluuRtbULgL87EJg' }; // Kit form "Lil' Outings updates" (owner, Nov 2026)
document.body.classList.toggle('cansub', !!KIT.form);
class KitRejected extends Error {}
async function sendSubscribe(email) {
  if (KIT.apiKey) {
    try {
      const res = await fetch(`https://api.convertkit.com/v3/forms/${encodeURIComponent(KIT.form)}/subscribe`, {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify({ api_key: KIT.apiKey, email })
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.subscription) return;
      if (res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 410) throw new KitRejected(j.message || `HTTP ${res.status}`);
    } catch (err) { if (err instanceof KitRejected) throw err; } // network/CORS trouble or v3 retired: try the form endpoint
  }
  const body = new FormData(); body.append('email_address', email);
  let res;
  try { res = await fetch(`https://app.kit.com/forms/${encodeURIComponent(KIT.form)}/subscriptions`, { method: 'POST', body, headers: { accept: 'application/json' } }); }
  catch { if (!navigator.onLine) throw new Error('offline'); return; } // reply unreadable, but Kit got the request
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.status && j.status !== 'success')) throw new Error(j.errors?.messages?.[0] || j.message || `HTTP ${res.status}`);
}
/**
 * Holiday launch splash (owner, Nov 2026): once per visitor per season, the first visit after the guide goes live.
 * "See holiday events" picks the Holidays interest; "Explore holiday places" opens the Holidays kind on the Places tab.
 */
const holiDlg = () => $('#holisplash');
const holiKey = () => { const [y, m] = NOW().date.split('-').map(Number); return `lilOutings.holidaySplash.${m === 1 ? y - 1 : y}`; };
function maybeHolidaySplash() {
  if (!holidaysLive()) return;
  try { if (localStorage.getItem(holiKey()) === '1' && !/[?&]holidays=live/.test(location.search)) return; } catch { /* storage blocked: still show it once this visit */ }
  holiDlg().querySelector('.holitile').innerHTML = tile('sparkle', '#8E97A3', 88);
  holiDlg().showModal(); track('holiday_splash', { action: 'shown' });
}
function closeHoliday(action) {
  try { localStorage.setItem(holiKey(), '1'); } catch { /* not critical */ }
  holiDlg().close(); track('holiday_splash', { action });
}
document.addEventListener('click', (ev) => {
  const go = ev.target.closest('[data-holigo]');
  if (go) {
    closeHoliday(go.dataset.holigo);
    if (go.dataset.holigo === 'events') {
      S.whats = ['holidays']; S.sel = null;
      if (S.hint) { S.hint = false; markHintSeen(); } // they've used the menus now
      S.when = 'upcoming'; // every holiday event from today on (owner, Nov 2026)
      if (location.hash === '#places') location.hash = '#events';
      renderHeadline(); renderToday();
    }
    else { S.explore = 'holidays'; S.showN = 24; renderMore(); location.hash = '#places'; }
    return;
  }
  if (ev.target.closest('[data-holiclose]')) return closeHoliday('closed');
  if (ev.target === holiDlg()) { const r = holiDlg().getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) closeHoliday('closed'); }
});
holiDlg()?.addEventListener('cancel', () => { try { localStorage.setItem(holiKey(), '1'); } catch { /* not critical */ } }); // Esc

const subDlg = () => $('#subscribe');
function subStep(name) { for (const el of subDlg().querySelectorAll('.step')) el.hidden = el.dataset.step !== name; subDlg().querySelector(`[data-step="${name}"] input`)?.focus(); }
document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('#subscribe form');
  if (!form) return;
  ev.preventDefault();
  const btn = form.querySelector('button'); btn.disabled = true;
  form.parentNode.querySelector('.err')?.remove();
  try { await sendSubscribe(form.email.value.trim()); track('subscribe', { from: subDlg().dataset.from || 'header' }); subDlg().classList.add('joined'); subStep('done'); }
  catch { form.insertAdjacentHTML('afterend', '<p class="err">Sorry, that didn’t go through. Please try again.</p>'); }
  finally { btn.disabled = false; }
});
document.addEventListener('click', (ev) => {
  const open = ev.target.closest('[data-subscribe]');
  if (open) { const d = subDlg(); d.dataset.from = open.dataset.subscribe || 'header'; d.querySelector('form').reset(); d.querySelector('.err')?.remove(); d.classList.remove('joined'); d.showModal(); subStep('form'); track('open_subscribe', { from: d.dataset.from }); return; }
  if (ev.target.closest('[data-subclose]')) { subDlg().close(); return; }
  if (ev.target === subDlg()) { const r = subDlg().getBoundingClientRect(); if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) subDlg().close(); }
});

const cityDlg = () => $('#cityask');
function cityStep(name) { for (const el of cityDlg().querySelectorAll('.step')) el.hidden = el.dataset.step !== name; cityDlg().querySelector(`[data-step="${name}"] input`)?.focus(); }
let askedCity = '';
document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('#cityask form');
  if (!form) return;
  ev.preventDefault();
  const btn = form.querySelector('button'); btn.disabled = true;
  form.parentNode.querySelector('.err')?.remove();
  try {
    if (form.dataset.form === 'city') {
      askedCity = form.city.value.trim();
      await sendSignup({ step: 'city', city: askedCity });
      track('city_ask', { step: 'city' });
      cityDlg().querySelector('[data-cityname]').textContent = askedCity; // textContent: the visitor's words are never HTML
      cityStep('email');
    } else {
      await sendSignup({ step: 'email', city: askedCity, email: form.email.value.trim() });
      track('city_ask', { step: 'email' });
      cityStep('done');
    }
  } catch {
    form.insertAdjacentHTML('afterend', '<p class="err">Sorry, that didn’t go through. Please try again.</p>');
  } finally { btn.disabled = false; }
});

document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-cityask]')) { const d = cityDlg(); for (const f of d.querySelectorAll('form')) f.reset(); d.querySelector('.err')?.remove(); d.showModal(); cityStep('city'); return; }
  if (ev.target.closest('[data-cityclose]')) { cityDlg().close(); return; }
  if (ev.target === cityDlg()) { // the dimmed backdrop counts as the dialog itself: close only when the click is outside its box
    const r = cityDlg().getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) cityDlg().close();
    return;
  }
  // Any click outside the day menu closes it.
  if (S.open && !ev.target.closest('.whenwrap')) closeMenu();
  const t = ev.target.closest('button, a[data-nav]'); if (!t) return;
  const d = t.dataset;
  if (d.menu) {
    if (S.hint) { S.hint = false; markHintSeen(); }
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
  if (d.what) { track('choose_interest', { interest: d.what }); S.whats = d.what === 'all' ? [] : togglePickIn(S.whats, d.what, WHAT.slice(1).map((w) => w[0])); return afterPick(t, 'what', `[data-what="${d.what}"]`); }
  if (d.agegroup) { track('choose_age', { age: d.agegroup }); S.ages = d.agegroup === 'all' ? [] : togglePickIn(S.ages, d.agegroup, AGE_IDS); saveAges(); return afterPick(t, 'age', `[data-agegroup="${d.agegroup}"]`); }
  if (d.menudone !== undefined) { const k = S.open; closeMenu(); $(`[data-menu="${k}"]`)?.focus(); return; }
  if (d.locany !== undefined) return setLoc(null);
  if (d.locregion) return setLoc({ region: d.locregion });
  if (d.locsetdistrict) return setLoc({ district: d.locsetdistrict }); // "See all of <district>" on an empty day
  if (d.locdistrict) { track('choose_area', { area: d.locdistrict }); return togglePick({ district: d.locdistrict }); }
  if (d.locplace) { track('choose_area', { area: d.locplace }); return togglePick({ place: d.locplace }); }
  if (d.locdone !== undefined) { closeMenu(); return; }
  if (d.when) { setWhen(d.when); if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.showmap !== undefined) { S.showMap = !S.showMap; return renderToday(); }
  if (d.explore) {
    track('choose_place_kind', { kind: d.explore });
    S.explore = d.explore; S.showN = 24; renderMore();
    // Phones: the list of kinds is tall, so bring the cards into view.
    if (matchMedia('(max-width:700px)').matches) $('#explore-results').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (d.showmore !== undefined) { S.showN += 24; return renderMore(); }
  if (d.pin) { track('tap_map_pin'); S.sel = d.pin; renderToday(); return scrollToCard(d.pin); }
});
document.addEventListener('click', (ev) => {
  const m = ev.target.closest('[data-more]');
  if (!m) return;
  const id = m.dataset.more, p = m.previousElementSibling, open = !S.expanded.has(id);
  open ? S.expanded.add(id) : S.expanded.delete(id);
  p.classList.toggle('open', open); m.textContent = open ? 'less' : 'more'; m.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-ev]');
  if (!c || ev.target.closest('a, [data-more]')) return;
  const fromMap = !!c.closest('.map'); // a row in the map's card: bring its event into view in the list
  S.sel = c.dataset.ev; const y = scrollY; renderToday(); scrollTo(0, y);
  if (fromMap) scrollToCard(c.dataset.ev);
});
/** Picked on the map: scroll the list to that event's card (owner, Nov 2026). */
function scrollToCard(id) {
  // Phones: the map sits above the list, so jumping down to the card would pull the map away mid-use (owner, Nov 2026).
  if (matchMedia('(max-width:700px)').matches) return;
  // Wait two frames: the "more" buttons appear one frame after a render and change every card's height.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector(`#today-inner .list .ev[data-ev="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}
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
  if (DATA) { S.open = null; renderHeadline(); }
  if (v === 'events' && DATA) renderToday(); // the map needs a visible container to size itself
}
addEventListener('hashchange', () => { const v = viewFromHash(); if (v !== document.body.dataset.view) { track('switch_tab', { tab: v }); showView(v); scrollTo(0, 0); } });
// Links out: an event's Details page, a place's own website.
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[target="_blank"]'); if (!a) return;
  const card = a.closest('.ev, .place'); if (!card) return;
  const name = card.querySelector('h3')?.textContent.replace(/\s*↗\s*$/, '').trim().slice(0, 100);
  if (card.classList.contains('ev')) track('open_event_details', { event_title: name });
  else if (!a.closest('.credit')) track('open_place_site', { place_name: name, kind: S.explore });
});
showView(viewFromHash());

// Headline font loaded? Then tighten its (very wide) word spaces; see .pm in styles.css.
document.fonts?.load("1em 'Palette Mosaic'").then((f) => { if (f.length) document.documentElement.classList.add('pm'); }).catch(() => {});

initMap().then((ok) => { MAP = ok; if (DATA) renderToday(); });
load().then((d) => {
  DATA = d; GEO = d.geo;
  markSeries(DATA.events);
  S.loc = loadLoc();
  S.ages = loadAges();
  S.hint = !hintSeen();
  if (NOW().hour >= EVENING_HOUR) S.when = 'tomorrow';
  DEFAULT_WHEN = S.when;
  renderHeadline(); renderToday(); renderMore(); renderFoot();
  maybeHolidaySplash();
}).catch((e) => { $('#today-inner').innerHTML = `<p>Could not load data: ${esc(e.message)}. Run <code>npm run refresh:demo</code> then <code>npm run serve</code>.</p>`; });
