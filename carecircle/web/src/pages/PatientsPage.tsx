import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, type PatientSummary } from '../lib/state';

export default function PatientsPage() {
  const app = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('Amira');
  const [items, setItems] = useState<PatientSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounced = useMemo(() => q, [q]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await app.searchPatients(debounced);
        if (!cancelled) {
          setItems(res.items || []);
          setTotal(res.total ?? res.items?.length ?? 0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [debounced, app]);

  async function choose(id: string) {
    await app.selectPatient(id);
    nav(`/patient/${id}/ask`);
  }

  return (
    <div className="panel stack">
      <div>
        <h1 style={{ fontFamily: 'var(--serif)', margin: 0 }}>Choose a live patient</h1>
        <p className="muted">
          Results come only from Anima <code>GET /api/sites/gp/patients</code>. No hardcoded patient is auto-selected.
        </p>
      </div>
      <label className="field">
        Search name or SIM ID
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try Amira or SIM-000001"
          aria-label="Search patients"
        />
      </label>
      {loading ? <div className="info-banner">Searching live directory…</div> : null}
      {error ? (
        <div className="error-banner">
          {error}{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setQ((q0) => q0 + '');
              setError(null);
              setLoading(true);
              void app
                .searchPatients(debounced)
                .then((res) => {
                  setItems(res.items || []);
                  setTotal(res.total ?? res.items?.length ?? 0);
                })
                .catch((err) => setError(err instanceof Error ? err.message : 'Search failed'))
                .finally(() => setLoading(false));
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <div className="info-banner">No patients matched. Keep editing the search.</div>
      ) : null}
      <div className="list" role="list">
        {items.map((p) => (
          <button key={p.id} type="button" className="list-item" onClick={() => choose(p.id)} role="listitem">
            <div>
              <strong>{p.name}</strong>
              <div className="muted small">
                {p.id} · DOB {p.birthDate} · synthetic
              </div>
              {p.conditions?.length ? (
                <div className="muted small">{p.conditions.slice(0, 3).join(' · ')}</div>
              ) : null}
            </div>
            <span className="chip">Open</span>
          </button>
        ))}
      </div>
      <p className="muted small">Showing {items.length} of {total} (page size 30).</p>
    </div>
  );
}
