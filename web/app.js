import { filterEvents, filterPlaces, filterPrograms, resolveLoc } from './query.js';
import { initMap, showPins } from './map.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { animals: '#F0614F', science: '#3B6FE0', trains: '#F2A93B', nature: '#2E9E6B', art: '#B05CD6', music: '#E4559B', dinosaurs: '#7A9A2E', books: '#1FA5B8' };
const INTERESTS = ['animals', 'science', 'trains', 'nature', 'art', 'music', 'dinosaurs', 'books'];
const LABEL = { animals: 'Animals', science: 'Science', trains: 'Trains', nature: 'Nature', art: 'Art', music: 'Music', dinosaurs: 'Dinosaurs', books: 'Books' };
const AGES = [{ id: 'baby', label: 'Babies', range: [0, 1] }, { id: 'toddler', label: 'Toddlers', range: [1, 3] }, { id: 'preschool', label: 'Preschool', range: [3, 5] }, { id: 'early', label: '6–8', range: [6, 8] }, { id: 'tween', label: '9–12', range: [9, 12] }];
const CATS = [['all', 'All'], ['storytime', 'Storytimes'], ['seasonal', 'Seasonal'], ['babies_toddlers', 'Babies + Toddlers'], ['outdoors', 'Outdoors']];
const AREA_NAMES = { NW: 'Northwest', N: 'North Portland', NE: 'Northeast', SW: 'Southwest', SE: 'Southeast' };
const when_opts = [['today', 'Today'], ['weekend', 'This weekend'], ['week', 'Next 7 days']];

let DATA, GEO;
let MAP = 'loading'; // 'loading' | true (real basemap) | false (illustrative fallback)
let mapItems = [];
let mapSel = null;
const S = { age: null, interest: 'all', category: 'all', when: 'week', loc: null, zipText: '', free: false, dropin: false, indoor: false, sort: 'soonest', tab: 'events', locOpen: false, quad: 'NE', sel: null };

async function load() {
  if (window.__DATA__) return window.__DATA__;
  const j = (p) => fetch(p).then((r) => r.json());
  const [events, places, programs, meta, geo] = await Promise.all([j('data/events.json'), j('data/places.json'), j('data/programs.json'), j('data/meta.json'), j('data/geo.json')]);
  return { events, places, programs, meta, geo };
}

const todayStr = () => DATA.meta.today || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const ctx = () => ({ today: todayStr(), geo: GEO });
const fmtMin = (m) => { if (m == null) return ''; const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const dayLabel = (d) => { const [y, m, dd] = d.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, dd)); const t = todayStr(); const base = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }); return d === t ? `Today · ${base}` : base; };
const opts = () => ({ age: S.age, interest: S.interest, category: S.category, when: S.when, loc: S.loc, free: S.free, dropin: S.dropin, indoor: S.indoor, sort: S.sort });
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

function renderHero() {
  const kinds = ['a', 'b', 'c', 'd', 'c', 'a', 'd', 'b'];
  $('#hero-art').innerHTML = INTERESTS.slice(0, 8).map((k, i) => `<div>${tile(kinds[i], COLORS[k], 92)}</div>`).join('');
  $('#tgrid').innerHTML = INTERESTS.map((k, i) => `<button data-int="${k}"><span style="width:32px;height:32px;flex:none">${tile(kinds[i], COLORS[k], 32)}</span><span class="nm">${LABEL[k]}</span><span>→</span></button>`).join('');
}

function locLabel() { const r = resolveLoc(S.loc, GEO); return r ? (r.unknown ? `${r.label} (not found)` : r.label) : 'Anywhere in the metro'; }

