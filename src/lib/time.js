// All times in this product are Portland wall-clock times. We store ISO strings WITH offset.
export const TZ = 'America/Los_Angeles';

/** Offset like "-08:00" for a wall-clock time in tz (handles DST via Intl). */
export function offsetFor(localISO, tz = TZ) {
  const guess = new Date(localISO + 'Z'); // treat wall time as UTC to get a probe instant
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(guess);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT-08:00';
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '-08:00';
}

/** "2026-11-16T10:30:00" + tz -> "2026-11-16T10:30:00-08:00" */
export function withOffset(localISO, tz = TZ) {
  return `${localISO}${offsetFor(localISO, tz)}`;
}

/** Wall-clock parts of an ISO string (ignores offset; we always render Portland time). */
export function wall(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], date: `${m[1]}-${m[2]}-${m[3]}`, minutes: +m[4] * 60 + +m[5] };
}

export function pad(n) { return String(n).padStart(2, '0'); }

/** Portland "today" as YYYY-MM-DD for a given Date. */
export function portlandDate(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function dayOfWeek(dateStr) { // 0=Sun
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "10:30 AM" from minutes since midnight. */
export function fmtTime(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}

/** Parse "9:00 am", "10 am", "1:30 PM" -> minutes. */
export function parseClock(s) {
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return null;
  let h = +m[1] % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return h * 60 + (m[2] ? +m[2] : 0);
}
