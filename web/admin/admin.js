// Lil' Outings admin dashboard (owner, Nov 2026). Reads the published JSON only:
//   ../data/{events,meta,geo,places}.json  (the site's data)
//   data/{runs,sources,review}.json        (written by the pipeline for this page; see src/runlog.js, scripts/build-site.js)
// Three views on the hash: #sources, #activity, #events.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Los_Angeles';
const fmt = (iso, o = { dateStyle: 'medium', timeStyle: 'short' }) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, ...o }) : '—');
const n = (x) => (x == null ? '—' : Number(x).toLocaleString('en-US'));
function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`;
}
const portlandToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (d, k) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The site's interest colors and labels (web/app.js).
const COLORS = { books: '#F2B705', art: '#B05CD6', nature: '#2E9E6B', science: '#3B6FE0', trains: '#F0614F', play: '#E4559B', holidays: '#9AA3AE' };
const LABEL = { books: 'Storytime', art: 'Music & Art', nature: 'Animals & Nature', science: 'Science', trains: 'Vehicles', play: 'Play', holidays: 'Holidays' };

let D; // all data

async function load() {
  const get = (p, fallback) => fetch(p, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  const [events, meta, geo, places, runs, sources, review, curated, classes] = await Promise.all([
    get('../data/events.json', []), get('../data/meta.json', {}), get('../data/geo.json', { regions: [], districts: [] }), get('../data/places.json', []),
    get('data/runs.json', []), get('data/sources.json', {}), get('data/review.json', []), get('data/curated.json', []), get('data/classes.json', [])
  ]);
  const regionOf = {};
  for (const r of geo.regions) for (const d of r.districts) regionOf[d] ??= r.id;
  return { events, meta, geo, places, runs, sources, review, curated, classes, regionOf, district: Object.fromEntries(geo.districts.map((d) => [d.id, d])), region: Object.fromEntries(geo.regions.map((r) => [r.id, r])) };
}

// ---------- source health ----------
// Event source categories (config/sources.json "category"; owner, Nov 2026).
const CATS = [['library', 'Libraries'], ['parks', 'Parks & Rec'], ['city', 'City websites'], ['attraction', 'Attractions & venues'], ['community', 'Community groups'], ['curated', 'Hand-entered']];
const catLabel = (c) => CATS.find((x) => x[0] === c)?.[1] || 'Other';
const catOfSource = (id) => (D.sources.events || []).find((s) => s.id === id)?.category || null;
const GROUPS = [['events', 'sources', 'Event sources'], ['classes', 'class_sources', 'Class sources (admin only for now)'], ['places', 'place_sources', 'Place sources'], ['programs', 'program_sources', 'Class series sources (hidden on the site)']];

/** Health of one source from its latest result and its history (newest first). */
export function health(cfg, latest, series) {
  if (cfg && cfg.enabled === false) return { cls: 'off', label: 'Off' };
  if (!latest) return { cls: 'off', label: 'Not run yet' };
  if (!latest.ok) return { cls: 'bad', label: 'Failed' };
  const count = latest.published ?? latest.fetched;
  if (!count) return { cls: 'warn', label: latest.fetched ? 'None published' : 'Nothing found' };
  const prev = series.slice(1, 8).filter((s) => s && s.ok).map((s) => s.published ?? s.fetched).filter((v) => v != null).sort((a, b) => a - b);
  const median = prev.length ? prev[Math.floor(prev.length / 2)] : null;
  if (median != null && median >= 6 && count < median * 0.5) return { cls: 'warn', label: `Dropped from ~${median}` };
  return { cls: 'ok', label: 'Healthy' };
}

function sparkline(values, w = 120, h = 26) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '<span class="note">—</span>';
  const max = Math.max(...v, 1), step = w / (values.length - 1);
  const pts = values.map((x, i) => (x == null ? null : `${(i * step).toFixed(1)},${(h - 3 - (x / max) * (h - 6)).toFixed(1)}`)).filter(Boolean);
  const last = pts[pts.length - 1].split(',');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="#3B6FE0" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="#3B6FE0"/></svg>`;
}

function sourceRows(group, key) {
  const cfgs = D.sources[group] || [];
  const latestList = D.meta[key] || [];
  const ids = [...new Set([...latestList.map((s) => s.id), ...cfgs.map((c) => c.id)])];
  return ids.map((id) => {
    const cfg = cfgs.find((c) => c.id === id) || null;
    const latest = latestList.find((s) => s.id === id) || null;
    const series = D.runs.map((r) => (r[key] || []).find((s) => s.id === id) || null);
    if (!D.runs.length) series.push(latest);
    const h = health(cfg, latest, series);
    const lastOk = D.runs.find((r) => (r[key] || []).some((s) => s.id === id && s.ok));
    const recent = series.slice(0, 14).filter(Boolean);
    return { id, cfg, latest, series, h, lastOk, okRate: recent.length ? `${recent.filter((s) => s.ok).length}/${recent.length}` : '—', name: latest?.name || cfg?.name || id };
  }).sort((a, b) => ({ bad: 0, warn: 1, ok: 2, off: 3 }[a.h.cls] - { bad: 0, warn: 1, ok: 2, off: 3 }[b.h.cls]) || a.name.localeCompare(b.name));
}