function renderFinder() {
  const ageChips = AGES.map((a) => `<button class="chip ${S.age && S.age[0] === a.range[0] ? 'on' : ''}" data-age="${a.id}">${a.label}</button>`).join('');
  const hoods = GEO.neighborhoods.filter((n) => n.area === S.quad);
  const pop = S.locOpen ? `<div class="pop">
      <label>ZIP code</label><input type="text" id="zip" inputmode="numeric" maxlength="5" placeholder="e.g. 97214" value="${esc(S.zipText)}">
      <div class="or">or pick an area</div>
      <div class="quads">${['NW', 'N', 'NE', 'SW', 'SE'].map((q) => `<button class="quad ${S.quad === q ? 'on' : ''}" data-quad="${q}"><b>${q}</b><small>${AREA_NAMES[q]}</small></button>`).join('')}</div>
      <div class="opts"><button class="opt ${S.loc?.area === S.quad ? 'on' : ''}" data-area="${S.quad}">All ${S.quad === 'N' ? 'North Portland' : S.quad}</button>${hoods.map((n) => `<button class="opt ${S.loc?.neighborhood === n.name ? 'on' : ''}" data-hood="${esc(n.name)}">${esc(n.name)}</button>`).join('')}</div>
      <div class="pop-foot"><button class="textbtn" data-clearloc>Clear</button><button class="btn-ink" data-done>Done</button></div></div>` : '';
  $('#finder').innerHTML = `
    <div><div class="q">How old is your little one?</div><div class="chips">${ageChips}</div></div>
    <div><div class="q">What are they into?</div><div class="chips">${INTERESTS.map((k) => `<button class="chip ${S.interest === k ? 'on' : ''}" data-int="${k}">${dot(COLORS[k])}${LABEL[k]}</button>`).join('')}</div></div>
    <div class="row-fields">
      <div class="field">When<select id="when">${when_opts.map(([v, l]) => `<option value="${v}" ${S.when === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field">Where<button class="fbtn" data-loc>${esc(locLabel())}<span>▾</span></button>${pop}</div>
      <button class="go" data-go>Show me</button>
    </div>`;
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

function renderResults() {
  const events = filterEvents(DATA.events, opts(), ctx());
  const places = filterPlaces(DATA.places, opts(), ctx());
  const programs = filterPrograms(DATA.programs || [], opts(), ctx());
  const whenL = when_opts.find((w) => w[0] === S.when)[1].toLowerCase();
  const ageL = S.age ? AGES.find((a) => a.range[0] === S.age[0])?.label : null;
  const heading = `${events.length} ${events.length === 1 ? 'thing' : 'things'} to do <em>${esc(S.when === 'week' ? 'this week' : whenL)}</em>${ageL ? ` for ${esc(ageL.toLowerCase())}` : ''}`;
  let body;
  if (S.tab === 'events') {
    if (!events.length) body = `<div class="empty"><h3>Nothing matches yet</h3><p style="color:var(--muted)">Try widening the day range, clearing an interest, or picking a larger area. ${places.length} places in the directory fit these filters.</p><button class="btn-ink" data-tab="places">See places</button></div>`;
    else {
      const days = {}; events.forEach((e) => (days[e.date] ||= []).push(e));
      let n = 0;
      events.forEach((e) => { e._n = ++n; });
      const list = Object.entries(days).map(([d, es]) => `<div class="daytitle">${esc(dayLabel(d))}</div>${es.map((e) => renderEvent(e, e._n)).join('')}`).join('');
      body = `<div class="split"><div class="list">${list}</div><aside class="map">${mapHtml(events)}</aside></div>`;
    }
  } else if (S.tab === 'classes') {
    body = programs.length ? `<p class="notice" style="margin:16px 0 0">Ongoing class programs at Portland Parks & Recreation. Dates, times and prices are in the registration system, so each card links there.</p><div class="places">${programs.map(renderProgram).join('')}</div>` : `<div class="empty"><h3>No classes match</h3><p style="color:var(--muted)">Try a different age or area.</p></div>`;
  } else {
    const pl = places.map((p, i) => ({ ...p, id: p.id, _n: i + 1, _c: COLORS[p.interests?.[0]] || '#5B5F6B' }));
    body = places.length ? `<div class="split"><div class="list"><div class="places" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${places.map(renderPlace).join('')}</div></div><aside class="map">${mapHtml(pl)}</aside></div>` : `<div class="empty"><h3>No places match</h3><p style="color:var(--muted)">Try clearing a filter.</p></div>`;
  }
  const tog = (k, l) => `<button class="tog ${S[k] ? 'on' : ''}" data-tog="${k}">${l}</button>`;
  $('#results-inner').innerHTML = `<h2>${S.tab === 'events' ? heading : S.tab === 'classes' ? `${programs.length} classes for kids` : `${places.length} places to visit`}</h2>
    <div class="tabs"><button class="tab ${S.tab === 'events' ? 'on' : ''}" data-tab="events">Events (${events.length})</button><button class="tab ${S.tab === 'classes' ? 'on' : ''}" data-tab="classes">Classes (${programs.length})</button><button class="tab ${S.tab === 'places' ? 'on' : ''}" data-tab="places">Places (${places.length})</button></div>
    <div class="chips" style="margin-bottom:14px">${CATS.map(([v, l]) => `<button class="chip ${S.category === v ? 'on' : ''}" data-cat="${v}">${l}</button>`).join('')}</div>
    <div class="bar">${tog('free', 'Free')}${tog('dropin', 'Drop-in')}${tog('indoor', 'Indoor')}</div>
    <div class="countbar"><span style="font-weight:600">${esc(locLabel())}</span>${S.tab === 'events' ? `<label style="font-weight:600;font-size:15px">Sort <select id="sort">${[['soonest', 'Soonest'], ['closest', 'Closest'], ['cheapest', 'Cheapest']].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}</div>${body}`;
  syncMap();
}

function renderFoot() {
  const m = DATA.meta;
  const when = new Date(m.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles' });
  $('#foot').innerHTML = `Data last refreshed ${esc(when)} (Pacific). Sources: ${m.sources.map((s) => `${esc(s.name)} <em>(${esc(s.status)}${s.ok ? '' : ', failed'})</em>`).join(', ')}. Always confirm details on the source page before you go.`;
  if (String(m.mode).startsWith('demo')) { const d = $('#demo'); d.hidden = false; d.textContent = 'Demo data: sample listings generated in the real feeds’ formats, not live Portland events. Run the refresh with network access for real data.'; }
}

function parseZip() {
  const z = S.zipText.trim();
  if (/^\d{5}$/.test(z)) S.loc = { zip: z };
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button, a[data-nav]'); if (!t) { return; }
  const d = t.dataset;
  if (d.nav) { S.tab = d.nav; return renderAll(); }
  if (d.age) { const a = AGES.find((x) => x.id === d.age); S.age = S.age && S.age[0] === a.range[0] ? null : a.range; return renderFinder(); }
  if (d.int) { S.interest = S.interest === d.int && t.closest('#finder') ? 'all' : d.int; renderAll(); if (t.closest('#tgrid')) $('#results').scrollIntoView({ behavior: 'smooth' }); return; }
  if (d.loc !== undefined) { S.locOpen = !S.locOpen; return renderFinder(); }
  if (d.quad) { S.quad = d.quad; return renderFinder(); }
  if (d.area) { S.loc = { area: d.area }; S.zipText = ''; return renderFinder(); }
  if (d.hood) { S.loc = { neighborhood: d.hood }; S.zipText = ''; return renderFinder(); }
  if (d.clearloc !== undefined) { S.loc = null; S.zipText = ''; return renderFinder(); }
  if (d.done !== undefined) { parseZip(); S.locOpen = false; return renderAll(); }
  if (d.go !== undefined) { parseZip(); S.locOpen = false; renderAll(); return $('#results').scrollIntoView({ behavior: 'smooth' }); }
  if (d.cat) { S.category = d.cat; return renderResults(); }
  if (d.tog) { S[d.tog] = !S[d.tog]; return renderResults(); }
  if (d.tab) { S.tab = d.tab; return renderResults(); }
  if (d.pin) { S.sel = d.pin; return renderResults(); }
});
document.addEventListener('click', (ev) => { const c = ev.target.closest('[data-ev]'); if (c && !ev.target.closest('a')) { S.sel = c.dataset.ev; const y = scrollY; renderResults(); scrollTo(0, y); } });
document.addEventListener('change', (ev) => { if (ev.target.id === 'when') { S.when = ev.target.value; renderAll(); } if (ev.target.id === 'sort') { S.sort = ev.target.value; renderResults(); } });
document.addEventListener('input', (ev) => { if (ev.target.id === 'zip') S.zipText = ev.target.value.replace(/\D/g, ''); });
document.addEventListener('keydown', (ev) => { if (ev.target.id === 'zip' && ev.key === 'Enter') { parseZip(); S.locOpen = false; renderAll(); } });

function renderAll() { renderFinder(); renderResults(); }

initMap().then((ok) => { MAP = ok; if (DATA) renderResults(); });
load().then((d) => { DATA = d; GEO = d.geo; renderHero(); renderAll(); renderFoot(); }).catch((e) => { $('#results-inner').innerHTML = `<p>Could not load data: ${esc(e.message)}. Run <code>npm run refresh:demo</code> then <code>npm run serve</code>.</p>`; });
