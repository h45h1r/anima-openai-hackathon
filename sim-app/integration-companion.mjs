// Manual check; creates synthetic family-sharing records in the separate local app.
// Run explicitly: node sim-app/integration-companion.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const base = process.env.SIM_APP_URL || 'http://localhost:4192';
const patientId = 'SIM-049990';
const runId = randomUUID();
const checks = [];
const database = process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) : process.env.APP_DATABASE || 'anima_sim_app_20260912';
assert.notEqual(database, 'anima_sim_replica_20260912', 'Use the separate application database.');
const pool = new pg.Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : { database, host: process.env.PGHOST || '/tmp' });

function client(role) {
  let cookie = '';
  return async (route, { method = 'GET', body, status = 200 } = {}) => {
    const response = await fetch(`${base}/api/companion/${role}/${route}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    const expected = Array.isArray(status) ? status : [status];
    assert.ok(expected.includes(response.status), `${role}/${route}: expected ${expected}, received ${response.status}: ${JSON.stringify(data)}`);
    const sessionCookie = response.headers.get('set-cookie');
    if (sessionCookie) cookie = sessionCookie.split(';')[0];
    assert.match(response.headers.get('cache-control') || '', /no-store/, 'Consent responses must not be cached.');
    return data;
  };
}

const patient = client('patient');
const gpClient = client('gp');
const family = client('family');
const fields = { name: `Integration family ${runId}`, relationship: 'Family member', email: '', categories: [] };
const memberPath = member => `members/${member.id}`;
const invitationToken = result => new URLSearchParams(new URL(result.invitationUrl).hash.slice(1)).get('token');
const post = body => ({ method: 'POST', body });

async function databaseSnapshot() {
  const head = await pool.query('SELECT revision FROM companion.patients WHERE patient_id=$1', [patientId]);
  const members = await pool.query('SELECT id,name,categories,status,version,invitation_hash FROM companion.members WHERE patient_id=$1 ORDER BY id', [patientId]);
  const audit = await pool.query('SELECT id,action,revision FROM companion.audit WHERE patient_id=$1 ORDER BY revision', [patientId]);
  const sync = await pool.query("SELECT version,body FROM sim.resource_projections WHERE site='gp' AND resource_id=$1", [`local-family-consent-${patientId}`]);
  return { head: head.rows, members: members.rows, audit: audit.rows, sync: sync.rows };
}

async function clinicalAction(action) {
  const response = await fetch(`${base}/api/sites/gp/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

try {
  const health = await (await fetch(`${base}/healthz`)).json();
  assert.equal(health.mode, 'local-copy');
  await client('family')('state', { status: 401 });
  await patient('session', post({ patientId }));
  await gpClient('session', post({ patientId }));
  const initial = await patient('state');
  const initialRevision = initial.revision;
  assert.equal(initial.patient.id, patientId);
  assert.deepEqual((await gpClient('state')).members, initial.members);
  await gpClient('members', { ...post({ ...fields, categories: ['appointments'] }), status: 403 });
  await patient('state?patientId=SIM-000006', { status: 403 });
  await gpClient('state?patientId=SIM-000006', { status: 403 });
  checks.push('Separate role sessions enforce GP read-only access and patient-bound state');

  const beforeInvalid = await databaseSnapshot();
  await patient('members', { ...post({ ...fields, categories: ['all_records'] }), status: 400 });
  await patient('members', { ...post({ ...fields, categories: ['appointments', 'appointments'] }), status: 400 });
  const missingCategories = { ...fields }; delete missingCategories.categories;
  await patient('members', { ...post(missingCategories), status: 400 });
  assert.deepEqual(await databaseSnapshot(), beforeInvalid, 'Invalid categories must leave consent and GP observation unchanged.');

  let result = await patient('members', { ...post(fields), status: 201 });
  let member = result.member;
  assert.deepEqual(member.categories, []);
  assert.equal(result.revision, initialRevision + 1);
  result = await patient(`${memberPath(member)}/invitation`, post({ expectedVersion: member.version }));
  member = result.member;
  const originalToken = invitationToken(result);
  assert.ok(originalToken);
  await family('session', post({ invitationToken: originalToken }));
  const emptyState = await family('state');
  assert.deepEqual(emptyState.categories, []);
  assert.deepEqual(emptyState.records, []);
  assert.equal(emptyState.patient.id, patientId);
  await family('state?patientId=SIM-000006', { status: 403 });
  await family('members', { ...post(fields), status: 403 });
  checks.push('New member with no selections shares nothing; invalid or missing category lists are rejected');

  const sourceAppointment = (await pool.query("SELECT body FROM sim.resource_projections WHERE patient_id=$1 AND site='gp' AND kind='appointment' LIMIT 1", [patientId])).rows[0]?.body;
  assert.ok(sourceAppointment, 'The isolated test patient must have an appointment to avoid an empty allowlist test.');
  const noteText = `Private clinical note integration ${runId}`;
  const note = await clinicalAction({ type: 'save_consultation', patientId, title: `Integration consent note ${runId}`, text: noteText, consultationStatus: 'saved', mode: 'in-person' });
  const beforeWrite = await databaseSnapshot();
  await gpClient(memberPath(member), { method: 'PUT', body: { ...fields, categories: ['appointments'], expectedVersion: member.version }, status: 403 });
  assert.deepEqual(await databaseSnapshot(), beforeWrite, 'Rejected GP writes must not change DB state.');
  const oldVersion = member.version;
  result = await patient(memberPath(member), { method: 'PUT', body: { ...fields, categories: ['appointments'], expectedVersion: member.version } });
  member = result.member;
  let familyState = await family('state?categories=appointments,medications,conditions,results,care_notes');
  assert.deepEqual(familyState.categories.map(category => category.id), ['appointments']);
  assert.ok(familyState.records.some(record => record.id === sourceAppointment.id));
  assert.ok(familyState.records.every(record => record.category === 'appointments'));
  assert.equal(JSON.stringify(familyState).includes(noteText), false);
  assert.equal(familyState.records.some(record => record.id === note.id), false);
  for (const record of familyState.records) assert.deepEqual(Object.keys(record).sort(), ['category', 'date', 'details', 'id', 'status', 'title']);
  checks.push('Server category allowlist returns the real appointment and withholds a known private clinical note despite query manipulation');

  const staleSnapshot = await databaseSnapshot();
  await patient(memberPath(member), { method: 'PUT', body: { ...fields, categories: ['care_notes'], expectedVersion: oldVersion }, status: 409 });
  assert.deepEqual(await databaseSnapshot(), staleSnapshot, 'Stale version must not change member, audit, revision or GP observation.');
  result = await patient(memberPath(member), { method: 'PUT', body: { ...fields, categories: ['care_notes'], expectedVersion: member.version } });
  member = result.member;
  familyState = await family('state');
  assert.ok(familyState.records.some(record => record.id === note.id && record.details.includes(noteText)));
  assert.ok(familyState.records.every(record => record.category === 'care_notes'));
  assert.equal(familyState.records.some(record => record.id === sourceAppointment.id), false);
  checks.push('Category changes take effect in an existing family session; stale updates roll back every persisted consent artifact');

  result = await patient(`${memberPath(member)}/revoke`, post({ expectedVersion: member.version }));
  member = result.member;
  assert.equal(member.status, 'revoked');
  assert.deepEqual(member.categories, []);
  await family('state', { status: [401, 403] });
  await client('family')('session', { ...post({ invitationToken: originalToken }), status: 403 });
  result = await patient(`${memberPath(member)}/restore`, post({ expectedVersion: member.version }));
  member = result.member;
  assert.equal(member.status, 'active');
  assert.deepEqual(member.categories, []);
  await family('state', { status: [401, 403] });
  await client('family')('session', { ...post({ invitationToken: originalToken }), status: 403 });
  checks.push('Revocation invalidates the existing family session and old invitation; restore does not revive either or grant categories');

  result = await patient(`${memberPath(member)}/invitation`, post({ expectedVersion: member.version }));
  member = result.member;
  const recreatedFamily = client('family');
  const restoredToken = invitationToken(result);
  await recreatedFamily('session', post({ invitationToken: restoredToken }));
  assert.deepEqual((await recreatedFamily('state')).records, []);
  assert.deepEqual((await recreatedFamily('state')).categories, []);
  result = await patient(memberPath(member), { method: 'PUT', body: { ...fields, categories: ['appointments'], expectedVersion: member.version } });
  member = result.member;
  assert.ok((await recreatedFamily('state')).records.some(record => record.id === sourceAppointment.id));
  await family('state', { status: [401, 403] });
  result = await patient(`${memberPath(member)}/invitation`, post({ expectedVersion: member.version }));
  member = result.member;
  await recreatedFamily('state', { status: [401, 403] });
  await client('family')('session', { ...post({ invitationToken: restoredToken }), status: 403 });
  checks.push('New invitations after restore still share nothing until explicit permission; rotating a link invalidates existing sessions');

  result = await patient(`${memberPath(member)}/revoke`, post({ expectedVersion: member.version }));
  member = result.member;
  const finalState = await patient('state');
  const finalGpState = await gpClient('state');
  assert.equal(finalState.revision, result.revision);
  assert.equal(finalGpState.revision, finalState.revision);
  assert.equal(finalState.sync.revision, finalState.revision);
  assert.equal(finalState.sync.resourceId, `local-family-consent-${patientId}`);
  const stored = await databaseSnapshot();
  assert.equal(stored.head[0].revision, finalState.revision);
  assert.equal(stored.sync[0].version, finalState.revision);
  assert.equal(stored.sync[0].body.data.revision, finalState.revision);
  assert.deepEqual(stored.sync[0].body.data.members, finalState.members);
  const memberAudit = finalState.audit.filter(audit => audit.memberName === fields.name);
  for (const action of ['member_added', 'sharing_updated', 'access_link_created', 'access_removed', 'member_restored']) assert.ok(memberAudit.some(audit => audit.action === action), `Missing ${action} audit`);
  assert.ok(memberAudit.every(audit => audit.actor.includes('local patient demo')));
  assert.equal(stored.audit.at(-1).revision, finalState.revision);
  const gpResponse = await fetch(`${base}/api/sites/gp/view?patient=${patientId}&limit=500`);
  const gpView = await gpResponse.json();
  const observation = gpView.resources.find(resource => resource.id === finalState.sync.resourceId);
  assert.equal(observation.version, finalState.revision);
  assert.equal(observation.data.consentManagedBy, 'patient');
  assert.deepEqual(observation.visibleTo, ['gp']);
  checks.push('Patient and GP views, SQL consent state, GP observation and audit persist the same current revision');

  console.log(JSON.stringify({ ok: true, base, patientId, runId, memberId: member.id, finalRevision: finalState.revision, finalMemberStatus: member.status, checks }, null, 2));
} finally {
  await pool.end();
}
