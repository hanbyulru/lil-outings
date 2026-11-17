import { readFileSync, existsSync } from 'node:fs';

/** Submitted/hand-curated events: data/manual/events.json, an array of raw events (see README). */
export async function fetchManual(source) {
  const file = source.config.file || 'data/manual/events.json';
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).map((e, i) => ({
    source_id: source.id, source_event_id: e.source_event_id || `manual-${i}`, all_day: false, address: null,
    lat: null, lon: null, raw_categories: [], raw_audience: [], price_text: null, image: null, cancelled: false, ...e
  }));
}