// ---------- curated (hand-entered) events ----------
// Each entry in config/events.seed.json, with its organizer page's check from every run (src/curated.js).
const PAGE = { ok: ['ok', 'Page OK'], blocked: ['warn', 'Blocks bots'], gone: ['bad', 'Page gone'], failed: ['bad', "Didn't load"], not_checked: ['off', 'Not checked'] };
const DATES = { upcoming: ['off', 'Upcoming'], running: ['ok', 'Running'], ending_soon: ['warn', 'Ends within a week'], ended: ['bad', 'Ended: renew or remove'], no_dates: ['bad', 'No dates'] };
const daysAgo = (iso) => (iso ? (Date.now() - new Date(iso)) / 864e5 : Infinity);
function curatedAttention(c) {
  const out = [];
  if (c.state === 'ended' || c.state === 'no_dates') out.push('dates');
  if (c.page && ['gone', 'failed'].includes(c.page.status)) out.push('page');
  if (c.page && daysAgo(c.page.changed_at) <= 7) out.push('changed');
  if (c.state === 'ending_soon') out.push('ending');
  if (c.state !== 'ended' && c.state !== 'upcoming' && c.published === 0) out.push('none');
  return out;
}
function renderCurated() {
  const list = [...(D.curated || [])];
  if (!list.length) return '';
  const rank = (c) => { const a = curatedAttention(c); return a.includes('page') || a.includes('dates') ? 0 : a.includes('changed') ? 1 : a.length ? 2 : 3; };
  list.sort((a, b) => rank(a) - rank(b) || String(a.first).localeCompare(String(b.first)));
  const checks = (id) => { const h = D.runs.map((r) => (r.curated || []).find((x) => x.id === id)).filter((x) => x && x.page && x.page !== 'not_checked').slice(0, 14); return h.length ? `${h.filter((x) => x.page === 'ok').length}/${h.length}` : '—'; };
  const short = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '?');
  const need = list.filter((c) => curatedAttention(c).length).length;
  return `<h2>Curated events <small class="note">(${list.length} hand-entered in config/events.seed.json${need ? `, ${need} to look at` : ''})</small></h2>
  <p class="note">These come from organizers' pages no feed covers. Every run visits each page: <b>Page changed</b> usually means new dates or times to copy over; <b>Ended</b> entries need renewing for next season or removing.</p>
  <div class="tablewrap"><table><thead><tr><th>Entry</th><th>Dates</th><th class="n">On site</th><th>Organizer page</th><th>Page changed</th><th class="n">Checks OK (14)</th></tr></thead><tbody>${list.map((c) => {
    const [dc, dl] = DATES[c.state] || ['off', c.state];
    const [pc, pl] = c.page ? PAGE[c.page.status] || ['off', c.page.status] : ['off', 'No page'];
    const recent = daysAgo(c.page?.changed_at) <= 7;
    return `<tr><td><b>${esc(c.title)}</b><span class="sub">${esc(c.venue || '')}</span></td>
      <td><span class="chip ${dc}">${esc(dl)}</span><span class="sub">${esc(short(c.first))}${c.last !== c.first ? ` – ${esc(short(c.last))}` : ''} · ${n(c.upcoming)} date${c.upcoming === 1 ? '' : 's'} left</span></td>
      <td class="n">${n(c.published)}</td>
      <td><span class="chip ${pc}">${esc(pl)}</span>${c.url ? `<span class="sub"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.host || c.url)}</a></span>` : ''}${c.page?.error && !c.page.ok ? `<span class="sub" style="color:var(--bad)">${esc(c.page.error)}</span>` : ''}</td>
      <td>${c.page?.changed_at ? `${recent ? '<span class="chip warn">Changed: review</span>' : ''}<span class="sub">${esc(fmt(c.page.changed_at, { month: 'short', day: 'numeric' }))} (${esc(ago(c.page.changed_at))})</span>` : `<span class="note">${c.page?.last_ok_at ? `No change since ${esc(fmt(c.page.first_seen_at, { month: 'short', day: 'numeric' }))}` : '—'}</span>`}</td>
      <td class="n">${checks(c.id)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderSources() {
  const all = GROUPS.flatMap(([g, k]) => sourceRows(g, k));
  const c = (cls) => all.filter((r) => r.h.cls === cls).length;
  const lastRun = D.runs[0];
  let html = `<h1>Sources</h1><p class="lede">Every source the pipeline reads, how its last run went, and how many events it put on the site. Problems sort to the top.</p>
  <div class="tiles">
    <div class="tile"><b>${c('ok')}</b><small>healthy</small></div>
    <div class="tile ${c('bad') ? 'bad' : ''}"><b>${c('bad')}</b><small>failed last run</small></div>
    <div class="tile ${c('warn') ? 'warn' : ''}"><b>${c('warn')}</b><small>empty or dropped</small></div>
    <div class="tile"><b>${c('off')}</b><small>turned off</small></div>
    <div class="tile ${(D.curated || []).some((c) => curatedAttention(c).length) ? 'warn' : ''}"><b>${(D.curated || []).filter((c) => curatedAttention(c).length).length}</b><small>curated entries to look at</small></div>
    <div class="tile"><b>${n(D.meta.counts?.kid_events)}</b><small>events on the site</small></div>
  </div>
  <p class="note">Last run ${esc(fmt(D.meta.generated_at))} (${esc(ago(D.meta.generated_at))})${lastRun?.run_url ? ` · <a href="${esc(lastRun.run_url)}" target="_blank" rel="noopener">log on GitHub ↗</a>` : ''} · runs daily around 4:20am and after every push.</p>`;
  for (const [g, k, title] of GROUPS) {
    const rows = sourceRows(g, k);
    if (!rows.length) continue;
    const isEv = g === 'events';
    const cols = isEv ? 8 : 7;
    const row = (r) => {
      const vals = r.series.slice(0, 30).reverse().map((s) => (s && s.ok ? (isEv ? s.published ?? s.fetched : s.fetched) : s ? 0 : null));
      if (r.cfg?.type === 'manual' && D.curated?.length) r.cfg = { ...r.cfg, status: `${D.curated.length} hand-entered entries, listed below` };
      const note = r.latest && !r.latest.ok ? `<td class="err">${esc(r.latest.error)}</td>` : `<td class="note">${esc(r.cfg?.status || '')}${r.cfg?.type ? ` · ${esc(r.cfg.type)}` : ''}</td>`;
      return `<tr><td><b>${esc(r.name)}</b>${r.cfg?.homepage ? `<span class="sub"><a href="${esc(r.cfg.homepage)}" target="_blank" rel="noopener">${esc(r.cfg.homepage.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48))}</a></span>` : ''}</td>
        <td><span class="chip ${r.h.cls}">${esc(r.h.label)}</span></td>
        <td class="n">${n(r.latest?.fetched)}</td>${isEv ? `<td class="n">${n(r.latest?.published)}</td>` : ''}
        <td>${sparkline(vals)}</td><td class="n">${r.okRate}</td>
        <td>${r.lastOk ? `${esc(fmt(r.lastOk.at, { month: 'short', day: 'numeric' }))}<span class="sub">${esc(ago(r.lastOk.at))}</span>` : r.latest?.ok ? esc(fmt(D.meta.generated_at, { month: 'short', day: 'numeric' })) : '—'}</td>${note}</tr>`;
    };
    // Event sources are grouped by category, each with its own count and events on the site.
    const body = !isEv ? rows.map(row).join('') : [...CATS, ['_other', 'Other']].map(([c, label]) => {
      const rs = rows.filter((r) => (r.cfg?.category || '_other') === c);
      if (!rs.length) return '';
      const on = rs.reduce((a, r) => a + (r.latest?.published || 0), 0);
      const bad = rs.filter((r) => r.h.cls === 'bad').length;
      return `<tr class="group"><td colspan="${cols}">${esc(label)} · ${rs.length} source${rs.length === 1 ? '' : 's'} · ${n(on)} events on site${bad ? ` · <span style="color:var(--bad)">${bad} failed</span>` : ''}</td></tr>${rs.map(row).join('')}`;
    }).join('');
    html += `<h2>${esc(title)}</h2><div class="tablewrap"><table><thead><tr><th>Source</th><th>Status</th><th class="n">Found</th>${isEv ? '<th class="n">On site</th>' : ''}<th>Last ${Math.min(30, Math.max(D.runs.length, 1))} runs</th><th class="n">OK (14)</th><th>Last success</th><th>Note</th></tr></thead><tbody>${body}</tbody></table></div>`;
    if (g === 'events') html += renderCurated();
  }
  if (!D.runs.length) html += `<p class="note">The run history starts with the next pipeline run, so trends and success rates fill in from there.</p>`;
  $('#tab-sources').innerHTML = html;
}

