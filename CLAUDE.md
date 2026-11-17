# Lil' Outings: project notes for Claude Code

Kids' events, classes and places for the Portland, OR metro. Zero npm deps, Node 22, ESM, `node:test`. Commands are in README.md.

## Product decisions (from the owner, Han Byul)
- Audience: parents/caregivers of kids 0-12. **No adult-oriented content**: volunteer days, public meetings, adult classes, teen-only programs are excluded. Filter at the source where a feed labels them (`exclude_labels`), and the classifier is the backstop.
- Content types: dated **events**, evergreen **programs** (classes without dates, e.g. PP&R), and **places** (directory).
- Landing page (Nov 2026): a daily check-in page. Headline "Something good to do with a small person [today▾] in [Portland▾]": both underlined phrases are menus. When: Today / Tomorrow / This weekend / This week. Where: anywhere, a quadrant (NW / N / NE / SW / SE) or one of its neighborhoods (from `config/geo.json`); the choice is remembered in localStorage. The day's events are listed right under it, map on the right (on phones behind a Map toggle). From 6pm Portland time it opens on Tomorrow (`EVENING_HOUR` in `web/app.js`); "today" hides events that are already over. Below: Places and Classes. The old search/filter card is gone; filters are to be reworked.
- Filters (planned, partly removed from the UI for now): age band, 8 interests (Animals, Science, Trains, Nature, Art, Music, Dinosaurs, Books), category pills (All / Storytimes / Seasonal / Babies + Toddlers / Outdoors), free / drop-in / indoor, date, location.
- Location: ZIP or area tabs NW / N / NE / SW / SE (N Portland is its own group), each with "All <area>" or a single neighborhood or suburb.
- Look: Editorial direction. Palette Mosaic for big titles (h1/h2), Instrument Sans for everything else including the logo. Rounded "mosaic tile" icons, not pixel-y. Site name is "Lil' Outings".

## State of the code
- Built in a sandbox with **no internet**: no adapter has been run against a live source. `npm run refresh:demo` exercises the real adapters on fixtures in `src/offline.js` (demo data, labeled as such in the UI).
- First live run (Nov 2026): `pdx_parks`, `pdx_parks_classes` and `wccls` work as written. `mcl` now scrapes multcolib.org/events-classes (`multcolib` adapter, verified). OSM Overpass is unverified (connection reset from the sandbox).
- Live runs from a proxied sandbox need `NODE_USE_ENV_PROXY=1` (Node's fetch ignores HTTPS_PROXY otherwise). The offline demo caches under `data/cache/offline-http` so it never feeds the live run.
- Next jobs: ActiveNet dated-session adapter for PP&R; more PP&R category pages; Beaverton/Hillsboro/Lake Oswego/Clackamas feeds; review UI for `review.json`.
- Map: real basemap done (MapLibre + self-hosted Protomaps tiles, `web/map.js`); same-spot items share one pin with a list card.
- Hosting: GitHub Pages via `.github/workflows/deploy.yml` (daily refresh + deploy). The site is static (`npm run build:site` -> `_site/`); `src/server.js` is for local dev.

## Conventions
- Adapters return raw events/places/programs; normalization, dedupe, tagging and geo happen in `src/pipeline.js`.
- LLM tagging output is validated against `config/vocab.json`; listings are untrusted input. Never let model output add vocabulary.
- Every parser gets a fixture test. Keep `web/query.js` free of Node APIs (shared by server and browser).
- Neighborhood/ZIP geo is centroid-based and approximate (`config/geo.json`).
