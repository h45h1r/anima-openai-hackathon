import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { Pool } from 'pg';
import { CareCircleStore } from './store';
import { ScopedMemoryService } from '../agent/memoryStore';

type Runtime = { store: CareCircleStore; memory: ScopedMemoryService };
const scope = new AsyncLocalStorage<Runtime>();
let local: Runtime | undefined;
let pool: Pool | undefined;
let ready: Promise<unknown> | undefined;
function createRuntime(store: CareCircleStore): Runtime {
  return { store, memory: new ScopedMemoryService({ initial: store.listMemories(), persist: items => store.saveMemories(items) }) };
}
function current(): Runtime {
  const active = scope.getStore();
  if (active) return active;
  if (process.env.DATABASE_URL) throw new Error('Ask must run inside its database scope.');
  return local ??= createRuntime(new CareCircleStore(path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.CARE_CIRCLE_DATA_DIR || './data')));
}
export const careStore = () => current().store;
export const careMemory = () => current().memory;

export async function withCareRuntime<T>(work: () => Promise<T>, sessionId: string): Promise<T> {
  if (!process.env.DATABASE_URL || scope.getStore()) return work();
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 15000, idleTimeoutMillis: 20000, allowExitOnIdle: true });
  ready ??= (async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('kindred-care-schema-v1'))");
      await client.query(`CREATE TABLE IF NOT EXISTS public.kindred_care_state (
        namespace text PRIMARY KEY, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  })().catch(error => { ready = undefined; throw error; });
  await ready;
  const client = await pool.connect();
  const namespace = `${process.env.KINDRED_RUNTIME_NAMESPACE || 'kindred-v1'}:${sessionId}`;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '140s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '170s'");
    await client.query('INSERT INTO public.kindred_care_state(namespace) VALUES($1) ON CONFLICT DO NOTHING', [namespace]);
    const result = await client.query('SELECT snapshot FROM public.kindred_care_state WHERE namespace=$1 FOR UPDATE', [namespace]);
    const runtime = createRuntime(new CareCircleStore(undefined, result.rows[0].snapshot, sessionId));
    const value = await scope.run(runtime, work);
    if (value instanceof Response && !value.ok) await client.query('ROLLBACK');
    else {
      await client.query('UPDATE public.kindred_care_state SET snapshot=$2, revision=revision+1,updated_at=now() WHERE namespace=$1', [namespace, JSON.stringify(runtime.store.snapshot())]);
      await client.query('COMMIT');
    }
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function closeCarePool() { const previous = pool; pool = undefined; ready = undefined; await previous?.end(); }
