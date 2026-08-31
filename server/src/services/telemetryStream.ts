import { pool } from '../db.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

export interface SystemHealth { version: typeof SYSTEM_VERSION; database: 'up' | 'down'; checkedAt: string; }
export interface PoolStats { total: number; idle: number; waiting: number; max: number; }
export interface QueueDepth { pendingPayments: number; pendingFieldCollections: number; varianceBatches: number; }
export interface SafeAuditEvent { id: string; action: string; entityType: string; entityId: string | null; correlationId: string; metadata: Record<string, unknown>; createdAt: string; }
const sensitive = /token|secret|password|private.?key|national.?id|borrower.?id|client.?id|loan.?id|entity.?id|phone|mobile|name|email|firebase.?uid/i;

export function maskTelemetry(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskTelemetry);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[REDACTED]' : maskTelemetry(item)]));
}

export async function getSystemHealth(): Promise<SystemHealth> {
  try { await pool.query('SELECT 1'); return { version: SYSTEM_VERSION, database: 'up', checkedAt: new Date().toISOString() }; }
  catch { return { version: SYSTEM_VERSION, database: 'down', checkedAt: new Date().toISOString() }; }
}

export function getDatabasePoolStats(): PoolStats { return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: Number(process.env.DATABASE_POOL_MAX ?? 5) }; }

export async function getQueueDepth(): Promise<QueueDepth> {
  const result = await pool.query<{ pending_payments: string; pending_field_collections: string; variance_batches: string }>(`SELECT (SELECT COUNT(*) FROM payments WHERE status IN ('recorded', 'pending_reconciliation', 'verified')) AS pending_payments, (SELECT COUNT(*) FROM field_collection_records WHERE status IN ('recorded', 'pending_reconciliation')) AS pending_field_collections, (SELECT COUNT(*) FROM reconciliations WHERE status = 'variance') AS variance_batches`);
  const row = result.rows[0]; return { pendingPayments: Number(row.pending_payments), pendingFieldCollections: Number(row.pending_field_collections), varianceBatches: Number(row.variance_batches) };
}

export async function streamAuditEvents(input: { after?: string; limit?: number; correlationId?: string }): Promise<SafeAuditEvent[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const result = await pool.query<{ id: string; action: string; entity_type: string; entity_id: string | null; correlation_id: string; metadata: Record<string, unknown>; created_at: Date }>(`SELECT id, action, entity_type, entity_id, correlation_id, metadata, created_at FROM audit_events WHERE ($1::timestamptz IS NULL OR created_at > $1::timestamptz) AND ($2::uuid IS NULL OR correlation_id = $2::uuid) ORDER BY created_at ASC, id ASC LIMIT $3`, [input.after ?? null, input.correlationId ?? null, limit]);
  return result.rows.map((row) => ({ id: row.id, action: row.action, entityType: row.entity_type, entityId: row.entity_id ? '[REDACTED]' : null, correlationId: row.correlation_id, metadata: maskTelemetry(row.metadata) as Record<string, unknown>, createdAt: row.created_at.toISOString() }));
}