// ---------- activity ----------
const TRIGGER = { schedule: 'Daily', push: 'Push', workflow_dispatch: 'Manual', local: 'Local' };
function renderActivity() {
  const runs = D.runs.length ? D.runs : [{ at: D.meta.generated_at, mode: D.meta.mode, counts: D.meta.counts, sources: D.meta.sources || [], place_sources: D.meta.place_sources || [], program_sources: D.meta.program_sources || [], trigger: null }];
  const latest = runs[0].counts || {};
  const drop = latest.dropped || {};
  let html = `<h1>Activity</h1><p class="lede">Each pipeline run, newest first: what it fetched, what made it to the site, and any source that failed. Open a run for its per-source detail and changes since the run before.</p>
  <h3>Latest run, from raw listings to the site</h3>
  <div class="funnel"><span><b>${n(latest.raw)}</b> listings fetched</span><i>→</i><span><b>${n(latest.normalized)}</b> dated, in range</span><i>→</i><span><b>${n(latest.after_dedupe)}</b> after duplicates merged</span><i>→</i><span><b>${n(latest.kid_events)}</b> kids' events published</span></div>
  <p class="note">Set aside: ${n(drop.past_or_far)} past or 60+ days out, ${n(drop.invalid)} without a usable date, ${n(drop.out_of_area)} out of area, ${n(latest.dropped_not_for_kids)} not for kids. ${n(latest.needs_review)} published events are flagged for review (low tagging confidence).</p>
  <h2>Runs <small class="note">(${runs.length}${D.runs.length ? ', kept for about a year' : ''})</small></h2>`;
  html += runs.map((r, i) => {
    const prev = runs[i + 1];
    const all = [...(r.sources || []), ...(r.place_sources || []), ...(r.program_sources || [])];
    const failed = all.filter((s) => !s.ok);
    const prevOf = (id) => prev && [...(prev.sources || []), ...(prev.place_sources || []), ...(prev.program_sources || [])].find((s) => s.id === id);
    const delta = (cur, old) => { if (cur == null || old == null) return ''; const d = cur - old; return d ? `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${n(d)}</span>` : ''; };
    const evDelta = prev ? delta(r.counts?.kid_events, prev.counts?.kid_events) : '';
    return `<details class="run" ${i === 0 ? 'open' : ''}><summary>
      <span class="when"><b>${esc(fmt(r.at))}</b><small>${esc(ago(r.at))}${r.duration_ms ? ` · ${Math.round(r.duration_ms / 60000) || '<1'} min` : ''}</small></span>
      <span>${r.trigger ? `<span class="tag">${esc(TRIGGER[r.trigger] || r.trigger)}</span>` : ''}</span>
      <span class="hide-sm num">${n(r.counts?.kid_events)} events ${evDelta}</span>
      <span>${failed.length ? `<span class="chip bad">${failed.length} failed</span>` : '<span class="chip ok">All sources OK</span>'}</span>
      <span class="hide-sm">${r.run_url ? `<a href="${esc(r.run_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">GitHub ↗</a>` : ''}</span>
    </summary><div class="body"><div class="tablewrap"><table><thead><tr><th>Source</th><th>Result</th><th class="n">Found</th><th class="n">On site</th><th class="n">Change</th><th class="n">Time</th></tr></thead><tbody>${all.map((s) => {
      const p = prevOf(s.id);
      return `<tr><td>${esc(s.name)}</td><td>${s.ok ? '<span class="chip ok">OK</span>' : `<span class="chip bad">Failed</span><span class="sub" style="color:var(--bad)">${esc(s.error)}</span>`}</td><td class="n">${n(s.fetched)}</td><td class="n">${n(s.published)}</td><td class="n">${delta(s.published ?? s.fetched, p ? p.published ?? p.fetched : null)}</td><td class="n">${s.ms ? `${(s.ms / 1000).toFixed(s.ms < 10000 ? 1 : 0)}s` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>${r.curated?.length ? (() => { const cu = r.curated; const by = (k) => cu.filter((c) => c.page === k).length; const ch = cu.filter((c) => c.changed); return `<p class="note"><b>Curated pages:</b> ${by('ok')} OK${by('blocked') ? `, ${by('blocked')} blocking bots` : ''}${by('gone') + by('failed') ? `, <span style="color:var(--bad)">${by('gone') + by('failed')} unreachable</span>` : ''}${by('not_checked') ? `, ${by('not_checked')} not checked` : ''}${ch.length ? `. Changed this run: ${ch.map((c) => esc(c.title)).join(', ')}` : ''}.</p>`; })() : ''}${r.commit ? `<p class="note">Commit ${esc(r.commit)} · ${esc(r.mode || '')}</p>` : ''}</div></details>`;
  }).join('');
  if (!D.runs.length) html += `<p class="note">Only the latest run is shown: the log starts recording with the next run.</p>`;
  $('#tab-activity').innerHTML = html;
}

// ---------- events & coverage ----------
const F = { q: '', days: '30', region: '', district: '', interest: '', srctype: '', source: '', age: '', cost: '', review: false, dim: 'interest', shown: 100 };

const DIMS = {
  interest: { label: 'Interest', values: () => [...['books', 'art', 'science', 'nature', 'play', 'trains', 'holidays'].map((v) => [v, LABEL[v]]), ['_none', 'Other (no tag)']], /* the site's interests (vocab.json also lists old aliases) */ of: (e) => (e.interests?.length ? e.interests : ['_none']) },
  category: { label: 'Category', values: () => [...(D.meta.vocab?.categories || []).map((c) => (typeof c === 'string' ? [c, c] : [c.id, c.label || c.id])), ['_none', 'None']], of: (e) => (e.categories?.length ? e.categories : ['_none']) },
  age: { label: 'Age', values: () => (D.meta.vocab?.age_bands || []).map((a) => [a.id, a.label]), of: (e) => e.age_bands || [] },
  dow: { label: 'Day', values: () => DOW.map((d, i) => [String(i), d]), of: (e) => [String(dow(e.date))] },
  time: { label: 'Time of day', values: () => [['am', 'Morning'], ['pm', 'Afternoon'], ['eve', 'Evening'], ['all', 'All day']], of: (e) => [e.start_min == null ? 'all' : e.start_min < 720 ? 'am' : e.start_min < 1020 ? 'pm' : 'eve'] },
  cost: { label: 'Cost', values: () => [['free', 'Free'], ['paid', 'Paid'], ['unknown', 'Unknown']], of: (e) => [e.cost_type === 'free' ? 'free' : e.cost_type === 'paid' || e.cost_amount ? 'paid' : 'unknown'] }
};

function filtered() {
  const today = portlandToday(), end = addDays(today, Number(F.days) - 1), q = F.q.trim().toLowerCase();
  return D.events.filter((e) => e.date >= today && e.date <= end
    && (!F.region || D.regionOf[e.district] === F.region)
    && (!F.district || e.district === F.district)
    && (!F.interest || (F.interest === '_none' ? !e.interests?.length : e.interests?.includes(F.interest)))
    && (!F.srctype || catOfSource(e.source?.id) === F.srctype)
    && (!F.source || e.source?.id === F.source)
    && (!F.age || e.age_bands?.includes(F.age))
    && (!F.cost || DIMS.cost.of(e)[0] === F.cost)
    && (!F.review || e.needs_review)
    && (!q || `${e.title} ${e.venue_name || ''} ${e.neighborhood || ''} ${e.source?.name || ''} ${e.description || ''}`.toLowerCase().includes(q)));
}

function options(list, cur, all) { return `<option value="">${esc(all)}</option>${list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}`; }

function renderEventsShell() {
  const srcs = [...new Map(D.events.map((e) => [e.source?.id, e.source?.name])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const districts = F.region ? (D.region[F.region]?.districts || []).map((d) => [d, D.district[d]?.name || d]) : D.geo.districts.map((d) => [d.id, d.name]).sort((a, b) => a[1].localeCompare(b[1]));
  $('#tab-events').innerHTML = `<h1>Events &amp; coverage</h1><p class="lede">Upcoming events on the site, filtered any way you like, with coverage by area so the gaps show. Everything below follows the filters.</p>
  <form class="filters" id="filters" onsubmit="return false">
    <label class="search">Search<input id="f-q" type="search" placeholder="Title, venue, neighborhood, source…" value="${esc(F.q)}"></label>
    <label>Window<select id="f-days">${[['7', 'Next 7 days'], ['14', 'Next 14 days'], ['30', 'Next 30 days'], ['60', 'Next 60 days']].map(([v, l]) => `<option value="${v}" ${v === F.days ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Region<select id="f-region">${options(D.geo.regions.map((r) => [r.id, r.name]), F.region, 'All regions')}</select></label>
    <label>District<select id="f-district">${options(districts, F.district, 'All districts')}</select></label>
    <label>Interest<select id="f-interest">${options(DIMS.interest.values(), F.interest, 'All interests')}</select></label>
    <label>Age<select id="f-age">${options(DIMS.age.values(), F.age, 'All ages')}</select></label>
    <label>Cost<select id="f-cost">${options(DIMS.cost.values(), F.cost, 'Any cost')}</select></label>
    <label>Source type<select id="f-srctype">${options(CATS, F.srctype, 'All types')}</select></label>
    <label>Source<select id="f-source">${options(srcs.filter(([id]) => !F.srctype || catOfSource(id) === F.srctype), F.source, 'All sources')}</select></label>
    <label class="checks"><input id="f-review" type="checkbox" ${F.review ? 'checked' : ''}> Flagged for review only</label>
  </form>
  <div class="actions"><button type="button" id="f-reset">Clear filters</button><button type="button" id="f-csv">Download CSV</button><span class="note" id="f-count"></span></div>
  <div id="ev-body"></div>`;
}

function renderEventsBody() {
  const list = filtered();
  const days = Number(F.days), today = portlandToday();
  const free = list.filter((e) => DIMS.cost.of(e)[0] === 'free').length;
  const tagged = list.filter((e) => e.interests?.length).length;
  const pct = (x) => (list.length ? `${Math.round((x / list.length) * 100)}%` : '—');
  $('#f-count').textContent = `${list.length.toLocaleString('en-US')} events match`;

  // coverage matrix: regions > districts × the chosen dimension
  const dim = DIMS[F.dim], cols = dim.values();
  const count = {}, rowTot = {}, colTot = {};
  for (const e of list) {
    const d = e.district || '_unplaced';
    rowTot[d] = (rowTot[d] || 0) + 1;
    for (const v of dim.of(e)) { (count[d] ||= {})[v] = (count[d][v] || 0) + 1; colTot[v] = (colTot[v] || 0) + 1; }
  }
  const max = Math.max(1, ...Object.values(count).flatMap((r) => Object.values(r)));
  const shade = (v) => (v ? `background:color-mix(in srgb,#3B6FE0 ${Math.round(8 + (v / max) * 52)}%,#fff)${v / max > 0.55 ? ';color:#fff' : ''}` : '');
  const regionRows = D.geo.regions.filter((r) => !F.region || r.id === F.region).map((r) => {
    const ds = r.districts.filter((d) => !F.district || d === F.district);
    const rt = ds.reduce((a, d) => a + (rowTot[d] || 0), 0);
    const rcol = (v) => ds.reduce((a, d) => a + (count[d]?.[v] || 0), 0);
    return `<tr class="region"><td>${esc(r.name)}</td>${cols.map(([v]) => `<td>${rcol(v) || '·'}</td>`).join('')}<td class="tot">${rt}</td></tr>` + ds.map((d) => `<tr><td>${esc(D.district[d]?.name || d)}</td>${cols.map(([v]) => { const c = count[d]?.[v] || 0; return `<td class="cell ${c ? '' : 'zero'}" style="${shade(c)}">${c || '0'}</td>`; }).join('')}<td class="tot">${rowTot[d] || 0}</td></tr>`).join('');
  }).join('');
  const unplaced = rowTot._unplaced ? `<tr><td>No area (far out or no location)</td>${cols.map(([v]) => `<td>${count._unplaced?.[v] || 0}</td>`).join('')}<td class="tot">${rowTot._unplaced}</td></tr>` : '';

  // thin spots: districts with the fewest events per week in this view
  const perWeek = (d) => ((rowTot[d] || 0) / days) * 7;
  const dlist = D.geo.regions.filter((r) => !F.region || r.id === F.region).flatMap((r) => r.districts).filter((d, i, a) => a.indexOf(d) === i && (!F.district || d === F.district));
  const thin = dlist.map((d) => [d, perWeek(d)]).sort((a, b) => a[1] - b[1]).slice(0, 6);

  // per day
  const byDay = {}; for (const e of list) byDay[e.date] = (byDay[e.date] || 0) + 1;
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const dmax = Math.max(1, ...dates.map((d) => byDay[d] || 0));
  const W = 640, H = 150, bw = W / dates.length;
  const bars = dates.map((d, i) => { const v = byDay[d] || 0, h = (v / dmax) * (H - 30); const we = [0, 6].includes(dow(d)); return `<g><rect x="${(i * bw + 1).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${we ? '#B05CD6' : '#3B6FE0'}"><title>${d} (${DOW[dow(d)]}): ${v}</title></rect>${i % Math.ceil(dates.length / 8) === 0 ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" font-size="10" text-anchor="middle" fill="#5B5F6B">${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>` : ''}</g>`; }).join('');
  const dayChart = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Events per day"><line x1="0" x2="${W}" y1="${H - 18}" y2="${H - 18}" stroke="#E3DED5"/><text x="2" y="10" font-size="10" fill="#5B5F6B">${dmax}</text>${bars}</svg>`;

  // by source / by interest
  const bySrc = {}; for (const e of list) bySrc[e.source?.name || '?'] = (bySrc[e.source?.name || '?'] || 0) + 1;
  const barList = (obj, color = () => '#3B6FE0') => { const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]); const m = Math.max(1, ...ent.map((x) => x[1])); return `<div class="bars">${ent.map(([k, v]) => `<div class="barrow"><span class="lbl" title="${esc(k)}">${esc(k)}</span><span class="track"><span class="fill" style="width:${(v / m) * 100}%;background:${color(k)}"></span></span><span class="v">${v}</span></div>`).join('') || '<p class="note">No events.</p>'}</div>`; };
  const byInt = {}; for (const e of list) for (const v of DIMS.interest.of(e)) byInt[v] = (byInt[v] || 0) + 1;
  const intLabeled = Object.fromEntries(Object.entries(byInt).map(([k, v]) => [LABEL[k] || (k === '_none' ? 'Other (no tag)' : k), v]));
  const colorOfLabel = (l) => COLORS[Object.keys(LABEL).find((k) => LABEL[k] === l)] || '#9AA3AE';

  // table
  const rows = list.slice(0, F.shown).map((e) => `<tr><td class="num">${esc(new Date(`${e.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }))}<span class="sub">${e.start_min == null ? 'All day' : `${((Math.floor(e.start_min / 60) + 11) % 12) + 1}:${String(e.start_min % 60).padStart(2, '0')}${e.start_min < 720 ? 'am' : 'pm'}`}</span></td>
    <td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>` : esc(e.title)}${e.needs_review ? ' <span class="chip warn">review</span>' : ''}<span class="sub">${esc(e.venue_name || '')}</span></td>
    <td>${esc(D.district[e.district]?.name || '—')}<span class="sub">${esc(e.neighborhood || '')}</span></td>
    <td>${(e.interests || []).map((i) => `<span class="tag" style="background:color-mix(in srgb,${COLORS[i] || '#9AA3AE'} 22%,#fff)">${esc(LABEL[i] || i)}</span>`).join('') || '<span class="note">—</span>'}</td>
    <td class="num">${e.age_min ?? '?'}–${e.age_max ?? '?'}</td><td>${esc(DIMS.cost.of(e)[0])}</td><td class="note">${esc(e.source?.name || '')}</td></tr>`).join('');

  $('#ev-body').innerHTML = `
  <div class="tiles">
    <div class="tile"><b>${n(list.length)}</b><small>events in the next ${days} days</small></div>
    <div class="tile"><b>${(list.length / days).toFixed(1)}</b><small>per day on average</small></div>
    <div class="tile"><b>${pct(free)}</b><small>free</small></div>
    <div class="tile"><b>${pct(tagged)}</b><small>have an interest tag</small></div>
    <div class="tile ${list.filter((e) => e.needs_review).length ? 'warn' : ''}"><b>${n(list.filter((e) => e.needs_review).length)}</b><small>flagged for review</small></div>
  </div>
  <h2>Coverage by area</h2>
  <div class="card"><h3><span class="seg" role="group" aria-label="Break down by">${Object.entries(DIMS).map(([k, d]) => `<button type="button" data-dim="${k}" aria-pressed="${k === F.dim}">${esc(d.label)}</button>`).join('')}</span><small>Events per district; darker = more. An event with two tags counts in both columns.</small></h3>
    <div class="tablewrap" style="border:0"><table class="matrix"><thead><tr><th>Area</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${regionRows}${unplaced}<tr class="region"><td>All</td>${cols.map(([v]) => `<td>${colTot[v] || 0}</td>`).join('')}<td class="tot">${list.length}</td></tr></tbody></table></div></div>
  <div class="grid2" style="margin-top:20px">
    <div class="card days"><h3>Events per day <small>weekends in purple</small></h3>${dayChart}</div>
    <div class="card"><h3>Thinnest areas <small>events per week in this view</small></h3><ul class="gaps">${thin.map(([d, v]) => `<li><b>${esc(D.district[d]?.name || d)}</b> <span class="note">${esc(D.region[D.regionOf[d]]?.short || '')}</span>: ${v.toFixed(1)}/week</li>`).join('')}</ul><p class="note">Candidates for new sources or curated events.</p></div>
  </div>
  <div class="grid2" style="margin-top:20px">
    <div class="card"><h3>By source type</h3>${barList(Object.fromEntries(Object.entries(list.reduce((a, e) => { const c = catLabel(catOfSource(e.source?.id)); a[c] = (a[c] || 0) + 1; return a; }, {}))))}<h3 style="margin-top:16px">By source</h3>${barList(bySrc)}</div>
    <div class="card"><h3>By interest</h3>${barList(intLabeled, colorOfLabel)}</div>
  </div>
  <h2>Events <small class="note">${list.length > F.shown ? `first ${F.shown} of ${n(list.length)}` : `${n(list.length)}`}</small></h2>
  <div class="tablewrap"><table><thead><tr><th>When</th><th>Event</th><th>Area</th><th>Interests</th><th class="n">Ages</th><th>Cost</th><th>Source</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="note">No events match these filters.</td></tr>'}</tbody></table></div>
  ${list.length > F.shown ? '<div class="actions"><button type="button" id="f-more">Show 100 more</button></div>' : ''}`;
}

function csv(list) {
  const cols = ['date', 'start', 'title', 'venue', 'district', 'region', 'neighborhood', 'interests', 'categories', 'age_min', 'age_max', 'cost', 'source', 'source_type', 'needs_review', 'url'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = list.map((e) => [e.date, e.start_min == null ? '' : `${String(Math.floor(e.start_min / 60)).padStart(2, '0')}:${String(e.start_min % 60).padStart(2, '0')}`, e.title, e.venue_name, D.district[e.district]?.name, D.region[D.regionOf[e.district]]?.name, e.neighborhood, (e.interests || []).map((i) => LABEL[i] || i).join('; '), (e.categories || []).join('; '), e.age_min, e.age_max, DIMS.cost.of(e)[0], e.source?.name, catLabel(catOfSource(e.source?.id)), e.needs_review ? 'yes' : '', e.url].map(q).join(','));
  const blob = new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lil-outings-events-${portlandToday()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function wireEvents() {
  const panel = $('#tab-events');
  panel.addEventListener('input', (ev) => {
    const id = ev.target.id; if (!id?.startsWith('f-')) return;
    const k = id.slice(2);
    if (k === 'review') F.review = ev.target.checked; else F[k] = ev.target.value;
    F.shown = 100;
    if (k === 'region') { F.district = ''; renderEventsShell(); }
    if (k === 'srctype') { F.source = ''; renderEventsShell(); }
    renderEventsBody();
  });
  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.dim) { F.dim = b.dataset.dim; renderEventsBody(); }
    else if (b.id === 'f-more') { F.shown += 100; renderEventsBody(); }
    else if (b.id === 'f-reset') { Object.assign(F, { q: '', days: '30', region: '', district: '', interest: '', srctype: '', source: '', age: '', cost: '', review: false, shown: 100 }); renderEventsShell(); renderEventsBody(); }
    else if (b.id === 'f-csv') csv(filtered());
  });
}

// ---------- classes (sign-up classes from Parks & Rec registration systems; admin only for now) ----------
// Read from admin/data/classes.json (src/adapters/activenet.js). The site doesn't show these yet: this tab is for sizing
// them up before designing the public Classes tab (owner, Nov 2026).
const KIND_LABEL = { swim: 'Swim', sports: 'Sports & movement', art: 'Art', music: 'Music', dance: 'Dance', theater: 'Theater', science: 'Science & STEM', camp: 'Camps & day-off', cooking: 'Cooking', early: 'Early childhood', other: 'Other' };
const AGE_BANDS = [['baby', 'Baby (0-1)', 0, 0.99], ['toddler', 'Toddler (1-2)', 1, 2.99], ['preschool', 'Preschool (3-5)', 3, 5.99], ['school', 'School age (6-12)', 6, 12.99]];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const C = { q: '', provider: '', kind: '', region: '', district: '', age: '', day: '', time: '', starts: '', cost: '', dim: 'kind', shown: 100 };
const bandsOfClass = (c) => AGE_BANDS.filter(([, , lo, hi]) => (c.age_min ?? 0) <= hi && (c.age_max ?? 99) >= lo).map((b) => b[0]);
const timeOfClass = (c) => (c.start_min == null ? 'any' : c.start_min < 720 ? 'am' : c.start_min < 1020 ? 'pm' : 'eve');
const startOfClass = (c) => { const t = portlandToday(); return !c.start_date ? 'unknown' : c.start_date <= t ? 'running' : c.start_date <= addDays(t, 30) ? 'soon' : 'later'; };
const costOfClass = (c) => (c.free ? 'free' : c.price != null ? 'priced' : 'details');
const CDIMS = {
  kind: { label: 'Kind', values: () => Object.entries(KIND_LABEL), of: (c) => [c.kind] },
  age: { label: 'Age', values: () => AGE_BANDS.map(([k, l]) => [k, l]), of: bandsOfClass },
  day: { label: 'Day', values: () => DAYS.map((d) => [d, d]), of: (c) => c.days || [] },
  time: { label: 'Time of day', values: () => [['am', 'Morning'], ['pm', 'Afternoon'], ['eve', 'Evening'], ['any', 'Varies']], of: (c) => [timeOfClass(c)] },
  starts: { label: 'Starts', values: () => [['running', 'Already running'], ['soon', 'Within 30 days'], ['later', 'Later'], ['unknown', 'No date']], of: (c) => [startOfClass(c)] },
  cost: { label: 'Cost', values: () => [['free', 'Free'], ['priced', 'Price listed'], ['details', 'Fee on detail page']], of: (c) => [costOfClass(c)] }
};
function classesFiltered() {
  const q = C.q.trim().toLowerCase();
  return (D.classes || []).filter((c) => (!C.provider || c.source?.id === C.provider)
    && (!C.kind || c.kind === C.kind)
    && (!C.region || D.regionOf[c.district] === C.region) && (!C.district || c.district === C.district)
    && (!C.age || bandsOfClass(c).includes(C.age)) && (!C.day || c.days?.includes(C.day)) && (!C.time || timeOfClass(c) === C.time)
    && (!C.starts || startOfClass(c) === C.starts) && (!C.cost || costOfClass(c) === C.cost)
    && (!q || `${c.name} ${c.full_name || ''} ${c.venue || ''} ${c.description || ''}`.toLowerCase().includes(q)));
}
function renderClassesShell() {
  const provs = [...new Map((D.classes || []).map((c) => [c.source?.id, c.source?.name])).entries()];
  const districts = C.region ? (D.region[C.region]?.districts || []).map((d) => [d, D.district[d]?.name || d]) : D.geo.districts.map((d) => [d.id, d.name]).sort((a, b) => a[1].localeCompare(b[1]));
  $('#tab-classes').innerHTML = `<h1>Classes</h1><p class="lede">Sign-up classes and series from Parks &amp; Rec registration systems (in progress or upcoming, at least one open spot, ages 0-12). Not on the public site yet: this is for sizing them up before designing a Classes tab.</p>
  ${(D.classes || []).length ? '' : '<p class="note">No classes yet: they arrive with the next pipeline run.</p>'}
  <form class="filters" onsubmit="return false">
    <label class="search">Search<input id="c-q" type="search" placeholder="Class, venue, description…" value="${esc(C.q)}"></label>
    <label>Kind<select id="c-kind">${options(Object.entries(KIND_LABEL), C.kind, 'All kinds')}</select></label>
    <label>Age<select id="c-age">${options(AGE_BANDS.map(([k, l]) => [k, l]), C.age, 'All ages')}</select></label>
    <label>Day<select id="c-day">${options(DAYS.map((d) => [d, d]), C.day, 'Any day')}</select></label>
    <label>Time of day<select id="c-time">${options(CDIMS.time.values(), C.time, 'Any time')}</select></label>
    <label>Starts<select id="c-starts">${options(CDIMS.starts.values(), C.starts, 'Any start')}</select></label>
    <label>Cost<select id="c-cost">${options(CDIMS.cost.values(), C.cost, 'Any cost')}</select></label>
    <label>Region<select id="c-region">${options(D.geo.regions.map((r) => [r.id, r.name]), C.region, 'All regions')}</select></label>
    <label>District<select id="c-district">${options(districts, C.district, 'All districts')}</select></label>
    ${provs.length > 1 ? `<label>Provider<select id="c-provider">${options(provs, C.provider, 'All providers')}</select></label>` : ''}
  </form>
  <div class="actions"><button type="button" id="c-reset">Clear filters</button><button type="button" id="c-csv">Download CSV</button><span class="note" id="c-count"></span></div>
  <div id="cl-body"></div>`;
}
function renderClassesBody() {
  const list = classesFiltered();
  $('#c-count').textContent = `${list.length.toLocaleString('en-US')} classes match`;
  const venues = new Set(list.map((c) => c.venue).filter(Boolean));
  const prices = list.map((c) => c.price).filter((p) => p != null).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const spots = list.reduce((a, c) => a + (c.openings || 0), 0);
  const weekend = list.filter((c) => c.days?.some((d) => d === 'Sat' || d === 'Sun')).length;
  const pct = (x) => (list.length ? `${Math.round((x / list.length) * 100)}%` : '—');
  // area x chosen dimension
  const dim = CDIMS[C.dim], cols = dim.values();
  const count = {}, rowTot = {}, colTot = {};
  for (const c of list) { const d = c.district || '_unplaced'; rowTot[d] = (rowTot[d] || 0) + 1; for (const v of dim.of(c)) { (count[d] ||= {})[v] = (count[d][v] || 0) + 1; colTot[v] = (colTot[v] || 0) + 1; } }
  const max = Math.max(1, ...Object.values(count).flatMap((r) => Object.values(r)));
  const shade = (v) => (v ? `background:color-mix(in srgb,#2E9E6B ${Math.round(8 + (v / max) * 52)}%,#fff)${v / max > 0.55 ? ';color:#fff' : ''}` : '');
  const rows = D.geo.regions.filter((r) => !C.region || r.id === C.region).map((r) => {
    const ds = r.districts.filter((d) => (!C.district || d === C.district) && (rowTot[d] || !C.region));
    const rt = ds.reduce((a, d) => a + (rowTot[d] || 0), 0);
    return `<tr class="region"><td>${esc(r.name)}</td>${cols.map(([v]) => `<td>${ds.reduce((a, d) => a + (count[d]?.[v] || 0), 0) || '·'}</td>`).join('')}<td class="tot">${rt}</td></tr>` + ds.map((d) => `<tr><td>${esc(D.district[d]?.name || d)}</td>${cols.map(([v]) => { const k = count[d]?.[v] || 0; return `<td class="cell ${k ? '' : 'zero'}" style="${shade(k)}">${k}</td>`; }).join('')}<td class="tot">${rowTot[d] || 0}</td></tr>`).join('');
  }).join('') + (rowTot._unplaced ? `<tr><td>No location (online, by arrangement, or not placed yet)</td>${cols.map(([v]) => `<td>${count._unplaced?.[v] || 0}</td>`).join('')}<td class="tot">${rowTot._unplaced}</td></tr>` : '');
  const tally = (f) => list.reduce((a, c) => { for (const k of [].concat(f(c))) if (k) a[k] = (a[k] || 0) + 1; return a; }, {});
  const bars = (obj, color = '#2E9E6B', limit = 20) => { const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit); const m = Math.max(1, ...ent.map((x) => x[1])); return `<div class="bars">${ent.map(([k, v]) => `<div class="barrow"><span class="lbl" title="${esc(k)}">${esc(k)}</span><span class="track"><span class="fill" style="width:${(v / m) * 100}%;background:${color}"></span></span><span class="v">${v}</span></div>`).join('') || '<p class="note">None.</p>'}</div>`; };
  const fmtD = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '?');
  const table = list.slice().sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || a.name.localeCompare(b.name)).slice(0, C.shown).map((c) => `<tr>
    <td>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}<span class="sub">${esc(KIND_LABEL[c.kind] || c.kind)}${c.one_day ? ' · one day' : ''}</span></td>
    <td>${esc(c.ages_text || '')}</td>
    <td>${esc((c.days || []).join(', '))}<span class="sub">${esc(c.time_text || '')}</span></td>
    <td class="num">${esc(fmtD(c.start_date))} – ${esc(fmtD(c.end_date))}</td>
    <td>${esc(c.venue || '—')}<span class="sub">${esc(D.district[c.district]?.name || '')}</span></td>
    <td>${esc(c.free ? 'Free' : c.price != null ? `$${c.price}` : 'See details')}</td>
    <td class="n">${c.unlimited ? 'Open' : n(c.openings)}${c.capacity ? `<span class="sub">of ${c.capacity}</span>` : ''}</td></tr>`).join('');
  $('#cl-body').innerHTML = `
  <div class="tiles">
    <div class="tile"><b>${n(list.length)}</b><small>classes</small></div>
    <div class="tile"><b>${n(venues.size)}</b><small>venues</small></div>
    <div class="tile"><b>${n(spots)}</b><small>open spots listed</small></div>
    <div class="tile"><b>${pct(weekend)}</b><small>meet on a weekend</small></div>
    <div class="tile"><b>${median != null ? `$${median}` : '—'}</b><small>median listed price (${n(prices.length)} with a price)</small></div>
  </div>
  <h2>Coverage by area</h2>
  <div class="card"><h3><span class="seg" role="group" aria-label="Break down by">${Object.entries(CDIMS).map(([k, d]) => `<button type="button" data-cdim="${k}" aria-pressed="${k === C.dim}">${esc(d.label)}</button>`).join('')}</span><small>Classes per district, placed by venue; a class on two days counts in both.</small></h3>
    <div class="tablewrap" style="border:0"><table class="matrix"><thead><tr><th>Area</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${rows}<tr class="region"><td>All</td>${cols.map(([v]) => `<td>${colTot[v] || 0}</td>`).join('')}<td class="tot">${list.length}</td></tr></tbody></table></div></div>
  <div class="grid2" style="margin-top:20px">
    <div class="card"><h3>By venue <small>top 20</small></h3>${bars(tally((c) => c.venue || 'No location'))}</div>
    <div class="card"><h3>By kind</h3>${bars(Object.fromEntries(Object.entries(tally((c) => c.kind)).map(([k, v]) => [KIND_LABEL[k] || k, v])))}<h3 style="margin-top:16px">By start month</h3>${bars(Object.fromEntries(Object.entries(tally((c) => (c.start_date ? new Date(`${c.start_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No date'))).sort()), '#3B6FE0')}</div>
  </div>
  <h2>Classes <small class="note">${list.length > C.shown ? `first ${C.shown} of ${n(list.length)}, by start date` : `${n(list.length)}, by start date`}</small></h2>
  <div class="tablewrap"><table><thead><tr><th>Class</th><th>Ages</th><th>When</th><th>Dates</th><th>Where</th><th>Cost</th><th class="n">Spots</th></tr></thead><tbody>${table || '<tr><td colspan="7" class="note">No classes match these filters.</td></tr>'}</tbody></table></div>
  ${list.length > C.shown ? '<div class="actions"><button type="button" id="c-more">Show 100 more</button></div>' : ''}`;
}
function classesCsv(list) {
  const cols = ['name', 'kind', 'ages', 'age_min', 'age_max', 'days', 'time', 'start_date', 'end_date', 'venue', 'district', 'region', 'fee', 'price', 'open_spots', 'capacity', 'provider', 'url', 'register_url'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = list.map((c) => [c.name, KIND_LABEL[c.kind] || c.kind, c.ages_text, c.age_min, c.age_max, (c.days || []).join(' '), c.time_text, c.start_date, c.end_date, c.venue, D.district[c.district]?.name, D.region[D.regionOf[c.district]]?.name, c.fee_text, c.price, c.unlimited ? 'unlimited' : c.openings, c.capacity, c.provider, c.url, c.register_url].map(q).join(','));
  const blob = new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lil-outings-classes-${portlandToday()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function wireClasses() {
  const panel = $('#tab-classes');
  panel.addEventListener('input', (ev) => {
    const id = ev.target.id; if (!id?.startsWith('c-')) return;
    const k = id.slice(2); C[k] = ev.target.value; C.shown = 100;
    if (k === 'region') { C.district = ''; renderClassesShell(); }
    renderClassesBody();
  });
  panel.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.cdim) { C.dim = b.dataset.cdim; renderClassesBody(); }
    else if (b.id === 'c-more') { C.shown += 100; renderClassesBody(); }
    else if (b.id === 'c-reset') { Object.assign(C, { q: '', provider: '', kind: '', region: '', district: '', age: '', day: '', time: '', starts: '', cost: '', shown: 100 }); renderClassesShell(); renderClassesBody(); }
    else if (b.id === 'c-csv') classesCsv(classesFiltered());
  });
}

// ---------- tabs ----------
function show() {
  const tab = ['sources', 'activity', 'events', 'classes'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'sources';
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;
  for (const a of document.querySelectorAll('[data-tab]')) a.setAttribute('aria-selected', String(a.dataset.tab === tab));
}

load().then((data) => {
  D = data;
  $('#loading').hidden = true;
  $('#stamp').textContent = D.meta.generated_at ? `Data from ${fmt(D.meta.generated_at)}` : '';
  renderSources(); renderActivity(); renderEventsShell(); renderEventsBody(); wireEvents(); renderClassesShell(); renderClassesBody(); wireClasses(); show();
  addEventListener('hashchange', show);
}).catch((e) => { $('#loading').textContent = `Could not load the pipeline data: ${e.message}`; });
