# Kindred web app

**The product.** Home, Circle, Ask, Care, and Family — one app on [http://localhost:3111](http://localhost:3111).

```sh
# From the repository root:
cp web/.env.example web/.env.local   # set SIM_API_KEY + ANIMA_API_KEY
npm start --prefix sim-app           # companion :4192
npm run dev                          # Kindred :3111 (includes clinical Ask)
```

Clinical Ask runs in-process under `/api/care` (no separate CareCircle server). Configure `ANIMA_API_KEY` and optional `OPENAI_API_KEY` in `web/.env.local`.

Consent and circle membership live in the local app PostgreSQL database through the companion API. `COMPANION_BASE_URL` defaults to `http://localhost:4192`.

The Circle preserves the original layout and six sharing categories. Add a family member to create them with no access, select their permissions, or remove them from the circle. The GP page shows the same saved choices and audit history.

This is a local demo with a persona switcher, not verified patient or clinician authentication.
