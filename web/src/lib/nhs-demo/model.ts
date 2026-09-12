export type Actor = "eleanor" | "sarah" | "tom" | "gp";
export type Relative = "sarah" | "tom";
export type Category = "appointments" | "results";
export type Message = {
  id: number;
  from: "you" | "kindred";
  text: string;
  category?: Category;
  source?: string;
};
export type Notice = {
  id: number;
  recipient: Relative;
  title: string;
  text: string;
  read: boolean;
  category: Category;
};
export type Event = {
  id: number;
  title: string;
  detail: string;
  outcome: "allowed" | "blocked" | "info";
  actor?: Actor;
};
export type Action =
  | { type: "login"; actor: Actor }
  | {
      type: "consent";
      relative: Relative;
      category: Category;
      allowed: boolean;
    }
  | { type: "chat"; text: string }
  | { type: "remind" }
  | { type: "read"; id: number }
  | { type: "reset" };

export const PEOPLE: Record<
  Actor,
  { name: string; first: string; role: string; initials: string }
> = {
  eleanor: {
    name: "Eleanor Chen",
    first: "Eleanor",
    role: "Patient",
    initials: "EC",
  },
  sarah: {
    name: "Sarah Chen",
    first: "Sarah",
    role: "Daughter",
    initials: "SC",
  },
  tom: { name: "Tom Chen", first: "Tom", role: "Son", initials: "TC" },
  gp: { name: "Dr Patel", first: "Dr Patel", role: "GP", initials: "DP" },
};

const APPOINTMENT = {
  title: "Kidney clinic review",
  date: "Thursday 17 September",
  time: "10:30 am",
  location: "Riverside Health Centre",
  preparation:
    "Bring your current medication list and any questions for the care team.",
};
const RESULT = {
  title: "Kidney function · eGFR",
  value: "48",
  unit: "mL/min/1.73m²",
  previous: "54",
  date: "10 September 2026",
  previousDate: "12 June 2026",
  note: "Review the change at the booked kidney clinic appointment. Discuss medicines and whether a repeat test is needed.",
  source: "Fictional GP laboratory report · DEMO-LAB-001",
};

export type DemoState = {
  actor: Actor | null;
  grants: Record<Relative, Record<Category, boolean>>;
  version: number;
  reminded: boolean;
  chats: Record<Actor, Message[]>;
  notices: Notice[];
  events: Event[];
  nextId: number;
};

export function createDemo(): DemoState {
  return {
    actor: null,
    grants: {
      sarah: { appointments: true, results: false },
      tom: { appointments: true, results: false },
    },
    version: 1,
    reminded: false,
    chats: { eleanor: [], sarah: [], tom: [], gp: [] },
    notices: [],
    events: [
      {
        id: 0,
        title: "Demo ready",
        detail:
          "Fictional family loaded. Results are private; appointment sharing is on.",
        outcome: "info",
      },
    ],
    nextId: 1,
  };
}

function event(
  state: DemoState,
  title: string,
  detail: string,
  outcome: Event["outcome"] = "info",
  actor?: Actor,
) {
  state.events.unshift({ id: state.nextId++, title, detail, outcome, actor });
  state.events = state.events.slice(0, 60);
}

export function allowed(
  state: DemoState,
  actor: Actor,
  category: Category,
): boolean {
  return actor === "eleanor" || actor === "gp" || state.grants[actor][category];
}

function consent(
  state: DemoState,
  relative: Relative,
  category: Category,
  value: boolean,
) {
  if (state.actor !== "eleanor")
    throw new Error("Only Eleanor can change sharing permissions.");
  if (state.grants[relative][category] === value) return;
  state.grants[relative][category] = value;
  state.version++;
  event(
    state,
    value ? "Permission granted" : "Permission revoked",
    `${PEOPLE[relative].first} · ${category === "results" ? "Test results" : "Appointments"} · consent v${state.version}`,
    value ? "allowed" : "blocked",
    relative,
  );
  event(
    state,
    "GP consent updated",
    `Mock EHR acknowledged consent v${state.version}.`,
    "info",
    "gp",
  );
}

