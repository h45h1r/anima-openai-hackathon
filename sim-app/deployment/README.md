# Neon database deployment

Project: **kindred-anima** (`empty-sunset-32555267`). PostgreSQL 18 in AWS London (`aws-eu-west-2`). Database: `kindred`.

| Branch | ID | Use |
| --- | --- | --- |
| production | br-rough-art-za6q8z12 | Seeded production database |
| development | br-misty-bonus-zaz9y3du | Development and integration checks |

Both branches contain the `sim` clinical-data schema and `companion` membership/consent schema. They stay in one database because saving consent and the GP observation must be a single transaction. Development was branched after the verified import; subsequent development changes do not update production.

The import contains 50,000 synthetic patients and 376,047 service projections, plus saved consent members, revisions and audit history. Counts and full patient/resource JSON fingerprints matched the local snapshot. Active login sessions, request caches and local identity settings were excluded; existing family access links were invalidated. The local PostgreSQL databases remain intact. See `neon-verification.json` for the migration checkpoint.

## Connection files

Credentials are in these **ignored, mode-0600** files:

- `sim-app/.env.neon.production`
- `sim-app/.env.neon.development`

Each has `DATABASE_URL` (pooled, for the backend), `DIRECT_DATABASE_URL` (direct, for migrations) and `APP_DATABASE`. TLS certificate verification is enabled with `sslmode=verify-full`. Do not put these values in frontend code, public environment variables or Git.

The backend now accepts `DATABASE_URL`; without it, it keeps using local PostgreSQL. The existing running app was left on its local configuration. To switch its backend to Neon development, stop the backend occupying port 4192 and run from the repository root:

```sh
npm run start:neon --prefix sim-app
```

The existing Next.js app continues to reach that backend through `COMPANION_BASE_URL`. No database credentials belong in the browser.

A temporary backend on port 4194 was used for verification and stopped after the checks. The Neon integration test used its development branch, a separate synthetic patient, and left its test member revoked:

```sh
cd sim-app
PORT=4194 npm run start:neon
# In another terminal, from sim-app:
SIM_APP_URL=http://localhost:4194 node --env-file=.env.neon.development integration-companion.mjs
```

## Hosting configuration

Deploy the Next.js app and the simulator/consent backend as separate services. The backend needs a long-running Node process for WebSockets, live consent events and simulation jobs. Apply the production connection values through the hosting provider's secret settings, then use the non-secret examples beside this file to set service URLs. `KINDRED_URL` controls links back to the existing patient app. `PUBLIC_ORIGIN` defines the public backend origin behind an HTTPS proxy; `COMPANION_PUBLIC_URL` controls browser-facing GP links.

Compute is set to 0.25–1 CU with a 300-second idle suspension period. A running simulator polls its clock every three seconds, so it keeps its compute active while running. Keep the background clock on one backend instance until job ownership is made explicit across replicas.

This step provisions databases, imports data and verifies connectivity. It does **not** publish the app. The current patient/GP demo sessions and persona switcher are not production authentication; the legacy simulator API is also a development API. Real identity/access enforcement is required before exposing it publicly. Conversations and agent state still use the existing app's in-memory store; consent and membership are durable in Neon.
