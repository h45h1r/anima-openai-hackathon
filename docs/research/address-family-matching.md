# Can we find families using postcode and address?

**Not reliably in this simulator.** We retrieved all **50,000 PDS demographic records**, across **500 pages**, on 12 September 2026. There were no failed pages or duplicate patient IDs.

| Check | Result |
| --- | ---: |
| Unique patients | 50,000 |
| Patients with a postcode | **0** |
| Distinct full addresses | **180** |
| Patients per address | **277–278** |
| Addresses with 278 patients | 140 |
| Addresses with 277 patients | 40 |
| Address + surname groups containing multiple patients | 10,763 |
| Structured `Patient.contact` fields populated | 0 |
| Structured `Patient.link` fields populated | 0 |

The address repeats every **180 consecutive patient IDs**: all **49,820** possible ID-offset pairs tested have identical addresses. This is strong evidence of an artificial address-assignment pattern, rather than a useful representation of real households. We observed the pattern; we have not inspected the backend generator implementation.

## Concrete examples

**Amira Khan, SIM-000001:** `2 Cedar Crescent, Northbank` is assigned to **278 patients with 66 distinct surnames**. No other patient at that address has the surname Khan.

**Eleanor Chen, SIM-000006:** `7 Meadow Walk, Northbank` is assigned to **278 patients with 65 distinct surnames**. No other patient at that address has the surname Chen.

Address-plus-surname matching produces groups of 1–14 patients, but the repetitive address assignment means these remain incidental matches. They cannot be treated as confirmed families. Postcode matching is unavailable because the field is absent throughout the retrieved data.

The simulator's [PDS guide](https://sim.animahealth.com/docs/fhir/) also explicitly describes addresses and contact details as fictional fixtures. Its `family` search parameter is a surname prefix, not a family identifier.

## Better relationship evidence

Amira's live GP record contains an unnamed daughter:

- `r-3664`: Amira lives alone; her daughter visits after work.
- `r-3666`: the daughter asked for appointments to be grouped on one day.
- `r-3668`: the daughter can collect a prescription but cannot attend during working hours.

This establishes a recorded **mention of a daughter**, not the daughter's identity, contact details, patient ID or sharing permissions. It also illustrates why co-residence is not required for useful family support: the notes say Amira lives alone.

Saved as an explicitly unverified [relationship candidate](amira-relationship-candidate.json), with exact source text, field paths and resource versions. No family account, relationship grant or consent was created.

## Recommendation

Use our own relationship database. Start with Amira, ask the patient to identify/confirm her daughter, and separately record what may be shared. For the hackathon, we can instead add a clearly marked fictional daughter in our demo data; that must not be described as someone discovered by address matching.

If another dataset later supplies reliable household identifiers, an exact shared address can nominate household candidates for confirmation. A household still does not prove kinship, and neither household membership nor kinship grants access. Preserve source evidence and confirmation state separately from consent.

The full carer-involvement cohort has **3,176 patients**. Of these, **150 are aged 65+**, including **138 with at least one listed condition**. That filter is useful for selecting patients for relationship onboarding; addresses are not. See [the cohort breakdown](carer-cohort.md) and [relationship database design](family-relationships.md).

## Evidence and method

- [Machine-readable population audit](address-family-audit.json)
- [All 180 address groups and counts](address-groups.json)
- [Amira's sourced daughter candidate](amira-relationship-candidate.json)

Read `GET /api/nhs/pds/Patient?_count=100&_offset=N` for offsets 0, 100, …, 49,900 with the existing team key. Three already successful same-day pages were reused. Validate each page's `total` and size, then validate unique IDs across the combined result. Group full address line(s), city, postcode where present, and country using Unicode normalization, case folding and whitespace normalization. No fuzzy surname/address matching was used. All requests were reads.
