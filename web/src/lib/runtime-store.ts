import { Pool } from 'pg';
import type { AppState } from './types';

export interface RuntimeSnapshot {
  messages?: AppState['messages'];
  audit?: AppState['audit'];
  consentRequests?: AppState['consentRequests'];
  levels?: AppState['levels'];
  nextActions?: AppState['nextActions'];
  announcedAppointmentIds?: string[];
}

export const runtimeSchema = `
CREATE TABLE IF NOT EXISTS public.kindred_runtime_state (
  namespace text NOT NULL,
  patient_id text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, patient_id)
);`;

let pool: Pool | undefined;
let schemaReady: Promise<unknown> | undefined;

function runtimePool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for durable runtime storage.');
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 15000, idleTimeoutMillis: 20000, allowExitOnIdle: true });
    pool.on('error', error => console.error('Runtime database connection failed:', error.message));
  }
  return pool;
}

async function initializeSchema(db: Pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kindred-runtime-schema-v1'))");
    await client.query(runtimeSchema);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function withRuntimeSnapshot<T>(patientId: string, write: boolean,
  work: (snapshot: RuntimeSnapshot) => Promise<{ value: T; snapshot?: RuntimeSnapshot }>,
): Promise<T> {
  const db = runtimePool();
  schemaReady ??= initializeSchema(db).catch(error => { schemaReady = undefined; throw error; });
  await schemaReady;
  const namespace = process.env.KINDRED_RUNTIME_NAMESPACE || 'kindred-v1';
  if (!write) {
    const result = await db.query('SELECT snapshot FROM public.kindred_runtime_state WHERE namespace=$1 AND patient_id=$2', [namespace, patientId]);
    return (await work(result.rows[0]?.snapshot || {})).value;
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '110s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '170s'");
    await client.query('INSERT INTO public.kindred_runtime_state(namespace,patient_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [namespace, patientId]);
    const saved = await client.query('SELECT snapshot FROM public.kindred_runtime_state WHERE namespace=$1 AND patient_id=$2 FOR UPDATE', [namespace, patientId]);
    const result = await work(saved.rows[0].snapshot);
    if (result.snapshot) {
      await client.query('UPDATE public.kindred_runtime_state SET snapshot=$3,revision=revision+1,updated_at=now() WHERE namespace=$1 AND patient_id=$2', [namespace, patientId, JSON.stringify(result.snapshot)]);
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return result.value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function runtimeSnapshot(state: AppState): RuntimeSnapshot {
  return { messages: state.messages, audit: state.audit.filter(entry => !entry.id.startsWith('consent-db-')),
    consentRequests: state.consentRequests, levels: state.levels, nextActions: state.nextActions,
    announcedAppointmentIds: state.appointments.filter(appointment => appointment.announcedToFamily).map(appointment => appointment.id) };
}

export function restoreRuntimeSnapshot(state: AppState, saved: RuntimeSnapshot): AppState {
  const announced = new Set(saved.announcedAppointmentIds || []);
  return { ...state, messages: saved.messages ?? state.messages,
    audit: [...state.audit.filter(entry => entry.id.startsWith('consent-db-')), ...(saved.audit ?? state.audit.filter(entry => !entry.id.startsWith('consent-db-')))]
      .sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 300),
    consentRequests: saved.consentRequests ?? state.consentRequests, levels: saved.levels ?? state.levels,
    nextActions: saved.nextActions ?? state.nextActions,
    appointments: state.appointments.map(appointment => ({ ...appointment, announcedToFamily: announced.has(appointment.id) || appointment.announcedToFamily })),
    busyThreads: [],
  };
}

export async function closeRuntimePool() {
  const old = pool; pool = undefined; schemaReady = undefined;
  if (old) await old.end();
}
