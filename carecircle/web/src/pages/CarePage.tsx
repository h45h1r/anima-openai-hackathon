import { useState } from 'react';
import { useApp } from '../lib/state';
import { Button, Card } from '../components/ui';

export default function CarePage() {
  const app = useApp();
  const events = app.context?.events || [];
  const [retrying, setRetrying] = useState(false);
  const siteErrors = app.context?.errors as { site: string; message: string }[] | undefined;

  async function retry() {
    setRetrying(true);
    try {
      await app.refreshContext();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card className="stack">
      <h1 className="page-title">My care</h1>
      <p className="muted">Timeline of appointments, tasks, documents and service status from live Anima resources.</p>
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
      {!events.length ? (
        <div className="info-banner">
          No events in the current view.{' '}
          <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      ) : (
        <div className="list">
          {events.map((e: any) => (
            <button key={e.evidenceId} type="button" className="list-item" onClick={() => app.openSource(e)}>
              <div>
                <strong className="font-display">{e.title}</strong>
                <div className="muted small">
                  {e.kind} · {e.status} · {e.informationClass} ·{' '}
                  {new Date(e.at).toLocaleString('en-GB', { timeZone: 'Europe/London' })}
                </div>
                <div className="small">{e.summary?.slice(0, 180)}</div>
              </div>
              <span className="chip">{e.service}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
