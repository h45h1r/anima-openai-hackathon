"use client";

import { useMemo, useState } from "react";
import TwinCanvas from "../components/TwinCanvas";

const patient = {
  id: "SIM-000006",
  name: "Eleanor Chen",
  age: 83,
  gender: "female",
  access: "Step-free",
  contact: "Telephone",
};

function rangeDeviation(value, low, high) {
  if (value < low) return (low - value) / low;
  if (value > high) return (value - high) / high;
  return 0;
}

function severityFor(deviation) {
  if (deviation >= 0.25) return "high";
  if (deviation > 0) return "moderate";
  return "within";
}

function sourceLabel(service, timestamp) {
  return `${service} · ${timestamp}`;
}

const bloodDeviation = Math.max(rangeDeviation(2.1, 4, 11), rangeDeviation(1.6, 2, 7.5));
const metabolicDeviation = rangeDeviation(49, 20, 41);
const activityDeviation = (4200 - 2200) / 4200;

const signals = {
  activity: {
    label: "Activity signal",
    location: "Whole-body mobility",
    severity: severityFor(activityDeviation),
    value: "2,200 steps/day",
    comparison: "48% below Eleanor’s 4,200-step baseline",
    detail: "This is the most recent Home Health reading, received at 17:10 UTC. Device data quality is good; the app does not infer a cause from the change.",
    source: sourceLabel("Home Health", "12 Sep 2026 · 17:10 UTC"),
  },
  blood: {
    label: "Blood signal",
    location: "Circulatory system",
    severity: severityFor(bloodDeviation),
    value: "WCC 2.1 · Neutrophils 1.6",
    comparison: "WCC is 48% below its supplied lower range",
    detail: "Latest FBC: haemoglobin 144 g/L and platelets 269 ×10⁹/L. The colour reflects distance from the supplied range, not a clinical assessment.",
    source: sourceLabel("Diagnostics", "11 Sep 2026 · 08:00 UTC"),
  },
  metabolic: {
    label: "Metabolic signal",
    location: "Glucose monitoring",
    severity: severityFor(metabolicDeviation),
    value: "HbA1c 49 mmol/mol",
    comparison: "20% above the supplied upper range of 41",
    detail: "This is the latest HbA1c available in the simulation record. The amber label represents a moderate distance from the displayed range.",
    source: sourceLabel("Diagnostics", "11 Sep 2026 · 08:00 UTC"),
  },
  liver: {
    label: "Liver signal",
    location: "Abdominal monitoring",
    severity: "within",
    value: "Latest LFT within source range",
    comparison: "ALT 35 · ALP 75 · bilirubin 16 · albumin 42",
    detail: "The most recent available LFT is a CareCircle result. All four displayed values are within its supplied ranges; earlier values are not used for this signal.",
    source: sourceLabel("Diagnostics", "12 Sep 2026 · 12:02 UTC"),
  },
  mobility: {
    label: "Mobility pathway",
    location: "Lower-body and acute care",
    severity: "moderate",
    value: "Reduced mobility · AMU bed 1",
    comparison: "Active pathway · medical take · routine acuity",
    detail: "This is an active pathway rather than a reference-range measurement. Amber means it needs a clear, current view, not that a numerical value is abnormal.",
    source: sourceLabel("Northbank General", "12 Sep 2026 · 04:20 UTC"),
  },
  care: {
    label: "Care network",
    location: "Home and community",
    severity: "moderate",
    value: "Home support not yet arranged",
    comparison: "Assessment awaiting allocation · due 13 Sep",
    detail: "Two daily visits are proposed; funding is pending, no carer is available, home access is not confirmed, and no key safe is recorded.",
    source: sourceLabel("Community Care", "12 Sep 2026 · 08:00 UTC"),
  },
};

const knowledge = [
  {
    keys: ["today", "attention", "open", "next", "task"],
    answer: "Open workflow items are the waiting letter-collection call, registration-paperwork conversation, consent task for Grace Chen, three LFT follow-up tasks, and the home-care assessment awaiting allocation.",
  },
  {
    keys: ["activity", "steps", "watch", "wearable", "walking"],
    answer: "The most recent Home Health reading is 2,200 steps/day at 17:10 UTC, against Eleanor’s 4,200-step personal baseline. The signal is 48% below baseline; device data quality is good.",
  },
  {
    keys: ["blood", "fbc", "white", "neutrophil", "lab"],
    answer: "The latest FBC, from 11 September at 08:00 UTC, shows white cells 2.1 ×10⁹/L and neutrophils 1.6 ×10⁹/L. White cells are 48% below the supplied lower range; haemoglobin is 144 g/L and platelets 269 ×10⁹/L.",
  },
  {
    keys: ["home", "care", "support", "carer", "social"],
    answer: "Home support is open but not yet arranged. The current assessment is waiting for allocation; two daily visits are proposed and funding is pending.",
  },
  {
    keys: ["hospital", "mobility", "amu", "admission"],
    answer: "Eleanor has an active reduced-mobility attendance in medical take at AMU bed 1, under Dr Alex Morgan, recorded as routine acuity in this simulation.",
  },
  {
    keys: ["contact", "preference", "family", "grace", "appointment"],
    answer: "Eleanor prefers telephone contact, uses a landline rather than the patient app, needs step-free access, and values local appointments with reliable transport. Her daughter Grace Chen is named in an open consent task for test-result sharing.",
  },
];

