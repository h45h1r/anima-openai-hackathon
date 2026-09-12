CREATE SCHEMA IF NOT EXISTS sim;

CREATE TABLE IF NOT EXISTS sim.worlds (
  world_id text PRIMARY KEY,
  team jsonb NOT NULL,
  clock_start jsonb,
  clock_end jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS sim.patients (
  world_id text NOT NULL REFERENCES sim.worlds,
  patient_id text NOT NULL,
  directory jsonb,
  demographics jsonb,
  directory_captured_at timestamptz,
  demographics_captured_at timestamptz,
  PRIMARY KEY (world_id, patient_id)
);

CREATE TABLE IF NOT EXISTS sim.resource_projections (
  world_id text NOT NULL REFERENCES sim.worlds,
  site text NOT NULL,
  resource_id text NOT NULL,
  patient_id text,
  kind text NOT NULL,
  status text,
  owner text,
  version integer,
  body jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, site, resource_id)
);
CREATE INDEX IF NOT EXISTS resource_patient_idx ON sim.resource_projections (world_id, patient_id, site);
CREATE INDEX IF NOT EXISTS resource_kind_idx ON sim.resource_projections (world_id, kind);

CREATE TABLE IF NOT EXISTS sim.events (
  world_id text NOT NULL REFERENCES sim.worlds,
  event_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (world_id, event_id)
);

CREATE TABLE IF NOT EXISTS sim.endpoint_responses (
  world_id text NOT NULL REFERENCES sim.worlds,
  endpoint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, endpoint)
);

CREATE TABLE IF NOT EXISTS sim.import_pages (
  world_id text NOT NULL REFERENCES sim.worlds,
  collection text NOT NULL,
  page_offset integer NOT NULL,
  item_count integer NOT NULL,
  source_total integer NOT NULL,
  endpoint text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, collection, page_offset)
);

CREATE OR REPLACE VIEW sim.resources AS
SELECT DISTINCT ON (world_id, resource_id)
  world_id, resource_id, patient_id, kind, status, owner, version, body, site AS selected_projection, captured_at
FROM sim.resource_projections
ORDER BY world_id, resource_id, version DESC NULLS LAST,
  (site = owner) DESC, (site <> 'patient') DESC, length(body::text) DESC, site;

CREATE OR REPLACE VIEW sim.patient_directory AS
SELECT world_id, patient_id,
  COALESCE(directory->>'name', demographics#>>'{name,0,text}') AS name,
  COALESCE(directory->>'birthDate', demographics->>'birthDate')::date AS birth_date,
  directory->'conditions' AS conditions,
  directory->'needs' AS needs,
  directory->'goals' AS goals,
  directory->'localIds' AS local_ids,
  demographics->'address' AS addresses,
  demographics->'telecom' AS telecom
FROM sim.patients;

CREATE OR REPLACE VIEW sim.patient_conditions AS
SELECT world_id, patient_id, jsonb_array_elements_text(directory->'conditions') AS condition
FROM sim.patients WHERE directory IS NOT NULL;

CREATE OR REPLACE VIEW sim.patient_needs AS
SELECT world_id, patient_id, jsonb_array_elements_text(directory->'needs') AS need
FROM sim.patients WHERE directory IS NOT NULL;

CREATE TABLE IF NOT EXISTS sim.legacy_documents (
  world_id text NOT NULL REFERENCES sim.worlds,
  resource_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  source_endpoint text NOT NULL DEFAULT '/browser/legacy',
  PRIMARY KEY (world_id, resource_id)
);

CREATE OR REPLACE VIEW sim.organizations AS
SELECT world_id, entry->'resource'->>'id' AS organization_id, entry->'resource' AS body
FROM sim.endpoint_responses,
LATERAL jsonb_array_elements(body->'entry') entry
WHERE endpoint='/api/nhs/ods/Organization?_count=100&_offset=0' AND status=200;

CREATE OR REPLACE VIEW sim.ehr_problems AS
SELECT world_id,patient_id,resource_id,item AS problem
FROM sim.resource_projections,
LATERAL jsonb_array_elements(body#>'{data,problems}') item
WHERE site='gp' AND kind='ehr-record';

CREATE OR REPLACE VIEW sim.ehr_medications AS
SELECT world_id,patient_id,resource_id,item AS medication
FROM sim.resource_projections,
LATERAL jsonb_array_elements(body#>'{data,medications}') item
WHERE site='gp' AND kind='ehr-record';

CREATE OR REPLACE VIEW sim.ehr_allergies AS
SELECT world_id,patient_id,resource_id,item AS allergy
FROM sim.resource_projections,
LATERAL jsonb_array_elements(body#>'{data,allergies}') item
WHERE site='gp' AND kind='ehr-record';

CREATE OR REPLACE VIEW sim.lab_results AS
SELECT world_id,patient_id,resource_id,body#>'{data,panel}' AS panel,
  body#>>'{data,collectedAt}' AS collected_at_ms,item AS analyte
FROM sim.resource_projections,
LATERAL jsonb_array_elements(body#>'{data,analytes}') item
WHERE site='gp' AND kind='report';

CREATE OR REPLACE VIEW sim.appointments AS
SELECT world_id,resource_id,patient_id,status,
  to_timestamp((body#>>'{data,startsAt}')::double precision/1000) AS starts_at,
  body#>>'{data,clinician}' AS clinician,body#>>'{data,mode}' AS mode,body
FROM sim.resource_projections WHERE site='gp' AND kind='appointment';
