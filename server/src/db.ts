import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.PGURI,
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

export type DbClient = pg.PoolClient;

export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS locked`,
      [key],
    );
    locked = result.rows[0]?.locked === true;
    if (!locked) return null;
    return await fn();
  } finally {
    if (locked) await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [key]);
    client.release();
  }
}

export async function insertAuditEvent(
  client: DbClient,
  input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    correlationId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
      (actor_user_id, action, entity_type, entity_id, correlation_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [input.actorUserId, input.action, input.entityType, input.entityId ?? null, input.correlationId, JSON.stringify(input.metadata ?? {})],
  );
}
