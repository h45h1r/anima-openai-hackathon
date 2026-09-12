# Kindred

A care companion for older people and patients with chronic conditions. Patients choose what to share with family members and carers; their choices appear in the GP consent view.

**One product:** open Kindred at [http://localhost:3111](http://localhost:3111). Home, Circle (people / sharing levels), Ask (clinical, grounded), Care / Results, and Family all live in that single shell. Personas use Kindred `?as=` — there is no separate CareCircle app.

[Mission statement](mission-statement.md) · [Design system](docs/design-system.md) · [Neon setup](sim-app/deployment/README.md) · [Backend details](sim-app/README.md)

## What you run

| Piece | Path | Port | Role |
| --- | --- | --- | --- |
| **Kindred app** (the product) | `web/` | **:3111** | UI + clinical Ask/SSE API in-process |
| Companion backend | `sim-app/` | **:4192** | Postgres consent / GP observation |

Kindred owns people, circle, sharing levels, and `?as=` personas. Clinical Ask (Anima grounding, SSE) runs as Kindred routes under `/api/care/*` — no second UI and no Express process on :8787.

## Start

Use Node.js 22.18 or newer.

```sh
npm ci --prefix web
npm ci --prefix sim-app
cp web/.env.example web/.env.local
```

Set in `web/.env.local`:

- `SIM_API_KEY` — Kindred patient record (Anima sim)
- `ANIMA_API_KEY` — grounded clinical Ask (same team key is fine)
- `OPENAI_API_KEY` — optional; improves Ask phrasing (deterministic grounding still works without it)

```sh
# Companion + Kindred (Ask included)
npm run dev:product
```

Or two terminals:

```sh
npm run dev:sim    # :4192
npm run dev        # :3111 Kindred (UI + clinical Ask)
```

Open **one URL:** [http://localhost:3111/?as=eleanor&tab=circle](http://localhost:3111/?as=eleanor&tab=circle)

- Circle / sharing levels → Kindred
- Ask / Care → Kindred tabs (`/api/care`)
- Switch family viewers → account menu (`?as=`)

GP consent (optional): [http://localhost:4192/gp/consent/?patient=SIM-000006](http://localhost:4192/gp/consent/?patient=SIM-000006)

Without `ANIMA_API_KEY`, Circle and companion chat still work; Ask/Care explain how to add the key.

## What's connected

- Add a family member with sharing off, choose a sharing level or individual categories, and remove their access.
- Ask uses in-process Anima grounding and maps Kindred `?as=` personas onto Ask viewers; Circle remains the access authority.
- Consent changes persist through `sim-app/`, which updates the GP observation and consent audit in one PostgreSQL transaction.
- Clinical records for Kindred home/circle are read from the configured Anima simulator.

The existing people and family relationships are demo configuration, not verified relatives. The persona switcher and demo sessions are not production authentication.

## Body view

`?tab=body` (patient and family) shows the record mapped onto a three.js figure: eight systems (heart, lungs, kidneys, sugar, liver, blood, joints, mind) computed from the live labs, problem list, medicines and wellbeing entries in `web/src/lib/body/systems.ts`. The figure is a stippled point cloud; with licensed models in `web/public/models/` (see `manifest.json` and `LICENSES.md` there) the body mesh is sampled into the same style and organ meshes light up per system. Consent applies per system: a family member without test-result access sees that system as "Not shared".

## Repository layout

| Directory | Purpose |
| --- | --- |
| `web/` | **The product** — Kindred shell, Circle, Ask, Care, Family, clinical API |
| `sim-app/` | Companion backend, GP consent, Neon notes |
| `docs/` | Design system and research notes |
| `carecircle/` | Removed as a product — see short deprecation note only |

## ADK

```sh
git submodule update --init vendor/adk
```

See [ADK notes](docs/adk-notes.md). Clinical Ask uses `@animahealth/adk` inside Kindred (`web/src/lib/carecircle/server`).

## Checks

```sh
npm test
npm run typecheck
npm run build
```
