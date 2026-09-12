'use client';

import { useMemo, useState } from 'react';
import ResultChart from '../components/ResultChart';
import { useApp } from '../lib/state';
import { Button, Card } from '../components/ui';

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
      <Card tone="plum">
        <h1 className="page-title">Results</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Consent blocks this — laboratory results are outside this viewer&apos;s Kindred sharing level. Switch to the
          patient or update Circle (sharing levels).
        </p>
      </Card>
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
    <Card className="stack">
      <h1 className="page-title">Results</h1>
      <p className="muted">
        Exact values from Anima-derived measurements. Reference bands are illustrative simulator intervals.
      </p>
      {app.status === 'error' ? (
        <div className="error-banner">
          {app.error || 'Results failed to load.'}{' '}
          <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      ) : null}
      {!visible.length ? (
        <div className="info-banner">
          {measurements.length
            ? 'Held result — values are held for disclosure (or filtered). Clear holds below, or switch viewer.'
            : 'No numeric result history was normalised from the live patient view.'}{' '}
          <Button type="button" variant="secondary" size="sm" disabled={retrying} onClick={() => void retry()}>
            {retrying ? 'Refreshing…' : 'Retry'}
          </Button>
        </div>
      ) : (
        <>
          <div className="pill-row">
            {visible.map((a) => (
              <Button
                key={a.id}
                type="button"
                variant={chart?.id === a.id ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSelected(a.id)}
              >
                {a.name}
              </Button>
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
            {(Array.from(new Set(measurements.map((m: { resourceId: string }) => m.resourceId))) as string[]).map(
              (id) => (
              <Button
                key={id}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => app.setDisclosure(id, heldIds.has(id) ? 'cleared' : 'held')}
              >
                {heldIds.has(id) ? 'Clear' : 'Hold'} {id.slice(0, 12)}
              </Button>
            ),
            )}
          </div>
        </>
      )}
    </Card>
  );
}
