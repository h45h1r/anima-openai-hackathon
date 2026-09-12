"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Action,
  Actor,
  Category,
  DemoView,
  Relative,
} from "@/lib/nhs-demo/model";
import Link from "next/link";
import styles from "./demo.module.css";

const profiles: Record<
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
type Tab = "home" | "sharing" | "chat" | "inbox";

function Icon({
  name,
  size = 21,
}: {
  name:
    | "home"
    | "people"
    | "chat"
    | "mail"
    | "shield"
    | "arrow"
    | "clock"
    | "check"
    | "leaf";
  size?: number;
}) {
  const paths = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" />
      </>
    ),
    chat: <path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z" />,
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 6 9 7 9-7" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    leaf: (
      <>
        <path d="M19 3C8 3 3 7 5 14c1 4 8 6 11 1 2-3 3-8 3-12Z" />
        <path d="m5 21 8-12" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export default function NhsDemo() {
  const [view, setView] = useState<DemoView | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [opened, setOpened] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const inFlight = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/nhs-demo", { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the demo.");
        setView(await response.json());
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (tab === "chat") bottom.current?.scrollIntoView({ block: "nearest" });
  }, [view?.messages.length, tab]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function act(action: Action): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/nhs-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Could not complete that action.");
      setView(data);
      if (action.type === "login" || action.type === "reset") {
        setTab("home");
        setOpened(null);
        setDraft("");
        setToast("");
      }
      if (action.type === "consent")
        setToast("Sharing updated. Mock GP record synced.");
      if (action.type === "remind")
        setToast("Demo clock advanced. Eligible family inboxes updated.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function ask(text: string) {
    if (!text.trim()) return;
    setTab("chat");
    if (await act({ type: "chat", text: text.trim() })) setDraft("");
  }

  const actor = view?.actor;
  const person = actor ? profiles[actor] : null;
  const patient = actor === "eleanor";
  const manager = patient || actor === "gp";
  const unread = view?.notices.filter((notice) => !notice.read).length ?? 0;
  const step =
    !view?.grants?.sarah.results && !view?.reminded
      ? 0
      : !view.reminded
        ? 1
        : 2;

  function button(text: string, onClick: () => void, secondary = false) {
    return (
      <button
        disabled={busy}
        className={secondary ? styles.secondary : styles.primary}
        onClick={onClick}
      >
        {text}
        <Icon name="arrow" size={18} />
      </button>
    );
  }

  function resultCard() {
    return view?.result ? (
      <div className={styles.result}>
        <div className={styles.eyebrow}>GP laboratory report</div>
        <h3>{view.result.title}</h3>
        <div className={styles.resultNumber}>
          {view.result.value}
          <span>{view.result.unit}</span>
        </div>
        <p>
          Previously {view.result.previous} · {view.result.previousDate}
        </p>
        <div className={styles.resultNote}>{view.result.note}</div>
        <small>Fictional result · {view.result.date}</small>
        {button(
          "Help me understand this",
          () => void ask("What does Mum’s eGFR result mean?"),
          true,
        )}
      </div>
    ) : (
      <div className={styles.locked}>
        <Icon name="shield" size={25} />
        <h3>Some things stay private.</h3>
        <p>
          Eleanor hasn’t shared test results with this profile. Her results are
          withheld by the server.
        </p>
        {button(
          "Ask Kindred about access",
          () => void ask("What does Mum’s eGFR result mean?"),
          true,
        )}
      </div>
    );
  }

  function phoneContent(): ReactNode {
    if (!view) return <div className={styles.loading}>Opening your demo…</div>;
    if (!person || !actor)
      return (
        <div className={styles.welcome}>
          <div className={styles.welcomeIcon}>
            <Icon name="people" size={38} />
          </div>
          <div className={styles.eyebrow}>NHS App · demonstration</div>
          <h2>
            Your care.
            <br />
            Your people.
          </h2>
          <p>
            A little support from the people you trust. You decide what to
            share.
          </p>
          {button(
            "Continue as Eleanor",
            () => void act({ type: "login", actor: "eleanor" }),
          )}
          <div className={styles.loginNote}>
            <Icon name="shield" size={16} />
            Simulated NHS login. No account needed.
          </div>
          <div className={styles.welcomeBottom}>
            Built for the moments
            <br />
            between appointments.
          </div>
        </div>
      );
    if (actor === "gp")
      return (
        <div className={styles.screenContent}>
          <div className={styles.eyebrow}>Riverside Health Centre</div>
          <h2>Patient sharing record</h2>
          <p className={styles.subtle}>Eleanor Chen · fictional patient</p>
          <div className={styles.syncBanner}>
            <Icon name="check" />
            Consent v{view.version} · mock sync complete
          </div>
          <ConsentRows view={view} />
          <div className={styles.infoBox}>
            These decisions are mirrored from Kindred. Changes are made by
            Eleanor in her patient profile.
          </div>
          {resultCard()}
        </div>
      );
    if (tab === "sharing")
      return (
        <div className={styles.screenContent}>
          <div className={styles.eyebrow}>Family care / Sharing</div>
          <h2>{patient ? "Your circle of care" : "What’s shared with you"}</h2>
          <p className={styles.subtle}>
            {patient
              ? "A little help, on your terms. Choose what each person can see."
              : "Eleanor controls your access. Each request is checked before any record is returned."}
          </p>
          {patient ? (
            (["sarah", "tom"] as Relative[]).map((relative) => (
              <div className={styles.sharingCard} key={relative}>
                <div className={styles.personRow}>
                  <span className={styles.avatar}>
                    {profiles[relative].initials}
                  </span>
                  <div>
                    <h3>{profiles[relative].name}</h3>
                    <span>{profiles[relative].role} · demo family member</span>
                  </div>
                </div>
                {(["appointments", "results"] as Category[]).map((category) => (
                  <div className={styles.toggleRow} key={category}>
                    <div>
                      <strong>
                        {category === "results"
                          ? "Test results"
                          : "Appointments"}
                      </strong>
                      <small>
                        {category === "results"
                          ? "Reports and plain-English explanations"
                          : "Dates, locations and preparation"}
                      </small>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={view.grants![relative][category]}
                      aria-label={`${profiles[relative].first}: ${category === "results" ? "test results" : "appointments"}`}
                      disabled={busy}
                      className={`${styles.toggle} ${view.grants![relative][category] ? styles.toggleOn : ""}`}
                      onClick={() =>
                        void act({
                          type: "consent",
                          relative,
                          category,
                          allowed: !view.grants![relative][category],
                        })
                      }
                    >
                      <span />
                    </button>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className={styles.sharingCard}>
              <PermissionRows view={view} />
            </div>
          )}
          <div className={styles.infoBox}>
            <Icon name="shield" size={20} />
            <span>
              {patient
                ? "You can change your mind at any time. Revoking access stops future reads; it cannot erase information already seen."
                : "Being family does not automatically grant access to a medical record."}
            </span>
          </div>
          {patient
            ? button("Change sharing with Kindred", () => setTab("chat"), true)
            : null}
        </div>
      );
    if (tab === "chat")
      return (
        <div className={styles.chatScreen}>
          <div className={styles.chatIntro}>
            <span className={styles.kindredIcon}>
              <Icon name="leaf" />
            </span>
            <div>
              <h2>Kindred</h2>
              <small>Your family care companion · scripted demo</small>
            </div>
          </div>
          <div className={styles.conversation}>
            <div className={styles.assistantBubble}>
              Hello {person.first}.{" "}
              {patient
                ? "I can help you choose what to share, understand your results, or prepare for your appointment."
                : "I can help with Eleanor’s care using only the information she has shared with you."}
            </div>
            {view.messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.from === "you"
                    ? styles.userBubble
                    : styles.assistantBubble
                }
              >
                <p>{message.text}</p>
                {message.source ? (
                  <details>
                    <summary>Why this response?</summary>
                    <p>{message.source}</p>
                  </details>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className={styles.thinking} role="status">
                Checking permissions…
              </div>
            ) : null}
            <div ref={bottom} />
          </div>
          <div className={styles.suggestions}>
            {patient ? (
              <button
                disabled={busy}
                onClick={() =>
                  void ask(
                    view.grants?.sarah.results
                      ? "Stop sharing my test results with Sarah"
                      : "Let Sarah see my test results",
                  )
                }
              >
                {view.grants?.sarah.results
                  ? "Stop sharing results with Sarah"
                  : "Let Sarah see my test results"}
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => void ask("What does Mum’s eGFR result mean?")}
              >
                Explain Mum’s test result
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void ask("What should we bring to the appointment?")
              }
            >
              Prepare for the appointment
            </button>
          </div>
          <form
            className={styles.composer}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <input
              aria-label="Message Kindred"
              placeholder="Ask Kindred…"
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
            />
            <button aria-label="Send message" disabled={busy || !draft.trim()}>
              <Icon name="arrow" />
            </button>
          </form>
        </div>
      );
    if (tab === "inbox")
      return (
        <div className={styles.screenContent}>
          <div className={styles.eyebrow}>NHS App / Messages</div>
          <h2>Your inbox</h2>
          <p className={styles.subtle}>The next step, in one place.</p>
          {view.notices.length === 0 ? (
            <div className={styles.empty}>
              <Icon name="mail" size={32} />
              <h3>All quiet for now</h3>
              <p>
                {patient
                  ? "Family reminders arrive in Sarah’s and Tom’s demo inboxes. Advance the demo clock, then switch profile."
                  : "Appointment reminders appear here when the demo clock advances and Eleanor has shared appointments with you."}
              </p>
            </div>
          ) : (
            view.notices.map((notice) => (
              <article className={styles.notice} key={notice.id}>
                <div className={styles.noticeMeta}>
                  <span>Kindred · family care</span>
                  <span>{notice.read ? "Read" : "New"}</span>
                </div>
                <h3>{notice.title}</h3>
                {opened === notice.id ? (
                  <>
                    <p>{notice.text}</p>
                    {button("Talk to Kindred", () => setTab("chat"))}
                  </>
                ) : (
                  button(
                    "Open message",
                    () => {
                      void act({ type: "read", id: notice.id }).then((ok) => {
                        if (ok) setOpened(notice.id);
                      });
                    },
                    true,
                  )
                )}
              </article>
            ))
          )}
        </div>
      );
    return (
      <div className={styles.screenContent}>
        <div className={styles.greeting}>Good morning, {person.first}</div>
        <h2>{patient ? "Your health, together." : "A little help for Mum."}</h2>
        {!patient ? (
          <div className={styles.actingFor}>
            <Icon name="people" size={16} />
            Family care for Eleanor Chen
          </div>
        ) : (
          <p className={styles.subtle}>
            Your NHS services. Your trusted circle.
          </p>
        )}
        {unread > 0 ? (
          <button className={styles.push} onClick={() => setTab("inbox")}>
            <span className={styles.miniNhs}>NHS</span>
            <span>
              <strong>You have a new message</strong>
              <small>Kindred · tap to open your inbox</small>
            </span>
            <span>›</span>
          </button>
        ) : null}
        <button
          className={styles.familyEntry}
          onClick={() => setTab("sharing")}
        >
          <div>
            <span className={styles.eyebrow}>Introducing Kindred</span>
            <h3>Family care</h3>
            <p>
              {patient
                ? "Choose who’s by your side."
                : "See what Eleanor has shared."}
            </p>
            <span className={styles.entryLink}>
              Open your circle <Icon name="arrow" size={17} />
            </span>
          </div>
          <div className={styles.familyArt}>
            <span>EC</span>
            <span>SC</span>
            <span>TC</span>
          </div>
        </button>
        <div className={styles.sectionTitle}>
          Coming up <span>{view.reminded ? "Tomorrow" : "In 5 days"}</span>
        </div>
        {view.appointment ? (
          <article className={styles.appointment}>
            <div className={styles.dateTile}>
              <span>SEP</span>
              <strong>17</strong>
              <span>THU</span>
            </div>
            <div>
              <h3>{view.appointment.title}</h3>
              <p>
                {view.appointment.time} · {view.appointment.location}
              </p>
              <button
                className={styles.textButton}
                disabled={busy}
                onClick={() =>
                  void ask("What should we bring to the appointment?")
                }
              >
                Help me prepare <span>→</span>
              </button>
            </div>
          </article>
        ) : (
          <div className={styles.infoBox}>
            Appointments have not been shared with you.
          </div>
        )}
        <div className={styles.sectionTitle}>
          Your care, explained <Icon name="shield" size={17} />
        </div>
        {resultCard()}
      </div>
    );
  }

  return (
    <div className={styles.demo}>
      <header className={styles.topbar}>
        <Link href="/nhs-demo" className={styles.brand}>
          <span className={styles.brandMark}>
            <Icon name="leaf" />
          </span>
          kindred
          <span className={styles.brandDivider} />
          NHS App demo
        </Link>
        <div className={styles.topActions}>
          <span className={styles.demoBadge}>
            <span />
            Simulated NHS integration
          </span>
          <Link href="/">Original demo ↗</Link>
        </div>
      </header>
      <main className={styles.layout}>
        <section className={styles.story}>
          <div className={styles.overline}>A connected circle of care</div>
          <h1>
            A little help.{" "}
            <br />
            On <em>your</em> terms.
          </h1>
          <p className={styles.lead}>
            Keep your family close to your care. Share what matters, understand
            what’s next, and stay in control.
          </p>
          <ol className={styles.steps}>
            {[
              {
                title: "Choose what to share",
                body: "Eleanor gives Sarah access to her test results.",
              },
              {
                title: "Bring the family in",
                body: "A timely reminder helps everyone prepare.",
              },
              {
                title: "Make sense of the result",
                body: "Kindred explains only what’s been shared.",
              },
            ].map((item, i) => (
              <li
                key={item.title}
                className={actor && step === i ? styles.currentStep : ""}
              >
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className={styles.director}>
            <div className={styles.eyebrow}>Demo controls</div>
            <label htmlFor="profile">View the journey as</label>
            <select
              id="profile"
              aria-label="Demo profile"
              disabled={!view || busy}
              value={actor ?? ""}
              onChange={(e) =>
                void act({ type: "login", actor: e.target.value as Actor })
              }
            >
              <option value="" disabled>
                Select a profile
              </option>
              {Object.entries(profiles).map(([id, profile]) => (
                <option key={id} value={id}>
                  {profile.name} · {profile.role}
                </option>
              ))}
            </select>
            <button
              className={styles.advance}
              disabled={busy || !manager || view?.reminded}
              onClick={() => void act({ type: "remind" })}
            >
              <Icon name="clock" size={18} />
              {view?.reminded
                ? "Reminder sent · 16 September"
                : "Advance to reminder day"}
            </button>
            <p>
              Run the clock as Eleanor or the GP, then switch to Sarah to open
              her message.
            </p>
            <button
              className={styles.reset}
              disabled={busy || !view}
              onClick={() => void act({ type: "reset" })}
            >
              ↺ Restart this demo
            </button>
          </div>
          <p className={styles.footnote}>
            Fictional people and records. Scripted assistant.
            <br />
            No NHS account, API key, or live messages.
          </p>
        </section>

        <section className={styles.deviceArea} aria-label="NHS App demo phone">
          <div className={styles.phone}>
            <div className={styles.statusBar}>
              <strong>9:41</strong>
              <div className={styles.camera} />
              <span>▮▮▮ &nbsp; ▰</span>
            </div>
            <div className={styles.nhsHeader}>
              <span className={styles.nhsLogo}>NHS</span>
              <span>
                App <small>DEMO</small>
              </span>
              {person ? (
                <span className={styles.headerAvatar} title={person.name}>
                  {person.initials}
                </span>
              ) : (
                <Icon name="shield" size={22} />
              )}
            </div>
            {person ? (
              <div className={styles.profileBar}>
                {person.name}
                <span>{person.role} profile</span>
              </div>
            ) : null}
            <div className={styles.phoneBody}>{phoneContent()}</div>
            {person && actor !== "gp" ? (
              <nav
                className={styles.bottomNav}
                aria-label="Demo app navigation"
              >
                {(
                  [
                    { id: "home", label: "Home", icon: "home" },
                    { id: "sharing", label: "Sharing", icon: "people" },
                    { id: "chat", label: "Kindred", icon: "chat" },
                    { id: "inbox", label: "Messages", icon: "mail" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    aria-current={tab === item.id ? "page" : undefined}
                    onClick={() => setTab(item.id)}
                  >
                    <span>
                      <Icon name={item.icon} />
                      {item.id === "inbox" && unread > 0 ? (
                        <i>{unread}</i>
                      ) : null}
                    </span>
                    {item.label}
                  </button>
                ))}
              </nav>
            ) : null}
            <div className={styles.homeIndicator} />
          </div>
          <div className={styles.deviceCaption}>
            <span />
            Separate demo session · {view?.day ?? "Loading"}
          </div>
        </section>

        <aside className={styles.evidence}>
          <div className={styles.evidenceTop}>
            <Icon name="shield" size={24} />
            <span>Trust, made visible</span>
          </div>
          <h2>
            Every share{" "}
            <br />
            has a reason.
          </h2>
          <p>
            Follow the permission checks and simulated NHS handoffs as the story
            unfolds.
          </p>
          <div className={styles.connectionCard}>
            <div className={styles.connectionLabel}>
              <span className={styles.dot} />
              {manager ? "GP consent mirror" : "Your access"}
              <span>MOCK</span>
            </div>
            {view && actor ? (
              <>
                {manager ? (
                  <ConsentRows view={view} />
                ) : (
                  <PermissionRows view={view} />
                )}
                <div className={styles.version}>
                  Consent v{view.version}
                  <span>
                    {manager ? "Synced locally" : "Checked on the server"}
                  </span>
                </div>
              </>
            ) : (
              <div className={styles.notSignedIn}>
                Choose a demo profile to begin.
              </div>
            )}
          </div>
          <div className={styles.auditTitle}>
            Activity <span>{view?.events.length ?? 0} events</span>
          </div>
          <div className={styles.audit} aria-live="polite">
            {view?.events.slice(0, 8).map((entry) => (
              <div key={entry.id} className={styles.auditItem}>
                <span
                  className={`${styles.auditDot} ${entry.outcome === "blocked" ? styles.blocked : entry.outcome === "allowed" ? styles.allowed : ""}`}
                />
                <div>
                  <strong>{entry.title}</strong>
                  <p>{entry.detail}</p>
                </div>
              </div>
            ))}
            {!actor ? (
              <p className={styles.auditEmpty}>
                The story starts with Eleanor.
                <br />
                Her choices set everything in motion.
              </p>
            ) : null}
          </div>
          <div className={styles.boundaryNote}>
            NHS login, proxy roles, delivery receipts, and GP sync are
            simulated. Sharing rules run in the backend.
          </div>
        </aside>
      </main>
      {toast ? (
        <div role="status" className={styles.toast}>
          <Icon name="check" size={19} />
          {toast}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className={styles.error}>
          {error}
          <button onClick={() => window.location.reload()}>Reload demo</button>
        </div>
      ) : null}
    </div>
  );
}

function ConsentRows({ view }: { view: DemoView }) {
  return (
    <div className={styles.consentTable}>
      <div>
        <span>Family member</span>
        <span>Visits</span>
        <span>Results</span>
      </div>
      {(["sarah", "tom"] as Relative[]).map((relative) => (
        <div key={relative}>
          <strong>{profiles[relative].first}</strong>
          {(["appointments", "results"] as Category[]).map((category) => (
            <span
              key={category}
              className={
                view.grants?.[relative][category]
                  ? styles.accessYes
                  : styles.accessNo
              }
            >
              {view.grants?.[relative][category] ? "Shared" : "Private"}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
function PermissionRows({ view }: { view: DemoView }) {
  return (
    <div className={styles.permissionRows}>
      {(["appointments", "results"] as Category[]).map((category) => (
        <div key={category}>
          <span>
            {category === "results" ? "Test results" : "Appointments"}
          </span>
          <strong
            className={
              view.permissions?.[category] ? styles.accessYes : styles.accessNo
            }
          >
            {view.permissions?.[category] ? "Shared" : "Private"}
          </strong>
        </div>
      ))}
    </div>
  );
}
