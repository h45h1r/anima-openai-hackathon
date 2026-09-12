CREATE SCHEMA IF NOT EXISTS companion;
CREATE TABLE IF NOT EXISTS companion.patients (
  world_id text NOT NULL, patient_id text NOT NULL, revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz, PRIMARY KEY(world_id,patient_id),
  FOREIGN KEY(world_id,patient_id) REFERENCES sim.patients(world_id,patient_id)
);
CREATE TABLE IF NOT EXISTS companion.members (
  id uuid PRIMARY KEY, world_id text NOT NULL, patient_id text NOT NULL,
  name text NOT NULL, relationship text NOT NULL, email text NOT NULL DEFAULT '',
  categories jsonb NOT NULL DEFAULT '[]', status text NOT NULL CHECK(status IN ('active','revoked')),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  invitation_hash text, invitation_expires timestamptz,
  FOREIGN KEY(world_id,patient_id) REFERENCES companion.patients(world_id,patient_id)
);
CREATE INDEX IF NOT EXISTS companion_members_patient ON companion.members(world_id,patient_id);
ALTER TABLE companion.members ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE companion.members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'family';
CREATE UNIQUE INDEX IF NOT EXISTS companion_members_external ON companion.members(world_id,patient_id,external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS companion_members_email ON companion.members(world_id,patient_id,lower(email)) WHERE email<>'' AND status='active';
CREATE TABLE IF NOT EXISTS companion.audit (
  id uuid PRIMARY KEY, world_id text NOT NULL, patient_id text NOT NULL, member_id uuid NOT NULL,
  action text NOT NULL, member_name text NOT NULL, actor text NOT NULL, detail text NOT NULL,
  before_value jsonb, after_value jsonb, revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS companion.sessions (
  token_hash text PRIMARY KEY, world_id text NOT NULL, patient_id text NOT NULL,
  role text NOT NULL CHECK(role IN ('patient','gp','family')), member_id uuid,
  expires_at timestamptz NOT NULL
);
