"use client";

import type { Person } from "@/lib/types";
import type { ReactNode } from "react";

export function Avatar({ person, size = 36, ring = false }: { person: Person; size?: number; ring?: boolean }) {
  const isAgent = person.role === "agent";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white select-none ${ring ? "ring-2 ring-white shadow" : ""}`}
      style={{ width: size, height: size, background: person.color, fontSize: size * 0.38 }}
      aria-label={person.name}
      title={person.name}
    >
      {isAgent ? <KindredMark size={size * 0.55} /> : person.initials}
    </span>
  );
}

/** Kindred's mark: two overlapping rings — the patient and their circle. */
export function KindredMark({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="12" r="6.5" stroke={color} strokeWidth="2.2" />
      <circle cx="15" cy="12" r="6.5" stroke={color} strokeWidth="2.2" />
    </svg>
  );
}

export function Pill({ children, tone = "neutral", className = "", title }: { children: ReactNode; tone?: "neutral" | "moss" | "plum" | "amber" | "rust"; className?: string; title?: string }) {
  const tones = {
    neutral: "bg-paper text-muted border-line",
    moss: "bg-moss-soft text-moss-deep border-transparent",
    plum: "bg-plum-soft text-plum border-transparent",
    amber: "bg-amber-soft text-[#7a520c] border-transparent",
    rust: "bg-[#f8e6df] text-rust border-transparent",
  };
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  className = "",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "plum" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const v = {
    primary: "bg-moss text-white hover:bg-moss-deep",
    plum: "bg-plum text-white hover:brightness-110",
    secondary: "bg-card text-ink border border-line hover:bg-paper",
    ghost: "bg-transparent text-muted hover:bg-paper hover:text-ink",
    danger: "bg-card text-rust border border-line hover:bg-[#f8e6df]",
  }[variant];
  const s = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" }[size];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${v} ${s} ${className}`}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label, big = false, disabled = false }: { on: boolean; onChange: (v: boolean) => void; label: string; big?: boolean; disabled?: boolean }) {
  const w = big ? 56 : 44;
  const h = big ? 32 : 26;
  const knob = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative shrink-0 rounded-full transition-colors disabled:cursor-wait disabled:opacity-50 ${on ? "bg-plum" : "bg-line"}`}
      style={{ width: w, height: h }}
    >
      <span className="absolute top-[3px] rounded-full bg-white shadow transition-all" style={{ width: knob, height: knob, left: on ? w - knob - 3 : 3 }} />
    </button>
  );
}

export function LockIcon({ size = 14, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

export function Card({ children, className = "", tone }: { children: ReactNode; className?: string; tone?: "amber" | "plum" | "moss" }) {
  const t = tone === "amber" ? "border-amber/40 bg-amber-soft" : tone === "plum" ? "border-plum/30 bg-plum-soft" : tone === "moss" ? "border-moss/30 bg-moss-soft" : "border-line bg-card";
  return <div className={`rounded-2xl border p-4 ${t} ${className}`}>{children}</div>;
}

/** Tiny markdown: **bold**, bullet lines, paragraphs. Enough for agent prose. */
export function Prose({ text, className = "" }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const isList = lines.every((l) => /^\s*[•\-*]\s+/.test(l));
        if (isList) {
          return (
            <ul key={i} className="space-y-1 pl-4">
              {lines.map((l, j) => (
                <li key={j} className="list-disc marker:text-muted">
                  <Inline text={l.replace(/^\s*[•\-*]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                <Inline text={l} />
                {j < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}
    </>
  );
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}
export function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
}
export function fmtLongDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
}
export function fmtClock(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Europe/London" });
}
