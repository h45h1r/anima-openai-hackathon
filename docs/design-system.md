# Kindred design system

How Kindred looks, reads and behaves, and how to build new screens that fit. Everything here is
implemented in `web/src/app/globals.css` (tokens, layout) and `web/src/components/ui.tsx`
(primitives). If the doc and the code disagree, fix the doc.

**Kindred** is a care companion for elderly and chronically ill patients and the people around
them. The interface has three audiences on one codebase: the patient (often 75+, on a phone, maybe
with a tremor or reading glasses off), their family and carers, and clinicians reading the same
facts inside their own systems. Every decision below serves the sentence *"I can see exactly what is
happening, who knows about it, and what to do next."*

---

## 1. Principles

1. **Consent is visible, not buried.** Who can see what is a first-class object on screen: a lock,
   a level name, a plain sentence. Never hide a sharing decision behind a settings gear.
2. **Plain English, UK spelling, no jargon without a translation.** eGFR gets "how fast the kidneys
   filter" in the same breath. Write for a worried adult child at 11pm.
3. **Big enough for the patient, dense enough for the family.** Patient screens use a larger type
   scale (`big` props); family and clinician screens use the standard scale.
4. **Truthful states.** Show real data, real timestamps, real sync status. If something is not shared,
   say so and never hint at the content.
5. **One memorable element, everything else quiet.** The circle-of-care diagram is the signature.
   Around it: white cards, soft borders, one accent at a time.
6. **Mobile-first, one responsive app.** No phone mock, no separate mobile build. Bottom tab bar
   below `lg`, header navigation above it.

---

## 2. Colour

Tokens live on `:root` and are mapped into Tailwind via `@theme inline`, so `bg-plum` and
`var(--plum)` are the same colour. Light theme only, `color-scheme: light`.

| Token | Hex | Role |
| --- | --- | --- |
| `--paper` | `#F2F4F1` | Page background. Pale mist, deliberately not cream. |
| `--card` | `#FFFFFF` | Surfaces: cards, header, tab bar, composer. |
| `--ink` | `#14261F` | Primary text, active nav. Deep spruce, not black. |
| `--muted` | `#5F6D66` | Secondary text, labels, timestamps. |
| `--line` | `#D8DED9` | Borders, dividers, inactive ring segments. |
| `--moss` / `--moss-deep` / `--moss-soft` | `#2F6B4F` / `#1E4A36` / `#E4EEE8` | The patient. Primary buttons, the patient's own messages, "allowed" and "live" states. |
| `--plum` / `--plum-soft` | `#6D2E5B` / `#F1E4EC` | **Consent and Kindred itself.** Locks, sharing levels, the agent's avatar and notifications, selected states, focus ring. |
| `--amber` / `--amber-soft` | `#C98A1E` / `#FBF1DC` | Appointments and things that need attention soon. "Custom" sharing. |
| `--rust` | `#C2572F` | Out-of-range results, errors, badges, destructive actions. Also the first family colour. |
| `--sky-soft` | `#E6EEF6` | Reserved for clinician surfaces. |

**Person colours.** Every person has a fixed colour used for their avatar and chat name. The
patient is moss; Kindred is plum; family members get `#C2572F`, `#3B6EA8`, `#8A6D2F`, `#526F5D`
in order; clinicians get `#3C5A7A`, `#4C6A5A`, `#5A4C7A`, `#7A5A3C`. Colours are assigned once and
never reused for meaning elsewhere on the same screen.

**Rules.** Plum means "about sharing" everywhere. Do not use it for generic emphasis. Amber is for
time pressure, not warnings in general. Rust is for "outside the range" and "destructive", never
decoration. Text on soft backgrounds uses `--ink` or a darkened accent (`#7A520C` on amber-soft),
never the raw accent.

---

## 3. Typography

Three faces, loaded with `next/font/google` and exposed as `font-display`, `font-body` (default)
and `font-mono`.

| Role | Face | Weights | Use |
| --- | --- | --- | --- |
| Display | **Bricolage Grotesque** | 500–800 | Headings, person names, level names, numbers in stat tiles, avatar initials. Letter-spacing `-0.02em`. |
| Body | **Instrument Sans** | 400–700 | Everything else. `ss01`, `cv11` enabled. |
| Data | **JetBrains Mono** | 400–500 | Lab values, IDs, timestamps in the activity rail, FHIR and JSON previews, audit kind labels. |

**Scale.**

| Element | Standard | Patient (`big`) |
| --- | --- | --- |
| Page title | `text-[26px] sm:text-3xl` display bold | `text-[28px] sm:text-4xl` |
| Card title | `text-lg` display bold | `text-lg` |
| Body | `text-[15px]` | `text-[17px]` |
| Secondary | `text-sm text-muted` | `text-[15px] text-muted` |
| Meta / labels | `text-xs` or `text-[11px] font-semibold uppercase tracking-wider text-muted` | same |
| Chat bubble | `text-[15px] leading-relaxed` | `text-[17px] leading-relaxed` |

