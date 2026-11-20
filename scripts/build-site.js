// Builds _site/: the static site for GitHub Pages (or any static host that supports HTTP Range requests).
// The browser does all filtering (web/query.js), so the site is just web/ plus the published JSON.
// Admin dashboard data (run log, configured sources, the review queue) goes to admin/data/, which Cloudflare Access
// keeps behind a login (docs/admin-login.md); it is not linked from the site and robots.txt keeps crawlers out.
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';

const OUT = '_site';
const DATA = process.env.DATA_DIR || 'data/public';
for (const f of ['events.json', 'places.json', 'programs.json', 'meta.json']) {
  if (!existsSync(`${DATA}/${f}`)) { console.error(`Missing ${DATA}/${f}: run npm run refresh first.`); process.exit(1); }
}
if (!existsSync('web/map/portland.pmtiles')) console.warn('web/map/portland.pmtiles missing: the site will use the illustrative map. Run npm run build:map.');

rmSync(OUT, { recursive: true, force: true });
cpSync('web', OUT, { recursive: true });
mkdirSync(`${OUT}/data`, { recursive: true });
for (const f of ['events.json', 'places.json', 'programs.json', 'meta.json']) cpSync(`${DATA}/${f}`, `${OUT}/data/${f}`);
cpSync('config/geo.json', `${OUT}/data/geo.json`);
mkdirSync(`${OUT}/admin/data`, { recursive: true });
for (const [f, empty] of [['runs.json', '[]'], ['sources.json', '{}'], ['review.json', '[]'], ['curated.json', '[]'], ['classes.json', '[]']]) {
  if (existsSync(`${DATA}/${f}`)) cpSync(`${DATA}/${f}`, `${OUT}/admin/data/${f}`); else writeFileSync(`${OUT}/admin/data/${f}`, empty);
}
writeFileSync(`${OUT}/robots.txt`, 'User-agent: *\nDisallow: /admin/\n');
writeFileSync(`${OUT}/.nojekyll`, ''); // serve files as-is (no Jekyll processing)
console.log(`${OUT}/ ready`);
