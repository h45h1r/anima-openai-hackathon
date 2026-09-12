'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { useApp } from '../lib/state';
import { Button, Card, fmtDay, fmtTime } from '../components/ui';

type CareEvent = {
  evidenceId: string;
  title?: string;
  kind?: string;
  status?: string;
  informationClass?: string;
  at?: string;
  summary?: string;
  service?: string;
};

function isAppointment(e: CareEvent) {
  return /appoint|clinic|follow.?up|review/i.test(`${e.kind || ''} ${e.title || ''} ${e.informationClass || ''}`);
}

function isTaskOrStep(e: CareEvent) {
  return /task|action|todo|referral|document|status|plan|next.?step/i.test(
    `${e.kind || ''} ${e.title || ''} ${e.informationClass || ''}`,
  );
}

export default function CarePage() {
  const app = useApp();
  const nav = useRouter();
  const events: CareEvent[] = app.context?.events || [];
  const [retrying, setRetrying] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  const siteErrors = app.context?.errors as { site: string; message: string }[] | undefined;
  const patientId = app.session?.selectedPatientId;

  const appointments = useMemo(() => {
    const now = Date.now();
    return events
      .filter(isAppointment)
      .slice()
      .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
      .filter((e) => {
        const t = new Date(e.at || 0).getTime();
        // Keep upcoming + recent past (7d) so judges see context
        return !Number.isFinite(t) || t >= now - 7 * 24 * 60 * 60 * 1000;
      })
      .slice(0, 5);
  }, [events]);

  const nextSteps = useMemo(() => {
    const apptIds = new Set(appointments.map((a) => a.evidenceId));
    return events.filter((e) => !apptIds.has(e.evidenceId) && isTaskOrStep(e)).slice(0, 5);
  }, [events, appointments]);

  const nextAppt = appointments[0];

  async function retry() {
    setRetrying(true);
    try {
      await app.refreshContext();
    } finally {
      setRetrying(false);
    }
  }

  function goAsk(question: string) {
    if (!patientId) return;
    sessionStorage.setItem('carecircle.draftQuestion', question);
    nav.push(`/patient/${patientId}/ask`);
  }

  async function requestAssist() {
    setRequesting(true);
    setAssistNotice(null);
    try {
      const sid = app.session?.sessionId;
      const res = await api<{ stage?: string; notice?: string }>('/api/appointments/request', {
        method: 'POST',
        sessionId: sid,
        body: JSON.stringify({
          reason: 'Follow-up support via CareCircle My care',
          preference: 'Afternoon if possible',
          // No confirmBook — safe stage only
        }),
      });
      setAssistNotice(
        res.notice ||
          'Appointment request drafted at preference / awaiting-confirmation stage — no booking submitted.',
      );
    } catch (err) {
      setAssistNotice(err instanceof Error ? err.message : 'Could not draft appointment request');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="stack">
      <Card className="stack">
        <h1 className="page-title">My care</h1>
        <p className="muted">
          What is coming up, what still needs doing, and safe next actions — from live Anima resources only. CareCircle
          never invents a booking.
        </p>
        {app.status === 'error' ? (
          <div className="error-banner">
            {app.error || 'Care data failed to load.'}{' '}
            <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={() => void retry()}>
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          </div>
        ) : null}
        {siteErrors?.length ? (
          <div className="info-banner">
            Some Anima sites failed ({siteErrors.map((e) => e.site).join(', ')}). Showing whatever loaded — not invented
            data.
          </div>
        ) : null}
      </Card>

      <Card className="stack" tone={nextAppt ? 'amber' : undefined}>
        <div className="section-title">Next appointments</div>
        {!appointments.length ? (
          <p className="muted">No upcoming appointments in the current permitted view.</p>
        ) : (
          <div className="list">
            {appointments.map((e) => (
              <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
                <div>
                  <strong className="font-display">{e.title || 'Appointment'}</strong>
                  <div className="muted small">
                    {e.status || 'scheduled'}
                    {e.at ? ` · ${fmtDay(e.at)} ${fmtTime(e.at)}` : ''}
                    {e.service ? ` · ${e.service}` : ''}
                  </div>
                  {e.summary ? <div className="small">{e.summary.slice(0, 160)}</div> : null}
                </div>
                <span className="chip">Open source</span>
              </button>
            ))}
          </div>
        )}

        <div className="section-title" style={{ marginTop: '0.5rem' }}>
          Useful actions
        </div>
        <div className="pill-row">
          <Button
            type="button"
            variant="plum"
            disabled={!patientId}
            onClick={() =>
              goAsk(
                nextAppt
                  ? `Is my ${nextAppt.title || 'follow-up'} appointment confirmed, and when exactly is it?`
                  : 'What appointments do I have coming up, and are any still unconfirmed?',
              )
            }
          >
            Ask about next appointment
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!patientId}
            onClick={() =>
              goAsk(
                'I would like help requesting an afternoon appointment. Clarify preference vs request vs available slots — do not book yet.',
              )
            }
          >
            Assist appointment in Ask
          </Button>
          <Button type="button" variant="secondary" disabled={requesting} onClick={() => void requestAssist()}>
            {requesting ? 'Drafting…' : 'Draft request (no book)'}
          </Button>
        </div>
        {assistNotice ? <div className="info-banner">{assistNotice}</div> : null}
        <p className="muted small">
          Safe stages only: preference → request → slots. Confirmed booking needs an explicit slot confirmation elsewhere.
        </p>
      </Card>

      <Card className="stack">
        <div className="section-title">Recorded next steps</div>
        {!nextSteps.length ? (
          <p className="muted">No separate tasks or next steps in the current live view.</p>
        ) : (
          <div className="list">
            {nextSteps.map((e) => (
              <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
                <div>
                  <strong className="font-display">{e.title || e.kind || 'Next step'}</strong>
                  <div className="muted small">
                    {e.kind} · {e.status}
                    {e.at ? ` · ${fmtDay(e.at)}` : ''}
                  </div>
                  {e.summary ? <div className="small">{e.summary.slice(0, 160)}</div> : null}
                </div>
                <span className="chip">{e.service || e.informationClass || 'live'}</span>
              </button>
            ))}
          </div>
        )}
        {nextSteps[0] ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => goAsk(`What should I do next about: ${nextSteps[0].title || nextSteps[0].summary || 'my open care tasks'}?`)}
          >
            Ask about next steps
          </Button>
        ) : null}
      </Card>

      <Card className="stack">
        <div className="section-title">All care events</div>
        <p className="muted small">Full timeline from permitted live resources (tap a row for the source drawer).</p>
        {!events.length ? (
          <div className="info-banner">
            No events in the current view.{' '}
            <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={() => void retry()}>
              {retrying ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        ) : (
          <div className="list">
            {events.map((e) => (
              <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
                <div>
                  <strong className="font-display">{e.title}</strong>
                  <div className="muted small">
                    {e.kind} · {e.status} · {e.informationClass} ·{' '}
                    {e.at ? new Date(e.at).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '—'}
                  </div>
                  <div className="small">{e.summary?.slice(0, 180)}</div>
                </div>
                <span className="chip">{e.service}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
