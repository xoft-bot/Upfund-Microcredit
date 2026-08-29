import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryRoutes } from '../server/src/routes/telemetryRoutes.js';
import { registerWebhookRoutes } from '../server/src/routes/webhookRoutes.js';
import { runReconciliationCycle, type Candidate } from '../server/src/jobs/reconciliationCron.js';
import { maskTelemetry } from '../server/src/services/telemetryStream.js';
import { pool } from '../server/src/db.js';
import type { TokenVerifier } from '../server/src/middleware/auth.js';
import type { UserResolver } from '../server/src/middleware/auth.js';

const verifier: TokenVerifier = vi.fn(async () => ({ uid: 'manager-1', role: 'manager', branchId: 'branch-1' } as never));
const userResolver: UserResolver = vi.fn(async () => ({ dbUserId: 'db-manager-1', firebaseUid: 'manager-1', role: 'manager' as const, branchId: 'branch-1' }));
const payload = { event: 'charge.completed', data: { id: 77, tx_ref: 'TX-STAGE4-1', amount: 5000, currency: 'UGX', status: 'successful', meta: { client_id: 'client-1', loan_id: 'loan-1', branch_id: 'branch-1' } } };
const paymentResult = { paymentId: 'payment-1', receiptReference: 'RCT-1', principalAmount: 5000, chargeAmount: 0, outstandingPrincipal: 95000, loanStatus: 'active', ledgerTransactionId: 'ledger-1', created: true };

afterEach(() => vi.restoreAllMocks());

describe('Stage 4 integration flow', () => {
  it('ingests a webhook twice while preserving the same idempotency key', async () => {
    const postPayment = vi.fn().mockResolvedValueOnce(paymentResult).mockResolvedValueOnce({ ...paymentResult, created: false }); const app = Fastify(); registerWebhookRoutes(app, { secretHash: 'hash', actorUserId: 'system-user', postPayment }); await app.ready();
    const headers = { 'verif-hash': 'hash', 'x-correlation-id': 'stage4-corr-1' }; const first = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', headers, payload }); const second = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', headers, payload });
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200); expect(postPayment.mock.calls.map((call) => call[0].idempotencyKey)).toEqual(['TX-STAGE4-1', 'TX-STAGE4-1']); expect(second.json().data.created).toBe(false); await app.close();
  });

  it('auto-posts matched cron batches and quarantines mismatches', async () => {
    const candidates: Candidate[] = [{ branchId: 'branch-1', paymentId: 'payment-1', amount: 5000 }]; const postBatch = vi.fn(async () => ({ reconciliationId: 'r1', status: 'matched', variance: 0, allocation: { policyVersion: 'v1', realizedCharge: 0, creditLossReserve: 0, operatingReserve: 0, collectionCost: 0, growthCapital: 0, retainedProfit: 0, deployableGrowthCapital: 0 }, ledgerTransactionId: 'l1' })); const quarantine = vi.fn(async () => undefined); const alertSink = vi.fn();
    expect((await runReconciliationCycle({ actorUserId: 'system', policyVersion: 'v1' }, { loadCandidates: async () => candidates, expectedForBranch: async () => 5000, postBatch })).posted).toBe(1);
    const result = await runReconciliationCycle({ actorUserId: 'system', policyVersion: 'v1' }, { loadCandidates: async () => candidates, expectedForBranch: async () => 7000, postBatch, quarantine, alertSink });
    expect(result.quarantined).toBe(1); expect(postBatch).toHaveBeenCalledTimes(1); expect(quarantine).toHaveBeenCalledOnce(); expect(alertSink).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.01', correlationId: expect.any(String) }));
  });

  it('protects telemetry endpoints and masks secrets in audit output', async () => {
    const query = vi.spyOn(pool, 'query').mockImplementation(async (sql: string) => { if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }], rowCount: 1 } as never; if (sql.includes('COUNT(*)')) return { rows: [{ pending_payments: '2', pending_field_collections: '1', variance_batches: '3' }], rowCount: 1 } as never; return { rows: [{ id: 'audit-1', action: 'login', entity_type: 'user', entity_id: 'user-1', correlation_id: 'corr-1', metadata: { token: 'secret', national_id: 'N-1', borrower_name: 'Borrower One', phone_number: '+256700000000', safe: 'ok' }, created_at: new Date('2026-08-25T00:00:00Z') }], rowCount: 1 } as never; }); const app = Fastify(); registerTelemetryRoutes(app, verifier, userResolver); await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/v1/telemetry/health' })).statusCode).toBe(401); const health = await app.inject({ method: 'GET', url: '/api/v1/telemetry/health', headers: { authorization: 'Bearer valid', 'x-correlation-id': 'telemetry-corr' } }); const queues = await app.inject({ method: 'GET', url: '/api/v1/telemetry/queues', headers: { authorization: 'Bearer valid' } }); const audit = await app.inject({ method: 'GET', url: '/api/v1/telemetry/audit-stream?limit=10', headers: { authorization: 'Bearer valid' } });
    expect(health.statusCode).toBe(200); expect(health.json().version).toBe('1.0.01'); expect(queues.json().data).toEqual({ pendingPayments: 2, pendingFieldCollections: 1, varianceBatches: 3 }); expect(audit.json().data[0].metadata).toEqual({ token: '[REDACTED]', national_id: '[REDACTED]', borrower_name: '[REDACTED]', phone_number: '[REDACTED]', safe: 'ok' }); expect(query).toHaveBeenCalled(); await app.close();
  });

  it('masks nested sensitive telemetry fields without mutating safe values', () => { expect(maskTelemetry({ secret: 'x', borrower_name: 'Borrower One', phone_number: '+256700000000', nested: { borrower_id: 'b', value: 4 } })).toEqual({ secret: '[REDACTED]', borrower_name: '[REDACTED]', phone_number: '[REDACTED]', nested: { borrower_id: '[REDACTED]', value: 4 } }); });
});
