import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { normalizeFlutterwaveCharge, verifyFlutterwaveSignature } from '../services/flutterwaveWebhook.js';
import { postManualPayment, type ManualPaymentResult } from '../services/payment-posting.js';

type PaymentPoster = (input: { actorUserId: string; loanId: string; branchId: string; amount: number; idempotencyKey: string; correlationId: string }) => Promise<ManualPaymentResult>;
interface WebhookOptions { enabled?: boolean; secretHash?: string; actorUserId?: string; postPayment?: PaymentPoster; }

export function registerWebhookRoutes(app: FastifyInstance, options: WebhookOptions = {}): void {
  const enabled = options.enabled ?? true;
  app.post('/api/v1/webhooks/flutterwave', async (request, reply) => {
    const correlationId = String(request.headers['x-correlation-id'] ?? 'webhook');
    if (!enabled) return reply.code(404).send({ ok: false, error: { code: 'FLUTTERWAVE_DISABLED', message: 'Flutterwave webhook integration is disabled' }, correlationId, version: SYSTEM_VERSION });
    const signature = request.headers['verif-hash'];
    if (!verifyFlutterwaveSignature(signature, options.secretHash)) return reply.code(401).send({ ok: false, error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Webhook signature rejected' }, correlationId, version: SYSTEM_VERSION });
    let event;
    try { event = normalizeFlutterwaveCharge(request.body); } catch (error) { const code = error instanceof Error ? error.message : 'INVALID_WEBHOOK_PAYLOAD'; return reply.code(400).send({ ok: false, error: { code, message: 'Webhook payload rejected' }, correlationId, version: SYSTEM_VERSION }); }
    if (event.currency !== 'UGX') return reply.code(400).send({ ok: false, error: { code: 'UNSUPPORTED_CURRENCY', message: 'Webhook currency rejected' }, correlationId, version: SYSTEM_VERSION });
    const actorUserId = options.actorUserId ?? process.env.FLUTTERWAVE_ACTOR_USER_ID;
    if (!actorUserId) return reply.code(503).send({ ok: false, error: { code: 'WEBHOOK_ACTOR_NOT_CONFIGURED', message: 'Webhook processing unavailable' }, correlationId, version: SYSTEM_VERSION });
    const postPayment = options.postPayment ?? postManualPayment;
    const result = await postPayment({ actorUserId, loanId: event.loanId, branchId: event.branchId, amount: event.amount, idempotencyKey: event.txRef, correlationId });
    return reply.send({ ok: true, data: { ...result, transactionId: event.transactionId, txRef: event.txRef }, correlationId, version: SYSTEM_VERSION });
  });
}
