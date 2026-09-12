# The “Carer involvement” cohort

Queried all **3,176 matching patients** in our 50,000-patient world on 12 September 2026: **106 pages**, no failed pages, no duplicate patient IDs. Every returned patient has the exact `Carer involvement` entry in `needs`. This is 6.35% of the directory.

- [Complete cohort and counts](carer-cohort.json)
- [Five demo candidates](carer-cohort-shortlist.json)
- [Family relationship database design](family-relationships.md)

## Meaning

These are patients who need carer involvement, not identified carers, family groups or consent grants. All directory records contain patient demographics, conditions, needs and goals; none has a carer identity or relationship field. Detailed notes can add evidence, as Amira's example below shows.

## Age breakdown

Ages are as of **12 September 2026**.

| Age | Patients |
| --- | ---: |
| Under 18 | 12 |
| 18–44 | 1,773 |
| 45–64 | 1,241 |
| 65–74 | 138 |
| 75–84 | 5 |
| 85+ | 7 |
| **Total** | **3,176** |

Only **150 are aged 65+**, including **138 with at least one listed condition**. Most are working-age adults. These are synthetic cohort characteristics, not real-world prevalence estimates.

## Conditions and other needs

**2,651** have at least one condition listed, **525** have none listed, and **115** have two or more. An empty directory field does not establish absence of disease.

| Condition as recorded | Patients |
| --- | ---: |
| Asthma | 544 |
| Osteoarthritis | 433 |
| Anxiety | 307 |
| Hypertension | 306 |
| Hearing loss | 306 |
| Migraine | 292 |
| Type 2 diabetes | 280 |
| Eczema | 255 |
| Arthritis | 17 |
| Heart failure | 13 |
| CKD | 11 |
| Diabetes | 6 |

Condition counts overlap. Similar labels are preserved separately instead of silently merged.

| Other need | Patients |
| --- | ---: |
| Letter preferred | 825 |
| Telephone preferred | 792 |
| SMS preferred | 775 |
| App preferred | 732 |
| Step-free access | 9 |
| Interpreter | 6 |
| Offline contact | 4 |
| Transport | 3 |
| Home visit | 1 |

Case variants of telephone preference were combined. Need counts can overlap. **1,621** have a letter/telephone preference or explicit offline-contact need. That supports a telephone or assisted consent option alongside an app; a preference alone does not establish inability to use an app or permission to send messages.

## Demo shortlist

This is a product-demo shortlist, not a clinical risk ranking.

| Patient | Age | Conditions | Relevant needs |
| --- | ---: | --- | --- |
| **Amira Khan — SIM-000001** | 74 | Heart failure, CKD | Carer involvement, home visit; wants to stay at home with a clear contact for help |
| **Grace Shah — SIM-000015** | 67 | Asthma, diabetes, arthritis | Carer involvement |
| **Daniel Patel — SIM-000244** | 75 | Diabetes, heart failure | Carer involvement, interpreter |
| **Aisha Okafor — SIM-000304** | 95 | Hypertension, CKD, heart failure | Carer involvement |
| **Grace Ahmed — SIM-000048** | 64 | Asthma, arthritis | Carer involvement, offline contact |

Subsequent live GP reads succeeded for Amira, Grace Shah and Daniel Patel. **Amira is the strongest starting case**: her notes explicitly mention a daughter who visits after work, asks for appointments to be grouped, and can collect a prescription but cannot attend during working hours. Sources: GP resources `r-3664`/`r-3666`/`r-3668` (verify the field/version in the current response before implementing). The daughter's name, contact details, patient ID and consent are not established by these statements.

The clinical request used `GET /api/sites/gp/view?patient=SIM-000001&offset=0&limit=100`. Community reads also showed a discharge medication-handover message and a bed record with a medicines/home-monitoring barrier. Grace and Daniel's inspected GP responses did not contain the searched daughter/husband/wife/son/carer-availability terms; this is not proof that no family relationships exist.

## A useful omission

**Eleanor Chen, SIM-000006, is not in this bucket.** Her directory lists step-free access, while her previously captured GP notes mention her husband. A fresh community read found `r-36` with `carerAvailable: false` and a waiting home-care assessment (`r-44`).

The tag is therefore a candidate-finding filter, not an exhaustive list of people who could benefit from family support. A boolean stating that a carer is unavailable does not tell us whether a relative exists or why support is unavailable.

## Next implementation step

Use Amira for the first family-enrichment flow. Extract the unnamed daughter as a source-backed candidate, then identify and confirm the person through the patient or a clearly labelled synthetic demo setup. Store the relationship in our own patient–person link table. Record access grants separately: being a daughter or collecting prescriptions is not consent to read the whole record.

## Query validation

Read `GET /api/sites/gp/patients?q=Carer%20involvement&offset=N` at offsets 0, 30, …, 3,150. The last page contains 26 patients. Checked every page's total/size, 3,176 unique IDs and exact need membership. No simulator records, clocks, relationships or messages were changed.
