"use client";

import { useState, type ReactNode } from "react";
import type { AppState, CareNote } from "@/lib/types";
import { personById } from "@/lib/types";
import type { ReadingLevel } from "@/lib/reading-level";
import { Button, Card, Pill, fmtDay } from "../ui";

// "After your appointment": the latest hospital letter or consultation from
// the record, shown in plain words. Medical terms become chips that expand to
// a one-line meaning and an nhs.uk link. "What happens next" is taken only
// from the letter's own follow-up and actions sections. Nothing here is
// generated; it is the record, reorganised and glossed.

interface Term { plain: string; nhs?: string }
// Keyed by lower-case term. The nhs slug points at nhs.uk/conditions/<slug>.
const GLOSSARY: Record<string, Term> = {
  "renal": { plain: "to do with the kidneys" },
  "renal clinic": { plain: "the hospital kidney team" },
  "clinic review": { plain: "a check-up with the specialist team" },
  "discharge": { plain: "being sent home or back to your GP after a visit" },
  "discharge coordinator": { plain: "the person who organises what happens after a hospital visit" },
  "handover": { plain: "passing your details to the next team" },
  "laboratory panel": { plain: "a set of blood tests done together" },
  "medicines reconciliation": { plain: "checking your list of medicines is right and up to date" },
  "medicines note": { plain: "a written list of what you take" },
  "coded diagnosis": { plain: "a condition entered formally on your record" },
  "diagnosis": { plain: "the name doctors give to what is wrong" },
  "correspondence": { plain: "letters between your hospital and GP" },
  "follow-up": { plain: "the next check after this one" },
  "prescription": { plain: "medicine your doctor authorises" },
  "frailty": { plain: "being less able to bounce back from illness or a fall, common in later life", nhs: "frailty" },
  "arthralgia": { plain: "joint pain", nhs: "joint-pain" },
  "egfr": { plain: "a number for how fast your kidneys filter the blood", nhs: "kidney-disease" },
  "creatinine": { plain: "a waste product the kidneys clear; used to check kidney function" },
  "chronic kidney disease": { plain: "kidneys that have worked less well for a long time", nhs: "kidney-disease" },
  "ckd": { plain: "chronic kidney disease: kidneys working less well over a long time", nhs: "kidney-disease" },
  "hypertension": { plain: "high blood pressure", nhs: "high-blood-pressure-hypertension" },
  "hba1c": { plain: "your average blood sugar over the last two to three months", nhs: "type-2-diabetes" },
  "anaemia": { plain: "too few oxygen-carrying red blood cells", nhs: "iron-deficiency-anaemia" },
  "neutropenia": { plain: "low levels of the main infection-fighting white cells" },
  "bilirubin": { plain: "a waste product the liver clears; high levels can mean the liver is under strain" },
  "lft": { plain: "liver function tests, a set of blood tests for the liver" },
  "liver function tests": { plain: "a set of blood tests that show how the liver is working" },
  "referral": { plain: "being sent to another team or specialist" },
  "outpatient": { plain: "a hospital visit where you go home the same day" },
  "admission": { plain: "being kept in hospital" },
  "acute medical unit": { plain: "the hospital ward where people are assessed after coming in urgently" },
  "mobility": { plain: "how easily you can move around" },
  "care package": { plain: "help at home arranged by social care" },
  "musculoskeletal": { plain: "to do with muscles, bones and joints" },
  "medication review": { plain: "a check that your medicines are still right for you" },
};

const TERMS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const TERM_RE = new RegExp(`\\b(${TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");

function gloss(text: string, open: string | null, setOpen: (t: string | null) => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const key = m[0].toLowerCase();
    const t = GLOSSARY[key];
    const isOpen = open === key;
    out.push(
      <button
        key={`${key}-${i++}`}
        type="button"
        onClick={() => setOpen(isOpen ? null : key)}
        aria-expanded={isOpen}
        className={`inline rounded-md border-b-2 border-dotted border-plum/60 px-0.5 font-semibold text-ink hover:bg-plum-soft ${isOpen ? "bg-plum-soft" : ""}`}
      >
        {m[0]}
      </button>,
    );
    if (isOpen && t) {
      out.push(
        <span key={`${key}-def-${i++}`} className="mx-1 inline-block rounded-lg bg-plum-soft px-2 py-0.5 text-[14px] text-ink">
          {t.plain}
          {t.nhs && (
            <>
              {" · "}
              <a href={`https://www.nhs.uk/conditions/${t.nhs}/`} target="_blank" rel="noreferrer" className="font-semibold text-plum underline">nhs.uk</a>
            </>
          )}
        </span>,
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// The simulator stamps its own housekeeping sentences into letters. Drop those; keep the clinical text.
const SIM_NOTE = /\b(fictional|training letter|simulat(ed|ion)|document workflow practice|integration testing)\b/i;
function stripSimNotes(s: string): string {
  return s.split(/(?<=[.!?])\s+/).filter((sentence) => !SIM_NOTE.test(sentence)).join(" ").trim();
}

