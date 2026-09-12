import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const categories = [
  { id: 'appointments', label: 'Appointments', description: 'Appointment dates, reasons, clinicians and locations.' },
  { id: 'medications', label: 'Medicines', description: 'Recorded medicines, doses and prescription status.' },
  { id: 'conditions', label: 'Health conditions', description: 'Recorded diagnoses and problems, including sensitive conditions.' },
  { id: 'results', label: 'Test results', description: 'Test names and recorded results, including sensitive tests.' },
  { id: 'care_notes', label: 'Clinical notes', description: 'Saved consultation notes. These may contain sensitive personal information.' },
  { id: 'mental_health', label: 'Mood & wellbeing', description: 'Mood, sleep and mental health entries identified in the demo record.' },
];
const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
const memberJSON = r => ({ id: r.id, externalId: r.external_id || null, role: r.role || 'family', name: r.name, relationship: r.relationship, email: r.email, categories: r.categories, status: r.status, version: r.version, updatedAt: r.updated_at });
function text(value, field, max, optional = false) { if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) fail(400, `Enter a valid ${field}.`); return value.trim(); }
export function validateMember(input) {
  const name = text(input.name, 'name', 100), relationship = text(input.relationship, 'relationship', 60);
  const email = text(input.email ?? '', 'email', 254, true).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address.');
  if (!Array.isArray(input.categories) || input.categories.some(id => !categories.some(c => c.id === id)) || new Set(input.categories).size !== input.categories.length) fail(400, 'Choose valid sharing categories.');
  return { name, relationship, email, categories: categories.filter(c => input.categories.includes(c.id)).map(c => c.id) };
}
async function body(req) { let data = ''; for await (const c of req) { data += c; if (Buffer.byteLength(data) > 16000) fail(413, 'Request too large.'); } try { return JSON.parse(data || '{}'); } catch { fail(400, 'Invalid JSON.'); } }
const labels = ids => ids.length ? categories.filter(c => ids.includes(c.id)).map(c => c.label.toLowerCase()).join(', ') : 'nothing';

// Only these selected fields can leave the family API. Raw resource JSON and
// unrelated categories never leave it, even if the browser asks for them.
export function sharedRecords(resources, allowed) {
  const rows = [];
  const add = (category, id, title, details, date, status) => { if (allowed.includes(category)) rows.push({ category, id, title: String(title || 'Record'), details: details.filter(Boolean).map(String), date: date || null, status: status || '' }); };
  for (const r of resources) {
    const d = r.data || {};
    if (r.kind === 'appointment') add('appointments', r.id, r.title, [d.clinician, d.location, d.mode], d.startsAt || r.dueAt, r.status);
    if (r.kind === 'prescription') add('medications', r.id, d.medication || r.title, [d.dose, d.instructions], r.createdAt, r.status);
    if (r.kind === 'problem') add('conditions', r.id, r.title, [], d.onsetDate || r.createdAt, r.status);
    if (r.kind === 'ehr-record') {
      for (const [i, m] of (d.medications || []).entries()) add('medications', `${r.id}:m:${i}`, m.name || m.drug || m.term, [m.dose, m.dosage, m.frequency], m.date, m.status);
      for (const [i, p] of (d.problems || []).entries()) add('conditions', `${r.id}:p:${i}`, p.term, [], p.date, p.status);
    }
    if (r.kind === 'report') add('results', r.id, d.panel?.name || r.title, (d.analytes || []).map(a => `${a.name}: ${a.value ?? 'Not recorded'} ${a.unit || ''}`), d.collectedAt || r.createdAt, r.status);
    if (r.kind === 'consultation' && r.status === 'saved') add('care_notes', r.id, r.title, [d.text], r.createdAt, r.status);
  }
  return rows.sort((a, b) => Number(new Date(b.date || 0)) - Number(new Date(a.date || 0)));
}

