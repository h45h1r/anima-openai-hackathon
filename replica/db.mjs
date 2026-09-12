import pg from 'pg';
export const database = process.env.REPLICA_DATABASE || 'anima_sim_replica_20260912';
export const pool = new pg.Pool({ database, host: process.env.PGHOST || '/tmp', max: 6 });
