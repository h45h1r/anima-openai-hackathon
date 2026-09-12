# Anima × OpenAI Hackathon — CareCircle

CareCircle is a patient-controlled family communication demo on synthetic Anima clinical data, with consent-gated answers and an optional cheap OpenAI refine pass.

## App

See [`carecircle/`](./carecircle/) for the runnable MVP (API + web).

Quick start:

```bash
cd carecircle
cp .env.example .env   # add ANIMA_API_KEY; optional OPENAI_API_KEY (model default gpt-4o-mini)
npm install
npm run dev            # API :8787 · web :5173
```

Also see `mission-statement.md` and `ali-prompts.md` in this repo root.
