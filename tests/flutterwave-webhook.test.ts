import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWebhookRoutes } from '../server/src/routes/webhookRoutes.js';
import { normalizeFlutterwaveCharge, verifyFlutterwaveSignature } from '../server/src/services/flutterwaveWebhook.js';

const payload = { event: 'charge.completed', data: { id: 987, tx_ref: 'TX-001', amount: 5000, currency: 'UGX', status: 'successful', meta: { client_id: 'client-1', loan_id: 'loan-1', branch_id: 'branch-1' } } };
const result = { paymentId: 'payment-1', receiptReference: 'RCT-1', principalAmount: 5000, chargeAmount: 0, outstandingPrincipal: 95000, loanStatus: 'active', ledgerTransactionId: 'ledger-1', created: true };

afterEach(() => vi.restoreAllMocks());

describe('Flutterwave webhook guard', () => {
  it('accepts a matching secret hash using constant-time comparison', () => { expect(verifyFlutterwaveSignature('hash', 'hash')).toBe(true); expect(verifyFlutterwaveSignature('wrong', 'hash')).toBe(false); expect(verifyFlutterwaveSignature(undefined, 'hash')).toBe(false); });
  it('normalizes a completed charge and rejects incomplete or unsuccessful payloads', () => { expect(normalizeFlutterwaveCharge(payload)).toMatchObject({ transactionId: '987', txRef: 'TX-001', amount: 5000, currency: 'UGX', loanId: 'loan-1' }); expect(() => normalizeFlutterwaveCharge({ ...payload, event: 'charge.failed' })).toThrow('UNSUPPORTED_WEBHOOK_EVENT'); expect(() => normalizeFlutterwaveCharge({ ...payload, data: { ...payload.data, status: 'failed' } })).toThrow('UNSUCCESSFUL_WEBHOOK_CHARGE'); });

  it('fails closed for missing and invalid signatures', async () => {
    const postPayment = vi.fn(async () => result); const app = Fastify(); registerWebhookRoutes(app, { secretHash: 'hash', actorUserId: 'system-user', postPayment }); await app.ready();
    const missing = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', payload });
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', headers: { 'verif-hash': 'wrong' }, payload });
    expect(missing.statusCode).toBe(401); expect(invalid.statusCode).toBe(401); expect(postPayment).not.toHaveBeenCalled(); await app.close();
  });

  it('does not process the route when the provider integration is disabled', async () => {
    const postPayment = vi.fn(async () => result); const app = Fastify(); registerWebhookRoutes(app, { enabled: false, postPayment }); await app.ready();
    const response = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', payload });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('FLUTTERWAVE_DISABLED');
    expect(postPayment).not.toHaveBeenCalled();
    await app.close();
  });

  it('replays duplicate tx_ref values through the idempotent payment contract', async () => {
    const postPayment = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, created: false }); const app = Fastify(); registerWebhookRoutes(app, { secretHash: 'hash', actorUserId: 'system-user', postPayment }); await app.ready();
    const headers = { 'verif-hash': 'hash', 'x-correlation-id': 'corr-1' }; const first = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', headers, payload }); const second = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', headers, payload });
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200); expect(postPayment).toHaveBeenCalledTimes(2); expect(postPayment.mock.calls[0][0].idempotencyKey).toBe('TX-001'); expect(postPayment.mock.calls[1][0].idempotencyKey).toBe('TX-001'); expect(second.json().data.created).toBe(false); await app.close();
  });

  it('rejects invalid payloads before invoking payment posting', async () => {
    const postPayment = vi.fn(async () => result); const app = Fastify(); registerWebhookRoutes(app, { secretHash: 'hash', actorUserId: 'system-user', postPayment }); await app.ready(); const response = await app.inject({ method: 'POST', url: '/api/v1/webhooks/flutterwave', headers: { 'verif-hash': 'hash' }, payload: { event: 'charge.completed', data: {} } }); expect(response.statusCode).toBe(400); expect(postPayment).not.toHaveBeenCalled(); await app.close();
  });
});
