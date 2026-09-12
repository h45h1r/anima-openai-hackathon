# CareCircle (clinical Ask backend)

Patient-controlled clinical Ask over **live Anima** synthetic data. In this repo the **product UI is Kindred** (`../web/` on :3111). This package’s **Express server** (:8787) powers Kindred’s Ask / Care tabs via `/care-api` rewrites.

Do **not** present `carecircle/web` (:3112) as a second app users must open.

## Ownership split

| Concern | Owner | Where |
| --- | --- | --- |
| People / circle / sharing levels / GP consent / `?as=` | **Kindred** | Repo `web/` + `sim-app/` · [http://localhost:3111](http://localhost:3111) |
| Grounded Ask / Results evidence / disclosure holds (API) | **CareCircle server** | `server/` · :8787 (called from Kindred) |

Ask filtering maps Kindred sharing levels onto Anima information classes via `server/src/consent/kindredBridge.ts`.

## Architecture

- `server/` — Node/Express API (port **8787**); holds the Anima bearer key — **this is what Kindred uses**
- `web/` — Legacy MVP Next UI (:3112); optional for isolated CareCircle demos only
- Ask streaming — **SSE** `POST /api/ask/stream` (`text/event-stream`, `data: {json}` frames + `: ping` keepalives). REST `POST /api/ask` remains as fallback.
- CareCircle store — Ask filter grants (Kindred levels), disclosure holds, agent traces (`data/store.json`)

## Setup (API for Kindred)

```bash
cd carecircle
cp .env.example .env
# Edit .env — at minimum set ANIMA_API_KEY
npm install
npm run dev --prefix server
# or from repo root: npm run dev:ask
```

- API: http://localhost:8787  
- Product UI: http://localhost:3111 (Ask / Care tabs)

From the repo root, `npm run dev:product` starts sim + Ask API + Kindred together.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANIMA_API_KEY` | Yes* | Team bearer key from simulator Team & API key |
| `ANIMA_TEAM_NAME` | Alt | Create/join world via `POST /api/keys` if no key |
| `ANIMA_BASE_URL` | No | Default `https://sim.animahacks.com` |
| `OPENAI_API_KEY` | No | Optional nicer phrasing; deterministic grounded answers work without it |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |
| `PORT` | No | API port (8787) |
| `CARE_CIRCLE_API_ORIGIN` | No | Next rewrite target (default `http://localhost:8787`) |
| `NEXT_PUBLIC_API_BASE` | No | Leave empty in dev (same-origin `/api` via Next rewrite) |
| `NEXT_PUBLIC_KINDRED_ORIGIN` | No | Kindred web origin for Circle deep-links (default `http://localhost:3111`) |

\*Or paste the key / team name under **Connection / API** (header menu) if the server has no env key.


## Agent stack (hackathon MVP)

- **OpenAI Responses API** via `@animahealth/adk/openai` (not Chat Completions). Direct `/v1/responses` is the only fallback.
- **Conversational Ask**: short user/assistant history is kept per patient+viewer (UI thread + server store) and sent with each ask so follow-ups work (“what about my kidney results?”). Answers still ground on live consent-filtered evidence — no invented numbers.
- **Intent routing**: portable `server/src/agent/intent.ts` + human consent copy in `server/src/consent/messages.ts` (share/consent vs BP vs labs).
- **Question-aware labs**: kidney / LFT / FBC / named analytes are retrieved separately so every blood question does not dump the same full panel.
- **Prompt caching**: static system prefix is tagged `cacheable` + `prompt_cache_key` / explicit breakpoint; dynamic role, memories, and permitted evidence are appended *after* the cacheable prefix (see `server/src/agent/prompts.ts`).
- **Slim skills (4)**: `get_permitted_evidence`, `appointment_assist`, `remember`, `update_consent` — consent/disclosure stay code-enforced; `update_consent` prefers Kindred sharing levels.
- **Memories**: ADK `memory()` + local embedder, scoped by `patientId` + `viewerId`. UX prefs only — clinical dumps are rejected.
- **Streaming**: `POST /api/ask/stream` emits SSE `data:` frames with `status` / `tool` / `token` / `final`. Ask UI prefers SSE; REST `/api/ask` remains as fallback.

## Tests & evals

```bash
npm test
```

Covers consent leakage, held results, identity manipulation, grounding/visualisation equality, patient binding, booking safety, memory scoping, kidney/follow-up routing.

## Judge demo journey

1. Open http://localhost:3112 — with `ANIMA_API_KEY` in server `.env`, CareCircle **auto-connects** and opens **Amira Khan (`SIM-000001`)** on **Home** (no Patients click). Hard-refresh if you still see an old Connect gate.
2. Use **Switch patient** (header / menu) only if you want another live patient. If Amira is missing from live search, the app shows a clear error and the switcher — it never invents a patient.
3. **Ask CareCircle**: “Explain my latest blood tests” → then “What about my kidney results?” — second answer should focus on U&E / eGFR / creatinine / potassium, not repeat the full FBC dump. Thread stays visible on the left; **Who can see what** on the right shows viewer, Kindred level, holds, and last sources.
4. Open a **source** chip; inspect visualisation if measurements exist
5. Switch **Ask as** to **Sarah** then **Tom** → ask again (thread resets per viewer). Tom starts with minimal sharing (no results); John is Kindred **Only practical**.
6. As patient, open **Circle** → assign Tom **Important updates** → re-ask as Tom; or open **Kindred Circle** for the product access surface
7. **My care**: review next appointments, use **Ask about next appointment** or **Draft request (no book)** — stages stay preference/request/slots, never a fake booking
8. Optional: Home → **Advance clock +121m** → Refresh (new labs may enter **held** for family)
9. Bad key / override: header menu → **Connection / API**

## Smoke API script

```bash
# With ANIMA_API_KEY or ANIMA_TEAM_NAME in env / .env
npm run smoke
```

## Notes / honesty

- Family Ask personas (Sarah/John/Tom) are CareCircle demo identities mapped to Kindred sharing levels — not Anima accounts and not Kindred’s dynamic circle membership.
- Disclosure holds are CareCircle-owned; Anima does not document a patient-informed signal.
- Booking uses `book_appointment` only after explicit `confirmBook` with exact slot fields.
- No silent fixture fallback when Anima fails — UI shows error / disconnected / sparse states.
- Full dual-app live sync of Kindred Postgres → CareCircle Ask is not required for this cut; levels are mirrored locally for Ask + deep-linked to Kindred for authority.
