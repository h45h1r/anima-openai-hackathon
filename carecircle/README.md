# CareCircle

Patient-controlled family communication over **live Anima** synthetic clinical data.

UI follows the shared **Kindred design system** ([`docs/design-system.md`](../docs/design-system.md)): tokens in `web/src/app/globals.css`, primitives in `web/src/components/ui.tsx`, Next.js App Router + fonts aligned with Kindred `web/`.

## Architecture

- `web/` — **Next.js 16** App Router UI (port **3112**), Kindred-style tokens/fonts
- `server/` — Node/Express API (port **8787**); holds the Anima bearer key
- Ask streaming — **SSE** `POST /api/ask/stream` (`text/event-stream`, `data: {json}` frames + `: ping` keepalives), same event shapes as before (`status` / `tool` / `token` / `stream_reset` / `final` / `error`). REST `POST /api/ask` remains as fallback.
- CareCircle store — consent, disclosure holds, agent traces (`data/store.json`)

Anima OpenAPI contract used: `https://sim.animahacks.com/openapi.json` (cached as `docs-openapi.json`).

Kindred itself lives at repo `web/` (port **3111**) and uses SSE for app-state sync (`GET /api/events`). CareCircle keeps a separate Express API for live Anima ADK agents, but matches Kindred’s coding language (Next + SSE) and visual system.

## Setup

```bash
cd "/Users/amishralhan/Documents/ChatGPT/Anima x OpenAI Hackathon/anima-openai-hackathon/carecircle"
cp .env.example .env
# Edit .env — at minimum set ANIMA_API_KEY (or use Connect UI / ANIMA_TEAM_NAME)
npm install
npm run dev
```

- UI: http://localhost:3112  
- API: http://localhost:8787  

Next rewrites `/api/*` → Express (`CARE_CIRCLE_API_ORIGIN`, default `http://localhost:8787`). Leave `NEXT_PUBLIC_API_BASE` empty in local dev so the browser talks same-origin `/api` (Anima key never reaches the client).

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

\*Or paste the key / team name under **Connection / API** (header menu) if the server has no env key.


## Agent stack (hackathon MVP)

- **OpenAI Responses API** via `@animahealth/adk/openai` (not Chat Completions). Direct `/v1/responses` is the only fallback.
- **Conversational Ask**: short user/assistant history is kept per patient+viewer (UI thread + server store) and sent with each ask so follow-ups work (“what about my kidney results?”). Answers still ground on live consent-filtered evidence — no invented numbers.
- **Intent routing**: portable `server/src/agent/intent.ts` + human consent copy in `server/src/consent/messages.ts` (share/consent vs BP vs labs).
- **Question-aware labs**: kidney / LFT / FBC / named analytes are retrieved separately so every blood question does not dump the same full panel.
- **Prompt caching**: static system prefix is tagged `cacheable` + `prompt_cache_key` / explicit breakpoint; dynamic role, memories, and permitted evidence are appended *after* the cacheable prefix (see `server/src/agent/prompts.ts`).
- **Slim skills (4)**: `get_permitted_evidence`, `appointment_assist`, `remember`, `update_consent` — consent/disclosure stay code-enforced.
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
3. **Ask CareCircle**: “Explain my latest blood tests” → then “What about my kidney results?” — second answer should focus on U&E / eGFR / creatinine / potassium, not repeat the full FBC dump. Thread stays visible on the left; **Who can see what** on the right shows viewer, consent, holds, and last sources.
4. Open a **source** chip; inspect visualisation if measurements exist
5. Switch viewer to **Sarah** then **Tom** → ask again (thread resets per viewer)
6. As patient, open **People** → change a grant → Save → re-ask as Tom
7. **My care**: review next appointments, use **Ask about next appointment** or **Draft request (no book)** — stages stay preference/request/slots, never a fake booking
8. Optional: Home → **Advance clock +121m** → Refresh (new labs may enter **held** for family)
9. Bad key / override: header menu → **Connection / API**

## Smoke API script

```bash
# With ANIMA_API_KEY or ANIMA_TEAM_NAME in env / .env
npm run smoke
```

## Notes / honesty

- Family viewers (Sarah/John/Tom) are CareCircle demo identities, not Anima accounts.
- Disclosure holds are CareCircle-owned; Anima does not document a patient-informed signal.
- Booking uses `book_appointment` only after explicit `confirmBook` with exact slot fields.
- No silent fixture fallback when Anima fails — UI shows error / disconnected / sparse states.
