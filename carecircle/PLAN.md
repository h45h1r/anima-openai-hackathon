# CareCircle Implementation Plan

## Goal
Ship a polished vertical slice: connect to live Anima → select a returned patient (Amira Khan `SIM-000001` preferred) → ask grounded questions → inspect sources → visualise real measurements → switch family roles → edit consent → clarify appointments safely.

## Stack
- **Web:** Next.js 16 App Router + TypeScript (Kindred-aligned)
- **API:** Node.js + Express + TypeScript (SSE Ask stream + REST fallback)
- **Store:** JSON file / in-memory CareCircle store (consent, disclosure holds, agent traces)
- **LLM:** OpenAI optional — deterministic grounded answers always; richer phrasing when `OPENAI_API_KEY` set
- **Anima:** Server-side adapter only; key never in browser

## Verified Anima contract (OpenAPI 3.1 from `https://sim.animahacks.com/openapi.json`)
| Operation | Use |
| --- | --- |
| `POST /api/keys` | Optional join/create team world |
| `GET /api/team` | Validate bearer key + scopes |
| `GET /api/sites/{site}/patients?q=&offset=` | Live patient search (page size 30) |
| `GET /api/sites/{site}/view?patient=&limit=&offset=` | Patient clinical resources |
| `GET /api/sites/{site}/appointments?date=` | Appointment book for a UTC day |
| `POST /api/sites/{site}/actions` | Typed actions incl. `book_appointment`, `create_task` |
| `GET/POST /api/clock` | Read / advance simulation time (`paused:true` required to advance) |

Sites used: `gp`, `hospital`, `pharmacy` (when scoped).

## Architecture
1. React SPA → CareCircle API
2. Session holds Anima key server-side
3. Consent + disclosure gate filter evidence **before** answer generation
4. Observable tool trace returned with every answer

## Build sequence
1. Plan + OpenAPI lock-in (this file)
2. Anima adapter + session connect/search/view
3. Normaliser → appointments, results, documents, tasks, messages
4. Consent policy engine + disclosure holds
5. Agent harness (retrieve → filter → answer → cite)
6. React UI: Connect, Patients, Home, Ask, My care, Results, People & access
7. Tests/evals + smoke curl journey
8. README + `.env.example`

## Blockers / open items
| Item | Status |
| --- | --- |
| User Anima team key | **Still needed from user** — wire via `ANIMA_API_KEY`, Connect UI, or `ANIMA_TEAM_NAME`. Live smoke not completed in this session (team-create probe skipped). |
| User OpenAI key | Optional `OPENAI_API_KEY`; deterministic grounded answers work without it |
| Exact lab result resource `kind` / `data` shape | Defensive normaliser covers common shapes; validates against live view once key present |
| Patient-informed disclosure signal | **Not in Anima** — CareCircle-owned held/cleared gate |
| Booking | Supported via `book_appointment` only after explicit confirm; MVP clarifies preference vs request vs slots vs confirmed |

## Completed in this build
- Server Anima adapter (OpenAPI-verified endpoints)
- Consent + disclosure policy engine + evals (12/12 pass)
- Agent harness with tool observations, grounding, visualisation
- React UI: Connect, Patients, Home, Ask, My care, Results, People and access
- README, `.env.example`, smoke script, PLAN.md

