import { useMemo, useState } from 'react';
import ResultChart from '../components/ResultChart';
import { useApp } from '../lib/state';

export default function ResultsPage() {
  const app = useApp();
  const measurements = app.context?.measurements || [];
  const [retrying, setRetrying] = useState(false);
  const byAnalyte = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of measurements) {
      const list = map.get(m.analyteId) || [];
      list.push(m);
      map.set(m.analyteId, list);
    }
    return [...map.entries()].map(([id, series]) => ({
      id,
      name: series[0].displayName,
      unit: series[0].unit,
      series: [...series].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt)),
      referenceLow: series.find((s) => s.referenceLow !== undefined)?.referenceLow,
      referenceHigh: series.find((s) => s.referenceHigh !== undefined)?.referenceHigh,
      referenceLabel: series.find((s) => s.referenceLabel)?.referenceLabel,
    }));
  }, [measurements]);
  const [selected, setSelected] = useState<string | null>(null);

  const viewerId = app.session?.activeViewerId || 'patient';
  const viewer = app.policy?.viewers?.find((v: any) => v.viewerId === viewerId);
  const canSeeLabs =
    viewer?.relationship === 'self' ||
    app.policy?.grants?.some(
      (g: any) => g.viewerId === viewerId && g.informationClass === 'laboratory_results' && g.allowed,
    );
  const heldIds = new Set(
    (app.policy?.disclosures || []).filter((d: any) => d.state === 'held').map((d: any) => d.resourceId),
  );

  async function retry() {
    setRetrying(true);
    try {
      await app.refreshContext();
    } finally {
      setRetrying(false);
    }
  }

  if (!canSeeLabs) {
    return (
      <div className="panel">
        <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>Results</h1>
        <div className="info-banner">
          Consent blocks this — laboratory results are outside this viewer&apos;s CareCircle access. Switch to the
          patient or update People and access.
        </div>
      </div>
    );
  }

  const visible = byAnalyte
    .map((a) => ({
      ...a,
      series: a.series.filter((m) => !heldIds.has(m.resourceId) || viewer?.relationship === 'self'),
    }))
    .filter((a) => a.series.length);

  const chart = (selected && visible.find((a) => a.id === selected)) || visible[0];

  return (
    <div className="panel stack">
      <h1 style={{ fontFamily: 'var(--serif)', marginTop: 0 }}>Results</h1>
      <p className="muted">
        Exact values from Anima-derived measurements. Reference bands are illustrative simulator intervals.
      </p>
      {app.status === 'error' ? (
        <div className="error-banner">
          {app.error || 'Results failed to load.'}{' '}
          <button type="button" className="secondary" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : null}
      {!visible.length ? (
        <div className="info-banner">
          {measurements.length
            ? 'Held result — values are held for disclosure (or filtered). Clear holds below, or switch viewer.'
            : 'No numeric result history was normalised from the live patient view.'}{' '}
          <button type="button" className="secondary" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Refreshing…' : 'Retry'}
          </button>
        </div>
      ) : (
        <>
          <div className="pill-row">
            {visible.map((a) => (
              <button
                key={a.id}
                type="button"
                className={chart?.id === a.id ? undefined : 'secondary'}
                onClick={() => setSelected(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>
          {chart ? (
            <ResultChart
              title={`${chart.name} (${chart.unit})`}
              unit={chart.unit}
              points={chart.series.map((m) => ({
                date: m.sampledAt,
                value: m.value,
                label: m.displayName,
                evidenceId: m.evidenceId,
              }))}
              referenceLow={chart.referenceLow}
              referenceHigh={chart.referenceHigh}
              referenceLabel={chart.referenceLabel || 'Illustrative simulator interval'}
            />
          ) : null}
          <div className="section-title">Disclosure holds (demo)</div>
          <p className="muted small">
            Newly detected lab resources after first sync start held for family. Clear explicitly — Anima has no
            patient-informed flag.
          </p>
          <div className="pill-row">
            {[...new Set(measurements.map((m: any) => m.resourceId))].map((id: string) => (
              <button
                key={id}
                type="button"
                className="secondary"
                onClick={() => app.setDisclosure(id, heldIds.has(id) ? 'cleared' : 'held')}
              >
                {heldIds.has(id) ? 'Clear' : 'Hold'} {id.slice(0, 12)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
