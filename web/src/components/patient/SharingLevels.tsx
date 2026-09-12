"use client";

import { useState } from "react";
import type { AppState, Category, SharingLevel } from "@/lib/types";
import { CATEGORIES, personById } from "@/lib/types";
import { LEVELS, levelFor } from "@/lib/levels";
import type { KindredActions } from "@/hooks/useKindred";
import { Avatar, Button, LockIcon } from "../ui";

// "What each level means": the patient defines the three buckets once; every
// person on a bucket follows it. "Everything" is fixed to the whole record.

export default function SharingLevels({ state, actions, onBack }: { state: AppState; actions: KindredActions; onBack: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = Object.keys(state.consent).map((id) => personById(state, id)).filter((p) => p.accessStatus !== "revoked");
  const onLevel = (level: SharingLevel) => people.filter((p) => levelFor(state.levels, state.consent[p.id]) === level);

  async function toggle(level: SharingLevel, category: Category, on: boolean) {
    if (pending) return;
    const next = on ? [...state.levels[level], category] : state.levels[level].filter((c) => c !== category);
    setPending(`${level}:${category}`);
    setError(null);
    try {
      await actions.setLevelDefinition(level, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this change.");
    } finally {
      setPending(null);
    }
  }

  const identical = LEVELS.filter((a) => LEVELS.some((b) => a.id !== b.id && sameSet(state.levels[a.id], state.levels[b.id])));

  return (
    <div className="space-y-5">
      <div>
        <button onClick={onBack} className="text-sm font-semibold text-plum underline-offset-4 hover:underline">← Back to your circle</button>
        <h1 className="mt-2 font-display text-[26px] font-bold leading-tight sm:text-3xl">What each level means</h1>
        <p className="mt-1 max-w-2xl text-[15px] text-muted">You put each person in your circle on one of three levels. Decide here which parts of your record each level includes. Change a level and everyone on it updates straight away, including your GP practice’s record.</p>
      </div>

      {error && <p role="alert" className="rounded-xl border border-rust/30 bg-[#f8e6df] px-3 py-2 text-sm text-rust">{error}</p>}
      {identical.length > 0 && <p className="rounded-xl border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-[#7a520c]">Two of your levels currently mean the same thing. That works, but it may be confusing when you choose a level for someone.</p>}

      <div className="grid gap-4 md:grid-cols-3">
        {LEVELS.map((l) => {
          const locked = l.id === "everything";
          const members = onLevel(l.id);
          return (
            <section key={l.id} className={`rounded-2xl border bg-card p-4 ${locked ? "border-line" : "border-plum/30"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-xl font-bold leading-tight">{l.label}</h2>
                  <p className="mt-0.5 text-sm text-muted">{l.blurb}</p>
                </div>
                {locked && <span className="mt-1 text-muted" title="Always the whole record"><LockIcon size={16} /></span>}
              </div>

              <ul className="mt-4 divide-y divide-line">
                {CATEGORIES.map((c) => {
                  const on = state.levels[l.id].includes(c.id);
                  const busy = pending === `${l.id}:${c.id}`;
                  return (
                    <li key={c.id}>
                      <label className={`flex items-center gap-3 py-2.5 ${locked ? "cursor-default" : "cursor-pointer"}`}>
                        <input type="checkbox" checked={on} disabled={locked || !!pending} onChange={(e) => void toggle(l.id, c.id, e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--plum)]" aria-label={`${l.label} includes ${c.label}`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[15px] font-semibold ${on ? "" : "text-muted"}`}>{c.label}</span>
                          <span className="block text-xs text-muted">{c.blurb}</span>
                        </span>
                        {busy && <span className="pulse-soft text-xs text-muted">Saving…</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-line pt-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">On this level</div>
                {members.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">Nobody yet</p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {members.map((p) => (
                      <li key={p.id} className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pl-0.5 pr-2.5 text-xs font-semibold">
                        <Avatar person={p} size={20} /> {p.shortName}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4">
        <p className="text-sm text-muted">People whose sharing doesn’t match any level show as <strong className="text-ink">Custom</strong> in your circle. Pick a level for them there to bring them in line.</p>
        <Button variant="secondary" size="sm" onClick={onBack}>Go to your circle</Button>
      </div>
    </div>
  );
}

function sameSet(a: Category[], b: Category[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}
