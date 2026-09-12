# Vercel deployment

- Kindred: https://kindred-anima.vercel.app
- GP consent: https://kindred-anima-api.vercel.app/gp/consent/?patient=SIM-000006
- Simulator: https://kindred-anima-api.vercel.app/control/

Both Vercel projects run in London and use the `production` branch of the Neon `kindred-anima` project (`empty-sunset-32555267`), database `kindred`.

The `web` project uses `DATABASE_URL` for durable agent messages, sharing levels, requests and activity. It reads clinical records directly from Neon. Consent and appointment writes use `sim-app` transactions against the same production database. Consent changes and their GP record are committed together. See `web/RUNTIME-PERSISTENCE.md` for agent storage details.

Production environment variables are stored in Vercel. Local Neon credentials remain in ignored `sim-app/.env.neon.production` and `.env.neon.development`. Never commit these files. `COMPANION_BYPASS_SECRET` lets the frontend call the protected backend; it must remain server-side.

Deploy from the repository root:

```sh
vercel deploy --cwd sim-app --prod --scope ali-nergizs-projects
vercel deploy --cwd web --prod --scope ali-nergizs-projects
```

The patient app is public and uses synthetic demo patient/persona selection. The simulator backend remains protected by Vercel sign-in; server-side calls use the configured bypass secret.

Server-sent events reconnect every 55 seconds and read committed database state across instances. Agent replies become visible after the request commits. The simulator clock runs when requested; a permanent background timer is not used on Vercel. Reception telephony remains a local-only feature because its receptionist connections are held in one Node process. These restrictions do not affect Kindred's consent and chat flows.


Kindred is the single agent screen at `/?tab=kindred`. Legacy `/?tab=ask` links redirect there. The shared agent uses Anima ADK with the existing OpenAI key; the model selects its tools directly, without a topic classifier. When `DATABASE_URL` is set, the agent and patient switching query Neon directly; no Anima API key is needed. Anima settings are only a fallback for local environments without a database. `OPENAI_MODEL` optionally overrides the shared harness model; Kindred passes `AGENT_MODEL` (`gpt-5.6-sol`).

Ask sessions, short chat history, memories and runs persist in `public.kindred_care_state`, one row per session. Separate visitors do not block each other's Ask requests. Each tool and final delivery refresh sharing from the companion consent database; a consent-service failure blocks the reply; browser sharing presets do not override it. Patient switching is stored in a browser cookie, and Kindred runtime rows remain scoped by patient.

Consent regression tests and live ADK canary evals are documented in `docs/evals/README.md`. These test the agent harness with a fixed viewer; the public synthetic persona selector is not authenticated patient access.
