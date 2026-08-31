import pg from 'pg';
import { getDatabaseConnectionString, isProductionRuntime } from './config.js';

const { Pool } = pg;

export interface DatabasePoolSettings {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl?: { rejectUnauthorized: false };
}

export function getDatabasePoolSettings(env: NodeJS.ProcessEnv = process.env): DatabasePoolSettings {
  const configuredMax = Number(env.DATABASE_POOL_MAX ?? 5);
  const max = Number.isInteger(configuredMax) && configuredMax >= 5 && configuredMax <= 10 ? configuredMax : 5;
  return {
    connectionString: getDatabaseConnectionString(env),
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isProductionRuntime(env) ? { rejectUnauthorized: false } : undefined,
  };
}

export interface DatabaseErrorDiagnostic {
  name: string;
  code?: string;
  message: string;
  errno?: string | number;
  syscall?: string;
  address?: string;
  port?: number;
}

function redactDatabaseMessage(message: string): string {
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://<redacted>')
    .replace(/(?:password|passwd|pwd)=[^\s&]+/gi, 'password=<redacted>')
    .slice(0, 300);
}

export function summarizeDatabaseError(error: unknown): DatabaseErrorDiagnostic {
  const value = error instanceof Error ? error as Error & Record<string, unknown> : { message: String(error) } as Record<string, unknown>;
  return {
    name: typeof value.name === 'string' ? value.name : 'DatabaseError',
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    message: redactDatabaseMessage(typeof value.message === 'string' ? value.message : 'Database operation failed'),
    ...(typeof value.errno === 'string' || typeof value.errno === 'number' ? { errno: value.errno } : {}),
    ...(typeof value.syscall === 'string' ? { syscall: value.syscall } : {}),
    ...(typeof value.address === 'string' ? { address: value.address } : {}),
    ...(typeof value.port === 'number' ? { port: value.port } : {}),
  };
}

export const pool = new Pool(getDatabasePoolSettings());

pool.on('error', (error) => {
  console.error(JSON.stringify({ event: 'database_pool_error', ...summarizeDatabaseError(error) }));
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
