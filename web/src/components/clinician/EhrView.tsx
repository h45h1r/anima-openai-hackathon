"use client";

import { useState } from "react";
import type { AppState } from "@/lib/types";
import { CATEGORIES, personById } from "@/lib/types";
import { toFhirConsent } from "@/lib/fhir";
import { Avatar, LockIcon, Pill, fmtTime } from "../ui";

// What the GP practice sees: the record they already have, plus a consent
// panel that Kindred keeps in sync. The point: nobody has to phone Margaret to
// ask if her daughter can be told about the appointment.

export default function EhrView({ state, viewerId }: { state: AppState; viewerId: string }) {
  const patient = personById(state, state.patientId);
  const viewer = personById(state, viewerId);
  const grantees = Object.keys(state.consent).map((id) => personById(state, id)).filter((p) => p.role !== "clinician");
  const [sel, setSel] = useState(grantees[0]?.id ?? "");
  const fhir = sel ? toFhirConsent(state, sel) : null;
  const meta = state.patient;
  const latestLab = state.labs.map((l) => l.date).sort().pop();
  const shownLabs = [...state.labs.filter((l) => l.flag !== "normal"), ...state.labs.filter((l) => l.flag === "normal")].slice(0, 10);
  const consentAudit = state.audit.filter((a) => a.kind === "consent.update" || a.kind === "ehr.sync").slice(0, 8);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-line bg-[#F7F9FB] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="rounded bg-[#3C5A7A] px-2 py-0.5 font-mono text-[11px] font-semibold text-white">EHR</span>
          <span className="font-display text-base font-bold">{viewer.org ?? meta.practice}</span>
        </div>
        <div className="text-xs text-muted">Signed in as {viewer.name}, {viewer.relation}</div>
      </div>

      <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
        <div className="border-b border-line p-5 md:border-b-0 md:border-r">
          <div className="flex items-center gap-4">
            <Avatar person={patient} size={52} />
            <div>
              <div className="font-display text-2xl font-bold leading-none">{patient.name}</div>
              <div className="mt-1 font-mono text-xs text-muted">{meta.simId}{meta.localId ? ` · ${meta.localId}` : ""} · DOB {new Date(meta.birthDate).toLocaleDateString("en-GB")} · {meta.age}y</div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Problems</dt>
              <dd className="mt-1 space-y-0.5">{state.conditions.length ? state.conditions.map((c) => <div key={c.id}>{c.name}{c.since ? ` (${c.since})` : ""}</div>) : <div className="text-muted">None active</div>}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Medication</dt>
              <dd className="mt-1 space-y-0.5">{state.medications.length ? state.medications.map((m) => <div key={m.id}>{m.name} {m.dose}</div>) : <div className="text-muted">No current medication recorded</div>}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Recent results{latestLab ? ` · ${new Date(latestLab).toLocaleDateString("en-GB")}` : ""}</dt>
              <dd className="mt-1 grid grid-cols-5 gap-2 font-mono text-xs">
                {shownLabs.map((l) => (
                  <div key={l.id} className="rounded-lg border border-line p-2" title={`${l.name} · ${l.panel} · range ${l.refRange}`}>
                    <div className="truncate text-[10px] text-muted">{l.name}</div>
                    <div className={`text-sm font-medium ${l.flag !== "normal" ? "text-rust" : ""}`}>{l.value}</div>
                  </div>
                ))}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Upcoming</dt>
              <dd className="mt-1 space-y-0.5">{state.appointments.length ? state.appointments.map((a) => <div key={a.id}>{new Date(a.start).toLocaleDateString("en-GB")} {a.title} — {personById(state, a.clinicianId).shortName}</div>) : <div className="text-muted">Nothing booked</div>}</dd>
            </div>
          </dl>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-plum"><LockIcon size={16} /></span>
              <h2 className="font-display text-lg font-bold">Information sharing consent</h2>
            </div>
            <Pill tone="plum">v{state.ehr.consentVersion} · synced {state.ehr.lastSyncedAt ? fmtTime(state.ehr.lastSyncedAt) : "—"}</Pill>
          </div>
          <p className="mt-1 text-xs text-muted">Captured by the patient in Kindred and written to the {meta.practice} workspace as a task carrying the FHIR Consent. No need to re-confirm with the patient before discussing care with the people below.</p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                  <th className="pb-2 pr-2 font-semibold">Recipient</th>
                  {CATEGORIES.map((c) => (
                    <th key={c.id} className="pb-2 px-1 text-center font-semibold" title={c.label}>{c.label.split(" ")[0].slice(0, 5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grantees.map((g) => (
                  <tr key={g.id} onClick={() => setSel(g.id)} className={`cursor-pointer border-t border-line ${sel === g.id ? "bg-plum-soft/60" : "hover:bg-paper"}`}>
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{g.name}</div>
                      <div className="text-[10px] text-muted">{g.relation}</div>
                    </td>
                    {CATEGORIES.map((c) => (
                      <td key={c.id} className="px-1 py-2 text-center">
                        <span className={`inline-block h-3 w-3 rounded-full transition ${state.consent[g.id][c.id] ? "bg-plum" : "border border-line bg-white"}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {fhir && (
            <details className="mt-4 rounded-xl border border-line bg-[#0f1a15] text-[#cfe3d8]">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[11px] text-white/80">FHIR Consent/{fhir.id} · versionId {fhir.meta.versionId}{state.ehr.lastResourceId ? ` · sim task ${state.ehr.lastResourceId}` : ""}</summary>
              <pre className="scroll-thin max-h-72 overflow-auto px-3 pb-3 font-mono text-[10.5px] leading-snug">{JSON.stringify(fhir, null, 2)}</pre>
            </details>
          )}

          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Consent history</h3>
          <ul className="mt-2 space-y-1.5">
            {consentAudit.length === 0 && <li className="text-xs text-muted">No changes yet this session.</li>}
            {consentAudit.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1 font-mono text-[10px] text-muted">{fmtTime(a.ts)}</span>
                <span className={a.kind === "ehr.sync" ? "text-muted" : ""}>{a.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
