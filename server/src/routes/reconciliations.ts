import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { postReconciliationBatch } from '../services/reconciliation-posting.js';
import { listPendingReconciliations } from '../services/collection-queries.js';

interface ReconciliationBody { branchId: string; batchReference: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; paymentIds: string[]; policyVersion: string; managerOverride?: boolean; decision?: 'approve' | 'reject'; decisionReason?: string; }
interface ReconciliationQuery { branchId?: string; limit?: string; }

export function registerReconciliationRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get<{ Querystring: ReconciliationQuery }>('/api/v1/reconciliations/queue', {
    preHandler: [
      authMiddleware(verifier, resolveUser),
      requireRoles(['admin', 'manager']),
      requireBranchScope((request) => (request.query as ReconciliationQuery | undefined)?.branchId ?? request.actor?.branchId ?? undefined),
    ],
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 }, limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' } } } },
  }, async (request, reply) => {
    const branchId = request.actor!.role === 'admin' ? request.query.branchId : request.actor!.branchId;
    if (!branchId) return reply.code(400).send({ ok: false, error: { code: 'BRANCH_REQUIRED', message: 'A branch is required for reconciliation review' }, version: SYSTEM_VERSION });
    const batches = await listPendingReconciliations({ branchId, limit: Math.min(Number(request.query.limit ?? 100), 100) });
    return { ok: true, data: { batches }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });

  app.post<{ Body: ReconciliationBody }>('/api/v1/reconciliations/post-batch', {
    preHandler: [authMiddleware(verifier, resolveUser), requireRoles(['admin', 'manager']), requireBranchScope((request) => (request.body as ReconciliationBody | undefined)?.branchId)],
    schema: { body: { type: 'object', required: ['branchId', 'batchReference', 'expectedAmount', 'recordedAmount', 'submittedAmount', 'paymentIds', 'policyVersion'], additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 }, batchReference: { type: 'string', minLength: 1, maxLength: 128 }, expectedAmount: { type: 'integer', minimum: 0 }, recordedAmount: { type: 'integer', minimum: 0 }, submittedAmount: { type: 'integer', minimum: 0 }, paymentIds: { type: 'array', items: { type: 'string' } }, policyVersion: { type: 'string', minLength: 1, maxLength: 64 }, managerOverride: { type: 'boolean' }, decision: { type: 'string', enum: ['approve', 'reject'] }, decisionReason: { type: 'string', minLength: 1, maxLength: 500 } } } },
  }, async (request) => {
    const result = await postReconciliationBatch({ ...request.body, actorUserId: request.actor!.userId, actorRole: request.actor!.role as 'admin' | 'manager', managerOverride: request.body.managerOverride ?? false, correlationId: String(request.headers['x-correlation-id']) });
    return { ok: true, data: result, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });
}
