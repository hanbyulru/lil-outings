import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { filterEvents, filterPlaces, filterPrograms } from '../web/query.js';
import { GEO } from './lib/geo.js';
import { portlandDate } from './lib/time.js';

const PORT = +(process.env.PORT || 8787);
const DATA = process.env.DATA_DIR || 'data/public';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.pbf': 'application/x-protobuf', '.pmtiles': 'application/octet-stream' };

const load = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const parseLoc = (q) => q.zip ? { zip: q.zip } : q.neighborhood ? { neighborhood: q.neighborhood } : q.area ? { area: q.area } : null;
const parseAge = (q) => (q.age_min != null && q.age_max != null ? [+q.age_min, +q.age_max] : null);

/**
 * Static files, with HTTP Range support: the map archive (web/map/portland.pmtiles, ~70 MB) is read by the browser
 * in small byte ranges, never whole.
 */
function sendFile(req, res, file) {
  const size = statSync(file).size;
  const headers = { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers?.range || '');
  if (m && (m[1] || m[2])) {
    let start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  return createReadStream(file).pipe(res);
}

export function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const q = Object.fromEntries(url.searchParams);
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  try {
    if (url.pathname === '/api/meta') return send(200, load('meta.json'));
    if (url.pathname === '/api/geo') return send(200, GEO);
    if (url.pathname === '/api/events') {
      const meta = load('meta.json');
      const opts = { age: parseAge(q), interest: q.interest, category: q.category, when: q.when || 'today', loc: parseLoc(q), free: q.free === '1', dropin: q.dropin === '1', indoor: q.indoor === '1', sort: q.sort, radius: q.radius ? +q.radius : undefined };
      return send(200, filterEvents(load('events.json'), opts, { today: q.today || meta.today || portlandDate(), geo: GEO }));
    }
    if (url.pathname === '/api/places') {
      const opts = { age: parseAge(q), interest: q.interest, category: q.category, loc: parseLoc(q), free: q.free === '1', indoor: q.indoor === '1' };
      return send(200, filterPlaces(load('places.json'), opts, { geo: GEO }));
    }
    if (url.pathname === '/api/programs') {
      return send(200, filterPrograms(load('programs.json'), { age: parseAge(q), category: q.category, loc: parseLoc(q) }, { geo: GEO }));
    }
    // static
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p === '/data/events.json' || p === '/data/places.json' || p === '/data/programs.json' || p === '/data/meta.json') return send(200, readFileSync(join(DATA, p.slice(6)), 'utf8'));
    if (p === '/data/geo.json') return send(200, GEO);
    const file = normalize(join('web', decodeURIComponent(p)));
    if (!file.startsWith('web' + sep) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: 'not found' });
    return sendFile(req, res, file);
  } catch (err) {
    return send(500, { error: String(err.message || err) });
  }
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  http.createServer(handle).listen(PORT, () => console.log(`Lil' Outings on http://localhost:${PORT}  (data: ${DATA})`));
}
