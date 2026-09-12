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

The projects require Vercel sign-in. The app still uses demo patient/persona selection, so deployment protection must stay enabled until real user authentication and authorization are implemented.

Server-sent events reconnect every 55 seconds and read committed database state across instances. Agent replies become visible after the request commits. The simulator clock runs when requested; a permanent background timer is not used on Vercel. Reception telephony remains a local-only feature because its receptionist connections are held in one Node process. These restrictions do not affect Kindred's consent and chat flows.
