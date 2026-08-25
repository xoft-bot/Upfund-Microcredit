import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../db.js';

const directory = join(process.cwd(), 'migrations');
const files = (await readdir(directory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const legacyStage1 = await client.query<{ exists: string }>(`SELECT to_regclass('public.branches') AS exists`);
  if (legacyStage1.rows[0].exists) await client.query(`INSERT INTO schema_migrations (filename) VALUES ('001_stage1_core.sql') ON CONFLICT DO NOTHING`);
  await client.query('COMMIT');
  for (const file of files) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (applied.rowCount) {
      console.log(`Skipped ${file}`);
      continue;
    }
    await client.query('BEGIN');
    await client.query(await readFile(join(directory, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`Applied ${file}`);
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