Inputs are never below 16px on phones (`text-base` then `sm:text-[15px]`) so iOS does not zoom on
focus. Line height is relaxed in prose, tight in headings.

---

## 4. Spacing, shape, elevation

- **Radius.** Cards and option tiles `rounded-2xl` (16px). Pills, buttons, avatars, toggles
  `rounded-full`. Chat bubbles `rounded-2xl` with one corner `rounded-br-md` / `rounded-bl-md`
  pointing at the sender. Code and JSON previews `rounded-xl`.
- **Borders over shadows.** Surfaces are `bg-card border border-line`. The only shadows are the
  account menu (`shadow-xl`) and agent bubbles (`shadow-sm ring-1 ring-line`).
- **Spacing rhythm.** 4px base. Card padding `p-4`. Vertical stack `space-y-4`. Grid gap `gap-3`
  on phones, `gap-4` from `md`. Page gutter 16px, 24px from `sm`, 32px from `lg` (`.page`).
- **Content width.** Pages cap at `64rem`. Chat and the activity page cap at `max-w-3xl`.
- **Backgrounds.** The page carries a faint two-point radial gradient (`.paper-grain`) so large
  empty areas are not flat grey.

---

## 5. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Header (sticky, 56px / 64px from lg)                          │
│  logo · [Home Circle Family Kindred]lg+ · Live · Run check ·  │
│  activity toggle lg+ · account menu                           │
├───────────────────────────────────────────┬──────────────────┤
│ main (.page or .app-main-h)               │ activity panel   │
│                                           │ lg+, 360–400px,  │
│                                           │ hidden by default│
├───────────────────────────────────────────┴──────────────────┤
│ Bottom tab bar (< lg only, 64px + safe area)                  │
└──────────────────────────────────────────────────────────────┘
```

CSS variables drive the maths: `--header-h` (3.5rem, 4rem from `lg`) and `--tabbar-h`
(4rem + safe-area, 0 from `lg`).

- `.page` — normal scrolling content with the tab bar cleared.
- `.app-main-h` — a full-height working area (`100dvh` minus header and tab bar) for chat and the
  activity log; the composer sits at its bottom.
- Persona and tab live in the URL (`?as=grace&tab=kindred`) so any screen can be deep-linked and two
  devices can show two people at once.
- The persona switcher is the **account menu** (top right). It is a demo affordance styled as
  "signed in as"; a real deployment replaces it with auth.

---

## 6. Primitives (`ui.tsx`)

| Component | Props | Notes |
| --- | --- | --- |
| `Avatar` | `person`, `size`, `ring` | Initials in display bold on the person's colour. Kindred shows the mark instead of initials. |
| `KindredMark` | `size`, `color` | Two overlapping rings: the patient and their circle. The only logo. |
| `Button` | `variant` primary · secondary · ghost · plum · danger, `size` sm · md · lg | Pill-shaped, never wraps. `primary` (moss) for the patient's main action, `plum` for anything about sharing or the agent, `danger` is outlined not filled. |
| `Pill` | `tone` neutral · moss · plum · amber · rust, `title` | Status chips. Never wraps. Wrap in a `span` to apply responsive `hidden`/`block`. |
| `Card` | `tone` amber · plum · moss | Default is white on `--line`. Toned cards are for one highlighted item per screen (next appointment, a consent request). |
| `Toggle` | `on`, `label`, `big`, `disabled` | Plum when on. 44px wide, 56px in `big`. Always given an `aria-label`. |
| `LockIcon` | `size`, `open` | The consent glyph. Closed = not shared, open = shared. |
| `Prose` | `text` | Renders agent replies: `**bold**`, bullet lines, paragraphs. Nothing else. |
| `fmt*` helpers | ISO → en-GB, Europe/London | Use these; never format dates inline. |

---

## 7. Patterns

**Sharing levels.** A person is on one of three levels: *Everything*, *Only practical*, *Important
updates*. Present them as large radio tiles with the level name in display bold, a one-line meaning,
and chips of the record parts it includes. The selected tile is plum-bordered on `plum-soft`. Below
the tiles, one plain sentence: "Grace can see now: …". A mix that matches no level is labelled
*Custom* in amber. Per-part toggles exist only inside a "Fine-tune" disclosure.

**Locked section.** When a viewer lacks access, render a dashed plum card with the lock, the section
name, and "Eleanor hasn't shared this with you." Offer "Ask her via Kindred" where a request makes
sense. Never describe the hidden content, not even its size.

**Chat.** The viewer's own messages are moss on the right. Kindred's replies are white with a hairline
ring on the left; Kindred's proactive notices use `plum-soft` with a plum border. Each agent reply
carries a collapsible "How I worked this out" trace listing tool calls and consent checks, with a
"withheld" count when something was refused. A pulsing bar marks streaming.

**Activity rail ("Behind the glass").** Monospace time, actor avatar, uppercase kind label in its
colour (consent = plum, EHR sync = clinician blue, tool = moss, notification = amber), then the
summary. Rows expand to raw JSON. Three stat tiles at the top: checks, withheld, consent version.

**Next-up card.** The single most time-relevant item on a home screen is an amber card: eyebrow
pill, display title, when and where, one-line purpose, an expandable list of what is on record for
the visit.

**Body view.** A light radial-gradient stage (`#ffffff → #e3ecf0`) holds a stippled figure in
`#6fa6cf`/`#a9c8dd` scan lines; nothing else on the page uses that blue. The focused system tints
its region in the system's status colour and the camera glides to it. Micro-labels above the stage
are JetBrains Mono, 10.5px, uppercase, tracking-wider: `HEALTH DATA 19 ANALYTES`. The systems list on
the right uses the standard card, a status dot, and an expandable detail with sparklines (reference
band in `moss-soft`, last point rust when outside range). Organ meshes, when present, sit at
`#8fb6d3` at 22% opacity and go opaque in the status colour on focus.