function chat(state: DemoState, text: string) {
  const actor = state.actor!;
  const lower = text.toLowerCase().trim();
  const conversation = state.chats[actor];
  const user: Message = { id: state.nextId++, from: "you", text };
  conversation.push(user);
  const reply: Message = { id: state.nextId++, from: "kindred", text: "" };
  const relative = /\bsarah\b/.test(lower)
    ? "sarah"
    : /\btom\b/.test(lower)
      ? "tom"
      : null;
  const category = /result|blood|egfr/.test(lower)
    ? "results"
    : /appointment|clinic|review/.test(lower)
      ? "appointments"
      : null;
  const revoke =
    /^stop sharing my (test results|appointments) with (sarah|tom)[.!]?$/.test(
      lower,
    );
  const grant =
    /^let (sarah|tom) see my (test results|appointments)[.!]?$/.test(lower);
  const sharingRequest =
    actor === "eleanor" &&
    relative &&
    /share|sharing|let|allow|revoke|permission|access/.test(lower);

  if (actor === "eleanor" && relative && category && (revoke || grant)) {
    consent(state, relative, category, !revoke);
    reply.text = revoke
      ? `Done. ${PEOPLE[relative].first} can no longer access your ${category === "results" ? "test results" : "appointments"} through Kindred. The mock GP record is updated. Information already seen cannot be taken back.`
      : `Done. ${PEOPLE[relative].first} can now see your ${category === "results" ? "test results" : "appointments"}. Your other permissions stay the same. The mock GP record is updated to consent v${state.version}.`;
    reply.source =
      "Your instruction → permission check → mock GP acknowledgement";
  } else if (sharingRequest) {
    reply.text =
      "I haven’t changed your permissions. This scripted demo supports one clear change at a time: “Let Sarah see my test results” or “Stop sharing my test results with Sarah”. You can also use the Sharing switches.";
  } else if (category === "results" || /kidney|mean|explain/.test(lower)) {
    user.category = "results";
    if (!allowed(state, actor, "results")) {
      reply.text =
        "Eleanor has not shared her test results with you. I cannot retrieve or explain them. She can change this in Family care → Sharing, or ask me to share them with you.";
      reply.source = `Access blocked before retrieving the report · consent v${state.version}`;
      event(
        state,
        "Result access blocked",
        `${PEOPLE[actor].first}: no permission. No laboratory data returned.`,
        "blocked",
        actor,
      );
    } else {
      reply.category = "results";
      reply.text = `eGFR is an estimate of how well the kidneys filter blood. In this fictional report, Eleanor’s result is ${RESULT.value} ${RESULT.unit}, compared with ${RESULT.previous} in June.\n\nA single change does not tell us the cause or what treatment is needed. The clinician’s recorded plan is: “${RESULT.note}”\n\nFor the appointment, useful questions are: Could this change be temporary? When should the test be repeated? Do any medicines need reviewing?\n\nThis is a scripted explanation of a fictional result, not a diagnosis or a treatment recommendation.`;
      reply.source = `${RESULT.source} · ${RESULT.date} · access allowed under consent v${state.version}`;
      event(
        state,
        "Result access allowed",
        `${PEOPLE[actor].first}: permission checked before reading the fictional report.`,
        "allowed",
        actor,
      );
    }
  } else if (category === "appointments" || /prepare|bring/.test(lower)) {
    user.category = "appointments";
    if (allowed(state, actor, "appointments")) {
      reply.category = "appointments";
      reply.text = `The ${APPOINTMENT.title.toLowerCase()} is on ${APPOINTMENT.date} at ${APPOINTMENT.time}, at ${APPOINTMENT.location}. ${APPOINTMENT.preparation} The family can use this reminder to arrange who will accompany Eleanor.`;
      reply.source = "Fictional appointment · DEMO-APPT-001";
    } else
      reply.text =
        "Eleanor has not shared appointments with you. No appointment details were retrieved.";
  } else {
    reply.text =
      actor === "eleanor"
        ? "I can help with this demo’s sharing, appointment, and test-result flows. Try “Let Sarah see my test results”, “Stop sharing my test results with Sarah”, or “What should I bring to my appointment?”"
        : "I can explain a shared test result or help prepare for the appointment. Try “What does Mum’s eGFR result mean?” or “What should we bring to the appointment?”";
  }
  conversation.push(reply);
  state.chats[actor] = conversation.slice(-40);
}

