import { filterEvents, filterPlaces, filterPrograms, whenRange } from './query.js';
import { initMap, showPins } from './map.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { animals: '#F0614F', science: '#3B6FE0', trains: '#F2A93B', nature: '#2E9E6B', art: '#B05CD6', music: '#E4559B', dinosaurs: '#7A9A2E', books: '#1FA5B8' };
const INTERESTS = ['animals', 'science', 'trains', 'nature', 'art', 'music', 'dinosaurs', 'books'];
const LABEL = { animals: 'Animals', science: 'Science', trains: 'Trains', nature: 'Nature', art: 'Art', music: 'Music', dinosaurs: 'Dinosaurs', books: 'Books' };

// The headline's day picker. [value, phrase in the headline, menu label]
const WHEN = [['today', 'today', 'Today'], ['tomorrow', 'tomorrow', 'Tomorrow'], ['weekend', 'this weekend', 'This weekend'], ['week', 'this week', 'This week']];
// From this hour (Portland time) little kids are winding down for bed, so the page opens on tomorrow.
const EVENING_HOUR = 18;
const EXPLORE_FALLBACK = [['indoor_play', 'Indoor Playgrounds'], ['playgrounds', 'Public Playgrounds'], ['art', 'Art'], ['science', 'Science'], ['nature', 'Nature'], ['farms', 'Farms'], ['history', 'History'], ['trains_planes', 'Trains & Planes'], ['classes', 'Recurring Classes & Memberships']].map(([id, label]) => ({ id, label }));
const LOC_KEY = 'lilOutings.loc'; // remembered per browser: daily visitors usually look near home

let DATA, GEO;
let MAP = 'loading'; // 'loading' | true (real basemap) | false (illustrative fallback)
let mapItems = [];
let mapSel = null;
const S = { when: 'today', open: null /* 'when' | 'loc' */, loc: null /* null | {region} | {district} | {place} */, locOpen: null /* region expanded in the menu */, interest: 'all', explore: 'indoor_play', showN: 24, sel: null, showMap: false };

function loadLoc() {
  try {
    const v = JSON.parse(localStorage.getItem(LOC_KEY) || 'null');
    if (v?.region && regionById(v.region)) return { region: v.region };
    if (v?.district && districtById(v.district)) return { district: v.district };
    if (v?.place && districtOfPlace(v.place)) return { place: v.place };
  } catch { /* storage blocked: start with anywhere */ }
  return null;
}
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
const primary = (e) => (e.interests && e.interests[0]) || null;
const colorOf = (e) => COLORS[primary(e)] || '#5B5F6B';

function tile(kind, c, size = 120) {
  const shapes = {
    a: `<path d="M10 60A50 50 0 0 1 60 10h50v50A50 50 0 0 1 60 110H10z"/>`,
    b: `<circle cx="60" cy="60" r="50"/>`,
    c: `<path d="M10 10h50a50 50 0 0 1 50 50v50H10z"/>`,
    d: `<path d="M60 10a50 50 0 0 1 50 50 50 50 0 0 1-50 50H10V60A50 50 0 0 1 60 10z"/>`
  };
  return `<svg viewBox="0 0 120 120" width="${size}" height="${size}" fill="${c}">${shapes[kind]}<circle cx="60" cy="60" r="14" fill="#fff" opacity=".9"/></svg>`;
}

function renderThemes() {
  const kinds = ['a', 'b', 'c', 'd', 'c', 'a', 'd', 'b'];
  $('#tgrid').innerHTML = INTERESTS.map((k, i) => `<button data-int="${k}"><span style="width:32px;height:32px;flex:none">${tile(kinds[i], COLORS[k], 32)}</span><span class="nm">${LABEL[k]}</span><span>→</span></button>`).join('');
}

