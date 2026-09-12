# Kindred

A care companion for older people and patients with chronic conditions. Patients choose what to share with family members and carers; their choices appear in the GP consent view.

**One product surface:** open Kindred at [http://localhost:3111](http://localhost:3111). Home, Circle (people / sharing levels), Ask (clinical, grounded), Care / Results, and Family all live in that single shell. Personas use Kindred `?as=` — not a separate CareCircle UI.

[Mission statement](mission-statement.md) · [Design system](docs/design-system.md) · [Neon setup](sim-app/deployment/README.md) · [Backend details](sim-app/README.md)

## What you run

| Piece | Path | Port | Role |
| --- | --- | --- | --- |
| **Kindred app** (the product) | `web/` | **:3111** | Single UI: Circle, Ask, Care, Family |
| Companion backend | `sim-app/` | **:4192** | Postgres consent / GP observation |
| Clinical Ask API (optional backend) | `carecircle/server/` | **:8787** | SSE Ask / live Anima context — **no separate web UI required** |

Kindred owns people, circle, sharing levels, and `?as=` personas. The CareCircle **server** powers clinical Ask behind `/care-api` in Kindred. Do not open `carecircle/web` (:3112) for the demo — that Next app is leftover MVP UI.

## Start the single app

Use Node.js 22.18 or newer.

```sh
npm ci --prefix web
npm ci --prefix sim-app
npm ci --prefix carecircle
cp web/.env.example web/.env.local
cp carecircle/.env.example carecircle/.env   # set ANIMA_API_KEY for clinical Ask
```

Set `SIM_API_KEY` in `web/.env.local` for the Kindred patient record. Set `ANIMA_API_KEY` in `carecircle/.env` for grounded Ask (same Anima team key is fine).

```sh
# One command: companion + Ask API + Kindred UI
npm run dev:product
```

Or three terminals:

```sh
npm run dev:sim    # :4192
npm run dev:ask    # :8787 CareCircle Express only
npm run dev        # :3111 Kindred
```

Open **one URL:** [http://localhost:3111/?as=eleanor&tab=circle](http://localhost:3111/?as=eleanor&tab=circle)

- Circle / sharing levels → Kindred
- Ask / Care → Kindred tabs calling the Ask API
- Switch family viewers → account menu (`?as=`)

GP consent (optional): [http://localhost:4192/gp/consent/?patient=SIM-000006](http://localhost:4192/gp/consent/?patient=SIM-000006)

Without `dev:ask` / `ANIMA_API_KEY`, Circle and companion chat still work; the Ask and Care tabs show how to start the clinical API.

## CareCircle server (backend only)

```bash
cd carecircle
cp .env.example .env   # ANIMA_API_KEY; optional OPENAI_API_KEY
npm install
npm run dev --prefix server   # or from repo root: npm run dev:ask
```

See [`carecircle/README.md`](./carecircle/README.md) for Ask streaming, evals, and Amira demo notes. The Express API is the integration surface; Kindred rewrites `/care-api/*` → `:8787/api/*`.

## What's connected

- Add a family member with sharing off, choose a sharing level or individual categories, and remove their access.
- Ask uses CareCircle SSE grounding and maps Kindred `?as=` personas onto Ask viewers; Circle remains the access authority.
- Consent changes persist through `sim-app/`, which updates the GP observation and consent audit in one PostgreSQL transaction.
- Clinical records for Kindred home/circle are read from the configured Anima simulator; Ask evidence comes from the CareCircle Anima session.

The existing people and family relationships are demo configuration, not verified relatives. The persona switcher and demo sessions are not production authentication.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `web/` | **The product** — Kindred shell, Circle, Ask, Care, Family |
| `carecircle/server/` | Clinical Ask / context API used by Kindred |
| `carecircle/web/` | Legacy MVP UI (not required; do not present as the product) |
| `sim-app/` | Companion backend, GP consent, Neon notes |
| `docs/` | Design system and research notes |

## ADK

```sh
git submodule update --init vendor/adk
```

See [ADK notes](docs/adk-notes.md). The Kindred runtime has not yet been migrated to ADK; CareCircle Ask uses ADK on the Express server.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
