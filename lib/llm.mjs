// OpenAI helpers with templated fallbacks. Every function returns { text, simulated }.
import { TOPICS, TEXT, isResultsQuestion } from "./gate.mjs";

const MODEL = "gpt-4o-mini";
const URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 40_000;

const hasKey = () => Boolean(process.env.OPENAI_API_KEY);
const oneLine = (m) => String(m).replace(/\s+/g, " ").slice(0, 160);

async function chat(messages, extra = {}) {
  if (!hasKey()) throw new Error("OPENAI_API_KEY missing");
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, temperature: 0.3, messages, ...extra }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return json.choices?.[0]?.message || {};
}

function describeAnalytes(analytes = []) {
  return analytes
    .map((a) => {
      const flag = a.v < a.lo ? "low" : a.v > a.hi ? "high" : "within range";
      return `${a.name}: ${a.v} ${a.unit} (reference ${a.lo}-${a.hi}, ${flag})`;
    })
    .join("; ");
}

export function explainTemplate(ctx) {
  const ab = ctx.abnormal || [];
  const opener = ctx.role === "patient" ? "Your recent liver blood test is back." : `${ctx.patient.name}'s recent liver blood test is back.`;
  const body = ab.length
    ? ` ${ab.join(" and ")} ${ab.length > 1 ? "are" : "is"} slightly outside the usual range. This is not a diagnosis; the practice will go through what it means at the follow-up appointment.`
    : " Everything measured is within the usual range. The practice will confirm this at the follow-up appointment.";
  return { text: opener + body, simulated: true };
}

// Plain-English explanation grounded only in the visible context for that person.
export async function explainResult(ctx) {
  if (!ctx.analytes) return { text: TEXT.appointments, simulated: true };
  try {
    const system = [
      "You are CareCircle, an NHS family communication assistant. Write in plain British English.",
      "Use ONLY the facts supplied. No diagnosis, no treatment advice, no speculation about causes.",
      "Maximum 70 words. Address the reader directly. Mention that the practice will discuss it at the follow-up appointment.",
      "Return JSON: {\"text\": string}.",
    ].join(" ");
    const user = JSON.stringify({
      reader: { name: ctx.name, role: ctx.role, consent: ctx.consent },
      patient: ctx.patient,
      panel: ctx.panel,
      analytes: describeAnalytes(ctx.analytes),
      outsideRange: ctx.abnormal,
    });
    const msg = await chat([{ role: "system", content: system }, { role: "user", content: user }], {
      response_format: { type: "json_object" },
    });
    const text = JSON.parse(msg.content || "{}").text;
    if (!text) throw new Error("empty explanation");
    return { text, simulated: false };
  } catch (e) {
    console.log(`openai explain fallback: ${oneLine(e.message)}`);
    return explainTemplate(ctx);
  }
}

export function askTemplate(ctx, question) {
  if (!ctx.consent.results && isResultsQuestion(question)) {
    return {
      text: `I'm sorry, ${ctx.name}. Eleanor has not shared her test results with you, so I can't go into them. Her practice is in touch with her, and you can ask her directly.`,
      simulated: true,
    };
  }
  if (ctx.analytes) return explainTemplate(ctx);
  const parts = [];
  if (ctx.appointment) parts.push(`Eleanor has a ${ctx.appointment.toLowerCase()}.`);
  parts.push("There is nothing you need to do right now; her practice is in touch with her.");
  return { text: parts.join(" "), simulated: true };
}

export async function answerQuestion(ctx, question) {
  if (!ctx.consent.results && isResultsQuestion(question)) return askTemplate(ctx, question);
  try {
    const system = [
      "You are CareCircle, an NHS family communication assistant. Plain British English, warm, under 80 words.",
      "Answer ONLY from the supplied context. If the context does not contain the answer, say so and suggest asking Eleanor or her practice.",
      "If the reader's consent.results is false, never mention any test values, analyte names or whether anything is abnormal; say Eleanor has not shared results with them.",
      "No diagnosis or treatment advice. Return JSON: {\"text\": string}.",
    ].join(" ");
    const user = JSON.stringify({ context: { ...ctx, analytes: ctx.analytes ? describeAnalytes(ctx.analytes) : null }, question });
    const msg = await chat([{ role: "system", content: system }, { role: "user", content: user }], {
      response_format: { type: "json_object" },
    });
    const text = JSON.parse(msg.content || "{}").text;
    if (!text) throw new Error("empty answer");
    return { text, simulated: false };
  } catch (e) {
    console.log(`openai ask fallback: ${oneLine(e.message)}`);
    return askTemplate(ctx, question);
  }
}

