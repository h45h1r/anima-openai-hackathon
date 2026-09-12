// Manual integration check. Writes new synthetic records to the running local app.
// Run explicitly: node sim-app/integration-correspondence.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

const base = 'http://localhost:4192';
const patientId = 'SIM-000006';
const runId = randomUUID();
const checks = [];

async function request(path, action, expectedStatus = 200) {
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, {
      method: action ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer local-demo', ...(action ? { 'Content-Type': 'application/json' } : {}) },
      signal: AbortSignal.timeout(15000),
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(action ? JSON.stringify(action) : undefined);
  });
  const body = response.body;
  assert.equal(response.status, expectedStatus, `${path}: ${JSON.stringify(body)}`);
  return body;
}

const message = (site, command, resource, extra = {}, expectedStatus = 200) => request(`/api/sites/${site}/actions`, {
  type: 'messaging_action', messagingCommand: command,
  ...(resource ? { resourceId: resource.id, expectedVersion: resource.version } : {}), ...extra,
}, expectedStatus);

async function gpConversation(id) {
  const workspace = await request('/api/sites/gp/messaging-workspace');
  const resource = workspace.resources.find(record => record.id === id);
  assert.ok(resource, `GP workspace did not persist ${id}`);
  return resource;
}

async function patientConversation(id) {
  const workspace = await request(`/api/sites/patient/messaging-workspace?patientId=${patientId}`);
  return workspace.resources.find(record => record.id === id);
}

const health = await request('/healthz');
assert.equal(health.mode, 'local-copy', 'This check must target the separate local app.');

let conversation = await message('gp', {
  kind: 'create', subject: `Local integration ${runId}`, body: 'Synthetic integration message: please confirm receipt.', channel: 'sms', allowReply: true,
}, undefined, { patientId });
const firstEntryId = conversation.data.entries[0].id;
assert.equal(conversation.data.entries[0].delivery.at(-1).status, 'queued');
assert.equal((await gpConversation(conversation.id)).version, conversation.version);
assert.equal(await patientConversation(conversation.id), undefined, 'Undelivered conversation must not appear to the patient.');
await message('patient', { kind: 'reply', body: 'Premature synthetic reply.' }, conversation, { patientId }, 409);
assert.equal((await gpConversation(conversation.id)).version, conversation.version, 'Rejected reply must not increment the version.');
checks.push('Queued messages persist for GP, remain hidden from patient, and reject premature replies without mutation');

conversation = await message('gp', { kind: 'delivery', entryId: firstEntryId, status: 'delivered' }, conversation);
assert.equal((await patientConversation(conversation.id)).data.entries[0].delivery.at(-1).status, 'delivered');
const internalText = `Practice-only integration note ${runId}`;
conversation = await message('gp', { kind: 'note', body: internalText }, conversation);
assert.ok((await gpConversation(conversation.id)).data.entries.some(entry => entry.body === internalText));
const patientView = await patientConversation(conversation.id);
assert.ok(patientView, 'Delivered conversation must appear to the patient.');
assert.equal(patientView.data.entries.some(entry => entry.direction === 'internal' || entry.body === internalText), false);
checks.push('Manual delivery exposes the message while GP-only notes stay out of the patient workspace');

await message('patient', { kind: 'reply', body: 'Wrong-patient reply.' }, conversation, { patientId: 'SIM-000007' }, 403);
const stale = conversation;
const replyText = `Synthetic patient reply ${runId}`;
const clientRequestId = randomUUID();
const reply = await message('patient', { kind: 'reply', body: replyText }, conversation, { patientId, clientRequestId });
assert.equal(reply.data.entries.some(entry => entry.direction === 'internal' || entry.body === internalText), false, 'Patient action response must exclude internal notes.');
assert.equal(reply.data.assignee, '', 'Patient data retains the frontend-required field without exposing assignment.');
const replay = await message('patient', { kind: 'reply', body: replyText }, conversation, { patientId, clientRequestId });
assert.deepEqual(replay, reply, 'Idempotent replay must return the same patient-safe response.');
assert.equal(replay.data.entries.some(entry => entry.direction === 'internal'), false);
conversation = await gpConversation(conversation.id);
assert.equal(conversation.version, reply.version);
assert.equal(conversation.data.entries.at(-1).direction, 'incoming');
assert.equal(conversation.data.entries.at(-1).body, replyText);
assert.equal((await patientConversation(conversation.id)).data.entries.some(entry => entry.direction === 'internal'), false);
await message('gp', { kind: 'note', body: 'Stale version should fail.' }, stale, {}, 409);
assert.equal((await gpConversation(conversation.id)).version, conversation.version);
checks.push('Matching patient replies persist in the GP thread; wrong-patient and stale-version writes fail');
checks.push('Patient action responses and idempotent replays exclude internal notes and practice assignment');

const originalSections = [{ id: 'clinical-note', heading: 'Synthetic integration note', text: `Original note text ${runId}` }];
const saveNote = { type: 'hospital_note', patientId, title: `Local signed note integration ${runId}`,
  hospitalNoteCommand: { kind: 'save', template: 'free-text', sections: originalSections } };
let note = await request('/api/sites/hospital/actions', saveNote);
assert.equal(note.data.stage, 'draft');
note = await request('/api/sites/hospital/actions', { type: 'hospital_note', resourceId: note.id, expectedVersion: note.version, hospitalNoteCommand: { kind: 'sign' } });
assert.equal(note.data.stage, 'signed');
assert.ok(note.data.signedBy);
const signedVersion = note.version;
await request('/api/sites/hospital/actions', { ...saveNote, resourceId: note.id, expectedVersion: note.version,
  hospitalNoteCommand: { kind: 'save', template: 'free-text', sections: [{ ...originalSections[0], text: 'Attempted overwrite.' }] } }, 409);
const addendumText = `Synthetic addendum ${runId}`;
note = await request('/api/sites/hospital/actions', { type: 'hospital_note', resourceId: note.id, expectedVersion: note.version,
  hospitalNoteCommand: { kind: 'addendum', text: addendumText } });
assert.equal(note.version, signedVersion + 1);
assert.deepEqual(note.data.sections, originalSections);
assert.equal(note.data.addenda.at(-1).text, addendumText);

const hospital = await request(`/api/sites/hospital/view?patient=${patientId}&limit=500`);
const savedNote = hospital.resources.find(resource => resource.id === note.id);
assert.ok(savedNote, 'Signed note must persist in the hospital view.');
assert.deepEqual(savedNote.data.sections, originalSections);
assert.equal(savedNote.data.addenda.at(-1).text, addendumText);
assert.equal(savedNote.data.stage, 'signed');
assert.equal(savedNote.version, note.version);
checks.push('Hospital notes save, sign and accept addenda; original signed sections remain unchanged and persist');

console.log(JSON.stringify({ ok: true, base, runId, conversationId: conversation.id, hospitalNoteId: note.id, checks,
  patientReplyResponseContainsInternalNote: reply.data.entries.some(entry => entry.direction === 'internal'),
}, null, 2));
