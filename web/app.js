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

let DATA, GEO;
let MAP = 'loading'; // 'loading' | true (real basemap) | false (illustrative fallback)
let mapItems = [];
let mapSel = null;
const S = { when: 'today', whenOpen: false, interest: 'all', tab: 'places', sel: null, showMap: false };

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
  return `<article class="place"><div class="kind">${dot(c)}${esc(p.kind || 'place')}${p.neighborhood ? ' · ' + esc(p.neighborhood) : ''}${p.miles != null ? ` · ${p.miles.toFixed(1)} mi` : ''}</div><h3>${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)} ↗</a>` : esc(p.name)}</h3>${p.note ? `<p>${esc(p.note)}</p>` : ''}<p style="font-size:14px">${p.cost === 'free' ? 'Free' : p.cost === 'paid' ? 'Paid' : ''} · Ages ${p.age_min ?? 0}–${p.age_max ?? 12}${p.hours_text ? ' · ' + esc(p.hours_text) : ''}${p.verified ? '' : ' · from OpenStreetMap'}</p></article>`;
}

function renderProgram(p) {
  return `<article class="place"><div class="kind">${dot('#3B6FE0')}${esc(p.age_label)} · ages ${p.age_min}–${p.age_max}</div><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}<p style="font-size:14px">${esc(p.location_text || '')}${p.region ? ` · ${esc(p.region)}` : ''}</p><p style="font-size:14px">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" style="font-weight:600;text-decoration:underline">Check availability ↗</a>` : ''} <span class="src">via ${esc(p.source?.name || '')}</span></p></article>`;
}

/** "Find something to do with your little one [today ▾]" — the underlined phrase picks the day. */
function renderHeadline() {
  const cur = WHEN.find((w) => w[0] === S.when);
  const menu = S.whenOpen ? `<span class="whenmenu" role="menu">${WHEN.map(([v, , label]) => `<button role="menuitemradio" aria-checked="${v === S.when}" class="${v === S.when ? 'on' : ''}" data-when="${v}"><span>${label}</span><small>${esc(rangeLabel(v))}</small></button>`).join('')}</span>` : '';
  $('#headline').innerHTML = `Find something to do with your little one <span class="whenwrap"><button class="whenbtn" data-whenmenu aria-haspopup="menu" aria-expanded="${S.whenOpen}"><span class="whentext">${esc(cur[1])}</span><span class="caret" aria-hidden="true">▾</span></button>${menu}</span>`;
}

