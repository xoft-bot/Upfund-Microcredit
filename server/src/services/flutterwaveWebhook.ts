import { timingSafeEqual } from 'node:crypto';
import { isProductionRuntime } from '../config.js';

export interface FlutterwaveChargeEvent {
  transactionId: string;
  txRef: string;
  amount: number;
  currency: string;
  status: string;
  clientId: string;
  loanId: string;
  branchId: string;
}

interface FlutterwavePayload { event?: unknown; data?: Record<string, unknown>; }
const text = (value: unknown): string => typeof value === 'string' && value.trim() ? value.trim() : '';
const identifier = (value: unknown): string => typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);
const number = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
const developmentSecretHash = 'dev_secret_hash_placeholder';

export function verifyFlutterwaveSignature(header: string | string[] | undefined, secretHash = process.env.FLUTTERWAVE_SECRET_HASH || (isProductionRuntime() ? undefined : developmentSecretHash)): boolean {
  if (!secretHash || typeof header !== 'string' || !header) return false;
  const expected = Buffer.from(secretHash, 'utf8'); const supplied = Buffer.from(header, 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function normalizeFlutterwaveCharge(payload: unknown): FlutterwaveChargeEvent {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_WEBHOOK_PAYLOAD');
  const body = payload as FlutterwavePayload; const data = body.data;
  if (body.event !== 'charge.completed' || !data) throw new Error('UNSUPPORTED_WEBHOOK_EVENT');
  const meta = data.meta && typeof data.meta === 'object' ? data.meta as Record<string, unknown> : {};
  const event: FlutterwaveChargeEvent = { transactionId: identifier(data.id), txRef: text(data.tx_ref), amount: number(data.amount), currency: text(data.currency).toUpperCase(), status: text(data.status).toLowerCase(), clientId: text(meta.client_id), loanId: text(meta.loan_id), branchId: text(meta.branch_id) };
  if (!event.transactionId || !event.txRef || !event.amount || !event.currency || !event.status || !event.clientId || !event.loanId || !event.branchId) throw new Error('INCOMPLETE_WEBHOOK_PAYLOAD');
  if (event.status !== 'successful') throw new Error('UNSUCCESSFUL_WEBHOOK_CHARGE');
  return event;
}
