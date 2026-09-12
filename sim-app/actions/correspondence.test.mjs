import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCorrespondence } from './correspondence.mjs';

function world() {
  const records = new Map();
  let sequence = 0;
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  async function run(site, action) {
    return handleCorrespondence({ site, action, now: 1789200000000 + sequence, worldId: 'local-test', actor: { kind: 'team', name: 'Local copy' },
      fail,
      async get(id) { if (!records.has(id)) fail(404, 'Not found'); return structuredClone(records.get(id)); },
      requireVersion(resource, version) { if (version !== resource.version) fail(409, 'Stale version'); },
      async create(input) { const value = { ...structuredClone(input), id: `record-${++sequence}`, version: 1 }; records.set(value.id, value); return structuredClone(value); },
      async update(resource, patch) { const value = { ...resource, ...structuredClone(patch), version: resource.version + 1 }; records.set(value.id, value); return structuredClone(value); },
    });
  }
  const message = (site, command, resource, extra = {}) => run(site, { type: 'messaging_action', messagingCommand: command, ...(resource ? { resourceId: resource.id, expectedVersion: resource.version } : {}), ...extra });
  const document = (site, command, resource, extra = {}) => run(site, { type: 'process_document', documentCommand: command, resourceId: resource.id, expectedVersion: resource.version, ...extra });
  const createMessage = (allowReply = true) => message('gp', { kind: 'create', subject: 'Appointment details', body: 'Please confirm your appointment.', channel: 'sms', allowReply }, undefined, { patientId: 'SIM-000006' });
  const sections = Object.fromEntries(['reason', 'course', 'diagnoses', 'medicationChanges', 'results', 'followUp', 'gpActions'].map(key => [key, `Synthetic ${key}.`]));
  const createDocument = () => run('hospital', { type: 'save_discharge_summary', patientId: 'SIM-000006', title: 'Clinic letter', dischargeSections: sections });
  return { records, run, message, document, createMessage, createDocument, sections };
}

const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);

test('message delivery, failure, retry and patient replies preserve delivery evidence', async () => {
  const w = world();
  let conversation = await w.createMessage();
  const entryId = conversation.data.entries[0].id;
  await rejects(w.message('patient', { kind: 'reply', body: 'Confirmed.' }, conversation, { patientId: 'SIM-000006' }), 409);
  conversation = await w.message('gp', { kind: 'delivery', entryId, status: 'failed' }, conversation);
  conversation = await w.message('gp', { kind: 'retry', entryId }, conversation);
  conversation = await w.message('gp', { kind: 'delivery', entryId, status: 'delivered' }, conversation);
  await rejects(w.message('patient', { kind: 'reply', body: 'Confirmed.' }, conversation, { patientId: 'SIM-000007' }), 403);
  conversation = await w.message('patient', { kind: 'reply', body: 'Confirmed.' }, conversation, { patientId: 'SIM-000006' });
  assert.deepEqual(conversation.data.entries[0].delivery.map(d => d.status), ['queued', 'failed', 'queued', 'delivered']);
  assert.equal(conversation.data.entries[1].direction, 'incoming');
  assert.equal(conversation.data.entries[1].channel, 'sms');
  assert.equal(conversation.data.entries[1].body, 'Confirmed.');
  await rejects(w.message('gp', { kind: 'retry', entryId }, conversation), 409);
  await rejects(w.message('gp', { kind: 'delivery', entryId, status: 'failed' }, conversation), 409);
});

test('closed and one-way conversations reject replies; stale actions never append', async () => {
  const w = world();
  let conversation = await w.createMessage(false);
  conversation = await w.message('gp', { kind: 'delivery', entryId: conversation.data.entries[0].id, status: 'delivered' }, conversation);
  await rejects(w.message('patient', { kind: 'reply', body: 'Reply' }, conversation, { patientId: 'SIM-000006' }), 409);
  const old = conversation;
  conversation = await w.message('gp', { kind: 'complete' }, conversation);
  await rejects(w.message('gp', { kind: 'send', body: 'Another message', channel: 'sms' }, old), 409);
  await rejects(w.message('gp', { kind: 'send', body: 'Another message', channel: 'sms' }, conversation), 409);
  assert.equal(w.records.get(conversation.id).data.entries.length, 1);
  conversation = await w.message('gp', { kind: 'reopen' }, conversation);
  conversation = await w.message('gp', { kind: 'send', body: 'A follow-up', channel: 'email' }, conversation);
  assert.equal(conversation.status, 'open');
  assert.equal(conversation.data.entries.at(-1).delivery[0].status, 'queued');
});

test('practice notes and assignments retain distinct internal entry shape', async () => {
  const w = world();
  let conversation = await w.createMessage();
  conversation = await w.message('gp', { kind: 'assign', assignee: 'Reception' }, conversation);
  conversation = await w.message('gp', { kind: 'note', body: 'Internal follow-up instruction' }, conversation);
  const note = conversation.data.entries.at(-1);
  assert.equal(conversation.data.assignee, 'Reception');
  assert.equal(note.direction, 'internal');
  assert.equal(note.channel, undefined);
  assert.equal(note.delivery, undefined);
  await rejects(w.message('patient', { kind: 'note', body: 'Forbidden' }, conversation, { patientId: 'SIM-000006' }), 403);
  await rejects(w.message('gp', { kind: 'reply', body: 'Impersonation' }, conversation), 403);
});

