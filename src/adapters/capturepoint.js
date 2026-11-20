import { politeFetch } from '../lib/http.js';
import { htmlToText, decodeEntities } from '../lib/html.js';
import { kindOf, venueShort, isAdultOnly, parseTimeRange } from './activenet.js';

/**
 * CapturePoint "Community Pass" catalog: the registration system behind Tualatin Parks & Recreation (owner, Nov 2026).
 * The public catalog page (cat_program_list.cfm?season_id=N) loads its programs with two in-page requests:
 *   POST get_program_filtered_id_list.cfm?s=   body: [{name:'program_group',value:G}, ..., {name:'season_id',value:N}]
 *        -> { DETAIL_PROGRAM_ID_STR: 'id,id,...', FILTERS: '<json string>' }
 *   POST includes/catalog/program-list.cfm?s=&t=&season_id=N&ipp=K   body: { programString: 'id,id', filters: FILTERS }
 *        -> HTML, one <section class="program"> per program.
 * Both want the X-Requested-With header the page's own requests send; no login or cookie.
 * Program groups come from the catalog's sidebar; adult and teen groups are left out by name.
 * A season id changes each season: config.season_ids lists the live ones (the dashboard shows 0 classes when they lapse).
 * config: { base: 'https://register.capturepoint.com/reg', season_ids: [39745], provider, venue_town }
 */
const ADULT_GROUP = /\b(adult|senior|teen|wellness|longevity|lifelong|trips?|travel|JPC|active aging)\b/i;
const PER_PAGE = 30;

/** Sidebar program groups: [{ id: '2811', name: "Children's Activities" }, ...]. */
export function parseGroups(html) {
  const out = [];
  const re = /name="program_group"[^>]*value="(\d+)"[^>]*>\s*<span class="label-text"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(html))) out.push({ id: m[1], name: decodeEntities(m[2]).trim() });
  return out;
}

/** The catalog's facility names (sidebar menu), used to find a partner program's venue in its description. */
export function parseFacilities(html) {
  const names = new Set();
  const re = /facility_id=\d+"[^>]*>([^<]+)</g;
  let m;
  while ((m = re.exec(html))) names.add(decodeEntities(m[1]).trim());
  return [...names];
}

