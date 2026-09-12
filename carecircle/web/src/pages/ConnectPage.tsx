import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { DEFAULT_ANIMA_BASE, DEFAULT_PATIENT_ID, useApp } from '../lib/state';
import { Button, Card } from '../components/ui';

type HealthInfo = {
  ok: boolean;
  openaiConfigured?: boolean;
  openaiModel?: string | null;
  animaEnvKeyConfigured?: boolean;
  animaTeamNameConfigured?: boolean;
};

/**
 * Connection / API settings — not the cold-start gate when ANIMA_API_KEY is in server env.
 * Cold load auto-connects in AppProvider.bootstrap(); this page is the escape hatch.
 */
export default function ConnectPage() {
  const app = useApp();
  const nav = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [teamName, setTeamName] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULT_ANIMA_BASE);
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

  // If bootstrap already landed a patient, leave Connect unless user explicitly opened settings.
  // Stay on page when already connected so they can override the key.
  const canUseEnv = Boolean(health?.animaEnvKeyConfigured || health?.animaTeamNameConfigured);
  const canSubmit = Boolean(apiKey.trim() || teamName.trim() || canUseEnv);
  const alreadyInApp = Boolean(app.session?.connected && app.session?.selectedPatientId);

  async function finishAfterConnect() {
    const result = await app.selectDefaultPatient();
    if (result.outcome === 'ready') {
      nav(`/patient/${result.patientId}`, { replace: true });
      return;
    }
    nav('/patients', { replace: true });
  }

  async function connectWith(input: { apiKey?: string; teamName?: string; baseUrl?: string }) {
    setBusy(true);
    try {
      await app.connect(input);
      await finishAfterConnect();
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
    await connectWith({ baseUrl });
  }

  return (
    <section className="hero-connect">
      <div>
        <h1>{alreadyInApp ? 'Connection / API' : 'CareCircle'}</h1>
        <p className="lead">
          {alreadyInApp
            ? 'Override the Anima key or base URL if the live connection fails. The team key stays on the CareCircle server.'
            : 'Understand synthetic clinical information with the people you trust — grounded in live Anima records, filtered by your consent boundaries.'}
        </p>
        {alreadyInApp ? (
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            Demo patient defaults to <strong>{DEFAULT_PATIENT_ID}</strong> after reconnect.{' '}
            <button type="button" className="linkish" onClick={() => nav(`/patient/${app.session?.selectedPatientId}`)}>
              Back to Home
            </button>
          </p>
        ) : null}
        <Card style={{ marginTop: '1.5rem', maxWidth: 520 }}>
          <form className="stack" onSubmit={onSubmit}>
            <p className="muted small">
              Prefer the server <code>.env</code> key for demos — paste only to override. Never commit secrets.
            </p>

            {health?.animaEnvKeyConfigured ? (
              <div className="stack" style={{ gap: '0.75rem' }}>
                <p className="muted small">
                  Server already has <code>ANIMA_API_KEY</code>
                  {alreadyInApp ? ' — reconnect without pasting.' : ' — cold load usually auto-connects; use this if that failed.'}
                  {health.openaiConfigured ? (
                    <>
                      {' '}
                      OpenAI refine ready (<code>{health.openaiModel || 'gpt-4o-mini'}</code>).
                    </>
                  ) : (
                    <> OpenAI refine off (deterministic answers still work).</>
                  )}
                </p>
                <Button type="button" variant="plum" disabled={busy} onClick={onUseServerEnv}>
                  {busy ? 'Connecting…' : alreadyInApp ? 'Reconnect with server key' : 'Connect with server key'}
                </Button>
                <p className="muted small">Or override below with a pasted key / team name.</p>
              </div>
            ) : health?.animaTeamNameConfigured ? (
              <div className="stack" style={{ gap: '0.75rem' }}>
                <p className="muted small">
                  Server has <code>ANIMA_TEAM_NAME</code> — connect without pasting a key.
                </p>
                <Button type="button" variant="plum" disabled={busy} onClick={onUseServerEnv}>
                  {busy ? 'Connecting…' : 'Connect with server team name'}
                </Button>
              </div>
            ) : health ? (
              <p className="muted small">
                No server Anima key detected — paste a team bearer key or team name below.
              </p>
            ) : (
              <p className="muted small pulse-soft">Checking server env…</p>
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
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy
                ? 'Connecting…'
                : apiKey.trim() || teamName.trim()
                  ? 'Connect with pasted values'
                  : canUseEnv
                    ? 'Connect using server env'
                    : 'Connect to Anima'}
            </Button>
          </form>
        </Card>
      </div>
      <div className="hero-visual" aria-hidden="true" />
    </section>
  );
}
