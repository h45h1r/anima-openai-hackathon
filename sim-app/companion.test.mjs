import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedRecords, validateMember } from './companion.mjs';

const ALL = ['appointments', 'medications', 'conditions', 'results', 'care_notes'];
const SENSITIVE = 'Private consultation narrative: patient discussed personal safeguarding concerns.';
const INTERNAL = 'INTERNAL-DO-NOT-DISCLOSE';
const DAY = Date.UTC(2026, 8, 12);

function record(id, kind, data, extras = {}) {
  return {
    id, kind, title: `${kind} summary`, status: 'active', createdAt: DAY,
    patientId: 'SIM-000006', owner: 'gp', visibleTo: ['gp'], version: 73,
    provenance: { created: { actor: { name: INTERNAL } }, changes: [{ text: INTERNAL }] },
    data: { ...data, internalMetadata: { privateKey: INTERNAL }, text: SENSITIVE },
    ...extras,
  };
}

function records() {
  return [
    record('appointment-1', 'appointment', { clinician: 'Nurse Alex Morgan', location: 'Room 3', mode: 'in-person', startsAt: DAY + 9 * 60 * 60_000, bookingNotes: INTERNAL }, { title: 'Practice follow-up', status: 'booked' }),
    record('prescription-1', 'prescription', { medication: 'Example medicine', dose: 'One tablet', instructions: 'With food', prescriberNotes: INTERNAL }, { status: 'issued' }),
    record('problem-1', 'problem', { onsetDate: '2026-08-01', clinicianNotes: INTERNAL }, { title: 'Recorded condition' }),
    record('ehr-1', 'ehr-record', {
      medications: [{ drug: 'Second medicine', dose: '5 mg', frequency: 'Once daily', date: '2026-09-01', status: 'active', confidentialNotes: INTERNAL }],
      problems: [{ term: 'Historical condition', date: '2025-09-01', status: 'resolved', note: INTERNAL }],
      allergies: [{ term: INTERNAL }], miscCodes: [{ term: INTERNAL }],
    }),
    record('result-1', 'report', { panel: { name: 'Example blood panel', labMetadata: INTERNAL }, analytes: [{ name: 'Example analyte', value: 12, unit: 'units', privateComment: INTERNAL }], collectedAt: DAY }, { title: 'Laboratory report', status: 'completed' }),
    record('consultation-1', 'consultation', { sections: { privateAdminNote: INTERNAL } }, { title: 'Saved consultation', status: 'saved' }),
    record('draft-1', 'consultation', {}, { title: 'Unfinished note', status: 'draft' }),
    record('message-1', 'conversation', { entries: [{ body: INTERNAL }] }),
    record('document-1', 'discharge-summary', { sections: { history: INTERNAL } }),
    record('consent-1', 'observation', { members: [{ name: INTERNAL, email: 'private@example.test', categories: ALL }], consentManagedBy: 'patient' }),
  ];
}

test('an empty sharing selection exposes no records even when every clinical category exists', () => {
  const member = validateMember({ name: 'Alex Chen', relationship: 'Family member', email: '', categories: [] });
  assert.deepEqual(member.categories, []);
  assert.deepEqual(sharedRecords(records(), member.categories), []);
});

test('appointment-only access returns the appointment field allowlist and nothing from other records', () => {
  assert.deepEqual(sharedRecords(records(), ['appointments']), [{
    category: 'appointments', id: 'appointment-1', title: 'Practice follow-up',
    details: ['Nurse Alex Morgan', 'Room 3', 'in-person'], date: DAY + 9 * 60 * 60_000, status: 'booked',
  }]);
});

test('medicines and conditions share their selected summaries without the rest of an EHR record', () => {
  assert.deepEqual(sharedRecords(records(), ['medications']), [
    { category: 'medications', id: 'prescription-1', title: 'Example medicine', details: ['One tablet', 'With food'], date: DAY, status: 'issued' },
    { category: 'medications', id: 'ehr-1:m:0', title: 'Second medicine', details: ['5 mg', 'Once daily'], date: '2026-09-01', status: 'active' },
  ]);
  assert.deepEqual(sharedRecords(records(), ['conditions']), [
    { category: 'conditions', id: 'problem-1', title: 'Recorded condition', details: [], date: '2026-08-01', status: 'active' },
    { category: 'conditions', id: 'ehr-1:p:0', title: 'Historical condition', details: [], date: '2025-09-01', status: 'resolved' },
  ]);
});

