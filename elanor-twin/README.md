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

The avatar selects a female or male display profile from the patient `gender`
field (scale and presentation colour). This makes the representation visibly
distinct while preserving that limitation of the underlying neutral mesh.

## Signal and source rules

Each displayed signal is built from the newest relevant source record, rather
than mixing it with an older result from the same panel. The source and precise
timestamp appear in the inspector. In this snapshot, for example, the liver
signal uses the 12 September 12:02 CareCircle LFT, rather than the earlier
historical bilirubin reading.

Signal colour has a visible text label as well as a colour:

- Moss — within the supplied reference range.
- Amber — 0–25% outside a supplied range, or a current care pathway that needs context.
- Rust — at least 25% outside a supplied range (activity uses personal-baseline distance).

The UI follows `docs/design-system.md`: Kindred light tokens, moss/plum/amber/rust
semantics, rounded bordered cards, pill controls, and the prescribed display,
body, and data typefaces.

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
