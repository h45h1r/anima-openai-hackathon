'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_PATIENT_ID, DEFAULT_PATIENT_NAME, useApp, type PatientSummary } from '../lib/state';
import { Button, Card } from '../components/ui';

export default function PatientsPage() {
  const app = useApp();
  const nav = useRouter();
  const [q, setQ] = useState('Amira');
  const [items, setItems] = useState<PatientSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const searchPatients = app.searchPatients;
  const openingRef = useRef(false);
  const missingDefault = app.bootPhase === 'default_patient_missing';

  const runSearch = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await searchPatients(query);
        setItems(res.items || []);
        setTotal(res.total ?? res.items?.length ?? 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    },
    [searchPatients],
  );

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      void runSearch(q);
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, runSearch]);

  async function choose(id: string) {
    if (openingRef.current || openingId) return;
    openingRef.current = true;
    setOpeningId(id);
    setError(null);
    try {
      await app.selectPatient(id);
      nav.push(`/patient/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open patient');
    } finally {
      openingRef.current = false;
      setOpeningId(null);
    }
  }

  async function retryDefault() {
    setOpeningId(DEFAULT_PATIENT_ID);
    setError(null);
    try {
      const result = await app.selectDefaultPatient();
      if (result.outcome === 'ready') nav.push(`/patient/${result.patientId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open default patient');
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Card className="stack">
      <div>
        <h1 className="page-title">Switch patient</h1>
        <p className="muted">
          CareCircle opens <strong>{DEFAULT_PATIENT_NAME}</strong> (<code>{DEFAULT_PATIENT_ID}</code>) by default when
          that ID appears in live Anima search. Use this page to pick another live patient for judging.
        </p>
      </div>

      {missingDefault ? (
        <div className="error-banner" role="alert">
          {DEFAULT_PATIENT_NAME} (<code>{DEFAULT_PATIENT_ID}</code>) was not found in live Anima search. Pick another
          patient below — CareCircle will not invent a record.{' '}
          <Button type="button" variant="secondary" size="sm" disabled={Boolean(openingId)} onClick={() => void retryDefault()}>
            Retry {DEFAULT_PATIENT_ID}
          </Button>
        </div>
      ) : null}

      <label className="field">
        Search name or SIM ID
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try Amira or SIM-000001"
          aria-label="Search patients"
          disabled={Boolean(openingId)}
        />
      </label>
      {loading && !openingId ? <div className="info-banner">Searching live directory…</div> : null}
      {openingId ? <div className="info-banner pulse-soft">Opening patient…</div> : null}
      {error ? (
        <div className="error-banner">
          {error}{' '}
          <Button type="button" variant="secondary" size="sm" onClick={() => void runSearch(q)}>
            Retry
          </Button>
        </div>
      ) : null}
      {!loading && !error && !openingId && items.length === 0 ? (
        <div className="info-banner">No patients matched in live Anima. Keep editing the search.</div>
      ) : null}
      <div className="list" role="list">
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            className="list-item"
            onClick={() => void choose(p.id)}
            role="listitem"
            disabled={Boolean(openingId)}
            aria-busy={openingId === p.id}
          >
            <div>
              <strong className="font-display">{p.name}</strong>
              <div className="muted small">
                {p.id} · DOB {p.birthDate} · synthetic
                {p.id === DEFAULT_PATIENT_ID ? ' · demo default' : ''}
              </div>
              {p.conditions?.length ? (
                <div className="muted small">{p.conditions.slice(0, 3).join(' · ')}</div>
              ) : null}
            </div>
            <span className="chip">{openingId === p.id ? 'Opening…' : 'Open'}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        Showing {items.length} of {total} (page size 30). Results from Anima <code>GET /api/sites/gp/patients</code> only.
      </p>
    </Card>
  );
}
