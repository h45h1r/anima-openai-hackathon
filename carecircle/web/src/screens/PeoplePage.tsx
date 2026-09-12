'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../lib/state';
import { Button, Card } from '../components/ui';

const KINDRED_ORIGIN =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_KINDRED_ORIGIN) || 'http://localhost:3111';

const LEVELS = [
  {
    id: 'everything' as const,
    label: 'Everything',
    blurb: 'The whole shared record (Kindred’s fullest level)',
  },
  {
    id: 'practical' as const,
    label: 'Only practical',
    blurb: 'Day-to-day help — appointments and medicines, not test results',
  },
  {
    id: 'updates' as const,
    label: 'Important updates',
    blurb: 'The big things — appointments and results',
  },
];

/**
 * Access control surface for CareCircle.
 * Kindred Circle + sharing levels are the product authority; this page mirrors
 * those three levels for Ask filtering and deep-links into Kindred to manage
 * the real circle. The old information-class matrix is intentionally gone.
 */
export default function PeoplePage() {
  const app = useApp();
  const isPatient = app.session?.activeViewerId === 'patient';
  const family = (app.policy?.viewers || []).filter((v: { viewerId: string }) => v.viewerId !== 'patient');
  const [target, setTarget] = useState(family[0]?.viewerId || 'sarah');
  const [pending, setPending] = useState<string | null>(null);

  const levelsByViewer = app.policy?.sharingLevels || {};
  const currentLevel = useMemo(() => {
    const fromMap = levelsByViewer[target];
    if (fromMap) return fromMap;
    const viewer = family.find((v: { viewerId: string }) => v.viewerId === target);
    return viewer?.sharingLevel || 'custom';
  }, [family, levelsByViewer, target]);

  const kindredCircleUrl = `${KINDRED_ORIGIN}/?tab=circle`;
  const kindredLevelsUrl = `${KINDRED_ORIGIN}/?tab=levels`;

  async function setLevel(level: 'everything' | 'practical' | 'updates') {
    if (!isPatient || pending) return;
    setPending(level);
    try {
      await app.saveSharingLevel(target, level);
    } catch {
      // error surfaced in app banner
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="stack">
      <Card className="stack">
        <h1 className="page-title">Circle and access</h1>
        <p className="muted">
          <strong>Kindred</strong> owns people, circle membership, and sharing levels. CareCircle Ask uses the same
          three levels to filter clinical answers — not a separate class matrix.
        </p>
        <div className="pill-row">
          <a href={kindredCircleUrl} target="_blank" rel="noreferrer">
            <Button type="button" variant="plum">
              Open Kindred Circle
            </Button>
          </a>
          <a href={kindredLevelsUrl} target="_blank" rel="noreferrer">
            <Button type="button" variant="secondary">
              What each level means
            </Button>
          </a>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Kindred runs at {KINDRED_ORIGIN} (Circle · Sharing levels · <code>?as=</code> personas). Start with{' '}
          <code>npm run dev</code> in the repo root / <code>web/</code>.
        </p>
      </Card>

      <Card className="stack">
        <div className="section-title">Ask demo circle</div>
        <p className="muted" style={{ marginTop: 0 }}>
          These demo personas only affect CareCircle Ask / Results on this patient. Assign a Kindred sharing level —
          the same buckets as Kindred Circle. Policy v{app.policy?.policyVersion}.
        </p>
        {!isPatient ? (
          <div
            className="info-banner"
            style={{ background: 'var(--plum-soft)', color: 'var(--plum)', borderColor: 'transparent' }}
          >
            Switch to the patient viewer to change sharing levels for the Ask demo.
          </div>
        ) : null}

        <div className="circle-orbit" aria-label="Demo circle">
          <div className="circle-centre">
            <span className="font-display">{app.session?.selectedPatientName || 'Patient'}</span>
            <span className="muted small">You</span>
          </div>
          <div className="circle-nodes">
            {family.map((v: { viewerId: string; displayName: string; sharingLevel?: string }) => {
              const level = levelsByViewer[v.viewerId] || v.sharingLevel || 'custom';
              const active = target === v.viewerId;
              return (
                <button
                  key={v.viewerId}
                  type="button"
                  className={`circle-node ${active ? 'active' : ''}`}
                  onClick={() => setTarget(v.viewerId)}
                  aria-pressed={active}
                >
                  <strong>{v.displayName.split(' · ')[0]}</strong>
                  <span className="muted small">{LEVELS.find((l) => l.id === level)?.label || level}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="section-title">Sharing level for {family.find((v: { viewerId: string }) => v.viewerId === target)?.displayName?.split(' · ')[0] || target}</div>
        <div className="level-grid">
          {LEVELS.map((l) => {
            const selected = currentLevel === l.id;
            return (
              <button
                key={l.id}
                type="button"
                className={`level-card ${selected ? 'selected' : ''}`}
                disabled={!isPatient || pending !== null}
                onClick={() => void setLevel(l.id)}
              >
                <strong className="font-display">{l.label}</strong>
                <span className="muted small">{l.blurb}</span>
                {selected ? <span className="chip" style={{ cursor: 'default' }}>Current</span> : null}
                {pending === l.id ? <span className="muted small">Saving…</span> : null}
              </button>
            );
          })}
        </div>

        <div className="pill-row">
          <Button type="button" variant="secondary" onClick={() => app.resetDemo()}>
            Reset CareCircle demo state
          </Button>
        </div>
      </Card>

      <Card className="stack">
        <div className="section-title">Audit</div>
        <ul className="small muted">
          {(app.policy?.audit || [])
            .slice()
            .reverse()
            .slice(0, 8)
            .map((a: { policyVersion: number; actor: string; message: string }, i: number) => (
              <li key={i}>
                v{a.policyVersion} · {a.actor} · {a.message}
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}
