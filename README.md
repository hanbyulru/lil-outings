# Lil' Outings (prototype)

Kids' events and places for the Portland, OR metro, aggregated from several sources, tagged by Claude, and served through a filterable site (age, interest, category, cost, area/neighborhood/ZIP, date, map).

Zero npm dependencies. Node 22+.

```
npm run refresh:demo   # offline run on sample feeds -> data/public/*.json
npm run refresh        # live run (needs network; set ANTHROPIC_API_KEY for LLM tagging)
npm run serve          # http://localhost:8787 (PORT=... to change)
npm test               # 34 tests
npm run build:map      # web/map/: Portland map tiles + fonts (needs the pmtiles CLI, see scripts/build-map.js)
npm run build:snapshot # dist/snapshot.html: one self-contained file with data inlined
```

## Status: read this first

The prototype was built in a sandbox with no internet access. So:

- **Nothing here has been run against the live sources.** `refresh:demo` feeds the *real adapters* sample responses written in each source's real format. All demo events are fictional samples, labeled as such in the UI.
- Adapters are marked in `config/sources.json`:

| Source | Adapter | Status |
|---|---|---|
| Multnomah County Library (`multcolib.org/events-classes`) | `multcolib` | verified Nov 2026: server-rendered list, fetched per kids' age filter (babies, kids & family, tweens) until past the horizon; branch coordinates from the map on `/hours-and-locations`. Cloudflare rate-limits, so requests are spaced 4s (`min_gap_ms`); a full run takes ~2.5 min |
| Washington County libraries (BiblioCommons) | `bibliocommons` | verified: gateway JSON, 50 per page (paged), branch coordinates from `mapLocation.centrePoint` |
| Fort Vancouver Regional Libraries (BiblioCommons, `fvrlibraries`) | `bibliocommons` | verified Nov 2026 (moved off LibraryMarket). Kids' audiences only; Gorge/Klickitat branches excluded |
| Oregon City Public Library (LibCal iCal) | `ical` | verified; rooms only, so a fixed library venue; take-home kits excluded |
| Wilsonville Public Library (CivicPlus iCal) | `ical` | verified; library + community categories; event link comes from DESCRIPTION |
| Lake Oswego and West Linn libraries (Drupal 7 calendar) | `drupal_calendar` | verified; month views give titles and start times only (no descriptions) |
| Oak Lodge & Gladstone libraries (Clackamas County events) | `clackamas_events` | verified; library department list, UTC times |
| Happy Valley Library (LibCal iCal) | `ical` | verified Nov 2026; "CLOSED" entries dropped |
| Ledding Library, Milwaukie (Revize calendar JSON) | `revize_calendar` | verified; repeating events expanded from RRULE blocks |
| Lake Oswego Parks & Recreation (city calendar groups 19, 14, 37273, 22) | `drupal_calendar` | verified; venue from the title ("Indoor Playground at LORAC"), else town center |
| West Linn Parks & Recreation | `drupal_calendar` | verified; town-level pin |
| Milwaukie Community Events (Revize) | `revize_calendar` | verified; parades, concerts in the park |
| Wilsonville Parks & Recreation (CivicPlus categories 25, 27) | `ical` | verified |
| City of Sherwood and City of Happy Valley events (WordPress The Events Calendar API) | `tribe_events` | verified; Sherwood library and meetings left out |
| THPRD (Beaverton/Aloha; CivicPlus categories 24 Events, 35 Nature Center) | `ical` + geocoding | verified; venue split from LOCATION and geocoded |
| Tualatin Parks & Recreation (WordPress/Juicebox; audiences Babies-Preschool and Kids) | `juicebox_events` | verified; list has no dates, so one detail call per event (cached a day) |
| North Clackamas Parks & Recreation, ncprd.org/events (Nuxt/Strapi `__NUXT_DATA__`) | `nuxt_strapi_events` | verified; Indoor Playground Tue/Thu occurrences |
| City of Gresham events (`/webservices/events/` JSON; Arts, Community, Parks & Rec, Youth) | `gresham_events` | verified; addresses geocoded |
| City of Vancouver, WA calendar (Events tab) | `vancouver_events` | verified; addresses geocoded |
| Portland Parks & Recreation `/parks/events` | `portland_gov` | list structure confirmed. Volunteer days and public meetings are excluded at the source (`exclude_labels`) |
| PP&R class listings (`/parks/recreation/activities/sports`) | `portland_gov_programs` | experimental. Structure read from the live Sports page: region > age group > Class/Description/Location/Register tables. Adult and intergenerational sections skipped. These are *programs* (no dates/times/prices), shown on the Classes tab with a link to ActiveNet. Other category pages (Arts, Dance, Music, Swim Lessons, School Break Camps) need their URLs checked and added to `config/sources.json` |
| PP&R ActiveNet sessions (dates, times, prices) | none yet | TODO: needs a look at the registration site's search API from a networked machine |
| Manual / curated (`data/manual/*.json`) | `manual` | works |
| Places: curated seed + OpenStreetMap (Overpass) | `osm` | OSM live call unverified; seed coordinates are approximate, DiG PDX's address and coordinates are placeholders |
| Tigard, Hillsboro (block automated requests), Tualatin, THPRD, NCPRD, Beaverton, Gresham, Vancouver parks calendars; venue JSON-LD | various | TODO |

