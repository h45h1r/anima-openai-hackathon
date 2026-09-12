import { useMemo } from 'react';

export default function ResultChart({
  title,
  unit,
  points,
  referenceLow,
  referenceHigh,
  referenceLabel,
}: {
  title: string;
  unit?: string;
  points: { date: string; value: number; label: string; evidenceId: string }[];
  referenceLow?: number;
  referenceHigh?: number;
  referenceLabel?: string;
}) {
  const sorted = useMemo(() => [...points].sort((a, b) => a.date.localeCompare(b.date)), [points]);
  const width = 640;
  const height = 220;
  const pad = 28;
  const values = sorted.map((p) => p.value);
  const min = Math.min(...values, referenceLow ?? Infinity);
  const max = Math.max(...values, referenceHigh ?? -Infinity);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - pad * 2)) / Math.max(sorted.length - 1, 1);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const path = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');

  return (
    <div className="chart-wrap">
      <div className="section-title">{title}</div>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {referenceLow !== undefined && referenceHigh !== undefined ? (
          <rect
            x={pad}
            y={y(referenceHigh)}
            width={width - pad * 2}
            height={Math.max(2, y(referenceLow) - y(referenceHigh))}
            fill="rgba(15,122,108,0.12)"
          />
        ) : null}
        <path d={path} fill="none" stroke="#0f7a6c" strokeWidth="3" />
        {sorted.map((p, i) => (
          <g key={p.evidenceId}>
            <circle cx={x(i)} cy={y(p.value)} r="5" fill="#065247">
              <title>{`${p.value} ${unit || ''} on ${new Date(p.date).toLocaleDateString('en-GB')}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      {referenceLabel ? <p className="muted small">{referenceLabel}</p> : null}
      <table className="chart-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Value</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.evidenceId}>
              <td>{new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</td>
              <td>{p.value}</td>
              <td>{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