/** The day's list, right under the headline, with the map beside it. */
function renderToday() {
  const c = ctx();
  const opts = { when: S.when, interest: S.interest };
  const events = filterEvents(DATA.events, opts, c);
  const over = S.when === 'today' ? filterEvents(DATA.events, opts, { ...c, nowMin: null }).length - events.length : 0;
  events.forEach((e, i) => { e._n = i + 1; });
  const multiDay = S.when === 'weekend' || S.when === 'week';
  const intChip = S.interest !== 'all' ? `<button class="chip on" data-clearint>${dot(COLORS[S.interest])}${LABEL[S.interest]} <span aria-hidden="true">✕</span><span class="sr">Show all interests</span></button>` : '';
  const bar = `<div class="todaybar"><span class="count">${events.length} ${events.length === 1 ? 'thing' : 'things'} to do</span><span class="muted">${esc(rangeLabel(S.when))}${over > 0 ? ` · ${over} earlier ${over === 1 ? 'one is' : 'ones are'} over` : ''}</span>${intChip}<button class="tog maptoggle ${S.showMap ? 'on' : ''}" data-showmap>${S.showMap ? 'Hide map' : 'Map'}</button></div>`;
  let body;
  if (!events.length) {
    const next = S.when === 'today' ? `<button class="btn-ink" data-when="tomorrow">See tomorrow</button>` : S.when === 'tomorrow' ? `<button class="btn-ink" data-when="weekend">See this weekend</button>` : '';
    const msg = S.interest !== 'all' ? `Nothing tagged ${LABEL[S.interest]} ${WHEN.find((w) => w[0] === S.when)[1]}. Try all interests.` : S.when === 'today' && over > 0 ? 'That’s everything for today.' : 'Nothing listed yet.';
    body = `<div class="empty"><h3>${esc(msg)}</h3>${next}</div>`;
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

/** Below the fold: classes and the places directory. */
function renderMore() {
  const c = ctx();
  const places = filterPlaces(DATA.places, { interest: S.interest }, c);
  const programs = filterPrograms(DATA.programs || [], {}, c);
  const body = S.tab === 'classes'
    ? (programs.length ? `<p class="notice" style="margin:16px 0 0">Ongoing class programs at Portland Parks & Recreation. Dates, times and prices are in the registration system, so each card links there.</p><div class="places">${programs.map(renderProgram).join('')}</div>` : `<div class="empty"><h3>No classes listed</h3></div>`)
    : (places.length ? `<div class="places" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${places.map(renderPlace).join('')}</div>` : `<div class="empty"><h3>No places match</h3></div>`);
  $('#results-inner').innerHTML = `<h2>More to explore</h2>
    <div class="tabs"><button class="tab ${S.tab === 'places' ? 'on' : ''}" data-tab="places">Places (${places.length})</button><button class="tab ${S.tab === 'classes' ? 'on' : ''}" data-tab="classes">Classes (${programs.length})</button></div>${body}`;
}

function renderFoot() {
  const m = DATA.meta;
  const when = new Date(m.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' });
  $('#foot').innerHTML = `Data last refreshed ${esc(when)} (Pacific). Sources: ${m.sources.map((s) => `${esc(s.name)} <em>(${esc(s.status)}${s.ok ? '' : ', failed'})</em>`).join(', ')}. Always confirm details on the source page before you go.`;
  if (String(m.mode).startsWith('demo')) { const d = $('#demo'); d.hidden = false; d.textContent = 'Demo data: sample listings generated in the real feeds’ formats, not live Portland events. Run the refresh with network access for real data.'; }
}

function setWhen(v) { S.when = v; S.whenOpen = false; S.sel = null; renderHeadline(); renderToday(); }

document.addEventListener('click', (ev) => {
  // Any click outside the day menu closes it.
  if (S.whenOpen && !ev.target.closest('.whenwrap')) { S.whenOpen = false; renderHeadline(); }
  const t = ev.target.closest('button, a[data-nav]'); if (!t) return;
  const d = t.dataset;
  if (d.whenmenu !== undefined) { S.whenOpen = !S.whenOpen; renderHeadline(); if (S.whenOpen) $('.whenmenu [aria-checked="true"]')?.focus(); return; }
  if (d.when) { setWhen(d.when); if (t.closest('.empty')) $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.nav === 'events') { ev.preventDefault(); $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.nav === 'places') { ev.preventDefault(); S.tab = 'places'; renderMore(); $('#more').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.int) { S.interest = d.int; S.sel = null; renderToday(); renderMore(); $('#today').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.clearint !== undefined) { S.interest = 'all'; renderToday(); renderMore(); return; }
  if (d.showmap !== undefined) { S.showMap = !S.showMap; return renderToday(); }
  if (d.tab) { S.tab = d.tab; return renderMore(); }
  if (d.pin) { S.sel = d.pin; return renderToday(); }
});
document.addEventListener('click', (ev) => { const c = ev.target.closest('[data-ev]'); if (c && !ev.target.closest('a')) { S.sel = c.dataset.ev; const y = scrollY; renderToday(); scrollTo(0, y); } });
document.addEventListener('keydown', (ev) => {
  if (!S.whenOpen) return;
  if (ev.key === 'Escape') { S.whenOpen = false; renderHeadline(); $('.whenbtn')?.focus(); return; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    const items = [...document.querySelectorAll('.whenmenu button')];
    const i = items.indexOf(document.activeElement);
    items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    ev.preventDefault();
  }
});

initMap().then((ok) => { MAP = ok; if (DATA) renderToday(); });
load().then((d) => {
  DATA = d; GEO = d.geo;
  if (NOW().hour >= EVENING_HOUR) S.when = 'tomorrow';
  renderThemes(); renderHeadline(); renderToday(); renderMore(); renderFoot();
}).catch((e) => { $('#today-inner').innerHTML = `<p>Could not load data: ${esc(e.message)}. Run <code>npm run refresh:demo</code> then <code>npm run serve</code>.</p>`; });
