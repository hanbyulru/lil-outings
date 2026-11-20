import { politeFetch } from '../lib/http.js';
import { htmlToText, decodeEntities } from '../lib/html.js';

/**
 * ActiveNet (ActiveCommunities) activity search: the registration system behind Portland Parks & Recreation and many
 * other parks departments (owner, Nov 2026). The public search page calls a JSON endpoint:
 *   POST https://anc.apm.activecommunities.com/<site>/rest/activities/list?locale=en-US
 *   header page_info: {"order_by":"Date range","page_number":N,"total_records_per_page":50}
 *   body: { activity_search_pattern: { activity_select_param: 2 (in progress / future), open_spots: 1, min_age, max_age, ... } }
 * Each item is one class or series: name, ages, date range, days, time, location, fee, openings, registration links.
 * These are CLASSES (sign-up, usually multi-week), kept apart from events; for now they only feed the admin dashboard.
 * config: { site: 'portlandparks', min_age: 0, max_age: 12, open_spots: 1, venue_town: 'Portland, OR', max_pages: 40 }
 */
const BASE = 'https://anc.apm.activecommunities.com';
const PER_PAGE = 50;

export function searchBody(cfg) {
  return {
    activity_search_pattern: {
      skills: [], time_after_str: '', days_of_week: null, activity_select_param: 2, center_ids: [], time_before_str: '',
      open_spots: cfg.open_spots ?? 1, activity_id: null, activity_category_ids: [], date_before: '', min_age: cfg.min_age ?? 0,
      date_after: '', activity_type_ids: [], site_ids: [], for_map: false, geographic_area_ids: [], season_ids: [],
      activity_department_ids: [], activity_other_category_ids: [], child_season_ids: [], activity_keyword: '', instructor_ids: [],
      max_age: cfg.max_age ?? 12, custom_price_from: '', custom_price_to: ''
    },
    activity_transfer_pattern: {}
  };
}

