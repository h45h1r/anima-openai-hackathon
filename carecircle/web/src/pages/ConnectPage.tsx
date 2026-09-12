import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/state';

type HealthInfo = {
  ok: boolean;
  openaiConfigured?: boolean;
  openaiModel?: string | null;
  animaEnvKeyConfigured?: boolean;
  animaTeamNameConfigured?: boolean;
};

export default function ConnectPage() {
  const app = useApp();
  const nav = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [teamName, setTeamName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://sim.animahacks.com');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<HealthInfo>('/api/health')
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canUseEnv = Boolean(health?.animaEnvKeyConfigured || health?.animaTeamNameConfigured);
  const canSubmit = Boolean(apiKey.trim() || teamName.trim() || canUseEnv);

  async function connectWith(input: { apiKey?: string; teamName?: string; baseUrl?: string }) {
    setBusy(true);
    try {
      await app.connect(input);
      nav('/patients');
    } catch {
      // error surfaced in banner
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await connectWith({
      apiKey: apiKey.trim() || undefined,
      teamName: teamName.trim() || undefined,
      baseUrl,
    });
  }

  async function onUseServerEnv() {
    // Empty body: server uses ANIMA_API_KEY / ANIMA_TEAM_NAME from .env
    await connectWith({ baseUrl });
  }

  return (
    <section className="hero-connect">
      <div>
        <h1>CareCircle</h1>
        <p className="lead">
          Understand synthetic clinical information with the people you trust — grounded in live Anima records,
          filtered by your consent boundaries.
        </p>
        <div className="panel" style={{ marginTop: '1.5rem', maxWidth: 520 }}>
          <form className="stack" onSubmit={onSubmit}>
            <p className="muted small">
              The Anima team key stays on the CareCircle server. Prefer the server <code>.env</code> key for demos —
              paste only if you need to override. Never commit secrets.
            </p>

            {health?.animaEnvKeyConfigured ? (
              <div className="stack" style={{ gap: '0.75rem' }}>
                <p className="muted small">
                  Server already has <code>ANIMA_API_KEY</code> — no paste needed.
                  {health.openaiConfigured ? (
                    <>
                      {' '}
                      OpenAI refine ready (<code>{health.openaiModel || 'gpt-4o-mini'}</code>).
                    </>
                  ) : (
                    <> OpenAI refine off (deterministic answers still work).</>
                  )}
                </p>
                <button type="button" disabled={busy} onClick={onUseServerEnv}>
                  {busy ? 'Connecting…' : 'Continue with server key'}
                </button>
                <p className="muted small">Or override below with a pasted key / team name.</p>
              </div>
            ) : health?.animaTeamNameConfigured ? (
              <div className="stack" style={{ gap: '0.75rem' }}>
                <p className="muted small">
                  Server has <code>ANIMA_TEAM_NAME</code> — connect without pasting a key.
                </p>
                <button type="button" disabled={busy} onClick={onUseServerEnv}>
                  {busy ? 'Connecting…' : 'Continue with server team name'}
                </button>
              </div>
            ) : health ? (
              <p className="muted small">
                No server Anima key detected — paste a team bearer key or team name below.
              </p>
            ) : (
              <p className="muted small">Checking server env…</p>
            )}

            <label className="field">
              Anima base URL
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} autoComplete="off" />
            </label>
            <label className="field">
              Team bearer key
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                placeholder="Optional override — paste ANIMA_API_KEY"
                autoComplete="off"
              />
            </label>
            <label className="field">
              Or team name (creates/joins via POST /api/keys)
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Optional ANIMA_TEAM_NAME"
                autoComplete="off"
              />
            </label>
            <button type="submit" disabled={busy || !canSubmit}>
              {busy
                ? 'Connecting…'
                : apiKey.trim() || teamName.trim()
                  ? 'Connect with pasted values'
                  : canUseEnv
                    ? 'Connect using server env'
                    : 'Connect to Anima'}
            </button>
          </form>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true" />
    </section>
  );
}