const CONSENT_TOOL = {
  type: "function",
  function: {
    name: "set_consent",
    description: "Change what one family member is allowed to receive from Eleanor's care.",
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", enum: ["sarah", "john", "tom"] },
        topic: { type: "string", enum: TOPICS },
        allowed: { type: "boolean" },
      },
      required: ["person", "topic", "allowed"],
    },
  },
};

const PERSON_WORDS = { sarah: /\b(sarah|daughter)\b/i, john: /\b(john|husband)\b/i, tom: /\b(tom|son)\b/i };
const TOPIC_WORDS = {
  results: /\b(result|results|blood|test|tests|numbers|clinical)\b/i,
  followup: /\b(follow[- ]?up|responsib)\w*/i,
  appointments: /\b(appointment|appointments|logistics|lift|transport)\b/i,
  updates: /\b(update|updates|everything|anything|all)\b/i,
};

function parseClause(clause) {
  const allowed = !/\b(stop|don't|do not|no longer|remove|revoke|hide|not)\b/i.test(clause);
  const people = Object.keys(PERSON_WORDS).filter((p) => PERSON_WORDS[p].test(clause));
  const topics = Object.keys(TOPIC_WORDS).filter((t) => TOPIC_WORDS[t].test(clause));
  return people.flatMap((person) => topics.map((topic) => ({ person, topic, allowed })));
}

// Regex fallback: each clause ("... and ...", "...; ...") is parsed on its own.
export function consentTemplate(text) {
  const applied = text.split(/\s*(?:\band\b|;|\.|,\s*but\b)\s*/i).flatMap(parseClause);
  const reply = applied.length
    ? `Done. ${applied.map((a) => `${cap(a.person)} ${a.allowed ? "can now see" : "will no longer see"} ${a.topic}`).join("; ")}.`
    : "I couldn't work out who or what to change. Try: \"Let John see my results\".";
  return { applied, reply, simulated: true };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Natural-language consent change via function calling; set_consent may be called several times.
export async function consentAgent(text, consent) {
  try {
    const system = [
      "You manage Eleanor's sharing permissions for her family: sarah (daughter), john (husband), tom (son).",
      "Topics: results (test values and explanations), followup (responsibility for follow-up), appointments (logistics), updates (whether help is needed).",
      "Call set_consent once per change Eleanor asks for. Then reply in one short plain sentence confirming what changed.",
      `Current consent: ${JSON.stringify(consent)}`,
    ].join(" ");
    const messages = [{ role: "system", content: system }, { role: "user", content: text }];
    const first = await chat(messages, { tools: [CONSENT_TOOL], tool_choice: "auto" });
    const calls = first.tool_calls || [];
    const applied = calls
      .map((c) => {
        try {
          return JSON.parse(c.function.arguments);
        } catch {
          return null;
        }
      })
      .filter((a) => a && ["sarah", "john", "tom"].includes(a.person) && TOPICS.includes(a.topic))
      .map((a) => ({ person: a.person, topic: a.topic, allowed: Boolean(a.allowed) }));
    let reply = first.content;
    if (calls.length) {
      const toolMsgs = calls.map((c) => ({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ ok: true }) }));
      const second = await chat([...messages, first, ...toolMsgs]);
      reply = second.content || reply;
    }
    return { applied, reply: reply || "Nothing changed.", simulated: false };
  } catch (e) {
    console.log(`openai consent fallback: ${oneLine(e.message)}`);
    return consentTemplate(text);
  }
}
