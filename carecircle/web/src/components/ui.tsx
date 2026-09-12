import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

/** Two overlapping rings — patient + circle (Kindred mark). */
export function CareCircleMark({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="12" r="6.5" stroke={color} strokeWidth="2.2" />
      <circle cx="15" cy="12" r="6.5" stroke={color} strokeWidth="2.2" />
    </svg>
  );
}

export function Pill({
  children,
  tone = 'neutral',
  title,
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'moss' | 'plum' | 'amber' | 'rust' | 'ok' | 'warn';
  title?: string;
  className?: string;
}) {
  const toneClass =
    tone === 'ok' || tone === 'moss'
      ? 'moss'
      : tone === 'warn' || tone === 'amber'
        ? 'amber'
        : tone === 'plum'
          ? 'plum'
          : tone === 'rust'
            ? 'rust'
            : '';
  return (
    <span title={title} className={`pill ${toneClass} ${className}`.trim()}>
      {children}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'plum' | 'danger';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: BtnProps) {
  const v =
    variant === 'secondary'
      ? 'secondary'
      : variant === 'ghost'
        ? 'ghost'
        : variant === 'plum'
          ? 'plum'
          : variant === 'danger'
            ? 'danger'
            : '';
  const s = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '';
  return (
    <button type={type} className={`${v} ${s} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}

export function Card({
  children,
  tone,
  className = '',
  style,
}: {
  children: ReactNode;
  tone?: 'amber' | 'plum' | 'moss';
  className?: string;
  style?: CSSProperties;
}) {
  const t = tone ? `tone-${tone}` : '';
  return (
    <div className={`panel ${t} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function Avatar({
  initials,
  color = 'var(--moss)',
  size = 36,
  label,
}: {
  initials: string;
  color?: string;
  size?: number;
  label?: string;
}) {
  return (
    <span
      className="font-display"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        color: 'white',
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
        userSelect: 'none',
      }}
      aria-label={label || initials}
      title={label || initials}
    >
      {initials}
    </span>
  );
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}

export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  });
}

export function fmtLongDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
}
