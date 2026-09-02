import type { FastifyInstance } from 'fastify';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { postManualPayment } from '../services/payment-posting.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

interface PaymentBody {
  loanId: string;
  branchId: string;
  amount: number;
  idempotencyKey: string;
  receiptReference?: string;
  localId?: string;
  clientId?: string;
  deviceId?: string;
  paymentMethod?: 'cash' | 'mobile_money';
  capturedAt?: string;
}

export function registerPaymentRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.post<{ Body: PaymentBody }>('/api/v1/payments', {
    preHandler: [authMiddleware(verifier, resolveUser), requireRoles(['admin', 'manager', 'officer', 'collector']), requireBranchScope((request) => (request.body as PaymentBody | undefined)?.branchId)],
    schema: {
      body: {
        type: 'object',
        required: ['loanId', 'branchId', 'amount', 'idempotencyKey'],
        additionalProperties: false,
        properties: {
          loanId: { type: 'string', minLength: 1 },
          branchId: { type: 'string', minLength: 1 },
          amount: { type: 'integer', minimum: 1 },
          idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
          receiptReference: { type: 'string', minLength: 1, maxLength: 128 },
          localId: { type: 'string', minLength: 1, maxLength: 128 },
          clientId: { type: 'string', minLength: 1 },
          deviceId: { type: 'string', minLength: 1, maxLength: 256 },
          paymentMethod: { type: 'string', enum: ['cash', 'mobile_money'] },
          capturedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (request, reply) => {
    const actor = request.actor!;
    try {
      const result = await postManualPayment({ ...request.body, actorUserId: actor.userId, correlationId: String(request.headers['x-correlation-id']) });
      return { ok: true, data: result, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
    } catch (error) {
      if (error instanceof Error && error.message === 'FIELD_COLLECTION_CONFLICT') {
        return reply.code(409).send({ ok: false, error: { code: 'CONFLICT', message: 'This offline collection conflicts with an existing server record' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
      }
      throw error;
    }
  });
}