export async function createCompanionHandler({ pool, worldId }) {
  await pool.query(await readFile(new URL('./companion-schema.sql', import.meta.url), 'utf8'));
  const subscribers = new Map();
  const cookieName = role => `companion_${role}`;
  async function patient(id, db = pool) {
    const r = (await db.query('SELECT directory FROM sim.patients WHERE world_id=$1 AND patient_id=$2', [worldId, id])).rows[0];
    if (!r) fail(404, 'Patient not found.');
    return { id, name: r.directory.name, dateOfBirth: r.directory.birthDate || '' };
  }
  async function session(req, role, db = pool) {
    const value = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName(role) + '='))?.split('=')[1];
    if (!value) fail(401, 'Open your local demo session to continue.');
    const r = (await db.query('SELECT * FROM companion.sessions WHERE token_hash=$1 AND world_id=$2 AND role=$3 AND expires_at>now()', [hash(value), worldId, role])).rows[0];
    if (!r) fail(401, 'Your session has ended. Open it again to continue.');
    if (role === 'family') {
      const m = (await db.query('SELECT * FROM companion.members WHERE id=$1 AND world_id=$2 AND patient_id=$3', [r.member_id, worldId, r.patient_id])).rows[0];
      if (!m || m.status !== 'active') fail(403, 'Access has been removed by the patient.');
      r.member = m;
    }
    return r;
  }
  async function openSession(res, role, patientId, memberId) {
    const key = token();
    await pool.query("INSERT INTO companion.sessions VALUES($1,$2,$3,$4,$5,now()+interval '12 hours')", [hash(key), worldId, patientId, role, memberId || null]);
    res.setHeader('Set-Cookie', `${cookieName(role)}=${key}; HttpOnly; SameSite=Strict; Path=/api/companion/${role}; Max-Age=43200`);
    return send(res, 200, { role, patient: await patient(patientId), memberId: memberId || null, demo: true });
  }
  async function state(id) {
    const db = await pool.connect();
    try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const p = await patient(id, db);
    const head = await db.query('SELECT * FROM companion.patients WHERE world_id=$1 AND patient_id=$2', [worldId, id]);
    const members = await db.query('SELECT * FROM companion.members WHERE world_id=$1 AND patient_id=$2 ORDER BY created_at,id', [worldId, id]);
    const audit = await db.query('SELECT id,action,member_name AS "memberName",actor,detail,created_at AS "createdAt",revision FROM companion.audit WHERE world_id=$1 AND patient_id=$2 ORDER BY revision DESC LIMIT 50', [worldId, id]);
    await db.query('COMMIT');
    const h = head.rows[0];
    return { patient: p, revision: h?.revision || 0, updatedAt: h?.updated_at || null, categories, members: members.rows.map(memberJSON), audit: audit.rows, sync: { status: h?.revision ? 'synced' : 'not_configured', resourceId: h?.revision ? `local-family-consent-${id}` : null, revision: h?.revision || 0, updatedAt: h?.updated_at || null } };
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  async function mutate(id, actor, fn) {
    const db = await pool.connect();
    let result, revision;
    try {
      await db.query('BEGIN');
      await db.query('INSERT INTO companion.patients(world_id,patient_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [worldId, id]);
      await db.query('SELECT revision FROM companion.patients WHERE world_id=$1 AND patient_id=$2 FOR UPDATE', [worldId, id]);
      result = await fn(db);
      const now = new Date();
      revision = (await db.query('UPDATE companion.patients SET revision=revision+1,updated_at=$3 WHERE world_id=$1 AND patient_id=$2 RETURNING revision', [worldId, id, now])).rows[0].revision;
      const rows = (await db.query('SELECT * FROM companion.members WHERE world_id=$1 AND patient_id=$2 ORDER BY created_at,id', [worldId, id])).rows;
      const detail = result.detail;
      await db.query('INSERT INTO companion.audit(id,world_id,patient_id,member_id,action,member_name,actor,detail,before_value,after_value,revision,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [randomUUID(), worldId, id, result.member.id, result.action, result.member.name, actor, detail, result.before || null, memberJSON(result.member), revision, now]);
      const resourceId = `local-family-consent-${id}`;
      const previous = (await db.query("SELECT body FROM sim.resource_projections WHERE world_id=$1 AND site='gp' AND resource_id=$2", [worldId, resourceId])).rows[0]?.body;
      const change = { time: now.getTime(), actor: { kind: 'team', name: actor }, source: 'gp', action: 'update_family_consent', version: revision };
      const resource = { id: resourceId, kind: 'observation', title: 'Family sharing preferences', status: 'active', owner: 'gp', visibleTo: ['gp'], patientId: id, priority: 'routine', createdAt: previous?.createdAt || now.getTime(), version: revision,
        data: { text: rows.map(m => `${m.name} (${m.relationship}): ${m.status === 'revoked' ? 'Access removed' : 'Shares ' + labels(m.categories)}.`).join('\n'), consentManagedBy: 'patient', revision, updatedAt: now.toISOString(), members: rows.map(memberJSON), source: 'companion-local' },
        provenance: { created: previous?.provenance?.created || change, changes: [...(previous?.provenance?.changes || []), ...(previous ? [change] : [])] } };
      await db.query("INSERT INTO sim.resource_projections(world_id,site,resource_id,patient_id,kind,status,owner,version,body,captured_at) VALUES($1,'gp',$2,$3,'observation','active','gp',$4,$5,now()) ON CONFLICT(world_id,site,resource_id) DO UPDATE SET version=EXCLUDED.version,body=EXCLUDED.body,captured_at=now()", [worldId, resourceId, id, revision, resource]);
      const event = { id: randomUUID(), time: now.getTime(), type: 'update_family_consent', actor, resourceId, patientId: id, detail, visibleTo: ['gp'] };
      await db.query('INSERT INTO sim.events(world_id,event_id,body) VALUES($1,$2,$3)', [worldId, event.id, event]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); if (error.code === '23505') fail(409, 'This email is already used by a family member.'); throw error; }
    finally { db.release(); }
    for (const client of subscribers.get(id) || []) {
      if (client.role === 'family' && client.memberId !== result.member.id) continue;
      if (client.role === 'family' && ['access_removed', 'member_restored', 'access_link_created'].includes(result.action)) {
        client.res.write('event: access-ended\ndata: {}\n\n');
        client.res.end();
      } else client.res.write(`event: change\ndata: ${JSON.stringify({ revision })}\n\n`);
    }
    return { ...result, revision };
  }
  async function existing(db, id, patientId, version) {
    const m = (await db.query('SELECT * FROM companion.members WHERE id::text=$1 AND world_id=$2 AND patient_id=$3', [id, worldId, patientId])).rows[0];
    if (!m) fail(404, 'Family member not found.');
    if (!Number.isInteger(version) || version !== m.version) fail(409, 'These preferences changed in another window. Refresh and try again.');
    return m;
  }
  return async function companion(req, res, url) {
    if (!url.pathname.startsWith('/api/companion/')) return false;
    try {
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== url.origin) fail(403, 'Request origin does not match this app.');
      const match = url.pathname.match(/^\/api\/companion\/(patient|gp|family)\/(.+)$/);
      if (!match) fail(404, 'Unknown companion endpoint.');
      const [, role, route] = match;
      if (route === 'session' && req.method === 'POST') {
        const input = await body(req);
        if (role === 'family') {
          const m = (await pool.query("SELECT * FROM companion.members WHERE world_id=$1 AND invitation_hash=$2 AND invitation_expires>now() AND status='active'", [worldId, hash(String(input.invitationToken || ''))])).rows[0];
          if (!m) fail(403, 'This access link has expired or been removed. Ask the patient for a new link.');
          return await openSession(res, role, m.patient_id, m.id);
        }
        // These two roles are explicitly local demo identities, not verified NHS logins.
        const p = await patient(input.patientId || 'SIM-000006');
        return await openSession(res, role, p.id);
      }
      const s = await session(req, role);
      const patientId = s.patient_id;
      if (url.searchParams.get('patientId') && url.searchParams.get('patientId') !== patientId) fail(403, 'This session belongs to a different patient.');
      if (route === 'session' && req.method === 'GET') return send(res, 200, { role, patient: await patient(patientId), memberId: s.member_id, demo: true });
      if (route === 'session' && req.method === 'DELETE') {
        await pool.query('DELETE FROM companion.sessions WHERE token_hash=$1', [s.token_hash]);
        for (const client of subscribers.get(patientId) || []) if (client.tokenHash === s.token_hash) { client.res.write('event: access-ended\ndata: {}\n\n'); client.res.end(); }
        return send(res, 200, { signedOut: true });
      }
      if (route === 'events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 2000\n\n');
        if (!subscribers.has(patientId)) subscribers.set(patientId, new Set());
        const client = { res, role, tokenHash: s.token_hash, memberId: s.member_id };
        subscribers.get(patientId).add(client);
        const timer = setInterval(() => { if (new Date(s.expires_at).getTime() <= Date.now()) { res.write('event: access-ended\ndata: {}\n\n'); res.end(); } else res.write(': heartbeat\n\n'); }, 20000);
        req.on('close', () => { clearInterval(timer); subscribers.get(patientId)?.delete(client); if (!subscribers.get(patientId)?.size) subscribers.delete(patientId); });
        return true;
      }
      if (route === 'state' && req.method === 'GET') {
        if (role !== 'family') return send(res, 200, await state(patientId));
        const db = await pool.connect();
        try {
          await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          const current = await session(req, role, db);
          const resources = (await db.query("SELECT body FROM sim.resource_projections WHERE world_id=$1 AND site='gp' AND patient_id=$2 AND kind=ANY($3::text[])", [worldId, patientId, ['appointment', 'prescription', 'ehr-record', 'problem', 'report', 'consultation']])).rows.map(r => r.body);
          const head = (await db.query('SELECT revision,updated_at FROM companion.patients WHERE world_id=$1 AND patient_id=$2', [worldId, patientId])).rows[0];
          const name = (await patient(patientId, db)).name;
          await db.query('COMMIT');
          return send(res, 200, { patient: { id: patientId, name }, member: { id: current.member.id, name: current.member.name, relationship: current.member.relationship }, categories: categories.filter(c => current.member.categories.includes(c.id)), records: sharedRecords(resources, current.member.categories), revision: head.revision, updatedAt: head.updated_at });
        } catch (error) { await db.query('ROLLBACK'); throw error; }
        finally { db.release(); }
      }
      if (role !== 'patient') fail(403, 'Only the patient can change family sharing.');
      const actor = (await patient(patientId)).name + ' · local patient demo';
      if (route === 'members' && req.method === 'POST') {
        const input = await body(req);
        const value = validateMember(input);
        const externalId = input.externalId == null ? null : text(input.externalId, 'member identifier', 100);
        const memberRole = input.role || 'family';
        if (!['family', 'carer', 'clinician'].includes(memberRole)) fail(400, 'Invalid member role.');
        const result = await mutate(patientId, actor, async db => {
          const m = (await db.query("INSERT INTO companion.members(id,world_id,patient_id,name,relationship,email,categories,status,external_id,role) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9) RETURNING *", [randomUUID(), worldId, patientId, value.name, value.relationship, value.email, JSON.stringify(value.categories), externalId, memberRole])).rows[0];
          return { member: m, action: 'member_added', detail: `Added ${m.name}. Shares ${labels(m.categories)}.` };
        });
        return send(res, 201, { member: memberJSON(result.member), revision: result.revision });
      }
      const memberRoute = route.match(/^members\/([^/]+)(?:\/(revoke|restore|invitation))?$/);
      if (!memberRoute) fail(404, 'Unknown companion endpoint.');
      const [, memberId, command] = memberRoute;
      const input = await body(req);
      if (!((!command && req.method === 'PUT') || (command && req.method === 'POST'))) fail(405, 'Method not allowed.');
      let invitationToken;
      const result = await mutate(patientId, actor, async db => {
        const old = await existing(db, memberId, patientId, input.expectedVersion);
        let update, action, detail;
        if (!command) {
          if (old.status !== 'active') fail(409, 'Restore this member before changing sharing.');
          update = validateMember(input); action = 'sharing_updated'; detail = `${update.name}: sharing changed from ${labels(old.categories)} to ${labels(update.categories)}.`;
        } else if (command === 'invitation') {
          if (old.status !== 'active') fail(409, 'Access has been removed. Restore the member first.');
          invitationToken = token();
          await db.query("UPDATE companion.members SET invitation_hash=$2,invitation_expires=now()+interval '30 days' WHERE id=$1", [memberId, hash(invitationToken)]);
          await db.query("DELETE FROM companion.sessions WHERE member_id=$1 AND role='family'", [memberId]);
          update = old; action = 'access_link_created'; detail = `Created a new access link for ${old.name}. Previous links and sessions are closed.`;
        } else {
          const status = command === 'revoke' ? 'revoked' : 'active';
          if (old.status === status) fail(409, `This member is already ${status}.`);
          update = { ...old, status, categories: [] }; action = command === 'revoke' ? 'access_removed' : 'member_restored';
          detail = command === 'revoke' ? `Removed all access for ${old.name}. Their access links no longer work.` : `Restored ${old.name}. Nothing is shared until you choose categories.`;
          await db.query('UPDATE companion.members SET invitation_hash=NULL,invitation_expires=NULL WHERE id=$1', [memberId]);
          await db.query("DELETE FROM companion.sessions WHERE member_id=$1 AND role='family'", [memberId]);
        }
        const m = (await db.query('UPDATE companion.members SET name=$2,relationship=$3,email=$4,categories=$5,status=$6,version=version+1,updated_at=now() WHERE id=$1 RETURNING *', [memberId, update.name, update.relationship, update.email, JSON.stringify(update.categories), update.status || old.status])).rows[0];
        return { member: m, before: memberJSON(old), action, detail };
      });
      return send(res, 200, { member: memberJSON(result.member), revision: result.revision, ...(invitationToken ? { invitationUrl: `${url.origin}/family/#token=${invitationToken}` } : {}) });
    } catch (error) { return send(res, error.status || 500, { error: error.status ? error.message : 'Could not save or load sharing preferences. Please try again.' }); }
  };
}
