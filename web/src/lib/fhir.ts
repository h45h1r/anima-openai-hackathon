// Map the app's consent map to a FHIR R4 Consent resource. This is the payload
// that would be PUT to the EHR so clinicians never have to re-ask.

import type { AppState, Category } from "./types";
import { CATEGORIES, personById } from "./types";

const CATEGORY_CODE: Record<Category, { system: string; code: string; display: string }> = {
  appointments: { system: "http://hl7.org/fhir/resource-types", code: "Appointment", display: "Appointments" },
  medications: { system: "http://hl7.org/fhir/resource-types", code: "MedicationStatement", display: "Medications" },
  lab_results: { system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory results" },
  conditions: { system: "http://hl7.org/fhir/resource-types", code: "Condition", display: "Conditions" },
  care_notes: { system: "http://hl7.org/fhir/resource-types", code: "DocumentReference", display: "Care notes" },
  mental_health: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "MH", display: "Mental health information" },
};

export function toFhirConsent(state: AppState, granteeId: string) {
  const patient = personById(state, state.patientId);
  const grantee = personById(state, granteeId);
  const scopes = state.consent[granteeId] ?? ({} as Record<Category, boolean>);
  const permitted = CATEGORIES.filter((c) => scopes[c.id]);
  const denied = CATEGORIES.filter((c) => !scopes[c.id]);

  const actorRef =
    grantee.role === "clinician"
      ? { reference: `Practitioner/${grantee.id}`, display: grantee.name }
      : { reference: `RelatedPerson/${grantee.id}`, display: `${grantee.name} (${grantee.relation.toLowerCase()})` };

  return {
    resourceType: "Consent",
    id: `${patient.id}-${grantee.id}`,
    meta: { versionId: String(state.ehr.consentVersion), lastUpdated: state.ehr.lastSyncedAt, source: "urn:kindred:consent-engine" },
    status: "active",
    scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy" }] },
    category: [{ coding: [{ system: "http://loinc.org", code: "59284-0", display: "Patient Consent" }] }],
    patient: { reference: `Patient/${patient.id}`, display: patient.name },
    dateTime: state.ehr.lastSyncedAt,
    performer: [{ reference: `Patient/${patient.id}` }],
    policyRule: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "OPTIN" }] },
    provision: {
      type: "deny",
      provision: [
        {
          type: "permit",
          actor: [{ role: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v3-ParticipationType", code: "IRCP", display: "information recipient" }] }, reference: actorRef }],
          action: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentaction", code: "access" }] }],
          class: permitted.map((c) => CATEGORY_CODE[c.id]),
        },
      ],
    },
    // Non-standard helper for demo readers: what is explicitly withheld.
    extension: denied.length
      ? [{ url: "urn:kindred:withheld", valueString: denied.map((c) => c.label).join(", ") }]
      : undefined,
  };
}
