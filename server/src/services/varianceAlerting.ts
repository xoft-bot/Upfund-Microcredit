import type { DbClient } from '../db.js';
import { insertAuditEvent } from '../db.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

export interface VarianceAlert { event: 'reconciliation.variance'; version: typeof SYSTEM_VERSION; correlationId: string; branchId: string; batchReference: string; variance: number; threshold: number; occurredAt: string; }
export type VarianceAlertSink = (alert: VarianceAlert) => void;
const defaultSink: VarianceAlertSink = (alert) => console.warn(JSON.stringify({ ...alert, level: 'alert' }));

export function createVarianceAlert(input: { branchId: string; batchReference: string; variance: number; threshold: number; correlationId: string; }, sink: VarianceAlertSink = defaultSink): VarianceAlert {
  const alert: VarianceAlert = { event: 'reconciliation.variance', version: SYSTEM_VERSION, branchId: input.branchId, batchReference: input.batchReference, variance: input.variance, threshold: input.threshold, correlationId: input.correlationId, occurredAt: new Date().toISOString() };
  sink(alert);
  return alert;
}

export function exceedsVarianceThreshold(variance: number, threshold: number): boolean { return Math.abs(variance) >= threshold; }

export async function quarantineVarianceBatchOnClient(client: DbClient, input: { actorUserId: string; branchId: string; batchReference: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; variance: number; paymentIds: string[]; correlationId: string; }): Promise<string> {
  const reconciliation = await client.query<{ id: string }>(`INSERT INTO reconciliations (branch_id, batch_reference, expected_amount, recorded_amount, submitted_amount, variance, status, submitted_by) VALUES ($1, $2, $3, $4, $5, $6, 'variance', $7) RETURNING id`, [input.branchId, input.batchReference, input.expectedAmount, input.recordedAmount, input.submittedAmount, input.variance, input.actorUserId]);
  const reconciliationId = reconciliation.rows[0].id;
  for (const paymentId of input.paymentIds) await client.query('INSERT INTO reconciliation_payments (reconciliation_id, payment_id) VALUES ($1, $2)', [reconciliationId, paymentId]);
  await insertAuditEvent(client, { actorUserId: input.actorUserId, action: 'reconciliation.batch.quarantined', entityType: 'reconciliation', entityId: reconciliationId, correlationId: input.correlationId, metadata: { batchReference: input.batchReference, variance: input.variance } });
  return reconciliationId;
}
