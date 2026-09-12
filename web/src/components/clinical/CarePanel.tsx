"use client";

import { useMemo, useState } from "react";
import type { AppState, Person } from "@/lib/types";
import { Button, Pill } from "../ui";
import ResultChart from "./ResultChart";
import type { CareClinical } from "@/hooks/useCareClinical";

type CareEvent = {
  evidenceId: string;
  title?: string;
  kind?: string;
  status?: string;
  informationClass?: string;
  at?: string;
  summary?: string;
  service?: string;
};

function isAppointment(e: CareEvent) {
  return /appoint|clinic|follow.?up|review/i.test(`${e.kind || ""} ${e.title || ""} ${e.informationClass || ""}`);
}

export default function CarePanel({
  state,
  viewer,
  care,
  onAsk,
  onOpenCircle,
}: {
  state: AppState;
  viewer: Person;
  care: CareClinical;
  onAsk: (q: string) => void;
  onOpenCircle: () => void;
}) {
  const [section, setSection] = useState<"care" | "results">("care");
  const [retrying, setRetrying] = useState(false);
  const events: CareEvent[] = care.context?.events || [];
  const measurements = care.context?.measurements || [];

  const appointments = useMemo(() => {
    const now = Date.now();
    return events
      .filter(isAppointment)
      .slice()
      .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime())
      .filter((e) => {
        const t = new Date(e.at || 0).getTime();
        return !Number.isFinite(t) || t >= now - 7 * 24 * 60 * 60 * 1000;
      })
      .slice(0, 5);
  }, [events]);

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
  const viewerId = care.careViewerId;
  const careViewer = care.policy?.viewers?.find((v: { viewerId: string }) => v.viewerId === viewerId);
  const canSeeLabs =
    careViewer?.relationship === "self" ||
    care.policy?.grants?.some(
      (g: { viewerId: string; informationClass: string; allowed: boolean }) =>
        g.viewerId === viewerId && g.informationClass === "laboratory_results" && g.allowed,
    );

  async function retry() {
    setRetrying(true);
    try {
      await care.refresh();
    } finally {
      setRetrying(false);
    }
  }

  function goAsk(q: string) {
    sessionStorage.setItem("kindred.draftQuestion", q);
    onAsk(q);
  }

  if (care.status === "needs_server" || care.status === "booting" || care.status === "idle") {
    return (
      <div className="page">
        <h1 className="font-display text-[26px] font-bold sm:text-3xl">My care</h1>
        <p className="mt-2 text-muted">
          {care.status === "needs_server"
            ? "Set ANIMA_API_KEY in web/.env.local and restart Kindred for live care and results."
            : "Loading care context…"}
        </p>
        {care.status === "needs_server" ? (
          <Button className="mt-4" variant="plum" onClick={() => care.retry()}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  const chart = (selected && byAnalyte.find((a) => a.id === selected)) || byAnalyte[0];

  return (
    <div className="page">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[26px] font-bold leading-tight sm:text-3xl">My care</h1>
          <p className="mt-1 text-[15px] text-muted">
            Live appointments and results for {viewer.shortName} — filtered by Kindred Circle sharing.
          </p>
        </div>
        <div className="flex rounded-full border border-line bg-card p-1">
          <button
            type="button"
            onClick={() => setSection("care")}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${section === "care" ? "bg-ink text-white" : "text-muted"}`}
          >
            Care
          </button>
          <button
            type="button"
            onClick={() => setSection("results")}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${section === "results" ? "bg-ink text-white" : "text-muted"}`}
          >
            Results
          </button>
        </div>
      </div>

      {care.error ? (
        <div className="mb-4 rounded-2xl border border-rust/30 bg-[#f8e6df] px-4 py-3 text-sm text-rust">
          {care.error}{" "}
          <button type="button" className="font-semibold underline" onClick={() => void retry()}>
            Retry
          </button>
        </div>
      ) : null}

      {section === "care" ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-display text-lg font-bold">Next appointments</div>
              <Pill tone="neutral">{appointments.length}</Pill>
            </div>
            {!appointments.length ? (
              <p className="mt-2 text-sm text-muted">No upcoming appointments in the permitted view.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {appointments.map((e) => (
                  <li key={e.evidenceId} className="py-3">
                    <div className="font-semibold">{e.title || "Appointment"}</div>
                    <div className="text-sm text-muted">
                      {e.status || "scheduled"}
                      {e.at ? ` · ${new Date(e.at).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}
                      {e.service ? ` · ${e.service}` : ""}
                    </div>
                    {e.summary ? <p className="mt-1 text-sm">{e.summary.slice(0, 160)}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="plum"
                size="sm"
                onClick={() =>
                  goAsk(
                    appointments[0]
                      ? `Is my ${appointments[0].title || "follow-up"} appointment confirmed, and when exactly is it?`
                      : "What appointments do I have coming up?",
                  )
                }
              >
                Ask about appointments
              </Button>
              <Button variant="secondary" size="sm" disabled={retrying} onClick={() => void retry()}>
                {retrying ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card p-4">
            <div className="font-display text-lg font-bold">Care timeline</div>
            <p className="mt-1 text-sm text-muted">Permitted live events for this viewer.</p>
            {!events.length ? (
              <p className="mt-3 text-sm text-muted">No events in the current view.</p>
            ) : (
              <ul className="mt-3 max-h-[420px] divide-y divide-line overflow-y-auto">
                {events.slice(0, 20).map((e) => (
                  <li key={e.evidenceId} className="py-2.5">
                    <div className="font-semibold">{e.title || e.kind || "Event"}</div>
                    <div className="text-sm text-muted">
                      {e.kind} · {e.status}
                      {e.at ? ` · ${new Date(e.at).toLocaleDateString("en-GB")}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenCircle}
            className="w-full rounded-2xl border border-plum/30 bg-plum-soft p-4 text-left text-sm font-semibold text-plum"
          >
            Sharing for {viewer.shortName} is controlled in Circle →
          </button>
        </div>
      ) : !canSeeLabs ? (
        <div className="rounded-2xl border border-plum/30 bg-plum-soft p-5">
          <h2 className="font-display text-xl font-bold">Results</h2>
          <p className="mt-2 text-[15px] text-muted">
            Laboratory results are outside this viewer&apos;s Kindred sharing level. Switch to the patient in the account
            menu, or open Circle to share more.
          </p>
          <Button className="mt-4" variant="plum" onClick={onOpenCircle}>
            Open Circle
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-card p-4">
            <h2 className="font-display text-xl font-bold">Results</h2>
            <p className="mt-1 text-sm text-muted">Exact values from Anima-derived measurements.</p>
            {!byAnalyte.length ? (
              <p className="mt-3 text-sm text-muted">No numeric result history in the permitted view.</p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  {byAnalyte.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelected(a.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                        (selected || byAnalyte[0]?.id) === a.id
                          ? "border-ink bg-ink text-white"
                          : "border-line bg-paper text-ink"
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
                {chart ? (
                  <div className="mt-4">
                    <ResultChart
                      title={chart.name}
                      unit={chart.unit}
                      points={chart.series.map((m) => ({
                        date: m.sampledAt,
                        value: m.value,
                        label: m.displayName,
                        evidenceId: m.evidenceId,
                      }))}
                      referenceLow={chart.referenceLow}
                      referenceHigh={chart.referenceHigh}
                      referenceLabel={chart.referenceLabel}
                    />
                  </div>
                ) : null}
              </>
            )}
            <Button
              className="mt-4"
              variant="plum"
              size="sm"
              onClick={() => goAsk(`What do ${viewer.id === state.patientId ? "my" : `${viewer.shortName}'s`} latest blood tests mean?`)}
            >
              Ask about results
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
