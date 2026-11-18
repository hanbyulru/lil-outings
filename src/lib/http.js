import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const USER_AGENT = 'LilOutingsBot/0.1 (+https://liloutings.com/)';

const lastHit = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polite fetch: identifies itself, spaces requests per host, caches responses on disk. */
export async function politeFetch(url, { fetchImpl = fetch, cacheDir = 'data/cache/http', ttlMs = 30 * 60 * 1000, minGapMs = 1500, headers = {}, method = 'GET', body, retries = 2, timeoutMs = 60000 } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const key = createHash('sha1').update(method + url + (body || '')).digest('hex');
  const file = join(cacheDir, key + '.json');
  if (existsSync(file)) {
    try {
      const c = JSON.parse(readFileSync(file, 'utf8'));
      if (Date.now() - c.at < ttlMs) return c.text;
    } catch { /* ignore bad cache */ }
  }
  const host = new URL(url).host;
  let res;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastHit.get(host) || 0) + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    res = await fetchImpl(url, { method, body, headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers }, signal: AbortSignal.timeout(timeoutMs) }); // a stalled source must not hang the run
    if (!(res.status === 429 || res.status === 503) || attempt >= retries) break;
    // Rate limited: honor Retry-After (seconds) when given, else back off 15s, 45s.
    const ra = Number(res.headers?.get?.('retry-after'));
    await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 15000 * 3 ** attempt, 120000));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  writeFileSync(file, JSON.stringify({ at: Date.now(), text }));
  return text;
}
