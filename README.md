# Kindred

A care companion for older people and patients with chronic conditions. Patients choose what to share with family members and carers; their choices appear in the GP consent view.

The main app is the existing **Kindred** Next.js app in `web/`. Its Circle screen manages family membership, sharing levels and six permission categories. Consent changes persist through the backend in `sim-app/`, which updates the GP observation and consent audit in one PostgreSQL transaction.

[Mission statement](mission-statement.md) · [Design system](docs/design-system.md) · [Neon setup](sim-app/deployment/README.md) · [Backend details](sim-app/README.md)

## Two surfaces in this repo

| Surface | Path | Ports | Role |
| --- | --- | --- | --- |
| **Kindred** (core) | `web/` + `sim-app/` | web **:3111**, sim **:4192** | Design-system app, **Circle consent / sharing levels**, companion backend on main |
| **CareCircle** (MVP demo) | `carecircle/` | web **:3112**, API **:8787** | Clinical **Ask / Results** on live Anima; Ask filter maps Kindred levels — not a competing access product |

### Who owns what

- **Kindred owns people / access / control** — Circle diagram, three sharing levels (Everything / Only practical / Important updates), dynamic family members, `?as=` personas, companion Postgres consent.
- **CareCircle owns Ask / clinical demo** — grounded answers, disclosure holds, Results, My care. Its Circle tab mirrors Kindred levels for Ask filtering and deep-links to Kindred Circle; it does **not** present the old class matrix as primary access UX.

This PR lands CareCircle as a portable stack beside Kindred. It does **not** rewrite Ask into Kindred Next routes or replace Kindred consent/GP flows.

## CareCircle MVP

[`carecircle/`](./carecircle/) is a patient-controlled family communication demo on synthetic Anima clinical data, with consent-gated answers and an optional OpenAI refine pass. It matches Kindred’s **Next.js App Router** + **SSE** coding language and design system, while keeping a separate Express API for live Anima ADK agents.

```bash
cd carecircle
cp .env.example .env   # add ANIMA_API_KEY; optional OPENAI_API_KEY
npm install
npm run dev            # API :8787 · Next web :3112
```

Open CareCircle at [http://localhost:3112](http://localhost:3112). For access control, open Kindred Circle at [http://localhost:3111/?tab=circle](http://localhost:3111/?tab=circle) (or CareCircle → **Circle**, which links there).

See [`carecircle/README.md`](./carecircle/README.md) for env vars, demos (patient Amira), Ask streaming, and evals.

## Start Kindred locally

Use Node.js 22.18 or newer. Install each service's locked dependencies:

```sh
npm ci --prefix web
npm ci --prefix sim-app
cp web/.env.example web/.env.local
```

Set `SIM_API_KEY` in `web/.env.local` to read the synthetic patient record. Agent API keys are optional; the existing scripted fallback works without them. Keep credentials in ignored environment files.

Start the backend and frontend in separate terminals:

```sh
# Terminal 1: uses the existing local app PostgreSQL database
npm run dev:sim

# Terminal 2
npm run dev
```

Open [Kindred](http://localhost:3111/?as=eleanor&tab=circle) and [GP consent](http://localhost:4192/gp/consent/?patient=SIM-000006).

The local backend expects the imported `anima_sim_app_20260912` database on `/tmp`. A fresh checkout needs either a database restore following [the backend guide](sim-app/README.md), or Neon credentials. For the prepared Neon development branch, use `npm run dev:neon` instead of `dev:sim`. Database dumps and connection credentials are not included in Git.

## What's connected

- Add a family member with sharing off, choose a sharing level or individual categories, and remove their access.
- The app, approved consent requests and agent consent tools use the same persisted permission store. The GP page receives live updates.
- Clinical records are read from the configured Anima simulator. The local copy also provides GP, hospital, pharmacy, community, wearable, messaging and reception screens.
- Consent writes target the configured companion backend. They create a local GP observation; they are **not** native FHIR Consent writes to the remote simulator.

The existing people and family relationships are demo configuration, not verified relatives. The persona switcher and demo sessions are not production authentication. Consent and memberships persist in PostgreSQL; conversations and other agent state still use the app's in-memory store. See the [deployment notes](sim-app/deployment/README.md) for the remaining work before public hosting.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `web/` | Active Kindred app, Circle, family views and agent tools |
| `carecircle/` | CareCircle hackathon MVP (Express API + Next.js web, SSE Ask) |
| `sim-app/` | Copied simulator frontend, local workflow API, consent service and tests |
| `sim-app/deployment/` | Neon project metadata, migration verification and hosting configuration examples |
| `replica/` | Read-only capture/import tools, SQL schema and database documentation |
| `docs/` | Simulator/ADK research and example agent integrations. Start with the [design system](docs/design-system.md) before building a screen |
| `prototype/` | Earlier GP reconstruction retained for the research notes; not the default app |
| `vendor/adk/` | Pinned upstream ADK submodule used by the research examples |

The original simulator assets retain attribution in [`sim-app/public/ATTRIBUTION.txt`](sim-app/public/ATTRIBUTION.txt). They are required by the copied screens.

## ADK

The ADK is pinned as a Git submodule. Fetch it only when working on the agent integration examples:

```sh
git submodule update --init vendor/adk
```

Its dependencies and compiled output are not committed here. See [ADK notes](docs/adk-notes.md) for installation and the current integration plan. The web app's runtime has not yet been migrated to ADK.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

`npm test` runs the backend, NHS demo model and earlier prototype tests. Manual `sim-app/integration-*.mjs` scripts also exist; they write synthetic test records and some advance the simulation clock, so run them deliberately against a development database.