export function applyAction(state: DemoState, action: Action) {
  if (action.type === "reset") {
    Object.assign(state, createDemo());
    return;
  }
  if (action.type === "login") {
    state.actor = action.actor;
    event(
      state,
      "Demo profile selected",
      `${PEOPLE[action.actor].name} · simulated NHS login`,
      "info",
      action.actor,
    );
    return;
  }
  if (!state.actor) throw new Error("Select a demo profile first.");
  if (action.type === "consent")
    consent(state, action.relative, action.category, action.allowed);
  if (action.type === "chat") chat(state, action.text);
  if (action.type === "remind") {
    if (state.actor !== "eleanor" && state.actor !== "gp")
      throw new Error("Run the demo clock as Eleanor or the GP.");
    if (state.reminded) return;
    state.reminded = true;
    for (const recipient of ["sarah", "tom"] as const) {
      if (!allowed(state, recipient, "appointments")) {
        event(
          state,
          "Reminder withheld",
          `${PEOPLE[recipient].first}: appointment sharing is off.`,
          "blocked",
          recipient,
        );
        continue;
      }
      state.notices.push({
        id: state.nextId++,
        recipient,
        title: "Eleanor has an appointment tomorrow",
        text: `${APPOINTMENT.title} · ${APPOINTMENT.date}, ${APPOINTMENT.time}. ${APPOINTMENT.location}. ${APPOINTMENT.preparation}`,
        read: false,
        category: "appointments",
      });
      event(
        state,
        "NHS App message delivered",
        `${PEOPLE[recipient].first} · simulated delivery · appointment permission checked.`,
        "allowed",
        recipient,
      );
    }
  }
  if (action.type === "read") {
    const notice = state.notices.find(
      (item) => item.id === action.id && item.recipient === state.actor,
    );
    if (!notice || !allowed(state, state.actor, notice.category))
      throw new Error("Message is unavailable for this profile.");
    if (!notice.read) {
      notice.read = true;
      event(
        state,
        "Message read",
        `${PEOPLE[state.actor].first} opened the simulated NHS App message.`,
        "info",
        state.actor,
      );
    }
  }
}

export function snapshot(state: DemoState) {
  const actor = state.actor;
  const manager = actor === "eleanor" || actor === "gp";
  return {
    actor,
    version: state.version,
    reminded: state.reminded,
    day: state.reminded
      ? "Wednesday 16 September 2026"
      : "Saturday 12 September 2026",
    grants: manager ? state.grants : null,
    permissions: actor
      ? {
          appointments: allowed(state, actor, "appointments"),
          results: allowed(state, actor, "results"),
        }
      : null,
    appointment:
      actor && allowed(state, actor, "appointments") ? APPOINTMENT : null,
    result: actor && allowed(state, actor, "results") ? RESULT : null,
    messages: actor
      ? state.chats[actor].filter(
          (message) =>
            !message.category || allowed(state, actor, message.category),
        )
      : [],
    notices: state.notices.filter(
      (notice) =>
        actor === notice.recipient && allowed(state, actor, notice.category),
    ),
    events: actor
      ? state.events.filter((entry) => manager || entry.actor === actor)
      : [],
  };
}

export type DemoView = ReturnType<typeof snapshot>;
