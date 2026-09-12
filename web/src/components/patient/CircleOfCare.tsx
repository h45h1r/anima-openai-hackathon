"use client";

import { useRef, useState, type FormEvent } from "react";
import type { AppState, Category, SharingLevel } from "@/lib/types";
import { CATEGORIES, personById } from "@/lib/types";
import { LEVELS, allowedCategories, levelFor, levelLabel } from "@/lib/levels";
import type { KindredActions } from "@/hooks/useKindred";
import { Avatar, Button, LockIcon, Pill, Toggle } from "../ui";

const R_ORBIT = 104;
const R_NODE = 22;
const R_RING = 30;

function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
}

export default function CircleOfCare({ state, actions, big = true, onEditLevels }: { state: AppState; actions: KindredActions; big?: boolean; onEditLevels?: () => void }) {
  const patient = personById(state, state.patientId);
  const grantees = Object.keys(state.consent).map((id) => personById(state, id)).filter((person) => person.accessStatus !== "revoked");
  const [selected, setSelected] = useState<string>(grantees[0]?.id);
  const sel = grantees.find((person) => person.id === selected) ?? grantees[0] ?? null;
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogMode, setDialogMode] = useState<"add" | "remove">("add");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function openDialog(mode: "add" | "remove") {
    setDialogMode(mode);
    setDialogError(null);
    dialog.current?.showModal();
  }

  async function changeConsent(id: string, category: Category, allowed: boolean) {
    if (pending) return;
    setPending(category);
    setError(null);
    setMessage(null);
    try {
      await actions.setConsent(id, category, allowed);
      setMessage("Sharing preference saved.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not save this sharing preference. Try again.");
    } finally { setPending(null); }
  }

  const [fineTune, setFineTune] = useState(false);

  async function changeLevel(id: string, level: SharingLevel) {
    if (pending) return;
    setPending(level);
    setError(null);
    setMessage(null);
    try {
      const res = (await actions.setSharingLevel(id, level)) as { changed?: boolean };
      setFineTune(false);
      setMessage(res.changed === false ? "Already on this level." : "Sharing level saved and synced to your GP record.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not change the sharing level. Try again.");
    } finally { setPending(null); }
  }

  async function submitMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setPending(dialogMode);
    setDialogError(null);
    setMessage(null);
    try {
      if (dialogMode === "add") {
        const added = await actions.addFamilyMember({name: String(fields.get("name") ?? "").trim(), relationship: String(fields.get("relationship") ?? "").trim(), email: String(fields.get("email") ?? "").trim() || undefined});
        setSelected(added.id);
        setMessage("Family member added. Nothing is shared until you choose a level.");
      } else if (sel && (sel.role === "family" || sel.role === "carer")) {
        await actions.removeFamilyMember(sel.id);
        setMessage(`${sel.name} was removed from your circle.`);
        setSelected("");
      }
      dialog.current?.close();
      form.reset();
    } catch (problem) {
      setDialogError(problem instanceof Error ? problem.message : "Could not save this change. Try again.");
    } finally { setPending(null); }
  }
  const size = 320;
  const c = size / 2;

  return (
    <>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
      <div className="lg:sticky lg:top-[calc(var(--header-h)+1rem)]">
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-[360px]" role="img" aria-label="Circle of care">
        <circle cx={c} cy={c} r={R_ORBIT} fill="none" stroke="var(--line)" strokeDasharray="2 6" />
        {grantees.map((g, i) => {
          const angle = -Math.PI / 2 + (i / grantees.length) * Math.PI * 2;
          const x = c + R_ORBIT * Math.cos(angle);
          const y = c + R_ORBIT * Math.sin(angle);
          const scopes = state.consent[g.id];
          const shared = CATEGORIES.filter((k) => scopes[k.id]).length;
          const isSel = g.id === sel?.id;
          return (
            <g key={g.id}>
              <line x1={c} y1={c} x2={x} y2={y} stroke={shared ? "var(--plum)" : "var(--line)"} strokeOpacity={shared ? 0.25 : 0.6} strokeWidth={1} />
              <g onClick={() => setSelected(g.id)} className="care-person cursor-pointer" role="button" aria-label={`${g.name}: shares ${shared} of ${CATEGORIES.length}`} aria-pressed={isSel} tabIndex={0} onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(g.id);
                }
              }}>
              {CATEGORIES.map((k, j) => {
                const gap = 0.12;
                const a0 = -Math.PI / 2 + (j / CATEGORIES.length) * Math.PI * 2 + gap / 2;
                const a1 = -Math.PI / 2 + ((j + 1) / CATEGORIES.length) * Math.PI * 2 - gap / 2;
                return <path key={k.id} d={arc(x, y, R_RING, a0, a1)} fill="none" stroke={scopes[k.id] ? "var(--plum)" : "var(--line)"} strokeWidth={isSel ? 5 : 4} strokeLinecap="round" className="transition-all duration-300" />;
              })}
              <circle cx={x} cy={y} r={R_NODE} fill={g.color} />
              <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={12} fontWeight={700} className="font-display">
                {g.initials}
              </text>
              <text x={x} y={y + R_RING + 18} textAnchor="middle" fill="var(--ink)" fontSize={11} fontWeight={isSel ? 700 : 600} className="care-person-label">
                {g.shortName}
              </text>
              </g>
            </g>
          );
        })}
        <circle cx={c} cy={c} r={36} fill={patient.color} />
        <text x={c} y={c - 4} textAnchor="middle" fill="white" fontSize={14} fontWeight={800} className="font-display">
          {patient.shortName}
        </text>
        <text x={c} y={c + 12} textAnchor="middle" fill="white" fillOpacity={0.8} fontSize={9} fontWeight={600} letterSpacing="0.08em">
          YOU
        </text>
      </svg>
      <div className="mt-3 flex justify-center">
        <Button variant="secondary" disabled={!!pending} onClick={() => openDialog("add")}>+ Add family member</Button>
      </div>
      <p className="mx-auto mt-3 max-w-[300px] text-center text-xs leading-relaxed text-muted">Pick a sharing level for each person. New family members start with nothing shared.</p>
      {onEditLevels && (
        <div className="mt-2 text-center">
          <button onClick={onEditLevels} className="text-xs font-semibold text-plum underline-offset-4 hover:underline">What each level means →</button>
        </div>
      )}
      </div>

      {sel ? (
        <div className="rounded-2xl border border-line bg-card p-4 rise" key={sel.id}>
          {(() => {
            const current = levelFor(state.levels, state.consent[sel.id]);
            const nowSees = allowedCategories(state.consent[sel.id]);
            return (
              <>
                <div className="flex items-center gap-3">
                  <Avatar person={sel} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg font-bold leading-tight">{sel.name}</div>
                    <div className="text-sm text-muted">{sel.relation}{sel.org ? ` · ${sel.org}` : ""}</div>
                  </div>
                  <Pill tone={current === "none" ? "neutral" : current === "custom" ? "amber" : "plum"}>
                    <LockIcon size={12} open={current !== "none"} /> {levelLabel(current)}
                  </Pill>
                </div>

                <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">How much {sel.shortName} sees</div>
                <div role="radiogroup" aria-label={`Sharing level for ${sel.shortName}`} className="mt-2 grid gap-2">
                  {LEVELS.map((l) => {
                    const on = current === l.id;
                    const busy = pending === l.id;
                    const means = CATEGORIES.filter((c) => state.levels[l.id].includes(c.id)).map((c) => c.label);
                    return (
                      <button
                        key={l.id}
                        role="radio"
                        aria-checked={on}
                        disabled={!!pending}
                        onClick={() => void changeLevel(sel.id, l.id)}
                        className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition disabled:cursor-wait ${on ? "border-plum bg-plum-soft/70" : "border-line bg-card hover:bg-paper"}`}
                      >
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-plum bg-plum" : "border-line bg-card"}`}>
                          {on && <span className="h-2 w-2 rounded-full bg-white" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block font-display font-bold leading-tight ${big ? "text-[18px]" : "text-base"}`}>{l.label}</span>
                          <span className="block text-sm text-muted">{l.blurb}</span>
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {means.map((m) => (
                              <span key={m} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${on ? "bg-plum text-white" : "bg-paper text-muted"}`}>{m}</span>
                            ))}
                          </span>
                        </span>
                        {busy && <span className="pulse-soft text-xs text-muted">Saving…</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-xl bg-paper px-3 py-2.5 text-sm">
                  <span className="font-semibold">{sel.shortName} can see now:</span>{" "}
                  {nowSees.length ? CATEGORIES.filter((c) => nowSees.includes(c.id)).map((c) => c.label).join(", ") : <span className="text-muted">nothing yet — choose a level above</span>}
                  {current === "custom" && <span className="block text-xs text-muted">This mix doesn’t match a level (set through Kindred or fine-tuning). Pick a level to bring it in line, or keep it as it is.</span>}
                </div>

                <details open={fineTune} onToggle={(e) => setFineTune((e.target as HTMLDetailsElement).open)} className="mt-3">
                  <summary className="cursor-pointer text-sm font-semibold text-plum">Fine-tune individual parts</summary>
                  <ul className="mt-2 divide-y divide-line">
                    {CATEGORIES.map((k) => {
                      const on = state.consent[sel.id][k.id];
                      return (
                        <li key={k.id} className="flex items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-semibold">{k.label}</div>
                            <div className="text-xs text-muted">{k.blurb}</div>
                          </div>
                          <Toggle on={on} label={`${sel.shortName} can see ${k.label}`} disabled={!!pending} onChange={(v) => void changeConsent(sel.id, k.id as Category, v)} />
                        </li>
                      );
                    })}
                  </ul>
                </details>
              </>
            );
          })()}
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <span className="mt-0.5 text-plum"><LockIcon size={13} /></span>
              Only what the chosen level includes is shared with this person. {onEditLevels && <button onClick={onEditLevels} className="font-semibold text-plum underline-offset-4 hover:underline">Change what the levels mean</button>}
            </p>
            <p className="text-xs leading-relaxed text-muted" role="status" aria-live="polite">
              {pending ? "Saving your change…" : state.ehr.syncError ? `GP sync needs attention: ${state.ehr.syncError}` : state.ehr.lastSyncedAt ? `GP record synced ${new Date(state.ehr.lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · version ${state.ehr.consentVersion}` : "GP sync has not been confirmed yet."}
            </p>
            {state.ehr.gpConsentUrl && <a href={state.ehr.gpConsentUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-plum underline underline-offset-4">View sharing preferences in GP Records ↗</a>}
            {error && <p role="alert" className="text-sm text-rust">{error}</p>}
            {message && <p role="status" className="text-xs text-muted">{message}</p>}
            {(sel.role === "family" || sel.role === "carer") && <div className="pt-2"><Button size="sm" variant="ghost" disabled={!!pending} onClick={() => openDialog("remove")}>Remove from circle</Button></div>}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-card p-6 text-center">
          <h3 className="font-display text-lg font-bold">Your circle starts with you</h3>
          <p className="mt-2 text-sm text-muted">Add a family member, then choose how much they can see.</p>
          {message && <p role="status" className="mt-3 text-xs text-muted">{message}</p>}
        </div>
      )}
    </div>
    <dialog ref={dialog} onCancel={(event) => { if (pending) event.preventDefault(); }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-black/30">
      <form onSubmit={(event) => void submitMember(event)} className="p-6">
        <h2 className="font-display text-xl font-bold">{dialogMode === "add" ? "Add family member" : "Remove from your circle?"}</h2>
        {dialogMode === "add" ? <>
          <p className="mt-2 text-sm leading-relaxed text-muted">Nothing will be shared until you choose a sharing level for them.</p>
          <label className="mt-5 block text-sm font-semibold">Name<input name="name" required maxLength={100} autoComplete="name" className="mt-2 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 font-normal outline-plum" /></label>
          <label className="mt-4 block text-sm font-semibold">Relationship<input name="relationship" required maxLength={80} placeholder="For example, daughter or brother" className="mt-2 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 font-normal outline-plum" /></label>
          <label className="mt-4 block text-sm font-semibold">Email <span className="font-normal text-muted">(optional)</span><input name="email" type="email" maxLength={254} autoComplete="email" className="mt-2 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 font-normal outline-plum" /></label>
        </> : <p className="mt-3 text-sm leading-relaxed text-muted">{sel?.name} will lose access to the information you shared. Your health records will stay in place.</p>}
        {dialogError && <p className="mt-4 text-sm text-rust" role="alert">{dialogError}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" disabled={!!pending} onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button type="submit" variant={dialogMode === "add" ? "plum" : "danger"} disabled={!!pending}>{pending ? "Saving…" : dialogMode === "add" ? "Add family member" : "Remove member"}</Button>
        </div>
      </form>
    </dialog>
    </>
  );
}
