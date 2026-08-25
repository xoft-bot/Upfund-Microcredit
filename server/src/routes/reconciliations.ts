import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { postReconciliationBatch } from '../services/reconciliation-posting.js';

interface ReconciliationBody { branchId: string; batchReference: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; paymentIds: string[]; policyVersion: string; managerOverride?: boolean; }

export function registerReconciliationRoutes(app: FastifyInstance, verifier?: TokenVerifier): void {
  app.post<{ Body: ReconciliationBody }>('/api/v1/reconciliations/post-batch', {
    preHandler: [authMiddleware(verifier), requireRoles(['admin', 'manager']), requireBranchScope((request) => (request.body as ReconciliationBody | undefined)?.branchId)],
    schema: { body: { type: 'object', required: ['branchId', 'batchReference', 'expectedAmount', 'recordedAmount', 'submittedAmount', 'paymentIds', 'policyVersion'], additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 }, batchReference: { type: 'string', minLength: 1, maxLength: 128 }, expectedAmount: { type: 'integer', minimum: 0 }, recordedAmount: { type: 'integer', minimum: 0 }, submittedAmount: { type: 'integer', minimum: 0 }, paymentIds: { type: 'array', items: { type: 'string' } }, policyVersion: { type: 'string', minLength: 1, maxLength: 64 }, managerOverride: { type: 'boolean' } } } },
  }, async (request) => {
    const result = await postReconciliationBatch({ ...request.body, actorUserId: request.actor!.userId, actorRole: request.actor!.role as 'admin' | 'manager', managerOverride: request.body.managerOverride ?? false, correlationId: String(request.headers['x-correlation-id']) });
    return { ok: true, data: result, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });
}
