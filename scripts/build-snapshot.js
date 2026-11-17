// Builds dist/snapshot.html: one self-contained file with CSS, JS and the current data inlined.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = (p) => readFileSync(p, 'utf8');
const data = { events: JSON.parse(r('data/public/events.json')), places: JSON.parse(r('data/public/places.json')), programs: JSON.parse(r('data/public/programs.json')), meta: JSON.parse(r('data/public/meta.json')), geo: JSON.parse(r('config/geo.json')) };
const query = r('web/query.js').replace(/^export /gm, '');
// The snapshot is opened as a file, so web/map.js falls back to the illustrative map (no tile server).
const map = r('web/map.js').replace(/^export /gm, '');
const app = r('web/app.js').replace(/^import .*\n/gm, '');
let html = r('web/index.html');
html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>${r('web/styles.css')}</style>`);
const json = JSON.stringify(data).replace(/</g, '\\u003c');
html = html.replace('<script type="module" src="app.js"></script>', `<script>window.__DATA__=${json};</script><script type="module">${query}\n${map}\n${app}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/snapshot.html', html);
console.log('dist/snapshot.html', (html.length / 1024).toFixed(0) + ' KB');
