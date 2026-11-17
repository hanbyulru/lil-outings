import { htmlToText, decodeEntities } from '../lib/html.js';
import { politeFetch } from '../lib/http.js';

/**
 * PP&R class listings on portland.gov/parks/recreation/activities/<category>.
 * Structure (verified from the Sports page): sections by region (h2/h3: "East and Southeast Portland", ...),
 * subsections by age group ("Child with Adult", "Preschool", "Youth", "Adult", ...), each a table with columns
 * Class | Description | Location | Register ("Check availability" -> ActiveNet search link).
 * These are evergreen PROGRAMS (no dates/times/prices), not dated events.
 */
const AGE_GROUPS = [
  [/child with adult|parent|toddler|tot/i, 0, 5, 'Child with adult'],
  [/preschool/i, 3, 5, 'Preschool'],
  [/youth|kids|school[- ]age|teen/i, 6, 12, 'Youth'],
  [/all ages|family/i, 0, 12, 'All ages']
];
const SKIP_GROUP = /adult|intergenerational|older|55|60|senior|lifelong/i;
// PP&R region headings -> our regions (config/geo.json). "East and Southeast Portland" spans inner SE and East Portland.
const REGION_AREAS = [[/northwest/i, ['inner-core']], [/north/i, ['north-east']], [/southwest/i, ['westside']], [/southeast|east/i, ['se-clackamas', 'north-east']]];
const strip = (h) => decodeEntities(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function ageFor(heading) {
  if (/^adult\b/i.test(heading.trim()) || (SKIP_GROUP.test(heading) && !/child with adult/i.test(heading))) return null;
  for (const [re, min, max, label] of AGE_GROUPS) if (re.test(heading)) return { min, max, label };
  return undefined; // unknown heading: not an age group (probably a region)
}

export function parsePortlandGovPrograms(html, source) {
  const out = [];
  let region = null, areas = [], age = null;
  const tokens = [...html.matchAll(/<h([234])[^>]*>([\s\S]*?)<\/h\1>|<table[\s\S]*?<\/table>/gi)];
  for (const m of tokens) {
    if (m[1]) {
      const text = strip(m[2]);
      const r = REGION_AREAS.find(([re]) => re.test(text));
      const a = ageFor(text);
      if (a !== undefined) age = a;               // null = adult-only section (skipped)
      else if (r) { region = text; areas = r[1]; age = null; }
      continue;
    }
    if (!age) continue;
    const head = [...m[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((x) => strip(x[1]).toLowerCase());
    const col = (n) => head.indexOf(n);
    for (const row of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
      if (!cells.length) continue;
      const name = strip(cells[Math.max(col('class'), 0)] || '');
      if (!name) continue;
      const desc = col('description') >= 0 ? strip(cells[col('description')] || '') : '';
      const loc = col('location') >= 0 ? strip(cells[col('location')] || '') : '';
      const href = (cells[col('register') >= 0 ? col('register') : cells.length - 1] || '').match(/href="([^"]+)"/i)?.[1];
      out.push({
        source_id: source.id, program_key: `${source.id}:${region}:${age.label}:${name}`,
        name, description: desc, age_min: age.min, age_max: age.max, age_label: age.label,
        region, regions: areas, location_text: loc,
        url: href ? decodeEntities(href) : null, price_text: null
      });
    }
  }
  return out;
}

export async function fetchPortlandGovPrograms(source, ctx) {
  const all = [];
  for (const url of source.config.urls) {
    try {
      const html = await politeFetch(url, ctx.http);
      all.push(...parsePortlandGovPrograms(html, source).map((p) => ({ ...p, page_url: url })));
    } catch (err) {
      ctx.log?.(`    ${url}: ${err.message}`);
    }
  }
  return all;
}