/** "9:15 AM - 8:45 PM" -> [555, 1245] (minutes after midnight). */
export function parseTimeRange(s) {
  const t = String(s || '').replace(/\bNoon\b/gi, '12:00 PM').replace(/\bMidnight\b/gi, '12:00 AM').match(/(\d{1,2}):(\d\d)\s*([AP]M)/gi) || [];
  const min = (x) => { const m = x.match(/(\d{1,2}):(\d\d)\s*([AP]M)/i); let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
  return [t[0] ? min(t[0]) : null, t[1] ? min(t[1]) : null];
}

/** Rough kind from the class name, for the dashboard's breakdowns (the name says what it is far more often than not). */
const KINDS = [
  ['swim', /\b(swim|aquatic|water polo|dive|diving|lifeguard)/i],
  ['camp', /\b(camp|no[- ]school|school'?s? out|break|day off)\b/i],
  ['dance', /(dance|ballet|hip[- ]?hop|\btap\b|jazz|ballroom|breakdanc)/i],
  ['music', /\b(music|piano|guitar|violin|ukulele|drum|sing|choir|voice|band|strings)/i],
  ['theater', /\b(theat|drama|acting|improv|musical|stage|puppet)/i],
  ['art', /\b(art|gallery|anim|cartoon|manga|felt|draw|paint|clay|ceramic|pottery|craft|sculpt|print|photo|wood|metal|jewelry|fiber|sew|knit|comic|anime)/i],
  ['science', /\b(science|stem|steam|lego|robot|coding|code|engineer|chess|math|nature|garden|outdoor|explor)/i],
  ['sports', /\b(soccer|basketball|baseball|t-?ball|softball|volleyball|football|lacrosse|hockey|tennis|pickleball|golf|track|run|gymnast|tumbl|acro|cheer|martial|karate|tae ?kwon ?do|taekwondo|judo|jiu|boxing|fencing|skat|climb|ninja|yoga|fitness|sport|ball\b|goldenball|archery|bike|hoop|rugby|ski\b|skiing|snowshoe|skyhawks)/i],
  ['cooking', /\b(cook|bak|chef|kitchen|dynamic duos|taco|pie\b|pizza|cookie|treats|soup)/i],
  ['early', /\b(preschool|pre-school|tot|toddler|baby|babies|infant|parent|caregiver|kidspace|play ?group|playtime|little|mini)/i]
];
/** Classes at a pool are swim lessons (not "Aquatic Center": LORAC hosts gym classes too) whatever their level name (Starfish, Goldfish, Sea Lion...). */
export const kindOf = (name, venue = '') => (/\bpool\b/i.test(venue || '') ? 'swim' : /\b(tennis|athletic fields?|gymnasium)\b/i.test(venue || '') ? 'sports' : KINDS.find(([, re]) => re.test(name))?.[0] || 'other');
/** "MDCC - Pre - Otter" -> "Pre - Otter": drop the facility code PP&R puts in front of swim lessons. */
export const displayName = (name) => name.replace(/^[A-Z]{3,5}\s*-\s*/, '').trim();

/** Venue labels come abbreviated ("East Portland Cmty Ctr"); spell them out for geocoding and display. */
export function venueName(label) {
  if (!label || /^(n\/?a|null)$/i.test(label.trim())) return null;
  return decodeEntities(label).replace(/^[.\s]+/, '').replace(/^LORAC\b/i, 'Lake Oswego Recreation & Aquatic Center').replace(/\bCmty\b/g, 'Community').replace(/\bComm\b/g, 'Community').replace(/\bCtr\b/g, 'Center').replace(/\bPk\b/g, 'Park').replace(/\bRec\b/g, 'Recreation').replace(/\s+/g, ' ').trim();
}

/**
 * What to look a venue up by: a PP&R indoor pool is inside the community center of the same name ("Mt Scott Indoor
 * Pool" -> "Mt Scott Community Center"); a bare room name ("Roller Rink", "Gym") can't be placed safely, so it isn't.
 */
/** "One River Art School; 15010 SW Bangy Rd" or "Greentree Road Art Studio 2766 Greentree Road" -> the name only (the full label still goes to the geocoder). */
export const venueShort = (venue) => (venue ? venue.split(/;\s*|,\s*(?=\d)|\s+(?=\d{2,6}\s+\w)/)[0].trim() : null);

export function venueQuery(venue, aliases = {}) {
  if (!venue) return null;
  // A source can name its own facilities' addresses (config.venue_aliases, matched by the start of the label).
  const alias = Object.entries(aliases).find(([k]) => venue.toLowerCase().startsWith(k.toLowerCase()));
  if (alias) return alias[1];
  // A label with a street address in it: look up the address ("Academy of Ballet, 311 B Avenue, Suite Z, ...").
  const street = venue.match(/\d{2,6}\s+(?:[NSEW]{1,2}\s+)?[\w .']+?\b(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Way|Hwy|Highway|Ln|Lane|Ct|Pkwy|Pl)\b/i);
  if (street) return street[0];
  if (venue.length > 90) return null;
  if (/^(roller rink|gym|gymnasium|pool|studio|room|online|virtual|tbd|various|multiple locations)$/i.test(venue.trim())) return null;
  return venue.replace(/\bIndoor Pool$/i, 'Community Center');
}

/** Adult and senior programs that slip through an age filter because they're listed for "Any" age (owner: no adult content). */
const ADULT = /\b(adult|senior|55\+|50\+|older adults?|mah-?jongg|bridge club|pickleball open play)\b|;\s*ACC$/i;
export function isAdultOnly(c) {
  const adultMarked = ADULT.test(c.full_name || c.name) || /adult community center|senior center/i.test(c.venue || '');
  return (adultMarked && !(c.age_max != null && c.age_max <= 12)) || (c.age_min ?? 0) >= 13;
}

export function parseActiveNet(json, source) {
  const items = json?.body?.activity_items || [];
  return items.map((a) => {
    const [startMin, endMin] = parseTimeRange(a.time_range);
    const fee = a.fee?.label || '';
    const price = /\$\s*([\d,.]+)/.test(fee) ? Number(fee.match(/\$\s*([\d,.]+)/)[1].replace(/,/g, '')) : null;
    const minAge = a.age_min_year || a.age_min_month ? +(a.age_min_year + (a.age_min_month || 0) / 12).toFixed(2) : 0;
    // "At least 3 but less than 6" -> 3 to 5; no maximum -> null ("and up").
    const maxAge = a.age_max_year || a.age_max_month ? Math.max(minAge, +(a.age_max_year + (a.age_max_month || 0) / 12 - (a.age_max_month ? 0 : 1)).toFixed(2)) : null;
    const open = a.total_open === -1 ? null : Number(a.openings);
    const name = decodeEntities(a.name || '').replace(/\s+/g, ' ').trim();
    const venue = venueName(a.location?.label);
    return {
      id: `${source.id}-${a.id}`,
      source: { id: source.id, name: source.name },
      provider: source.config.provider || source.name,
      activity_id: a.id, number: a.number || null,
      name: displayName(name), full_name: name, kind: kindOf(name, venue),
      description: htmlToText(a.desc || '').replace(/\s+/g, ' ').trim().slice(0, 600),
      ages_text: a.ages ? decodeEntities(a.ages).replace(/\s+/g, ' ').trim() : null, age_min: minAge, age_max: maxAge,
      start_date: a.date_range_start || null, end_date: a.date_range_end || null, dates_text: a.date_range || null,
      days: (a.days_of_week || '').split(',').map((d) => d.trim()).filter(Boolean),
      time_text: a.time_range || null, start_min: startMin, end_min: endMin,
      venue, venue_short: venueShort(venue),
      fee_text: fee || null, price, free: /^free$/i.test(fee.trim()),
      openings: Number.isFinite(open) ? open : null, unlimited: a.total_open === -1, capacity: a.total_open > 0 ? a.total_open : null, enrolled: a.already_enrolled ?? null,
      drop_in: !!a.allow_drop_in_reg, one_day: !!a.only_one_day,
      url: a.detail_url || null, register_url: a.enroll_now?.href || null
    };
  });
}

export async function fetchActiveNet(source, ctx) {
  const cfg = source.config;
  const url = `${BASE}/${cfg.site}/rest/activities/list?locale=en-US`;
  const body = JSON.stringify(searchBody(cfg));
  const out = [];
  for (let page = 1; page <= (cfg.max_pages || 40); page++) {
    // The page number travels in a header, so it also goes in the URL to keep each page's cache entry separate.
    const text = await politeFetch(`${url}&page=${page}`, {
      ...ctx.http, method: 'POST', body,
      headers: { 'content-type': 'application/json;charset=utf-8', accept: 'application/json', page_info: JSON.stringify({ order_by: 'Date range', page_number: page, total_records_per_page: PER_PAGE }) }
    });
    const json = JSON.parse(text);
    if (json?.headers?.response_code && json.headers.response_code !== '0000') throw new Error(`ActiveNet: ${json.headers.response_message || json.headers.response_code}`);
    out.push(...parseActiveNet(json, source).filter((c) => !isAdultOnly(c)));
    const total = json?.headers?.page_info?.total_page || 1;
    if (page >= total) break;
  }
  const seen = new Set();
  return out.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
}