// The GP-actions section is written for the practice; turn it to face the patient.
function toPatientVoice(s: string): string {
  return s
    .replace(/^Match the referenced panel to the patient record and request the outstanding medicines note before closing the document task\.?$/i, "Your GP has been asked to match the blood test mentioned in the letter to your record, and to ask for your up-to-date medicines list.")
    .replace(/\bthe patient\b/gi, "you")
    .replace(/\bpatient record\b/gi, "your record");
}

// The letter's own follow-up, medicines and GP-actions sections, facing the patient.
export function nextStepsFromRecord(state: AppState, level: ReadingLevel = "standard"): string[] {
  const letter = state.careNotes.find((n) => n.kind === "letter");
  const sec = letter?.sections;
  if (!sec) return [];
  const raw = [sec.followUp, sec.medicationChanges, sec.gpActions ? toPatientVoice(sec.gpActions) : undefined].filter((x): x is string => Boolean(x)).map(stripSimNotes).filter(Boolean);
  if (level === "simple") return raw.map(simplify);
  return raw;
}

// Short-sentence versions of the letter's stock phrases, for the simple reading level.
function simplify(s: string): string {
  return s
    .replace(/^The clinic secretary will confirm the next appointment through a separate booking letter\.?$/i, "The clinic will write to you with your next date.")
    .replace(/^The letter does not request a prescription\. A medicines reconciliation note is still expected\.?$/i, "No new medicines. Your GP will check your medicines list.")
    .replace(/^Your GP has been asked to match the blood test mentioned in the letter to your record, and to ask for your up-to-date medicines list\.?$/i, "Your GP will check your blood test and your medicines list.")
    .replace(/^Attendance for a planned renal clinic review\.?$/i, "You saw the kidney team.")
    .replace(/^The clinic attendance is complete\. The appointment outcome was entered in the hospital record\. The discharge coordinator recorded the handover for [^.]+\.?$/i, "The visit is finished and written up.")
    .replace(/^An existing simulated laboratory panel is referenced without new values in this letter\.?$/i, "No new test results in this letter.")
    .replace(/^No new coded diagnosis is asserted by this training letter\. Check the simulated patient record when classifying the correspondence\.?$/i, "No new diagnosis.");
}

export default function AfterAppointment({ state, onAsk, level = "standard" }: { state: AppState; onAsk: () => void; level?: ReadingLevel }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const letter = state.careNotes.find((n) => n.kind === "letter") ?? null;
  const latest: CareNote | null = letter ?? state.careNotes[0] ?? null;
  if (!latest) return null;
  const author = personById(state, latest.authorId);
  const sec = latest.sections;

  const saidRaw = (sec ? [sec.reason, sec.course, sec.results, sec.diagnoses] : [latest.text]).filter((x): x is string => Boolean(x)).map(stripSimNotes).filter(Boolean);
  const said = level === "simple" ? saidRaw.map(simplify) : saidRaw;
  const detailed = level === "detailed";

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="font-display text-lg font-bold">After your appointment</div>
        <span className="text-sm text-muted">{latest.title} · {fmtDay(latest.date)} · {author.name}</span>
      </div>
      <p className="mt-0.5 text-[15px] text-muted">{level === "simple" ? "Your last letter, in short. Tap an underlined word to see what it means." : "Your letter in plain words. Tap any underlined word to see what it means."}</p>

      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">What was said</div>
      <div className="mt-1 space-y-2 text-[16px] leading-relaxed">
        {(showAll || detailed ? said : said.slice(0, 2)).map((s, i) => <p key={i} className={level === "simple" ? "text-[18px]" : ""}>{gloss(s, open, setOpen)}</p>)}
        {detailed && sec?.gpActions && <p className="text-[14px] text-muted">Original note to your GP: “{sec.gpActions}”</p>}
        {!detailed && said.length > 2 && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-[15px] font-semibold text-plum hover:underline">{showAll ? "Show less" : `Show the rest (${said.length - 2} more)`}</button>
        )}
      </div>


      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="plum" size="lg" onClick={onAsk}>Ask Kindred what this means for me</Button>
        <Pill tone="neutral">From your record, not a diagnosis</Pill>
      </div>
      <p className="mt-2 text-[13px] text-muted">Questions like “is this serious?” or “what happens if it gets worse?” are for your practice. Kindred can note them down so you have them ready for the call.</p>
    </Card>
  );
}
