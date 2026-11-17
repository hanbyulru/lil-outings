// Builds the self-hosted basemap in web/map/:
//   portland.pmtiles  Protomaps vector tiles for the metro (from the daily planet build, ~70 MB)
//   fonts/, sprites/  label glyphs and road-shield/town icons used by the Protomaps "light" style
// Needs the pmtiles CLI (https://github.com/protomaps/go-pmtiles: `go install github.com/protomaps/go-pmtiles@latest`,
// binary is `go-pmtiles`, or a release binary named `pmtiles`); set PMTILES_BIN to point at it.
// Network: build.protomaps.com, protomaps.github.io. Re-run every few months to pick up map edits.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { addDays, portlandDate } from '../src/lib/time.js';

const BBOX = '-123.05,45.28,-122.35,45.70'; // keep in sync with web/map.js BOUNDS
const MAXZOOM = 15;
const ASSETS = 'https://protomaps.github.io/basemaps-assets';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447']; // Latin, Latin Extended, punctuation
const SPRITES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];

const bin = process.env.PMTILES_BIN || ['pmtiles', 'go-pmtiles'].find((b) => { try { execFileSync(b, ['version'], { stdio: 'ignore' }); return true; } catch { return false; } });
if (!bin) { console.error('pmtiles CLI not found. Install it (see the header of this file) or set PMTILES_BIN.'); process.exit(1); }

let build = null;
for (let i = 0; i < 10 && !build; i++) {
  const d = addDays(portlandDate(), -i).replace(/-/g, '');
  const res = await fetch(`https://build.protomaps.com/${d}.pmtiles`, { method: 'HEAD' });
  if (res.ok) build = `https://build.protomaps.com/${d}.pmtiles`;
}
if (!build) { console.error('No Protomaps build found in the last 10 days.'); process.exit(1); }

mkdirSync('web/map', { recursive: true });
console.log(`Extracting ${build} -> web/map/portland.pmtiles`);
execFileSync(bin, ['extract', build, 'web/map/portland.pmtiles', `--bbox=${BBOX}`, `--maxzoom=${MAXZOOM}`], { stdio: 'inherit' });

const save = async (url, file) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};
for (const f of FONTS) {
  mkdirSync(`web/map/fonts/${f}`, { recursive: true });
  for (const r of RANGES) await save(`${ASSETS}/fonts/${encodeURIComponent(f)}/${r}.pbf`, `web/map/fonts/${f}/${r}.pbf`);
}
mkdirSync('web/map/sprites', { recursive: true });
for (const s of SPRITES) await save(`${ASSETS}/sprites/v4/${s}`, `web/map/sprites/${s}`);
console.log(`Done: portland.pmtiles ${(statSync('web/map/portland.pmtiles').size / 1e6).toFixed(0)} MB, ${FONTS.length} fonts, sprites.`);
