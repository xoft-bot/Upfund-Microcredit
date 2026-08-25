import type { FastifyInstance } from 'fastify';
import { authMiddleware, type TokenVerifier } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { postManualPayment } from '../services/payment-posting.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

interface PaymentBody { loanId: string; branchId: string; amount: number; idempotencyKey: string; receiptReference?: string; }

export function registerPaymentRoutes(app: FastifyInstance, verifier?: TokenVerifier): void {
  app.post<{ Body: PaymentBody }>('/api/v1/payments', {
    preHandler: [authMiddleware(verifier), requireRoles(['admin', 'manager', 'officer', 'collector']), requireBranchScope((request) => (request.body as PaymentBody | undefined)?.branchId)],
    schema: { body: { type: 'object', required: ['loanId', 'branchId', 'amount', 'idempotencyKey'], additionalProperties: false, properties: { loanId: { type: 'string', minLength: 1 }, branchId: { type: 'string', minLength: 1 }, amount: { type: 'integer', minimum: 1 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 }, receiptReference: { type: 'string', minLength: 1, maxLength: 128 } } } },
  }, async (request) => {
    const actor = request.actor!;
    const result = await postManualPayment({ ...request.body, actorUserId: actor.userId, correlationId: String(request.headers['x-correlation-id']) });
    return { ok: true, data: result, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });
}
