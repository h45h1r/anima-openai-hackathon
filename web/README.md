# Kindred web app

Use the existing [Kindred Circle](http://localhost:3111/?as=eleanor&tab=circle) with the [GP consent page](http://localhost:4192/gp/consent/?patient=SIM-000006).

```sh
# From the repository root, in separate terminals:
npm start --prefix sim-app
npm run dev --prefix web -- --port 3111
```

The clinical record and agent keep their existing configuration in `web/.env.local`. Consent and circle membership now live in the local app PostgreSQL database through the companion API. `COMPANION_BASE_URL` defaults to `http://localhost:4192`.

The Circle preserves the original layout and six sharing categories. Add a family member to create them with no access, select their permissions, or remove them from the circle. The GP page shows the same saved choices and audit history. `lab_results` maps to the backend's `results` category; `mental_health` is stored separately.

App switches, approved consent requests and agent consent tools all use the same awaited persistence path. The UI reports success only after saving. Invalid choices and stale member versions are rejected. The GP observation and permission changes commit together. Removing someone clears their scopes and removes them from the active persona list and family group.

Existing demo members and current permissions were copied into the shared database when this connection was made. These names and relationships remain demo configuration, not independently verified relatives. New databases start with no saved memberships. Clinical data and conversations keep the existing app's behavior; resetting/reloading them does not reset saved consent.

This is a local demo with a persona switcher, not verified patient or clinician authentication. GP sync targets the local simulator copy. It does not create a native FHIR Consent resource or update the remote simulator. The older `/companion/` page now redirects here.

Validation: TypeScript and ESLint checks pass. Browser checks covered add with 0/6 access, appointment and mood toggles appearing in GP Records, reload persistence and removal. HTTP checks rejected invalid booleans, stale versions and explicit non-patient actors without changing the stored revision.