/** Items at the same spot (e.g. six storytimes at one branch) share one pin. */
function groupPins(items) {
  const m = new Map();
  for (const e of items) {
    const k = `${(+e.lat).toFixed(4)},${(+e.lon).toFixed(4)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  return [...m.values()].map((g, i) => ({ id: g[0].id, lat: g[0].lat, lon: g[0].lon, n: g[0]._n ?? i + 1, color: g[0]._c || colorOf(g[0]), count: g.length, items: g }));
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
    <ul>${shown.map((e) => `<li><button class="${S.sel === e.id ? 'on' : ''}" data-ev="${e.id}"><span class="n" style="background:${e._c || colorOf(e)}">${e._n ?? ''}</span><span class="w">${esc(e.start_min != null ? fmtMin(e.start_min) : '')}</span><span class="tt">${esc(e.title || e.name)}</span></button></li>`).join('')}</ul>
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

function renderEvent(e, n) {
  const cat = e.categories?.[0] ? e.categories[0].replace('_', ' + ') : '';
  const age = e.age_min != null ? (e.age_max >= 12 ? `Ages ${e.age_min}+` : `Ages ${e.age_min}–${e.age_max}`) : '';
  const cost = e.cost_type === 'free' ? '<span class="free">Free</span>' : e.cost_amount ? `$${e.cost_amount}` : e.cost_type === 'paid' ? 'Paid' : '';
  const reg = e.registration === 'drop_in' ? 'Drop-in' : e.registration === 'required' ? 'Registration required' : '';
  return `<article class="ev ${S.sel === e.id ? 'sel' : ''}" data-ev="${e.id}"><span class="bar4" style="background:${colorOf(e)}"></span>
    <div class="time"><div class="num" style="background:${colorOf(e)}">${n}</div><div class="big">${esc(e.start_min != null ? fmtMin(e.start_min).replace(' ', '') : 'All day')}</div>${e.end_min != null ? `<div class="small">to ${esc(fmtMin(e.end_min))}</div>` : ''}</div>
    <div class="body"><div class="kicker" style="color:${colorOf(e)}">${esc(primary(e) ? LABEL[primary(e)] : cat)}${cat && primary(e) ? ` <span style="color:var(--muted)">· ${esc(cat)}</span>` : ''}</div>
    <h3>${esc(e.title)}</h3><div class="where">${esc(e.venue_name || 'Location on source page')}${e.neighborhood ? ' · ' + esc(e.neighborhood) : ''}${e.miles != null ? ` · ${e.miles.toFixed(1)} mi` : ''}</div>
    <p>${esc((e.description || '').replace(/https?:\/\/\S+/g, '').trim())}</p>
    <div class="meta"><span>${esc(age)}</span>${cost}<span>${esc(reg)}</span>${srcLine(e)}${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">Details ↗</a>` : ''}</div></div></article>`;
}

function renderPlace(p) {
  const c = COLORS[p.interests?.[0]] || '#5B5F6B';
  return `<article class="place"><div class="kind">${dot(c)}${esc(p.kind || 'place')}${p.neighborhood ? ' · ' + esc(p.neighborhood) : ''}${p.miles != null ? ` · ${p.miles.toFixed(1)} mi` : ''}</div><h3>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)} ↗</a>` : esc(p.name)}</h3>${p.address ? `<p class="addr">${esc(p.address)}</p>` : ''}${p.note ? `<p>${esc(p.note)}</p>` : ''}<p style="font-size:14px">${p.cost === 'free' ? 'Free' : p.cost === 'paid' ? 'Paid' : ''} · Ages ${p.age_min ?? 0}–${p.age_max ?? 12}${p.hours_text ? ' · ' + esc(p.hours_text) : ''}${p.verified ? '' : ' · from OpenStreetMap'}</p></article>`;
}

function renderProgram(p) {
  return `<article class="place"><div class="kind">${dot('#3B6FE0')}${esc(p.age_label)} · ages ${p.age_min}–${p.age_max}</div><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p style="font-size:14px">${esc(p.location_text || '')}${p.region ? ` · ${esc(p.region)}` : ''}</p><p style="font-size:14px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="font-weight:600;text-decoration:underline">Check availability ↗</a>` : ''} <span class="src">via ${esc(p.source?.name || '')}</span></p></article>`;
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
  const trigger = (kind, text, open) => `<button class="whenbtn" data-menu="${kind}" aria-haspopup="${kind === 'when' ? 'menu' : 'dialog'}" aria-expanded="${open}"><span class="whentext">${esc(text)}</span><span class="caret" aria-hidden="true">▾</span></button>`;
  $('#headline').innerHTML = `Something good to do with a small person <span class="whenwrap">${trigger('when', cur[1], S.open === 'when')}${whenMenu}</span> in <span class="whenwrap">${trigger('loc', locPhrase(S.loc), S.open === 'loc')}${locMenu}</span>`;
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
  const opts = { when: S.when, interest: S.interest, loc: S.loc };
  const events = filterEvents(DATA.events, opts, c);
  const over = S.when === 'today' ? filterEvents(DATA.events, opts, { ...c, nowMin: null }).length - events.length : 0;
  events.forEach((e, i) => { e._n = i + 1; });
  const multiDay = S.when === 'weekend' || S.when === 'week';
  const intChip = S.interest !== 'all' ? `<button class="chip on" data-clearint>${dot(COLORS[S.interest])}${LABEL[S.interest]} <span aria-hidden="true">✕</span><span class="sr">Show all interests</span></button>` : '';
  const bar = `<div class="todaybar"><span class="count">${events.length} ${events.length === 1 ? 'thing' : 'things'} to do</span><span class="muted">${esc(rangeLabel(S.when))}${over > 0 ? ` · ${over} earlier ${over === 1 ? 'one is' : 'ones are'} over` : ''}</span>${intChip}<button class="tog maptoggle ${S.showMap ? 'on' : ''}" data-showmap>${S.showMap ? 'Hide map' : 'Map'}</button></div>`;
  let body;
  if (!events.length) {
    const next = S.when === 'today' ? `<button class="btn-ink" data-when="tomorrow">See tomorrow</button>` : S.when === 'tomorrow' ? `<button class="btn-ink" data-when="weekend">See this weekend</button>` : '';
    const phrase = WHEN.find((w) => w[0] === S.when)[1];
    const where = S.loc ? ` in ${locPhrase(S.loc)}` : '';
    const msg = S.interest !== 'all' ? `Nothing tagged ${LABEL[S.interest]}${where} ${phrase}.` : S.when === 'today' && over > 0 && !S.loc ? 'That’s everything for today.' : `Nothing listed${where} ${phrase}.`;
    const w = widerLoc(S.loc);
    const wider = w ? `<button class="btn-ink" ${w.district ? `data-locdistrict="${w.district}"` : `data-locregion="${w.region}"`}>See all of ${esc(locPhrase(w))}</button>` : S.loc ? `<button class="btn-ink" data-locany>See anywhere in Portland</button>` : next;
    body = `<div class="empty"><h3>${esc(msg)}</h3><div class="empty-actions">${wider}${S.loc ? next.replace('btn-ink', 'textbtn') : ''}</div></div>`;
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

/** Below the fold: "More to explore" pills over the places directory (and PP&R class series under Classes). */
function renderMore() {
  const c = ctx();
  const pills = DATA.meta.vocab?.explore || EXPLORE_FALLBACK;
  const placesFor = (id) => filterPlaces(DATA.places, { explore: id, loc: S.loc }, c);
  const programs = filterPrograms(DATA.programs || [], { loc: S.loc }, c);
  const count = (id) => placesFor(id).length + (id === 'classes' ? programs.length : 0);
  const cur = pills.find((x) => x.id === S.explore) || pills[0];
  const items = placesFor(cur.id);
  const where = S.loc ? ` in ${locPhrase(S.loc)}` : '';
  const shown = items.slice(0, S.showN);
  let body = items.length ? `<div class="places">${shown.map(renderPlace).join('')}</div>` : '';
  if (items.length > shown.length) body += `<button class="textbtn more-btn" data-showmore>Show ${Math.min(24, items.length - shown.length)} more of ${items.length - shown.length}</button>`;
  if (cur.id === 'classes' && programs.length) body += `<h3 class="subhead">Portland Parks &amp; Recreation class series</h3><p class="notice" style="margin:4px 0 0">Dates, times and prices are in the registration system, so each card links there.</p><div class="places">${programs.map(renderProgram).join('')}</div>`;
  if (!items.length && !(cur.id === 'classes' && programs.length)) body = `<div class="empty"><h3>Nothing under ${esc(cur.label)}${esc(where)} yet.</h3>${S.loc ? '<button class="btn-ink" data-locany>See anywhere in Portland</button>' : ''}</div>`;
  $('#results-inner').innerHTML = `<h2>More to explore${esc(where)}</h2>
    <div class="chips explore-pills" role="group" aria-label="Kinds of places">${pills.map((x) => { const n = count(x.id); return `<button class="chip ${x.id === cur.id ? 'on' : ''}" data-explore="${x.id}" aria-pressed="${x.id === cur.id}">${esc(x.label)}<span class="n">${n}</span></button>`; }).join('')}</div>
    <p class="explore-hint">${esc(cur.hint || '')}</p>${body}`;
}

function renderFoot() {
  const m = DATA.meta;
  const when = new Date(m.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' });
  $('#foot').innerHTML = `Data last refreshed ${esc(when)} (Pacific). Sources: ${m.sources.map((s) => `${esc(s.name)} <em>(${esc(s.status)}${s.ok ? '' : ', failed'})</em>`).join(', ')}. Always confirm details on the source page before you go.`;
  if (String(m.mode).startsWith('demo')) { const d = $('#demo'); d.hidden = false; d.textContent = 'Demo data: sample listings generated in the real feeds’ formats, not live Portland events. Run the refresh with network access for real data.'; }
}

function setWhen(v) { S.when = v; S.open = null; S.sel = null; renderHeadline(); renderToday(); }
function setLoc(loc) { S.loc = loc; S.open = null; S.sel = null; saveLoc(); renderHeadline(); renderToday(); renderMore(); }

document.addEventListener('click', (ev) => {
  // Any click outside the day menu closes it.
  if (S.open && !ev.target.closest('.whenwrap')) closeMenu();
  const t = ev.target.closest('button, a[data-nav]'); if (!t) return;
  const d = t.dataset;
  if (d.menu) {
    S.open = S.open === d.menu ? null : d.menu;
    if (S.open === 'loc') S.locOpen = S.loc && !S.loc.region ? regionOfLoc(S.loc)?.id || null : null;
    renderHeadline();
    if (S.open === 'when') $('.whenmenu [aria-checked="true"]')?.focus();
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
  if (d.locany !== undefined) return setLoc(null);
  if (d.locregion) return setLoc({ region: d.locregion });
  if (d.locdistrict) return setLoc({ district: d.locdistrict });
  if (d.locplace) return setLoc({ place: d.locplace });
  if (d.when) { setWhen(d.when); if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.nav === 'events') { ev.preventDefault(); $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.nav === 'places') { ev.preventDefault(); $('#more').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.int) { S.interest = d.int; S.sel = null; renderToday(); renderMore(); $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.clearint !== undefined) { S.interest = 'all'; renderToday(); renderMore(); return; }
  if (d.showmap !== undefined) { S.showMap = !S.showMap; return renderToday(); }
  if (d.explore) { S.explore = d.explore; S.showN = 24; return renderMore(); }
  if (d.showmore !== undefined) { S.showN += 24; return renderMore(); }
  if (d.pin) { S.sel = d.pin; return renderToday(); }
});
document.addEventListener('click', (ev) => { const c = ev.target.closest('[data-ev]'); if (c && !ev.target.closest('a')) { S.sel = c.dataset.ev; const y = scrollY; renderToday(); scrollTo(0, y); } });
document.addEventListener('keydown', (ev) => {
  if (!S.open) return;
  if (ev.key === 'Escape') { const k = S.open; closeMenu(); $(`[data-menu="${k}"]`)?.focus(); return; }
  if (S.open === 'when' && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
    const items = [...document.querySelectorAll('.whenmenu button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    ev.preventDefault();
  }
});

initMap().then((ok) => { MAP = ok; if (DATA) renderToday(); });
load().then((d) => {
  DATA = d; GEO = d.geo;
  S.loc = loadLoc();
  if (NOW().hour >= EVENING_HOUR) S.when = 'tomorrow';
  renderThemes(); renderHeadline(); renderToday(); renderMore(); renderFoot();
}).catch((e) => { $('#today-inner').innerHTML = `<p>Could not load data: ${esc(e.message)}. Run <code>npm run refresh:demo</code> then <code>npm run serve</code>.</p>`; });
