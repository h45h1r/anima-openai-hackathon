# Vercel deployment

- Kindred: https://kindred-anima.vercel.app
- GP consent: https://kindred-anima-api.vercel.app/gp/consent/?patient=SIM-000006
- Simulator: https://kindred-anima-api.vercel.app/control/

Both Vercel projects run in London and use the `production` branch of the Neon `kindred-anima` project (`empty-sunset-32555267`), database `kindred`.

The `web` project uses `DATABASE_URL` for durable agent messages, sharing levels, requests and activity. It reads clinical records and saves consent through `sim-app`; that backend uses the same production database. Consent changes and their GP record are committed together. See `web/RUNTIME-PERSISTENCE.md` for agent storage details.

Production environment variables are stored in Vercel. Local Neon credentials remain in ignored `sim-app/.env.neon.production` and `.env.neon.development`. Never commit these files. `COMPANION_BYPASS_SECRET` lets the frontend call the protected backend; it must remain server-side.

Deploy from the repository root:

```sh
vercel deploy --cwd sim-app --prod --scope ali-nergizs-projects
vercel deploy --cwd web --prod --scope ali-nergizs-projects
```

The patient app is public and uses synthetic demo patient/persona selection. The simulator backend remains protected by Vercel sign-in; server-side calls use the configured bypass secret.

Server-sent events reconnect every 55 seconds and read committed database state across instances. Agent replies become visible after the request commits. The simulator clock runs when requested; a permanent background timer is not used on Vercel. Reception telephony remains a local-only feature because its receptionist connections are held in one Node process. These restrictions do not affect Kindred's consent and chat flows.


Ask and Kindred are both in the patient app: `/?tab=ask` and `/?tab=kindred`. Ask uses the Anima ADK with the existing OpenAI key. Its clinical source defaults to `SIM_BASE_URL` and `SIM_API_KEY`; optional `ANIMA_BASE_URL` and `ANIMA_API_KEY` override them. `OPENAI_MODEL` controls Ask (default `gpt-4o-mini`), while `AGENT_MODEL` controls Kindred.

Ask sessions, short chat history, memories and runs persist in `public.kindred_care_state`, one row per session. Separate visitors do not block each other's Ask requests. Each request refreshes sharing from the companion consent database; browser sharing presets do not override it. Patient switching is stored in a browser cookie, and Kindred runtime rows remain scoped by patient.
