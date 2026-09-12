'use client';

import Link from 'next/link';
import { useApp } from '../lib/state';
import { Button, Card, fmtDay } from '../components/ui';

export default function HomePage() {
  const app = useApp();
  const viewer = app.policy?.viewers?.find((v: any) => v.viewerId === app.session?.activeViewerId);
  const events = app.context?.events || [];
  const next = events.filter((e: any) => /appoint|task|follow/i.test(`${e.kind} ${e.title}`)).slice(0, 4);
  const people = (app.policy?.viewers || []).filter((v: any) => v.viewerId !== 'patient');

  return (
    <div className="stack">
      <Card>
        <h1 className="page-title">
          {viewer?.relationship === 'self'
            ? `Hello, ${app.session?.selectedPatientName}`
            : `You are viewing ${app.session?.selectedPatientName}'s shared care as ${viewer?.displayName || 'a family member'}`}
        </h1>
        <p className="muted">What would you like to understand or arrange?</p>
        <div className="pill-row">
          <Link href={`/patient/${app.session?.selectedPatientId}/ask`}>
            <Button type="button" variant="plum">
              Ask CareCircle
            </Button>
          </Link>
          <Button type="button" variant="secondary" onClick={() => app.refreshContext()}>
            Refresh live record
          </Button>
          <Button type="button" variant="secondary" onClick={() => app.advanceClock(121)}>
            Advance clock +121m
          </Button>
        </div>
      </Card>

      <div className="grid-2">
        <Card className="stack" tone={next.length ? 'amber' : undefined}>
          <div className="section-title">Needs attention</div>
          {app.context?.sparse ? (
            <div className="info-banner">Sparse data — few or no visible resources returned for this patient.</div>
          ) : null}
          {app.context?.errors?.length ? (
            <div className="error-banner">
              Some sites failed: {app.context.errors.map((e: any) => `${e.site}: ${e.message}`).join('; ')}
            </div>
          ) : null}
          {next.length ? (
            next.map((e: any) => (
              <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
                <div>
                  <strong className="font-display">{e.title}</strong>
                  <div className="muted small">
                    {e.status} · {fmtDay(e.at)}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <p className="muted">No time-sensitive items in the current permitted view.</p>
          )}
        </Card>
        <Card className="stack">
          <div className="section-title">People helping</div>
          {people.map((p: any) => (
            <div key={p.viewerId} className="list-item">
              <div>
                <strong className="font-display">{p.displayName}</strong>
                <div className="muted small">{p.relationship.replaceAll('_', ' ')}</div>
              </div>
            </div>
          ))}
          <div className="section-title">Record classes returned</div>
          <div className="pill-row">
            {(app.context?.recordClasses || []).map((c: string) => (
              <span className="chip" key={c} style={{ cursor: 'default' }}>
                {c}
              </span>
            ))}
            {!app.context?.recordClasses?.length ? <span className="muted">None yet</span> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