function askTwin(question) {
  const input = question.toLowerCase();
  const match = knowledge.find((item) => item.keys.some((key) => input.includes(key)));
  return match?.answer ?? "This twin can answer about Eleanor’s active pathways, vitals and signals, home support, diagnostics, contact preferences, and recorded tasks. Try asking about activity, blood results, mobility, or care support.";
}

export default function Home() {
  const [selected, setSelected] = useState("activity");
  const [focusVersion, setFocusVersion] = useState(0);
  const [question, setQuestion] = useState("What needs attention today?");
  const [answer, setAnswer] = useState(askTwin("What needs attention today?"));
  const signal = signals[selected];
  const cards = useMemo(() => Object.entries(signals), []);

  function submit(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setAnswer(askTwin(question));
  }

  function selectSignal(id) {
    setSelected(id);
    setFocusVersion((version) => version + 1);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">E</span><span>Eleanor Twin</span></div>
        <div className="patient-pill"><span className="live-dot" />{patient.id} · synthetic data</div>
        <div className="snapshot">Source refresh · 12 Sep 2026 · 18:05 UTC · paused</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">DIGITAL TWIN / CARE MATRIX</p>
          <h1>{patient.name}</h1>
          <p className="intro">A connected view of Eleanor’s recorded signals, care pathways and lived context. Select a signal on the twin, or ask it a question.</p>
        </div>
        <div className="identity-grid">
          <div><span>Age</span><strong>{patient.age}</strong></div>
          <div><span>Gender</span><strong>Female</strong></div>
          <div><span>Access</span><strong>{patient.access}</strong></div>
          <div><span>Contact</span><strong>{patient.contact}</strong></div>
        </div>
      </section>

      <section className="twin-layout">
        <aside className="signal-rail" aria-label="Signal matrix">
          <p className="rail-label">Signal matrix</p>
          {cards.map(([id, item], index) => (
            <button key={id} className={`signal-card ${selected === id ? "selected" : ""} ${item.severity}`} onClick={() => selectSignal(id)} aria-pressed={selected === id}>
              <span className="signal-index">0{index + 1}</span>
              <span><strong>{item.label}</strong><small>{item.value}</small><em>{item.severity === "within" ? "Within source range" : item.severity === "high" ? "Far outside range" : "Needs attention"}</em></span>
              <i />
            </button>
          ))}
        </aside>

        <div className="twin-stage">
          <div className="matrix-field" />
          <div className="stage-copy"><span>SOMA-X BODY MAP</span><small>Drag to orbit · select a glowing signal</small></div>
          <TwinCanvas selected={selected} onPick={selectSignal} gender={patient.gender} focusVersion={focusVersion} signalSeverities={Object.fromEntries(cards.map(([id, item]) => [id, item.severity]))} />
          <div className="body-label label-head">blood</div>
          <div className="body-label label-left">metabolic</div>
          <div className="body-label label-right">liver</div>
          <div className="body-label label-bottom">mobility</div>
        </div>

        <aside className="inspector" aria-live="polite">
          <p className="rail-label">Selected signal</p>
          <div className={`signal-state ${signal.severity}`}><span />{signal.severity === "within" ? "Within source range" : signal.severity === "high" ? "Far outside source range" : "Needs attention"}</div>
          <h2>{signal.label}</h2>
          <p className="location">{signal.location}</p>
          <p className="signal-value">{signal.value}</p>
          <p className="comparison">{signal.comparison}</p>
          <p className="detail">{signal.detail}</p>
          <div className="source"><span>Data source</span>{signal.source}</div>
        </aside>
      </section>

      <section className="query-section">
        <div><p className="eyebrow">ASK ELEANOR’S TWIN</p><h2>Query any recorded aspect</h2></div>
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="question">Ask a question about Eleanor</label>
          <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about signals, care, results or preferences…" />
          <button type="submit">Ask twin <span>↗</span></button>
        </form>
        <div className="answer"><span>TW</span><p>{answer}</p></div>
        <div className="prompt-row">
          {["What needs attention today?", "Show her latest activity", "What is her home-care status?"].map((prompt) => (
            <button key={prompt} onClick={() => { setQuestion(prompt); setAnswer(askTwin(prompt)); }}>{prompt}</button>
          ))}
        </div>
      </section>

      <footer>Simulation training data only · Signal colours show source-range distance or pathway state, not clinical priority.</footer>
    </main>
  );
}
