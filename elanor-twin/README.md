# Eleanor Twin

An interactive Next.js digital twin for the synthetic NHS SIM record `SIM-000006`.
It visualises Eleanor Chen's cross-service signals and offers a local, record-scoped
question interface. It does not contain the NHS SIM team key and makes no network
requests at runtime.

## Body asset

The interactive body uses `public/models/soma-x-base-body.obj`, sourced from the
`Anny/base_body.obj` asset in [NVlabs/SOMA-X](https://github.com/NVlabs/SOMA-X).
SOMA-X is licensed under Apache-2.0. Its published body template is neutral, so
the app uses it as Eleanor's avatar without claiming that the mesh itself is a
sex-specific anatomical model.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Included data labels

- Activity and device signals
- Blood, metabolic and liver result labels
- Acute mobility pathway
- Community-care pathway
- Contact and accessibility context
- Open simulation workflow items

The application deliberately labels all results as synthetic simulation data rather
than clinical guidance.