test('templates create, update and archive with version checks and GP ownership', async () => {
  const w = world();
  const command = { kind: 'save_template', title: 'Appointment reminder', body: 'Your appointment is tomorrow.', channel: 'sms' };
  let template = await w.message('gp', command);
  assert.equal(template.kind, 'message-template');
  assert.deepEqual(template.visibleTo, ['gp']);
  template = await w.message('gp', { ...command, body: 'Please contact reception.' }, template);
  template = await w.message('gp', { kind: 'archive_template' }, template);
  assert.equal(template.status, 'archived');
  await rejects(w.message('gp', command, template), 409);
  await rejects(w.message('patient', command), 403);
});

test('invalid message inputs fail before creating or changing records', async () => {
  const w = world();
  await rejects(w.message('gp', { kind: 'create', subject: 'Subject', body: '   ', channel: 'sms', allowReply: true }, undefined, { patientId: 'SIM-000006' }), 400);
  assert.equal(w.records.size, 0);
  let conversation = await w.createMessage();
  await rejects(w.message('gp', { kind: 'send', body: 'Message', channel: 'push' }, conversation), 400);
  assert.equal(w.records.get(conversation.id).version, 1);
});

test('hospital draft → GP review → filing keeps original letter and structured annotations', async () => {
  const w = world();
  let letter = await w.createDocument();
  assert.deepEqual(letter.visibleTo, ['hospital']);
  letter = await w.document('hospital', 'send', letter);
  assert.equal(letter.status, 'sent');
  assert.deepEqual(letter.visibleTo, ['hospital', 'gp']);
  await rejects(w.document('gp', 'file', letter, { text: 'Filed' }), 409);
  letter = await w.document('gp', 'assign', letter, { clinician: 'Practice document team' });
  letter = await w.document('gp', 'annotate', letter, { documentTags: ['Follow-up'], documentSnomedCodes: [{ code: '44054006', display: 'Diabetes mellitus type 2' }] });
  letter = await w.document('gp', 'review', letter, { text: 'Review recorded.' });
  letter = await w.document('gp', 'file', letter, { text: 'Filed to patient history.' });
  assert.equal(letter.status, 'filed');
  assert.equal(letter.data.stage, 'filed');
  assert.deepEqual(letter.data.sections, w.sections);
  assert.equal(letter.data.reviewNote, 'Review recorded.');
  assert.equal(letter.data.filingNote, 'Filed to patient history.');
  assert.equal(letter.data.reviewedBy, 'Local copy');
  assert.deepEqual(letter.data.tags, ['Follow-up']);
  await rejects(w.document('gp', 'assign', letter, { clinician: 'Other clinician' }), 409);
});

test('sent letter text cannot be edited and draft patients cannot be changed', async () => {
  const w = world();
  let letter = await w.createDocument();
  const edit = { type: 'save_discharge_summary', resourceId: letter.id, expectedVersion: letter.version, title: 'Updated title', dischargeSections: w.sections };
  await rejects(w.run('hospital', { ...edit, patientId: 'SIM-000007' }), 400);
  letter = await w.run('hospital', edit);
  assert.equal(letter.title, 'Updated title');
  letter = await w.document('hospital', 'send', letter);
  await rejects(w.run('hospital', { ...edit, expectedVersion: letter.version }), 409);
  await rejects(w.document('hospital', 'review', letter, { text: 'Review' }), 403);
  await rejects(w.document('gp', 'send', letter), 403);
});

test('incomplete letters and invalid coding fail without modifying the original', async () => {
  const w = world();
  let letter = await w.run('hospital', { type: 'save_discharge_summary', patientId: 'SIM-000006', title: 'Draft', dischargeSections: { ...w.sections, gpActions: '' } });
  await rejects(w.document('hospital', 'send', letter), 400);
  assert.equal(w.records.get(letter.id).status, 'draft');
  await rejects(w.document('gp', 'annotate', letter, { documentTags: [], documentSnomedCodes: [] }), 409);
  letter = await w.createDocument();
  letter = await w.document('hospital', 'send', letter);
  await rejects(w.document('gp', 'annotate', letter, { documentTags: ['Urgent', 'urgent'], documentSnomedCodes: [] }), 400);
  await rejects(w.document('gp', 'annotate', letter, { documentTags: [], documentSnomedCodes: [{ code: 'invalid', display: 'Invalid' }] }), 400);
  assert.equal(w.records.get(letter.id).version, 2);
});

test('unrelated actions are passed through to another handler', async () => {
  assert.equal(await handleCorrespondence({ action: { type: 'book_appointment' } }), undefined);
});
