# CareCircle

Patient-controlled family communication over **live Anima** synthetic clinical data.

## Architecture

- `web/` — React + Vite UI (ports **5173**)
- `server/` — Node/Express API (port **8787**); holds the Anima bearer key
- CareCircle store — consent, disclosure holds, agent traces (`data/store.json`)

Anima OpenAPI contract used: `https://sim.animahacks.com/openapi.json` (cached as `docs-openapi.json`).

## Setup

```bash
cd "/Users/amishralhan/Documents/ChatGPT/Anima x OpenAI Hackathon/carecircle"
cp .env.example .env
# Edit .env — at minimum set ANIMA_API_KEY (or use Connect UI / ANIMA_TEAM_NAME)
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:8787  

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANIMA_API_KEY` | Yes* | Team bearer key from simulator Team & API key |
| `ANIMA_TEAM_NAME` | Alt | Create/join world via `POST /api/keys` if no key |
| `ANIMA_BASE_URL` | No | Default `https://sim.animahacks.com` |
| `OPENAI_API_KEY` | No | Optional nicer phrasing; deterministic grounded answers work without it |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |
| `PORT` | No | API port (8787) |
| `VITE_API_BASE` | No | Leave empty in dev (Vite proxies `/api`) |

\*Or paste the key / team name in the Connect screen.

## Tests & evals

```bash
npm test
```

Covers consent leakage, held results, identity manipulation, grounding/visualisation equality, patient binding, booking safety.

## Judge demo journey

1. Open http://localhost:5173/connect → paste Anima key (or team name) → **Connect**
2. Search **Amira** / `SIM-000001` (or any returned patient) → Open
3. **Ask CareCircle** a free-form question (e.g. latest blood tests / follow-up)
4. Open a **source** chip; inspect visualisation if measurements exist
5. Switch viewer to **Sarah** then **Tom** → ask the same question
6. As patient, open **People and access** → change a grant → Save → re-ask as Tom
7. Ask about appointments / afternoon preference — confirm stage is preference/request/slots, not fake booking
8. Optional: Home → **Advance clock +121m** → Refresh (new labs may enter **held** for family)

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
