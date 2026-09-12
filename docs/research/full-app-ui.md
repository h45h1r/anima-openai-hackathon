# Full original application UI mirror

The local application now serves the original compiled Anima simulator interface rather than a hand-reconstructed screen subset. Files were captured from `https://sim.animahealth.com/` on 12 September 2026. No upstream write requests were used.

## Coverage

`sim-app/public` contains **218 original source assets**, approximately **42.3 MB**, plus the local bootstrap, root redirect, asset manifest and attribution notice.

The original entry pages are preserved at their original routes:

- `/control/`: neighbourhood map and desktop launcher.
- `/gp/`: patient records, consultations, appointment book, problems, allergies, medication, results, tasks and care coordination.
- `/gp/documents/`, `/gp/messages/`, `/gp/telephony/`.
- `/hospital/`, `/pharmacy/`, `/community/`.
- `/wearables/`, `/wearables/messages/`.
- `/cis2/`: staff identity interface.
- `/docs/`: linked handbook pages, API explorer, stylesheet, runtime, main script and all 30 chunk files declared by its runtime.

The mirror includes nine original brand SVGs, both desktop/map backgrounds, five map destination images, the looping neighbourhood video and ten zoom/return videos. Dynamic media paths were resolved from the actual map IDs and animation phases in the source. No paths were guessed. No external fonts were referenced by these app assets.

The original compiled JavaScript, CSS and media files are unchanged. The original HTML entry pages have a `/local-bootstrap.js` script inserted before the application scripts. That script sets only:

- `sim-key`: `local-demo`
- `sim-team`: `local-copy`
- `sim-world`: `team-8942268fa18a`

It also removes the onboarding session marker and adds a small **Local copy** label to the original footer. It contains no upstream credential. The root `/` redirects to `/control/`.

`sim-app/public/ATTRIBUTION.txt` identifies the source. `asset-manifest.json` records each original URL, path, upstream SHA-256, local byte count and whether the asset came from the previously captured cache. No source ownership is claimed.

## Network behavior and missing assets

The core clients call relative `/api/...` URLs, so the original application code reaches the local API automatically. No API URL rewrite was needed. The handbook contains upstream build metadata and canonical links referring to `http://localhost:8080`; tested handbook navigation still loads its scripts and pages from the current origin. Official government-policy links remain ordinary external links.

All discovered asset downloads succeeded. Direct module imports and HTML asset references resolve locally. An isolated Chrome check of `/control/`, `/docs/`, `/docs/systemtwo/`, `/docs/api/` and `/cis2/` reported **zero missing static requests, zero browser page errors and zero remote network requests**.

This verification covers asset delivery and original frontend rendering. API behavior, mutation persistence and deeper application workflows depend on the local server implementation and must be verified separately. Original staff identity UI is present; that alone does not assert a complete local OIDC implementation.

## Local runtime verification

The writable app runs at `http://localhost:4192/control/`, backed by `anima_sim_app_20260912`. The archive remains separate: its 50,000 patients, 375,140 resources and zero events were checked after local workflow tests.

The original UI was used to save and reload a GP consultation, create an appointment session and booking, send a patient message reply, handle a reception call with persisted notes, and complete fictional staff sign-in. The organiser screen lists the local team, its real record changes and working clock controls.

Real HTTP integration checks cover queued/delivered messages, internal-note exclusion from patient views and action responses, idempotent replay, signed hospital notes and addenda, pharmacy checkout/dispensing/collection, community visit completion and wearable readings. Browser verification found and corrected a missing patient conversation field and a wearable unit mismatch. A separate response-projection check found and fixed internal notes leaking into patient reply responses. Existing test records were repaired in the working database.

There are 46 passing unit tests across appointments, clinical workflows, correspondence, pharmacy, reception, identity and local organiser routes. Manual integration scripts live under `sim-app/integration-*.mjs` and write local test data.

The final browser smoke check covered all 12 entry screens listed above: zero JavaScript page errors, zero HTTP failures and zero remote network requests during loading. This checks those screen loads and the named workflows, not every possible UI action.

The local identity flow implements PKCE S256, single-use codes, signed ID tokens and sessions, using fictional staff already in the captured database. It does not use real NHS credentials or authenticators. The original hidden simulation engine, population generation, organiser incidents and background agents are unavailable. Those organiser operations return explicit unsupported errors. See [local app setup and limits](../../sim-app/README.md).
