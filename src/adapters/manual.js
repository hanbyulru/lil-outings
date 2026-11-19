import { readFileSync, existsSync } from 'node:fs';

/**
 * Hand-curated events (owner, Nov 2026): config/events.seed.json, tracked in git so the daily refresh sees it.
 * One entry per event; `runs` expands it into one listing per day:
 *   { "dates": ["2026-11-27"], "start": "17:30", "end": "18:45" }
 *   { "from": "2026-11-27", "to": "2026-12-27", "days": ["fri","sat","sun"], "except": ["2026-12-25"], "start": "10:00", "end": "19:45" }
 * Times are Portland wall-clock times. "interests" sets the event's interest tags exactly, in order (first = card color),
 * through the event overrides in pipeline.js.
 * An entry can also be a plain raw event with start/end ISO strings, the older format.
 */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** UTC offset of Portland on a date, as "-08:00" / "-07:00" (DST-aware via Intl). */
export function portlandOffset(date) {
  const noonUtc = new Date(`${date}T20:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' })
    .formatToParts(noonUtc).find((p) => p.type === 'timeZoneName').value; // "GMT-8"
  const h = Number(name.replace('GMT', '')) || 0;
  return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`;
}

/** The dates a run covers, in order. */
export function runDates(run) {
  if (run.dates) return [...run.dates].sort();
  const out = [], skip = new Set(run.except || []);
  const days = run.days ? new Set(run.days.map((d) => d.toLowerCase().slice(0, 3))) : null;
  for (let t = Date.parse(`${run.from}T00:00:00Z`); t <= Date.parse(`${run.to}T00:00:00Z`); t += 864e5) {
    const d = new Date(t), iso = d.toISOString().slice(0, 10);
    if (skip.has(iso) || (days && !days.has(DAYS[d.getUTCDay()]))) continue;
    out.push(iso);
  }
  return out;
}

/** Expand seed entries into raw events (one per day of each run). */
export function expandSeed(entries, sourceId) {
  const out = [];
  entries.forEach((e, i) => {
    const base = {
      source_id: sourceId, all_day: false, address: null, lat: null, lon: null, raw_categories: [], raw_audience: [],
      price_text: null, image: null, cancelled: false
    };
    const { runs, interests, id, note, ...fields } = e;
    if (!runs) { out.push({ ...base, source_event_id: id || `manual-${i}`, ...fields }); return; }
    for (const run of runs) {
      for (const date of runDates(run)) {
        const off = portlandOffset(date);
        out.push({
          ...base, ...fields,
          source_event_id: `${id || `manual-${i}`}-${date}`,
          all_day: !run.start,
          start: `${date}T${run.start || '00:00'}:00${off}`,
          end: run.end ? `${date}T${run.end}:00${off}` : null,
          ...(run.note ? { description: `${run.note} ${fields.description || ''}`.trim() } : {})
        });
      }
    }
  });
  return out;
}

export async function fetchManual(source) {
  const file = source.config.file || 'config/events.seed.json';
  if (!existsSync(file)) return [];
  return expandSeed(JSON.parse(readFileSync(file, 'utf8')), source.id);
}

/** Interest rules from the seed ("interests"), in the shape of config/event_overrides.json rules (only_interests). */
export function seedInterestRules(file, sourceId) {
  if (!existsSync(file)) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return JSON.parse(readFileSync(file, 'utf8')).filter((e) => e.interests?.length)
    .map((e) => ({ source: sourceId, title: `^${esc(e.title)}$`, only_interests: e.interests }));
}
