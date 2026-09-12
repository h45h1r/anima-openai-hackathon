import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, database } from './db.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const { rows: worlds } = await pool.query('SELECT * FROM sim.worlds ORDER BY started_at DESC LIMIT 1');
const world = worlds[0];
const results = {};
results.patients = (await pool.query('SELECT count(*)::integer total,count(directory)::integer directory,count(demographics)::integer demographics FROM sim.patients WHERE world_id=$1', [world.world_id])).rows[0];
results.pages = (await pool.query('SELECT collection,count(*)::integer pages,sum(item_count)::integer imported,max(source_total)::integer source_total FROM sim.import_pages WHERE world_id=$1 GROUP BY collection ORDER BY collection', [world.world_id])).rows;
results.resources = (await pool.query('SELECT site,count(*)::integer total FROM sim.resource_projections WHERE world_id=$1 GROUP BY site ORDER BY site', [world.world_id])).rows;
results.uniqueResources = (await pool.query('SELECT count(DISTINCT resource_id)::integer total FROM sim.resource_projections WHERE world_id=$1', [world.world_id])).rows[0].total;
results.missingPatientReferences = (await pool.query('SELECT count(*)::integer total FROM sim.resource_projections r LEFT JOIN sim.patients p ON p.world_id=r.world_id AND p.patient_id=r.patient_id WHERE r.world_id=$1 AND r.patient_id IS NOT NULL AND p.patient_id IS NULL', [world.world_id])).rows[0].total;
results.resourceKinds = (await pool.query('SELECT kind,count(*)::integer total FROM sim.resources WHERE world_id=$1 GROUP BY kind ORDER BY total DESC', [world.world_id])).rows;
results.blockedEndpoints = (await pool.query('SELECT endpoint,status,body FROM sim.endpoint_responses WHERE world_id=$1 AND status<>200 ORDER BY endpoint', [world.world_id])).rows;
results.legacyDocuments = (await pool.query('SELECT count(*)::integer total FROM sim.legacy_documents WHERE world_id=$1', [world.world_id])).rows[0].total;
results.organizations = (await pool.query('SELECT count(*)::integer total FROM sim.organizations WHERE world_id=$1', [world.world_id])).rows[0].total;
results.events = (await pool.query('SELECT count(*)::integer total FROM sim.events WHERE world_id=$1', [world.world_id])).rows[0].total;
results.databaseSize = (await pool.query('SELECT pg_database_size(current_database())::bigint AS bytes,pg_size_pretty(pg_database_size(current_database())) AS display')).rows[0];
results.patientSamples = (await pool.query("SELECT patient_id,name,birth_date,conditions,needs FROM sim.patient_directory WHERE world_id=$1 AND patient_id=ANY($2::text[]) ORDER BY patient_id", [world.world_id, ['SIM-000001', 'SIM-025000', 'SIM-050000']])).rows;

const errors = [];
for (const collection of ['directory', 'demographics', ...world.team.scopes, 'patient']) {
  if (!results.pages.some(page => page.collection === collection)) errors.push(`Missing collection: ${collection}`);
}
if (results.patients.total !== 50000 || results.patients.directory !== 50000 || results.patients.demographics !== 50000) errors.push('Patient directory/demographic coverage is incomplete.');
if (results.missingPatientReferences) errors.push('Some resource patient IDs are not in the replicated patient table.');
for (const page of results.pages) {
  const patientVisibilityGap = page.collection === 'patient' && page.source_total === 51 && page.imported === 50;
  if (page.imported !== page.source_total && !patientVisibilityGap) errors.push(`${page.collection}: ${page.imported} imported, ${page.source_total} reported.`);
  const records = results.resources.find(r => r.site === page.collection);
  if (records && records.total !== page.imported) errors.push(`${page.collection}: overlapping or missing resource IDs across pages.`);
}
const report = {
  verifiedAt: new Date().toISOString(), database, world: world.world_id, results, errors,
  completeForEnumeratedCollections: errors.length === 0,
  isFullBackendDatabaseDump: false,
  clockStart: world.clock_start, clockEnd: world.clock_end,
  caveats: [
    'API-accessible data replica, not the original PostgreSQL schema or a transactional pg_dump of the simulator.',
    'Full-world snapshot, hidden scheduled jobs and full historical event logs require organiser/database access.',
    'Patient view reports 51 but returns 50 visible records; a failed-delivery conversation is omitted from that projection and remains available in the GP messaging data.',
    'Public wearable device/reading routes returned 404 during replication; device and observation data are present in the wearable service view.',
    'PDS demographic pages reuse the complete, validated same-day capture from this team world.',
    'The source API provides no multi-request snapshot isolation. Counts and observed versions are preserved; concurrent edits cannot be ruled out.',
  ],
};
await writeFile(resolve(root, '../docs/research/replica-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ database, ...results.patients, uniqueResources: results.uniqueResources, resources: results.resources, organizations: results.organizations, legacyDocuments: results.legacyDocuments, databaseSize: results.databaseSize.display, errors }, null, 2));
await pool.end();
if (errors.length) process.exitCode = 1;
