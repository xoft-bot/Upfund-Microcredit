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
      const result = await postManualPayment({ ...request.body, actorUserId: actor.userId, actorRole: actor.role, correlationId: String(request.headers['x-correlation-id']) });
      return { ok: true, data: result, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
    } catch (error) {
      if (error instanceof Error) {
        const mapped = PAYMENT_ERROR_STATUS[error.message];
        if (mapped) {
          return reply.code(mapped.status).send({ ok: false, error: { code: mapped.code, message: mapped.message }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
        }
      }
      throw error;
    }
  });
}

// Every business-rule error postManualPayment can throw, mapped to the HTTP status the caller
// actually needs. Without this, every one of these fell through to the global error handler,
// which has no way to distinguish them from a genuine server fault and returns a generic 500 —
// which the offline sync queue's retry classification (network/401/5xx => retry, everything else
// => stop and flag) treats as transient, so a permanently invalid payment (wrong branch, loan not
// payable, unassigned collector, bad input) got retried forever instead of surfacing to the user.
const PAYMENT_ERROR_STATUS: Record<string, { status: number; code: string; message: string }> = {
  INVALID_PAYMENT_AMOUNT: { status: 400, code: 'INVALID_PAYMENT_AMOUNT', message: 'Payment amount must be a positive whole number' },
  INVALID_PAYMENT_METHOD: { status: 400, code: 'INVALID_PAYMENT_METHOD', message: 'Unsupported payment method' },
  INVALID_CAPTURED_AT: { status: 400, code: 'INVALID_CAPTURED_AT', message: 'capturedAt must be a valid date-time' },
  FIELD_COLLECTION_CONFLICT: { status: 409, code: 'CONFLICT', message: 'This offline collection conflicts with an existing server record' },
  LOAN_NOT_FOUND_OR_BRANCH_DENIED: { status: 404, code: 'LOAN_NOT_FOUND', message: 'Loan not found for this branch' },
  LOAN_CLIENT_MISMATCH: { status: 409, code: 'LOAN_CLIENT_MISMATCH', message: 'This loan does not belong to the specified client' },
  LOAN_NOT_PAYABLE: { status: 409, code: 'LOAN_NOT_PAYABLE', message: 'This loan is not in a state that accepts payments' },
  COLLECTOR_NOT_ASSIGNED: { status: 403, code: 'COLLECTOR_NOT_ASSIGNED', message: 'You are not currently assigned to this client' },
  NO_OPEN_REPAYMENT_SCHEDULE: { status: 409, code: 'NO_OPEN_REPAYMENT_SCHEDULE', message: 'This loan has no open installment to apply a payment to' },
  LOAN_BALANCE_GUARD_FAILED: { status: 409, code: 'LOAN_BALANCE_GUARD_FAILED', message: 'Loan balance changed unexpectedly while posting this payment' },
  SCHEDULE_UPDATE_FAILED: { status: 409, code: 'SCHEDULE_UPDATE_FAILED', message: 'Repayment schedule changed unexpectedly while posting this payment' },
};
