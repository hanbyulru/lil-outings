# Lil' Outings: project notes for Claude Code

Kids' events, classes and places for the Portland, OR metro. Zero npm deps, Node 22, ESM, `node:test`. Commands are in README.md.

## Product decisions (from the owner, Han Byul)
- Audience: parents/caregivers of kids 0-12. **No adult-oriented content**: volunteer days, public meetings, adult classes, teen-only programs are excluded. Filter at the source where a feed labels them (`exclude_labels`), and the classifier is the backstop.
- Content types: dated **events**, evergreen **programs** (classes without dates, e.g. PP&R), and **places** (directory).
- Landing page (Nov 2026): a daily check-in page. Headline "Something good to do with a small person [today▾] in [Portland▾]": both underlined phrases are menus. When: Today / Tomorrow / This weekend / This week. Where: anywhere, a region, a district, or a town (see Location); the choice is remembered in localStorage. The day's events are listed right under it, map on the right (on phones behind a Map toggle). From 6pm Portland time it opens on Tomorrow (`EVENING_HOUR` in `web/app.js`); "today" hides events that are already over. Below: Places and Classes. The old search/filter card is gone; filters are to be reworked.
- Filters (planned, partly removed from the UI for now): age band, 8 interests (Animals, Science, Trains, Nature, Art, Music, Dinosaurs, Books), category pills (All / Storytimes / Seasonal / Babies + Toddlers / Outdoors), free / drop-in / indoor, date, location.
- Location (owner's grouping, Nov 2026): 6 regions that feel like "a quick drive from home" (Downtown & Inner Core; SW Portland & Westside; South Metro; SE Portland & Clackamas; North, NE & East Metro; Vancouver, WA & Beyond) > districts > named towns/neighborhoods, all in `config/geo.json`. Picking a region must stay one tap; districts and towns are a "Narrow" step. A district can be in two regions (Tigard). Items get the district of the nearest named place within 5 miles (`nearestPlace` in `web/query.js`); farther out (Newberg, Sauvie Island) they show only under "anywhere". Vancouver comes from FVRL (BiblioCommons); far Gorge branches are excluded and anything 15+ miles from every named place is dropped as out of area.
- Look: Editorial direction. Palette Mosaic for big titles (h1/h2), Instrument Sans for everything else including the logo. Rounded "mosaic tile" icons, not pixel-y. Site name is "Lil' Outings".

## State of the code
- Built in a sandbox with **no internet**: no adapter has been run against a live source. `npm run refresh:demo` exercises the real adapters on fixtures in `src/offline.js` (demo data, labeled as such in the UI).
- First live run (Nov 2026): `pdx_parks`, `pdx_parks_classes` and `wccls` work as written. `mcl` now scrapes multcolib.org/events-classes (`multcolib` adapter, verified). OSM Overpass is unverified (connection reset from the sandbox).
- Live runs from a proxied sandbox need `NODE_USE_ENV_PROXY=1` (Node's fetch ignores HTTPS_PROXY otherwise). The offline demo caches under `data/cache/offline-http` so it never feeds the live run.
- Sources added Nov 2026: FVRL (Vancouver), Oregon City, Wilsonville, Lake Oswego, West Linn, Oak Lodge & Gladstone (see README table). Several give titles only, so tagging leans on titles; Claude handles that better than the rules fallback.
- More to explore (Nov 2026): pills from `config/vocab.json` `explore` (Indoor Playgrounds, Public Playgrounds, Art, Science, Nature, Farms, History, Trains & Planes, Recurring Classes & Memberships) over the places directory; Classes also lists PP&R class series. Curated places (`config/places.seed.json`) only with an address confirmed by OSM/Nominatim or consistent sources; OSM places get pills from their tags (`exploreFor`).
- City Parks & Rec calendars added: Lake Oswego, West Linn, Milwaukie, Wilsonville, Sherwood, Happy Valley (README table).
- Next jobs: Parks & Rec calendars for Tigard and Hillsboro (block bots), Tualatin, THPRD, NCPRD, Beaverton, Gresham, Vancouver; ActiveNet dated-session adapter for PP&R; review UI for `review.json`.
- Map: real basemap done (MapLibre + self-hosted Protomaps tiles, `web/map.js`); same-spot items share one pin with a list card.
- Hosting: GitHub Pages via `.github/workflows/deploy.yml` (daily refresh + deploy). The site is static (`npm run build:site` -> `_site/`); `src/server.js` is for local dev.

## Conventions
- Adapters return raw events/places/programs; normalization, dedupe, tagging and geo happen in `src/pipeline.js`.
- LLM tagging output is validated against `config/vocab.json`; listings are untrusted input. Never let model output add vocabulary.
- Every parser gets a fixture test. Keep `web/query.js` free of Node APIs (shared by server and browser).
- Place/ZIP coordinates are hand-entered approximate centers (`config/geo.json`). The old NW/N/NE/SW/SE quadrants are gone.