**Empty and error states.** Say what is true and what to do: "No appointments booked. Nothing is in
the practice diary right now." Errors name the failure and the fix ("Start sim-app on port 4192").
No apologies, no exclamation marks.

---

## 8. Motion and feedback

- `.rise` (280ms fade-up) on newly inserted rows, bubbles and cards. Nothing else animates on
  entry.
- `.pulse-soft` for "in progress": streaming cursor, "Saving…", "Checking…".
- Toggles and rings transition colour over 300ms.
- All motion is disabled under `prefers-reduced-motion`.
- Every write shows its result in words within the same component ("Sharing level saved and synced
  to your GP record."). Optimistic UI is fine for toggles; never for consent.

---

## 9. Accessibility

- Focus ring is 2px plum with 2px offset on every focusable element, never removed.
- Tap targets are at least 44px on phones; patient toggles and buttons are larger.
- Radio groups, switches and menus carry roles and `aria-checked` / `aria-pressed` /
  `aria-expanded`. Live regions announce save status.
- Colour never carries meaning alone: locks, labels and text accompany every plum / amber / rust.
- Text contrast is 4.5:1 or better on every token pairing listed above.
- The SVG circle has `role="img"` and an `aria-label`, and each person node is keyboard-operable.

---

## 10. Writing

- **Sentence case** everywhere, including buttons and tab labels.
- **Name people, not roles**, once they are known: "Grace can see…", not "The daughter can see…".
- **Verbs on buttons say what happens:** "Share with Grace", "Run check", "Reload record from
  NHS-SIM". Not "Submit", "OK".
- **Consent language is fixed:** *share / stop sharing*, *level*, *Everything / Only practical /
  Important updates*, *not shared*, *withheld*. Do not introduce synonyms.
- **Health explanations** follow the same shape every time: what the number means, what changed,
  what it does not mean, what is already planned, what to ask at the next appointment.
- **Numbers stay with their units** in mono: `48 mL/min/1.73m²`.
- Kindred speaks as "I" and addresses people by first name. It never says "as an AI".

---

## 11. Do and don't

| Do | Don't |
| --- | --- |
| One toned card per screen | Stack several amber or plum cards |
| Plum for anything about sharing | Plum for decoration or generic emphasis |
| Show sync status in words with a time | Show a green tick with no context |
| Put the sharing level name in display bold | Hide the level inside a dropdown |
| Use `Pill` inside a responsive wrapper | Put `hidden md:inline-flex` on `Pill` directly |
| Format dates with the `fmt*` helpers | Inline `toLocaleDateString` calls |
| Keep the header to one row | Add a tagline or a second badge |

---

## 12. Adding a screen

1. Decide the audience (patient, family, clinician) and pick the type scale accordingly.
2. Wrap in `.page` for scrolling content or `.app-main-h` for a full-height tool.
3. Build from `Card`, `Pill`, `Button`, `Toggle` before writing new CSS. New tokens go in
   `globals.css` and this doc in the same change.
4. Add the tab to the `tabs` array in `App.tsx` if it needs navigation; otherwise deep-link it with
   `?tab=`.
5. Check it at 375px and 1280px, with the activity panel open and closed, with keyboard focus, and
   with "Reduce motion" on.
