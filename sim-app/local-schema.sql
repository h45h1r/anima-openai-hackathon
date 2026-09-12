CREATE TABLE IF NOT EXISTS sim.local_clock (
  world_id text PRIMARY KEY REFERENCES sim.worlds,
  sim_time double precision NOT NULL,
  wall_time bigint NOT NULL,
  paused boolean NOT NULL DEFAULT true,
  speed double precision NOT NULL DEFAULT 60
);
CREATE TABLE IF NOT EXISTS sim.local_requests (
  world_id text NOT NULL REFERENCES sim.worlds,
  request_key text NOT NULL,
  request jsonb NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY(world_id,request_key)
);
CREATE TABLE IF NOT EXISTS sim.local_jobs (
  id bigserial PRIMARY KEY,
  world_id text NOT NULL REFERENCES sim.worlds,
  type text NOT NULL,
  due_at double precision NOT NULL,
  resource_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  error text
);
CREATE TABLE IF NOT EXISTS sim.local_settings (
  world_id text NOT NULL REFERENCES sim.worlds,
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY(world_id,key)
);
