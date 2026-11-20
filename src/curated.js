// Curated events monitor (owner, Nov 2026). Hand-entered events (config/events.seed.json) can't be read automatically,
// so each pipeline run checks every entry's organizer page instead: did it load (or is it blocked / gone), has its text
// changed since the last run (often new dates or times worth reviewing), and are the entry's own dates running out.
// Results go to the admin dashboard (admin/data/curated.json) and into the run log.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { politeFetch } from './lib/http.js';
import { htmlToText } from './lib/html.js';
import { runDates } from './adapters/manual.js';

/**
 * A fingerprint of a page's visible text, so cosmetic markup changes don't count as a change. Numbers that tick over
 * on their own (years in footers, counters) still might; the dashboard shows when it changed, the owner judges.
 */
export function textFingerprint(html) {
  const text = htmlToText(String(html).replace(/<(nav|footer|header|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' '))
    .replace(/\s+/g, ' ').trim().toLowerCase();
  return { hash: createHash('sha1').update(text).digest('hex').slice(0, 16), chars: text.length };
}

/** An entry's dates against today: upcoming / running / ending soon (started, last date within 7 days) / ended. */
export function entryDates(entry, today) {
  const dates = (entry.runs || []).flatMap((r) => runDates(r)).sort();
  if (!dates.length) return { first: null, last: null, upcoming: 0, state: 'no_dates' };
  const first = dates[0], last = dates[dates.length - 1], upcoming = dates.filter((d) => d >= today).length;
  const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
  // A run that has started and has a week or less left is "ending soon"; a one-off date stays "upcoming" until it's past.
  const state = last < today ? 'ended' : first > today ? 'upcoming' : days(today, last) <= 7 ? 'ending_soon' : 'running';
  return { first, last, upcoming, state };
}

/** Compare this run's page check with the previous one (state carried in the cache between runs). */
export function mergeCheck(prev, check, nowIso) {
  const p = prev || {};
  const changed = check.ok && p.hash && check.hash !== p.hash;
  return {
    ...check,
    checked_at: nowIso,
    last_ok_at: check.ok ? nowIso : p.last_ok_at || null,
    first_seen_at: p.first_seen_at || nowIso,
    changed_at: changed ? nowIso : p.changed_at || null,
    changed_now: !!changed,
    hash: check.ok ? check.hash : p.hash || null
  };
}

/**
 * Check every curated entry's page (one fetch per distinct URL) and return one row per entry.
 * published: kids' events on the site from that entry this run (matched by source + title).
 */
export async function checkCurated({ seedFile, statePath, http, today, kept, sourceId = 'manual', offline = false, log = () => {} }) {
  if (!existsSync(seedFile)) return [];
  const entries = JSON.parse(readFileSync(seedFile, 'utf8'));
  let state = {};
  try { if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { state = {}; }
  const nowIso = new Date().toISOString();
  for (const url of [...new Set(entries.map((e) => e.url).filter(Boolean))]) {
    if (offline) continue; // the demo never fetches; its rows show "not checked"
    let check;
    try {
      // At most an hour of cache, so each daily run sees the page fresh while pushes close together reuse it.
      const html = await politeFetch(url, { ...http, ttlMs: Math.min(http.ttlMs ?? 0, 60 * 60 * 1000) });
      check = { ok: true, status: 'ok', ...textFingerprint(html) };
    } catch (err) {
      const code = Number(String(err.message).match(/HTTP (\d{3})/)?.[1]) || null;
      check = { ok: false, status: code === 403 || code === 401 ? 'blocked' : code === 404 || code === 410 ? 'gone' : 'failed', http: code, error: String(err.message || err).slice(0, 200) };
    }
    state[url] = mergeCheck(state[url], check, nowIso);
  }
  if (!offline) { mkdirSync(dirname(statePath), { recursive: true }); writeFileSync(statePath, JSON.stringify(state)); }
  const rows = entries.map((e) => {
    const page = !e.url ? null : offline ? { status: 'not_checked', ok: null } : state[e.url];
    let host = null; try { host = e.url ? new URL(e.url).host.replace(/^www\./, '') : null; } catch { /* bad url */ }
    return {
      id: e.id || e.title, title: e.title, venue: e.venue_name || null, url: e.url || null, host,
      interests: e.interests || [],
      ...entryDates(e, today),
      published: kept.filter((k) => k.source?.id === sourceId && k.title === e.title.replace(/\s+/g, ' ').trim()).length,
      page: page ? { status: page.status, ok: page.ok, http: page.http || null, error: page.error || null, checked_at: page.checked_at, last_ok_at: page.last_ok_at, changed_at: page.changed_at, changed_now: page.changed_now, first_seen_at: page.first_seen_at } : null
    };
  });
  const bad = rows.filter((r) => r.page && r.page.ok === false).length;
  log(`  curated entries: ${rows.length} checked (${bad} page${bad === 1 ? '' : 's'} unreachable, ${rows.filter((r) => r.page?.changed_now).length} changed)`);
  return rows;
}
