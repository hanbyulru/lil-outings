// Pipeline activity log for the admin dashboard (owner, Nov 2026).
// Each refresh appends one summary to data/cache/runs.json, which the GitHub workflow keeps between runs in its cache,
// and the build copies the log to _site/admin/data/runs.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_RUNS = 400; // about a year of daily runs plus pushes

/** One run's summary: totals and each source's result (fetched = raw listings, published = events kept on the site). */
export function runSummary({ meta, startedAt, finishedAt, env = process.env }) {
  const gh = env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const pick = (s) => ({ id: s.id, name: s.name, ok: s.ok, fetched: s.fetched ?? null, published: s.published ?? null, ms: s.ms ?? null, ...(s.ok ? {} : { error: String(s.error || '').slice(0, 300) }) });
  return {
    at: finishedAt.toISOString(),
    started_at: startedAt.toISOString(),
    duration_ms: finishedAt - startedAt,
    mode: meta.mode,
    trigger: env.GITHUB_EVENT_NAME || 'local', // schedule | push | workflow_dispatch | local
    commit: env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : null,
    run_url: gh,
    counts: meta.counts,
    sources: meta.sources.map(pick),
    place_sources: meta.place_sources.map(pick),
    program_sources: (meta.program_sources || []).map(pick)
  };
}

/** Newest first, capped. */
export function appendRun(history, run, max = MAX_RUNS) {
  return [run, ...(Array.isArray(history) ? history : [])].slice(0, max);
}

export function recordRun(file, run) {
  let history = [];
  try { if (existsSync(file)) history = JSON.parse(readFileSync(file, 'utf8')); } catch { history = []; } // a corrupt log starts over
  const next = appendRun(history, run);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(next));
  return next;
}