const pick = (s, re) => (s.match(re) || [])[1] || null;
const usDate = (s) => { const m = s && s.match(/(\d\d)\/(\d\d)\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseCapturePoint(html, source, { facilities = [], seasonId } = {}) {
  const cfg = source.config;
  const base = cfg.base || 'https://register.capturepoint.com/reg';
  const parts = html.split(/<section class="program"/).slice(1);
  return parts.map((s) => {
    const id = pick(s, /data-id="(\d+)"/) || pick(s, /program_id=(\d+)/);
    const name = decodeEntities(htmlToText(pick(s, /<h2 class="program-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || '')).replace(/\s+/g, ' ').trim();
    const description = htmlToText(pick(s, /<div class="inner-wrap">([\s\S]*?)<\/div>/) || '').replace(/\s+/g, ' ').trim();
    // Ages: "4 ‐10" in the eligibility list; partner programs only say it in the title ("Soccer Shots Mini | Ages 2-3").
    const ageLi = pick(s, /<li class="age">([\s\S]*?)<\/li>/);
    let ageMin = null, ageMax = null;
    if (ageLi) {
      const n = decodeEntities(htmlToText(ageLi)).match(/(\d+)\D+(\d+)?/);
      if (n) { ageMin = +n[1]; ageMax = n[2] ? +n[2] : null; }
    } else {
      const n = `${name} ${description}`.match(/\bages?\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i);
      if (n) { ageMin = +n[1]; ageMax = +n[2]; }
    }
    if (ageMax != null && ageMax >= 99) ageMax = null; // "1 - 100": all ages
    const locName = pick(s, /<span class="program-loc-name">([^<]*)</);
    const locAddr = pick(s, /<span class="program-loc-address">([^<]*)</);
    // "Van Raden Community Center/Main Room" -> the building; a partner listing names it in its text.
    const building = locName ? decodeEntities(locName).split('/')[0].trim() : facilities.find((f) => `${name} ${description}`.includes(f)) || null;
    const street = locAddr ? decodeEntities(locAddr).split(',')[0].trim() : null;
    const venue = building ? (street ? `${building}, ${street}` : building) : null;
    const hours = pick(s, /<li class="program-hours">([^<]*)</);
    const timeText = hours ? hours.trim() : pick(description, /\|\s*(\d{1,2}(?::\d\d)?\s*[ap]m\s*-\s*\d{1,2}(?::\d\d)?\s*[ap]m)\s*\|/i);
    const [startMin, endMin] = parseTimeRange((timeText || '').replace(/(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?/gi, (x, h, m, ap) => `${h}:${m || '00'} ${ap.toUpperCase()}M`));
    const dayLis = [...s.matchAll(/<li class="(active|inactive)-day">/g)].map((m) => m[1] === 'active');
    // The week row starts on Monday.
    const days = dayLis.length === 7 ? dayLis.map((on, i) => (on ? DAYS[(i + 1) % 7] : null)).filter(Boolean) : [];
    const eventDate = usDate(pick(s, /title="Event Date: ([^"]+)"/));
    const start = eventDate || usDate(pick(s, /title="Start Date: ([^"]+)"/));
    const end = eventDate || usDate(pick(s, /title="End Date: ([^"]+)"/)) || start;
    const priceText = pick(s, /<span class="program-fees-price">([^<]*)</);
    const partnerPrice = pick(description, /\|\s*\$(\d+(?:\.\d\d)?)\b/);
    const price = priceText && /\$\s*([\d,.]+)/.test(priceText) ? Number(priceText.match(/\$\s*([\d,.]+)/)[1].replace(/,/g, '')) : partnerPrice ? Number(partnerPrice) : null;
    const spots = pick(s, /<ul class="program-availability">\s*<li>\s*([^<]*?)\s*<\/li>/);
    const openings = spots != null && /^\d+$/.test(spots) ? +spots : null;
    const external = pick(s, /<a class="cat-btn[^"]*"[^>]*href="(https?:[^"]+)"[^>]*>\s*Visit Website/);
    const full = /cat-btn-add-to-waitlist|\bWaitlist\b|\bFull\b/i.test(pick(s, /<footer class="program-cta">([\s\S]*?)<\/footer>/) || '') || openings === 0;
    const detail = `${base}/cat_program_list_detail.cfm?season_id=${seasonId ?? ''}&program_id=${id}`;
    return {
      id: `${source.id}-${id}`,
      source: { id: source.id, name: source.name },
      provider: cfg.provider || source.name,
      activity_id: id ? +id : null, number: null,
      name, full_name: name, kind: kindOf(name, venue),
      description: description.slice(0, 600),
      ages_text: ageMin != null ? (ageMax != null ? `Ages ${ageMin}-${ageMax}` : `Ages ${ageMin}+`) : null, age_min: ageMin ?? 0, age_max: ageMax,
      start_date: start, end_date: end, dates_text: null,
      days: days.length || !start || start !== end ? days : [DAYS[new Date(`${start}T12:00:00Z`).getUTCDay()]], time_text: timeText, start_min: startMin, end_min: endMin,
      venue, venue_short: venueShort(venue),
      fee_text: priceText ? priceText.trim() : partnerPrice ? '$' + partnerPrice : null, price, free: price === 0,
      openings, unlimited: false, capacity: null, enrolled: null,
      drop_in: false, one_day: !!eventDate || (start && start === end),
      url: detail, register_url: external || detail,
      full
    };
  });
}

export async function fetchCapturePoint(source, ctx) {
  const cfg = source.config;
  const base = cfg.base || 'https://register.capturepoint.com/reg';
  const xhr = { 'content-type': 'application/json', accept: '*/*', 'x-requested-with': 'XMLHttpRequest' };
  const out = [];
  for (const seasonId of cfg.season_ids || []) {
    const page = await politeFetch(`${base}/cat_program_list.cfm?season_id=${seasonId}`, ctx.http);
    const groups = parseGroups(page).filter((g) => !ADULT_GROUP.test(g.name));
    if (!groups.length) throw new Error(`CapturePoint: no program groups for season ${seasonId} (season over? update season_ids)`);
    const facilities = parseFacilities(page);
    const filterBody = JSON.stringify([
      ...groups.map((g) => ({ name: 'program_group', value: g.id })),
      { name: 'lo-age', value: '' }, { name: 'hi-age', value: '' }, { name: 'start-date', value: '' }, { name: 'end-date', value: '' },
      { name: 'season_id', value: String(seasonId) }, { name: 'search_term', value: '' }
    ]);
    const idsText = await politeFetch(`${base}/get_program_filtered_id_list.cfm?s=`, { ...ctx.http, method: 'POST', body: filterBody, headers: xhr });
    const ids = JSON.parse(idsText || '{}');
    const list = String(ids.DETAIL_PROGRAM_ID_STR || '').split(',').filter(Boolean);
    for (let i = 0; i < list.length; i += PER_PAGE) {
      const body = JSON.stringify({ programString: list.slice(i, i + PER_PAGE).join(','), filters: ids.FILTERS || '' });
      const html = await politeFetch(`${base}/includes/catalog/program-list.cfm?s=&t=&season_id=${seasonId}&ipp=${PER_PAGE}`, { ...ctx.http, method: 'POST', body, headers: xhr });
      if (/An error has occurred/i.test(html) && !/<section class="program"/.test(html)) throw new Error('CapturePoint: program list returned an error page');
      out.push(...parseCapturePoint(html, source, { facilities, seasonId }));
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  // Owner's filters: in progress or future, 1+ open spots, ages 0-12.
  return out.filter((c) => !c.full && (!c.end_date || c.end_date >= today) && !(c.age_min > 12) && !isAdultOnly(c) && (seen.has(c.id) ? false : seen.add(c.id)))
    .map(({ full, ...c }) => c);
}
