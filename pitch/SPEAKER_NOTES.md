# Kindred pitch: speaker notes

Seven slides, one speaker. Timings follow the brief (20 + 25 + 20 + 30 + 90 + 10 + 15 = 210 seconds, so 3:30 as briefed; if the slot is a hard 3:00, cut the demo to 60 seconds by dropping step 4's follow-up and the morning check). Every citation from the old deck lives here, not on the slides. The two extrapolations on slide 2 show their working below.

All patient data is synthetic. Eleanor Chen, SIM-000006, is a simulator-authored patient (her consultations carry the simulator's `patient-stories-v1` tag). Kindred is a fictional demo, not an official NHS product.

Product name: the slides read it from one constant, `PRODUCT` at the top of the script in `pitch/index.html`; the PPTX builder has the same constant. Swap it there if the name changes.

---

## Which code runs which pillar today (read before going on stage)

The three pillars are presented as one loop on the slides. They run in two codebases:

| Pillar | What it is | Where it runs today |
| --- | --- | --- |
| 1. Sees it coming | Trend engine: a year of bloods and the watch data become improving / watch / worsening cards | Prototype: `lib/insights.mjs`, served by `server.mjs` at `GET /api/insights`, live against the remote Anima world |
| 2. Tells her first | Disclosure gate and the three-day escalation (GP task plus landline call) | Prototype: `lib/gate.mjs` and `server.mjs`; 29 tests across `test/gate.test.mjs` (18) and `test/insights.test.mjs` (11), 29 pass; one LFT order, one clock advance and one task per run against Anima |
| 3. Tells the right people the right way | Three sharing levels over six record categories, custom mixes, `set_sharing_level` and `update_consent` tools, NOT_SHARED enforcement inside every tool, `request_access` cards, consent mirrored to the GP consent view in one PostgreSQL transaction, the scheduled morning check, the audit rail | Kindred app: `web/` (agent tools in `web/src/lib/agent/tools.ts`, levels in `web/src/lib/levels.ts`, circle in `web/src/lib/data/circle.ts`) with the companion backend in `sim-app/` |

Two honesty points that must be said if asked:

- Consent writes go to the local companion backend, which writes a GP observation and a consent audit entry in one transaction. They are not native FHIR Consent writes to the remote Anima simulator (README, "What's connected").
- The prototype's per-person threads are still named Sarah, John and Tom in `lib/gate.mjs`. The slides use the app's circle, Grace (daughter, SIM-000066), Thomas (son, SIM-000009) and Idris (husband, SIM-000140). Rename the prototype's people before showing its family view on stage, or say "daughter, husband, son".

---

## Slide 1: Eleanor (20 seconds)

**Script**

"This is Eleanor Chen. She is 83. Since May she has had four abnormal blood panels. Each one was filed. Nobody looked at them together. The only message the practice ever sent her was about registration paperwork. At twenty past four this morning she was admitted with reduced mobility. Her GP appointment for half past eight is still in the book. She has a landline, no app, and her husband could not drive her to her last review. Nothing in her record has reached her family. She is the human middleware between her clinicians and her family. In her words: I want to know what that is. I want to know what's going on. I want to be aware."

**What is verified in the simulator (read 12 Sep 2026, sim clock 08:00)**

- Born 1943-05-12, so 83 on the sim date (PDS record).
- White cell count below the 4 to 11 reference range on 15 May (2.7), 14 Jul (1.6), 29 Aug (1.3) and 11 Sep 2026 (2.1). All panels status "available", none reviewed, no task, no message about any of them. That is "each one was filed, nobody looked at them together".
- Exactly one conversation resource in the GP record: an SMS, subject "Registration paperwork", 12 Sep 01:00, "Please contact reception to finish the outstanding registration paperwork."
- Hospital attendance arrived 2026-09-12 04:20, presenting complaint "Reduced mobility", AMU bed 1, acuity 3.
- GP practice follow-up appointment booked 2026-09-12 08:30, 15 minutes.
- Consultation 21 Jun 2026 (Dr Rowan Ellis, telephone): "Eleanor's husband could not drive her to a review." One occasion, so say "could not drive her to her last review", not "cannot drive".
- Personal context: "Uses a landline and does not use the patient app."
- No family contact, next of kin or carer record anywhere in the GP, hospital or community views. "Nothing in her record has gone to her family" is the safe wording; "her family knows none of it" is an inference and is not on the slide.
- The wearables (steps, resting heart rate, sleep) are genuinely in the simulator record, on the community and wearables site: 4,350 steps on 5 Sep down to 1,800 on 12 Sep, flagged below her personal baseline of 4,200.

Do not say "nothing here was staged". The narrative was authored by the simulator, which is why the slide says "synthetic data, authored by the simulator, not by us".

---

## Slide 2: The scale (25 seconds)

**Script**

"This is not one patient. In a UK audit of two and a half thousand patients across 57 practices, 47 percent of blood results had no record of ever being communicated to the patient. For abnormal results it was still 31 percent. The NHS App now shows twelve million results a month. At 47 percent that is roughly five point six million results a month, around 68 million a year, with no evidence the patient was told. Doctors spend 74 minutes a day on results; across England's GPs that is about 35,000 GP-hours every working day. And a single reading is not effective at spotting decline. The trajectory is, and every GP system already holds the data. When this goes wrong it is serious: 41 serious incidents in 13 months, including a 45 millimetre lung mass. Five million unpaid carers could help. Point four percent of portal users have shared access."

**Sources and working**

1. **47% / 31%.** Watson J, Duncan P, Burrell A, et al. (PACT). BMJ Open Qual 2024;13:e002632. https://bmjopenquality.bmj.com/content/13/3/e002632. 57 practices, all four UK nations, blood tests taken April 2021, 2,572 patients. "Overall, in 47% (n=1210) of patients there was no evidence in the electronic health records that results had been communicated. Out of 1176 patients with one or more abnormal results there was no evidence of test communication in 30.6% (n=360)." Communication rate varied 12.2% to 80.5% between practices. Caveat: "no record in the EHR", not proof the patient was never told. Say "no record of being communicated", never "never told".

2. **5.6m a month, 68m a year (extrapolated).** NHS App Roadmap, NHS England Digital, updated 22 Jul 2026, https://digital.nhs.uk/services/nhs-app/roadmap: "Every month, NHS App users view their GP health record more than 35 million times, including 12 million views of test results." Working: 12,000,000 x 0.47 = 5,640,000 a month; x 12 = 67,680,000 a year, rounded to 68m. Caveats: (a) 12m is views, not distinct results; (b) a practice-record audit rate is being applied to App views, which assumes App-viewed results carry the same documentation gap; (c) the roadmap figure is management information, not official statistics. An order-of-magnitude illustration, labelled extrapolated on the slide.

3. **35,000 GP-hours a day (extrapolated).** Poon EG, Gandhi TK, Sequist TD, et al. Arch Intern Med 2004;164(20):2223-2228. https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/217621. 262 physicians, 15 practices, 64% response: "they spent on average 74 minutes per clinical day managing test results"; 83% reported at least one delay in reviewing results in the previous two months; the most wanted feature was "tools to help physicians generate result letters to patients". GP denominator: NHS England Digital, General Practice Workforce, 31 July 2026, published 27 Aug 2026, https://digital.nhs.uk/data-and-information/publications/statistical/general-and-personal-medical-services/31-july-2026: "28,426 FTE Qualified permanent GPs (excludes GPs in Training Grade and Locums)". Working: 74 x 28,426 = 2,103,524 minutes a day = 35,059 hours, rounded to 35,000. Caveats: (a) Poon is a US study from 2004, self-reported, not UK data; (b) FTE, not headcount; (c) wider definitions change the answer: 29,057 FTE fully qualified GPs including locums gives about 35,800 hours, and 38,578 FTE including trainees gives about 47,600 hours. Nearest UK evidence: Elwenspoek et al. 2020 (BMC Fam Pract 21:257, 550 UK GPs): 78% spend more than 30 minutes a day on testing, 53% confident dealing with abnormal results. Watson et al. 2022 (BJGP 72:e747) quotes an estimate of 1.5 to 2 hours a day, but its primary source could not be retrieved, so do not present it as verified.

4. **A single reading versus the trajectory.** Stow D, Matthews FE, Hanratty B. BMC Med 2018;16:171. https://doi.org/10.1186/s12916-018-1148-x. 13,149 people aged 75+ who died versus 13,149 matched controls, monthly electronic frailty index: "eFI at a single time point can predict mortality at a population level, but it is not effective at identifying individuals at short-term risk". Rapidly rising frailty from a low baseline: OR 2.84 (95% CI 2.34 to 3.45) for one-year mortality. "Every GP system already holds the data": the eFI is computed from routine coded GP data (Clegg A, et al. Age Ageing 2016;45:353-360, 931,541 patients). Note: the journal is BMC Medicine, not Age & Ageing. The odds ratio is not on the slide.

5. **41 serious incidents, 45 mm lung mass.** HSIB, "Failures in communication or follow-up of unexpected significant radiological findings", July 2019. https://www.hssib.org.uk/patient-safety-investigations/failures-in-communication-or-follow-up-of-unexpected-significant-radiological-findings/. "Between 1 April 2017 and 14 May 2018 there were 41 serious incidents reported on the Strategic Executive Information System (StEIS) ... involving a delayed lung cancer diagnosis as a result of radiological findings that were not acted upon. In 27 incidents, informing the patient about unexpected radiological findings could have prevented serious harm." Reference case: 76-year-old woman, chest x-ray 15 Jul 2017 reported "a 45mm opacity projected over the liver which may represent a right lung base mass"; letters to the consultant and GP never arrived; found by her GP three months later; died 31 Jan 2018. Caveats: radiology, not blood tests; 13.5 months. Do not say the GP ignored it (the GP never received the letter and was the one who found it) and do not say she died two months after the x-ray (about 6.5 months after the x-ray, just over two months after diagnosis).

6. **5 million unpaid carers.** ONS, Unpaid care, England and Wales: Census 2021 (19 Jan 2023): "an estimated 5.0 million usual residents aged 5 years and over provided unpaid care in 2021" (4.7 million in England). https://www.ons.gov.uk/peoplepopulationandcommunity/healthandsocialcare/healthandwellbeing/bulletins/unpaidcareenglandandwales/census2021. Carers UK's survey-based estimate is higher (about 10.6 million); we use the Census figure only.

7. **0.4% shared access.** Wolff JL, Berger A, Clarke D, et al. JAMIA 2016;23(6):1150-1158. https://doi.org/10.1093/jamia/ocw025. Geisinger: "Few (0.4%) registered adult patient portal users shared access to their account." Supporting: Gleason KT, et al. JAMA Netw Open 2025;8(2):e2461803, 16,005 patients aged 65+: only 43.3% aware shared access existed; 52.7% of care partners primarily used the patient's own credentials.

If asked for a UK carer anxiety figure: Carers UK State of Caring 2025, 74% of carers felt stressed or anxious (online self-selected sample of about 12,500). https://www.carersuk.org/policy-and-research/key-facts-and-figures/

---

## Slide 3: Why it happens (20 seconds)

**Script**

"Three reasons. First, it is not seen coming: results are reviewed one at a time, and no one reads the trend. Second, she is not told: there is no reliable 'patient informed' state in the record, and nothing routes a result to the people who need to act. Third, it is not understood and the family is locked out: the App shows the number and says ring your GP, only half of adults can find the out-of-range value, and proxy access hands a person the whole record after a practice-led setup, which almost nobody has."

**Citations**

- Not seen coming: Stow 2018 as above ("not effective at identifying individuals"). Eleanor's own record is the illustration: four low white cell counts, each filed as "available", none reviewed together.
- No "patient informed" state: PACT audit as above (the audit could only look for evidence of communication in the EHR because no structured state exists). Litchfield I, et al. BMJ Qual Saf 2015;24(11):681-690: "none of the practices we spoke to had a fail-safe in place to ensure that results are returned to staff or patients"; 80% of practices' default was that patients phone in for normal results. Bowie P, et al. BMJ Open 2015;5:e008968: 83% of 778 practices had a results-handling hazard; 39% of hazards were about communicating the outcome to the patient.
- 51%: Zikmund-Fisher BJ, Exe NL, Witteman HO. J Med Internet Res 2014;16(8):e187, n=1,817 adults aged 40 to 70: "approximately half (931/1817, 51.24%) of participants correctly identified the hemoglobin A1c value as being 'different than what [it] should be'"; 77% of higher numeracy and literacy participants versus 38% of lower. https://www.jmir.org/2014/8/e187
- "Ring your GP": nhs.uk NHS App help, test results (reviewed 13 Jan 2026): "You may see test results in your record that your healthcare professional has not yet discussed with you. Contact your GP if you have any concerns." https://www.nhs.uk/nhs-app/help/test-results/. NHS App Roadmap, 22 Jul 2026, lists "helping users to view detailed test results and more easily interpret changes between consecutive results" as a next step. https://digital.nhs.uk/services/nhs-app/roadmap
- Proxy access: nhs.uk family and carer access (reviewed 23 Sep 2024) and NHS England proxy access guidance (updated 13 Mar 2025): "Your GP surgery will need to set up family and carer access for you. Both you and the other person need to be patients at the same surgery"; consent form, identity checks, practice decides the level. https://www.nhs.uk/nhs-app/help/profile/family-and-carer-access/ ; https://www.england.nhs.uk/long-read/proxy-access/
- Almost nobody has it: Wolff 2016 (0.4%) and Gleason 2025, as under slide 2. Crotty BH, et al. JAMA Intern Med 2015;175(9):1492-1497: older people "want to retain granular control of their information ... simple proxy access may not adequately address the needs and concerns of aging patients."

---

## Slide 4: The solution (30 seconds)

**Script**

"Kindred turns every result into the right explanation and next action for every trusted person, under the patient's control. Three pillars, one loop. One: it sees it coming. A trend engine reads a year of bloods and the watch data and says improving, watch or worsening; on Eleanor's real values it flags her liver trend as worsening and her white cells as watch. Two: it tells her first. When a result lands or a trend is flagged, the gate asks one question, has she been told, and holds everything until she has been talked through it. Big news waits for her yes. If nobody tells her within three days, the agent raises a GP task and phones her landline. Three: it tells the right people the right way. Three sharing levels over six record categories, enforced inside every tool call, mirrored to her GP's consent view. Grace gets the numbers, Idris gets the logistics, Thomas gets a yes or no. Proxy access gives a person the record. Kindred gives each person their role."

**Notes**

- Trend engine (prototype, `lib/insights.mjs`): run on Eleanor's fixture it returns exactly six cards, in this order: worsening liver (bilirubin, "Your liver reading has been rising since July"), worsening mobility (steps), watch immune (white cell count), watch immune (neutrophils), improving metabolic (HbA1c, three panels in a row), improving kidney (potassium). Do not say "in June" or "three months before the admission": the engine does not time-slice, so that claim is unverifiable.
- Gate (prototype, `lib/gate.mjs`): deterministic code, not a model decision. Steps: idle, ordered, result_detected, disclosed, awaiting_patient, released. Family threads stay empty until disclosure, and with "ask me first" on, until the patient shares. Escalation fires only when a result is abnormal and undisclosed, and the family escalation message carries no analyte value or name.
- Consent (Kindred app): levels are `Everything` (all six categories), `Only practical` (appointments, medications, care notes), `Important updates` (appointments, test results, conditions), from `web/src/lib/levels.ts`. Circle defaults from `web/src/lib/data/circle.ts`: Grace sees appointments, medications, conditions, care notes (4 of 6, a custom mix); Thomas sees appointments only; Idris sees appointments, medications, test results, conditions, care notes (5 of 6). The patient changes them on the Circle screen or by telling Kindred in words (`set_sharing_level`, `update_consent`). Enforcement is in `web/src/lib/agent/tools.ts`: every read tool calls `checkConsent` first and returns `NOT_SHARED` with an instruction not to reveal or guess; the audit rail records the check.
- Plain-language rewriting evidence, for questions only: Steimetz E, et al. JAMA Netw Open 2024;7(5):e2412767. GPT-4 simplified 1,134 pathology reports from grade 13.19 to 7.45 reading level, 97.44% interpreted correctly, hallucinations in 0.26%; the authors say simplified reports "should be reviewed by clinicians before distribution to patients". Balance with Zaretsky J, et al. JAMA Netw Open 2024;7(3):e240357: discharge summaries rewritten by GPT-4, only 54% of physician reviews rated fully accurate, 18 of 100 flagged a safety concern, mostly omissions.

---

## Slide 5: The demo (90 seconds)

**Script, while clicking**

"Ninety seconds, live against Anima. Step zero: Eleanor's trend cards. Improving, watch, worsening, generated from her real panel history, live from the prototype. Liver worsening, white cells watch, sugar control improving. Step one: I order a liver function test in Anima and advance the clock 121 minutes. The result lands as a real state change; we detect it, we do not mock it. Step two: held. Eleanor's phone gets one message, a result has arrived and your practice will talk you through it. The family view shows nothing. Step three: the practice marks it discussed, it is flagged, so Eleanor is asked: do you want your circle to know? She says yes. Three versions go out: Grace sees bilirubin and albumin with the ranges, Idris sees the follow-up to arrange, Thomas sees nothing needed this week. A task now exists in Anima's own activity trail. Step four, in the Kindred app: Grace asks about a result she cannot see. NOT_SHARED. Kindred says Eleanor has not shared her test results, with no hint of what they say. Grace asks for access, Eleanor approves from a card, and the GP consent view updates live. Step five: the morning check reads the half past eight appointment from the record and posts to the family group: who can give Eleanor a lift?"

**Notes**

- Steps 0 to 3 run in the prototype (`server.mjs`) against the remote Anima world: `GET /api/insights` for the cards; one LFT order, one clock advance and one task per run.
- Steps 4 and 5 run in the Kindred app (`web/` plus `sim-app/`). The morning check picks up appointments in the next seven days not yet announced (sim clock 08:00, appointment 08:30), posts with category "appointments", so Grace, Thomas and Idris all see it, and adds the next action "Arrange to accompany Eleanor to practice follow-up".
- Visibly simulated, and say so if asked: WhatsApp delivery, relative identity checks, the clinician's "discussed with patient" tap, and the persona switcher standing in for sign-in. Consent writes go to the companion backend, not native FHIR Consent on the remote simulator.
- If the sim is slow, the held state is the moment to talk through the gate; the release is the payoff.

---

## Slide 6: 10 Year Health Plan fit (10 seconds)

**Script**

"This is what the 10 Year Health Plan asks for. One core purpose: power in patients' hands. Patients control whether their data is shared, and My Carer gives carers access on their loved one's behalf. And poor communication is the most common complaint. Chapters 2, 3 and 6."

**Citations** (Fit for the Future: The 10 Year Health Plan for England, CP 1350, DHSC, July 2025, corrected 15 July 2025; printed page numbers, PDF page = printed page + 2)

- Chapter 1, p22: "There are 3 shifts, but only one core purpose: to put power in patients' hands."
- Chapter 3, p51: "Patients will have control over whether this data is shared in real-time with their care team, so they can proactively monitor their health and step in if needed." Context, pp50 to 51: the My Health tool "will connect to the results of recent tests and investigations."
- Chapter 3, p51: "My Carer will allow people to securely prove they are providing care, often for an older family member, and gain access to the App on their behalf."
- Chapter 6, p89: "The problem is that the NHS doesn't listen well enough. The most common reasons for complaints is poor communication." (The plan's own grammar.)
- Chapter 2, p34: "Unpaid carers will also be actively involved in care planning." This is the Chapter 2 hook behind "Chapters 2, 3 and 6".
- Chapter 1, p21, for pillar 1 if asked: "This AI will also be an early warning system, detecting subtle signs of health changes by analysing data from wearables, lifestyle and medical records to trigger timely interventions".

Note: the plan contains no sentence about uncommunicated test results. Do not attribute the HSIB finding to the plan.

---

## Slide 7: Close and proof (15 seconds)

**Script**

"No result ever sits uncommunicated. And when it is communicated, every trusted person gets the right version, in their words, under her control. Three sharing levels over six record categories. Every agent tool call checks consent and is audited. Six plain-English trend cards from a year of bloods and her watch data. One transaction mirrors each consent change to her GP. Next: fold the trend engine, the gate and the escalation into the app, pilot at one practice, and wire consent to NHS App proxy access. We are Team 5. Thank you."

**Proof behind the strip**

- 3 x 6, Every, 1: Kindred app facts (`web/src/lib/levels.ts`, `web/src/lib/agent/tools.ts`, README "What's connected": consent changes "update the GP observation and consent audit in one PostgreSQL transaction").
- 6 cards: prototype fact, `lib/insights.mjs` on Eleanor's fixture (`test/fixtures/p6-gp.json` and `p6-community.json`), asserted by `test/insights.test.mjs` ("cards are sorted worsening, watch, improving, stable and capped at 6"). The watch data is genuinely in the simulator record (community and wearables site).

**Prototype proof (say only under the "prototyped today" label)**

- 3 real Anima actions per run: order the test, advance the clock, raise the task.
- 29 tests, 29 pass: `node --test test/gate.test.mjs test/insights.test.mjs` on 12 Sep 2026 reports tests 29, pass 29, fail 0. 18 on the gate and consent, 11 on the trend cards.
- "The son never receives a value" is asserted by this test in `test/gate.test.mjs`:

  ```
  test("no analyte values ever appear in a message to a person with results:false", () => {
    ...
    for (const person of ["john", "tom"]) {
      assert.equal(s.consent[person].results, false);
      const ctx = gate.visibleContextFor(person, s);
      assert.equal(ctx.analytes, null, `${person} context must not carry analytes`);
      assert.equal(ctx.abnormal, null);
      const text = allMessagesTo(s, person) + "\n" + allMessagesTo(s, "family");
      assert.equal(gate.containsAnalyteValues(text, s.gate.analytes), false, `${person} saw a value: ${text}`);
      for (const a of s.gate.analytes) assert.equal(text.includes(a.name), false, `${person} saw analyte name ${a.name}`);
      const refusal = askTemplate(ctx, "What were her liver results?");
      assert.match(refusal.text, /not shared/);
      assert.equal(gate.containsAnalyteValues(refusal.text, s.gate.analytes), false);
    }
  ```

  In the prototype "tom" is the son (`lib/gate.mjs`: `{ id: "tom", name: "Tom", role: "son" }`). The test also covers the husband and the shared family thread, and checks that a direct question ("What were her liver results?") gets a refusal with no value in it. A second test, "no family message before disclosure, except escalation", asserts the escalation message to the family contains no analyte value.

---

## Expected questions

**1. "Aren't you just adding demand to the waiting list?"**

No. We reorder by risk rather than adding to it. A task is created only for an abnormal result that has sat uncommunicated for three days, and that result is already an incident risk today: the PACT audit found no record of communication for 31% of abnormal results, and HSIB counted 41 serious incidents in 13 months from findings that were not acted on. Most of what is released is an explanation, not an appointment: Grace gets the numbers explained, Idris gets the logistics, Thomas gets a yes or no. Explanation is what reduces contacts: after immediate release without explanation, patient messages to clinicians within six hours roughly doubled (Steitz BD, et al. JAMA Netw Open 2021;4(10):e2129553, median 77.5 to 146 a day), and the plan's own arithmetic values 90 seconds saved per appointment at over 2,000 FTE GPs (10 Year Health Plan, Ch2 p29).

**2. "How do you prevent hallucinated explanations after the Annie incident?"**

Three layers, and the first two are not a model. First, tools are the only source of record values: the system prompt says everything Kindred knows comes from tools, and the tools read the record, with reference ranges, previous values and a plain-language note that come from the record, not from the model's memory. Second, NOT_SHARED never leaks: consent is enforced inside the tool, the denied result tells the model not to reveal or guess, and the prototype's tests assert that a person without results consent gets no analyte value or name even when they ask directly. Third, the clinician stays in the loop: the gate holds release until disclosure is confirmed, the "discussed with patient" step is the clinician's, and escalation raises a task for them rather than acting alone. The literature agrees this is the right posture: GPT-4 was 97.4% correct on 1,134 pathology reports with 0.26% hallucinations, but the authors still require clinician review before release (Steimetz 2024); on discharge summaries only 54% of reviews rated the rewrite fully accurate, with most errors being omissions (Zaretsky 2024). So we ground, we bound, and we keep the human.

**3. "Proxy access already exists, what's new?"**

Proxy access gives one person the whole record, or a practice-chosen slice of it, after a practice-led setup with a consent form and identity checks, and almost nobody has it (0.4% of portal users at Geisinger; 43% of older patients did not know it existed). It does not explain anything, it does not know who has been told, and it does not act. Kindred adds four things proxy access does not do: purpose-based levels per person (Everything, Only practical, Important updates, or a custom mix, set by the patient with one dial each), enforcement inside every agent action so nothing outside a person's level can be read or hinted at, a request-access loop where the family member asks and the patient approves from a card, and proactive reminders from the live record with a concrete ask. Next come the disclosure gate, so the family can never learn a result before the patient, and escalation when an abnormal result sits uncommunicated, both prototyped today. Older people asked for exactly this: they "want to retain granular control of their information" and "simple proxy access may not adequately address the needs and concerns of aging patients" (Crotty 2015). The roadmap is to sit on top of NHS App proxy access, not replace it: proxy access becomes the identity and consent rail, Kindred the role layer.

**4. "How is this different from Annie's context panel or existing safety-netting tools?"**

Those work at the point of a consultation, or rely on a clinician remembering to set a reminder. Kindred reads the trajectory continuously, so Eleanor's four low white cell counts become one "watch" card instead of four filed results; it gates disclosure, so nothing reaches the family before she has been told; it escalates when nobody acts, raising a GP task and phoning her landline after three days; and then it communicates per person under her consent, the numbers to Grace, the logistics to Idris, a yes or no to Thomas. A safety-netting tool ends when the reminder fires. This loop ends when the right people have understood.

---

## Removed from the deck on purpose

The 2.8x frailty figure (Stow 2018 odds ratio), den Duijn 2025, the "proactive engine" as a separate product card, the Elwenspoek slide and the Steimetz GPT-4 line. Stow is now cited under slide 2 for the "single reading versus trajectory" sentence only; Steimetz and Elwenspoek stay here for questions.
