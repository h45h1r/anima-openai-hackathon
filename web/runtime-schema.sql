CREATE TABLE IF NOT EXISTS public.kindred_runtime_state (
  namespace text NOT NULL,
  patient_id text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, patient_id)
);