First thing to do on your machine: `npm run refresh -- --no-llm` and look at `meta.json` source results and `data/cache`.

## Pipeline

source registry -> adapters -> normalize (Pacific time, DST) -> dedupe (title + date + 5-min start bucket + venue, or URL; higher-trust source wins) -> drop past/far-future -> classify -> drop non-kid events (adult classes, volunteer days, meetings, teen-only) -> geo (nearest neighborhood centroid) -> `events.json`, `places.json`, `meta.json`, `review.json`.

## LLM tagging

`src/classify/llm.js` calls the Anthropic Messages API (`ANTHROPIC_API_KEY`; model via `LLM_MODEL`, default `claude-haiku-5-5`). Listings are sent as untrusted data with a controlled vocabulary (`config/vocab.json`); output is validated and anything outside the vocabulary is dropped. Items go to `review.json` when confidence < 0.6, validation issues occur, or the LLM and the rules classifier disagree on whether it is for kids. Results are cached by content hash. If the API fails or no key is set, the deterministic rules classifier (`rules.js`) takes over, so the pipeline never blocks.

## Adding a source

1. Add an entry to `config/sources.json` with `type` (`ical`, `multcolib`, `portland_gov`, `bibliocommons`, `jsonld`, `manual`), `trust`, `status` and `config`.
2. For a new format, add an adapter in `src/adapters/` returning raw events and register it in `adapters/index.js`.
3. Add a parser test with a saved sample response.

Manual events: JSON arrays in `data/manual/*.json` with `title, start, end, venue_name, lat, lon, url, description, price_text`.

## Scheduling

Run `npm run refresh` daily (cron, or a scheduled GitHub Action that commits `data/public`). Be polite: the HTTP layer sets a User-Agent, spaces requests per host and caches on disk. Check each source's terms before shipping publicly.

## Known limitations

- Neighborhood/area comes from nearest centroid (approximate); the ZIP table is centroids, not boundaries. The Sauvie Island tree farm lands in N.
- Dedupe is conservative; cross-source near-duplicates with different titles will remain.
- Items at the same spot share one pin with a "+N" badge; tapping it lists them (first four, the rest are in the list).

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` runs daily at 12:17 UTC (and on every push to `main`, and on demand): tests, live refresh, map tiles (cached, rebuilt monthly), `npm run build:site`, then publishes `_site/` to GitHub Pages. Nothing generated is committed.

One-time setup: in the repo, Settings > Pages > Source: **GitHub Actions**. Optional: add an `ANTHROPIC_API_KEY` repository secret for Claude tagging. Pages is free for public repositories; a private repo needs a paid GitHub plan.

## Analytics
Google Analytics 4, Measurement ID `G-VY8N6BJX9H` (tag in `web/index.html`; not loaded on localhost). Besides page views, `track()` in `web/app.js` sends:

| Event | Parameters | When |
|---|---|---|
| `choose_interest` | `interest` (books, art, nature, science, trains, play, other, all) | headline "what" menu (each toggle; `all` = cleared) |
| `choose_age` | `age` | headline "who" menu (each toggle; `all` = cleared) |
| `choose_day` | `day` (today, tomorrow, week, weekend) | headline "when" menu |
| `choose_area` | `area` (region, district or town id; `anywhere`) | location menu |
| `switch_tab` | `tab` (events, places) | Events/Places toggle |
| `choose_place_kind` | `kind` | Places list |
| `tap_map_pin` | | map pins |
| `open_event_details` | `event_title` | an event's Details link |
| `open_place_site` | `place_name`, `kind` | a place's website link |
| `open_subscribe` | `from` (header, holidays) | the Get updates dialog opens |
| `open_partner` | | the Partner with us dialog opens |
| `contact` | `from` (missing_place, missing_event, partner), `kind` | an email link to hello@liloutings.com is clicked |
| `subscribe` | `from` | an email is submitted (the address itself is never sent to Google Analytics) |

To report on a parameter, register it in GA: Admin > Custom definitions > Create custom dimension (event scope).

## Map

MapLibre GL (vendored in `web/vendor/`, see its README) draws a self-hosted Protomaps extract of the metro, `web/map/portland.pmtiles` (~70 MB, built by `npm run build:map`). The browser reads it in byte ranges, so the server supports HTTP Range requests; a static host must too (most do). No API key or third-party tile service. The Protomaps "light" style is re-tinted to the site palette in `web/map.js`, with its own POI icons turned off. Map data is © OpenStreetMap contributors (ODbL); the credit shows on the map. The single-file snapshot, or any page where the map can't load, falls back to the illustrative SVG map.

The ~70 MB tile file is near GitHub's 100 MB limit: keep it out of git (rebuild with `build:map` on deploy) or use Git LFS.
- Event details change; the UI links to the source for confirmation.
