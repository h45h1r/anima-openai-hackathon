# CareCircle (removed)

CareCircle is **not** a separate product in this repo anymore.

All clinical Ask / Anima grounding / SSE functionality lives inside **Kindred**:

- UI: `../web/` (tabs Ask + Care)
- API: `../web/src/app/api/care/*` and `../web/src/lib/carecircle/server/`
- Env: `../web/.env.local` (`ANIMA_API_KEY`, `OPENAI_API_KEY`, …)

Run Kindred only:

```sh
npm run dev          # http://localhost:3111
# or with companion:
npm run dev:product
```

Do not start a second UI or Express process for CareCircle.
