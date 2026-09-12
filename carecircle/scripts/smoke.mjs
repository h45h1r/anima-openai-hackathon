#!/usr/bin/env node
/**
 * API smoke journey against a running CareCircle server + live Anima.
 * Usage: node scripts/smoke.mjs
 * Requires server on PORT (default 8787) and ANIMA_API_KEY or ANIMA_TEAM_NAME.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const API = process.env.SMOKE_API || `http://localhost:${process.env.PORT || 8787}`;

async function req(pathname, { method = 'GET', sessionId, body } = {}) {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(sessionId ? { 'x-carecircle-session': sessionId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

function step(name) {
  console.log(`\n✓ ${name}`);
}

async function main() {
  console.log('CareCircle smoke against', API);
  await req('/api/health');
  step('health');

  const connectBody = {};
  if (process.env.ANIMA_API_KEY) connectBody.apiKey = process.env.ANIMA_API_KEY;
  else if (process.env.ANIMA_TEAM_NAME) connectBody.teamName = process.env.ANIMA_TEAM_NAME;
  else {
    console.error('Set ANIMA_API_KEY or ANIMA_TEAM_NAME for live smoke.');
    process.exit(2);
  }

  const connected = await req('/api/connect', { method: 'POST', body: connectBody });
  const sessionId = connected.session.sessionId;
  step(`connected team=${connected.session.teamLabel} world=${connected.session.worldId}`);

  const search = await req('/api/patients?q=Amira', { sessionId });
  step(`patient search returned ${search.items?.length || 0} (total ${search.total})`);
  let patient = search.items?.find((p) => p.id === 'SIM-000001') || search.items?.[0];
  if (!patient) {
    const any = await req('/api/patients?q=', { sessionId });
    patient = any.items?.[0];
  }
  if (!patient) throw new Error('No live patients returned');
  step(`selecting ${patient.id} ${patient.name}`);

  await req('/api/patients/select', { method: 'POST', sessionId, body: { patientId: patient.id } });
  const ctx = await req(`/api/patients/${patient.id}/context`, { sessionId });
  step(`context resources=${ctx.context.resourceCount} measurements=${ctx.context.measurementCount} classes=${ctx.context.recordClasses}`);

  const ask = await req('/api/ask', {
    method: 'POST',
    sessionId,
    body: { patientId: patient.id, viewerId: 'patient', question: 'What follow-up or results are recorded?' },
  });
  step(`ask patient outcome=${ask.run.policy.outcome} citations=${ask.run.answer.citations.length}`);

  await req('/api/viewer', { method: 'POST', sessionId, body: { viewerId: 'tom' } });
  const askTom = await req('/api/ask', {
    method: 'POST',
    sessionId,
    body: { patientId: patient.id, viewerId: 'tom', question: 'What did the blood test show?' },
  });
  step(`ask tom outcome=${askTom.run.policy.outcome}`);

  await req('/api/viewer', { method: 'POST', sessionId, body: { viewerId: 'patient' } });
  const consent = await req(`/api/consent/${patient.id}`, { sessionId });
  await req(`/api/consent/${patient.id}`, {
    method: 'PUT',
    sessionId,
    body: {
      viewerId: 'tom',
      updates: { appointments: true, laboratory_results: false },
      expectedVersion: consent.policy.policyVersion,
    },
  });
  step('consent updated');

  const appt = await req('/api/ask', {
    method: 'POST',
    sessionId,
    body: { patientId: patient.id, viewerId: 'patient', question: 'Is the appointment confirmed and do I prefer afternoon?' },
  });
  step(`appointment assist stage=${appt.run.answer.appointmentAssist?.stage || 'n/a'}`);

  console.log('\nSmoke journey completed.');
}

main().catch((err) => {
  console.error('\nSmoke failed:', err.message);
  process.exit(1);
});