test('results access exposes the named analyte value, not private laboratory metadata', () => {
  assert.deepEqual(sharedRecords(records(), ['results']), [{
    category: 'results', id: 'result-1', title: 'Example blood panel', details: ['Example analyte: 12 units'], date: DAY, status: 'completed',
  }]);
});

test('sensitive consultation text requires an explicit clinical-notes selection and drafts stay private', () => {
  const withoutNotes = sharedRecords(records(), ['appointments', 'medications', 'conditions', 'results']);
  assert.ok(!JSON.stringify(withoutNotes).includes(SENSITIVE));
  assert.deepEqual(sharedRecords(records(), ['care_notes']), [{
    category: 'care_notes', id: 'consultation-1', title: 'Saved consultation', details: [SENSITIVE], date: DAY, status: 'saved',
  }]);
  assert.ok(!sharedRecords(records(), ALL).some(row => row.id === 'draft-1'));
});

test('even all selected categories never return raw data, provenance, member lists or unrelated workflow records', () => {
  const output = sharedRecords(records(), ALL);
  const serialized = JSON.stringify(output);
  assert.ok(!serialized.includes(INTERNAL));
  assert.ok(!serialized.includes('private@example.test'));
  assert.ok(!serialized.includes('SIM-000006'));
  const expectedKeys = ['category', 'date', 'details', 'id', 'status', 'title'];
  for (const row of output) {
    assert.deepEqual(Object.keys(row).sort(), expectedKeys);
    assert.ok(Array.isArray(row.details) && row.details.every(detail => typeof detail === 'string'));
  }
  assert.deepEqual(new Set(output.map(row => row.id)), new Set(['appointment-1', 'prescription-1', 'problem-1', 'ehr-1:m:0', 'ehr-1:p:0', 'result-1', 'consultation-1']));
});

test('member validation normalizes contact details, keeps sharing explicit and drops extra privileges', () => {
  assert.deepEqual(validateMember({ name: '  Alex Chen  ', relationship: '  Son  ', email: ' ALEX@EXAMPLE.TEST ', categories: ['results', 'appointments'], status: 'admin', invitationToken: INTERNAL }), {
    name: 'Alex Chen', relationship: 'Son', email: 'alex@example.test', categories: ['appointments', 'results'],
  });
  assert.equal(validateMember({ name: 'Alex', relationship: 'Son', categories: [] }).email, '');
});

test('unknown, duplicate, missing or malformed categories cannot create broader access', () => {
  const valid = { name: 'Alex', relationship: 'Son', email: '', categories: [] };
  for (const scopes of [['*'], ['clinical'], ['appointments', 'appointments'], ['care_notes', 'all'], ['__proto__'], ['appointments', null], 'appointments', null, undefined, { appointments: true }]) {
    assert.throws(() => validateMember({ ...valid, categories: scopes }), error => error.status === 400, `categories=${JSON.stringify(scopes)}`);
  }
});

test('invalid member names, relationships and email addresses are rejected before storage', () => {
  const valid = { name: 'Alex', relationship: 'Son', email: '', categories: [] };
  for (const name of ['', '   ', 'x'.repeat(101), null, 12]) assert.throws(() => validateMember({ ...valid, name }), error => error.status === 400);
  for (const relationship of ['', '   ', 'x'.repeat(61), null]) assert.throws(() => validateMember({ ...valid, relationship }), error => error.status === 400);
  for (const email of ['not-an-email', 'a@', '@example.test', 'a b@example.test', 'a@example', 'a@@example.test', `${'x'.repeat(250)}@example.test`, 12]) assert.throws(() => validateMember({ ...valid, email }), error => error.status === 400);
});
