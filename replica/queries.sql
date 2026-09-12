-- Connect: psql -d anima_sim_replica_20260912

-- Import coverage. The directory and demographics should both contain 50,000 rows.
SELECT count(*) patients, count(directory) directory_records, count(demographics) demographic_records
FROM sim.patients;

-- Exact per-service copies, including versions and original JSON.
SELECT site, count(*) resources FROM sim.resource_projections GROUP BY site ORDER BY site;

-- Unique records across services (preserve individual projections for audit).
SELECT kind, count(*) FROM sim.resources GROUP BY kind ORDER BY count(*) DESC;

-- The carer-involvement group, ready to link to our separate family/contact tables.
SELECT p.patient_id, p.name, p.birth_date, p.conditions, p.needs
FROM sim.patient_directory p
WHERE p.needs @> '["Carer involvement"]'::jsonb
ORDER BY p.birth_date;

-- One patient's GP record.
SELECT resource_id, kind, status, version, body
FROM sim.resource_projections
WHERE site='gp' AND patient_id='SIM-000001'
ORDER BY (body->>'createdAt')::numeric DESC;

-- Sourced mentions for relationship enrichment. These are candidates, not confirmed contacts.
SELECT patient_id, resource_id, version, body#>>'{data,text}' AS note
FROM sim.resource_projections
WHERE site='gp' AND kind IN ('observation','encounter')
AND body#>>'{data,text}' ~* '\m(daughter|husband|wife|son|carer)\M'
LIMIT 30;

-- What could not be retrieved through this key/API.
SELECT endpoint, status, body FROM sim.endpoint_responses WHERE status<>200;
