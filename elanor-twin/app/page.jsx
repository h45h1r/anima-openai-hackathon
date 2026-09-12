"use client";

import { useMemo, useState } from "react";
import TwinCanvas from "../components/TwinCanvas";

const signals = {
  activity: {
    label: "Activity signal",
    location: "Whole-body mobility",
    tone: "attention",
    value: "1,800 steps/day",
    comparison: "Personal baseline: 4,200 steps/day",
    detail: "Latest home readings range from 1,700 to 2,200 steps/day. The watch is active, good quality, and has 76% battery.",
    source: "Home Health · 12 Sep 2026",
  },
  blood: {
    label: "Blood signal",
    location: "Circulatory system",
    tone: "flag",
    value: "WCC 2.1 · Neutrophils 1.6",
    comparison: "Both are below the supplied source ranges",
    detail: "Latest FBC: haemoglobin 144 g/L and platelets 269 ×10⁹/L. Values are presented as simulation signals, not clinical advice.",
    source: "Diagnostics · 11 Sep 2026",
  },
  metabolic: {
    label: "Metabolic signal",
    location: "Glucose monitoring",
    tone: "flag",
    value: "HbA1c 49 mmol/mol",
    comparison: "Source reference range: 20–41",
    detail: "This is the latest historical HbA1c available in the simulation record.",
    source: "Diagnostics · 11 Sep 2026",
  },
  liver: {
    label: "Liver signal",
    location: "Abdominal monitoring",
    tone: "attention",
    value: "Bilirubin 25 µmol/L",
    comparison: "Source reference range: 0–21",
    detail: "Latest historical LFT also records ALT 11 U/L, ALP 55 U/L and albumin 35 g/L. Three later CareCircle LFT records are within their displayed ranges.",
    source: "Diagnostics · 11–12 Sep 2026",
  },
  mobility: {
    label: "Mobility pathway",
    location: "Lower-body and acute care",
    tone: "attention",
    value: "Reduced mobility · AMU bed 1",
    comparison: "Hospital status: medical take · routine acuity",
    detail: "The active hospital attendance is assigned to Dr Alex Morgan. It was recorded at 04:20 UTC on 12 September.",
    source: "Northbank General · 12 Sep 2026",
  },
  care: {
    label: "Care network",
    location: "Home and community",
    tone: "network",
    value: "Home support not yet arranged",
    comparison: "Assessment awaiting allocation",
    detail: "Two daily visits are proposed; funding is pending, no carer is available, home access is not confirmed, and no key safe is recorded.",
    source: "Community Care · due 13 Sep 2026",
  },
};

const knowledge = [
  {
    keys: ["today", "attention", "open", "next", "task"],
    answer: "Open workflow items are the waiting letter-collection call, registration-paperwork conversation, consent task for Grace Chen, three LFT follow-up tasks, and the home-care assessment awaiting allocation.",
  },
  {
    keys: ["activity", "steps", "watch", "wearable", "walking"],
    answer: "Eleanor’s activity signal is 1,800 steps/day against a 4,200-step personal baseline. Recent readings range from 1,700 to 2,200; the watch is active with good-quality data.",
  },
  {
    keys: ["blood", "fbc", "white", "neutrophil", "lab"],
    answer: "The latest FBC shows white cells 2.1 ×10⁹/L and neutrophils 1.6 ×10⁹/L, below the source ranges. Haemoglobin is 144 g/L and platelets 269 ×10⁹/L.",
  },
  {
    keys: ["home", "care", "support", "carer", "social"],
    answer: "Home support is open but not yet arranged. The home-care assessment is waiting for allocation; two daily visits are proposed and funding is pending.",
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
  const [question, setQuestion] = useState("What needs attention today?");
  const [answer, setAnswer] = useState(askTwin("What needs attention today?"));
  const signal = signals[selected];
  const cards = useMemo(() => Object.entries(signals), []);

  function submit(event) {
    event.preventDefault();
    if (!question.trim()) return;
    setAnswer(askTwin(question));
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">E</span><span>Eleanor Twin</span></div>
        <div className="patient-pill"><span className="live-dot" />SIM-000006 · synthetic data</div>
        <div className="snapshot">Snapshot · 12 Sep 2026 · 14:03 UTC · paused</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">DIGITAL TWIN / CARE MATRIX</p>
          <h1>Eleanor Chen</h1>
          <p className="intro">A connected view of Eleanor’s recorded signals, care pathways and lived context. Select a signal on the twin, or ask it a question.</p>
        </div>
        <div className="identity-grid">
          <div><span>Age</span><strong>83</strong></div>
          <div><span>Access</span><strong>Step-free</strong></div>
          <div><span>Contact</span><strong>Telephone</strong></div>
        </div>
      </section>

      <section className="twin-layout">
        <aside className="signal-rail" aria-label="Signal matrix">
          <p className="rail-label">Signal matrix</p>
          {cards.map(([id, item], index) => (
            <button key={id} className={`signal-card ${selected === id ? "selected" : ""} ${item.tone}`} onClick={() => setSelected(id)}>
              <span className="signal-index">0{index + 1}</span>
              <span><strong>{item.label}</strong><small>{item.value}</small></span>
              <i />
            </button>
          ))}
        </aside>

        <div className="twin-stage">
          <div className="matrix-field" />
          <div className="stage-copy"><span>SOMA-X BODY MAP</span><small>Drag to orbit · select a glowing signal</small></div>
          <TwinCanvas selected={selected} onPick={setSelected} />
          <div className="body-label label-head">blood</div>
          <div className="body-label label-left">metabolic</div>
          <div className="body-label label-right">liver</div>
          <div className="body-label label-bottom">mobility</div>
        </div>

        <aside className="inspector" aria-live="polite">
          <p className="rail-label">Selected signal</p>
          <div className={`signal-state ${signal.tone}`}><span />{signal.tone === "flag" ? "Source-range flag" : signal.tone === "network" ? "Connected pathway" : "Needs context"}</div>
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

      <footer>Simulation training data only · Values, labels and pathways must not be used as clinical advice.</footer>
    </main>
  );
}
