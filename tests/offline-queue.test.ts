import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineQueue, createPaymentSync } from '../client/src/services/offlineQueue.js';
import type { FieldCollectionRecord } from '../client/src/types/field-ops.js';

const storage = new Map<string, string>();
const browserWindow = { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: vi.fn(), removeEventListener: vi.fn() };
Object.defineProperty(globalThis, 'window', { value: browserWindow, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const record: FieldCollectionRecord = { localId: 'local-1', idempotencyKey: 'idem-0001', clientId: 'client-1', loanId: 'loan-1', branchId: 'branch-1', collectorId: 'collector-1', amount: 5000, paymentMethod: 'cash', status: 'Queued', syncState: 'queued', deviceId: 'device-1', correlationId: 'corr-1', capturedAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', retryCount: 0 };

describe('offline collection queue', () => {
  beforeEach(() => storage.clear());

  it('stores records and appends status changes to the local event stream', async () => {
    const queue = new OfflineQueue(async () => ({ ok: true }));
    await queue.enqueue(record);
    await queue.updateStatus(record.localId, 'Needs review', 'CONFLICT');
    const records = await queue.getRecords();
    expect(records[0]).toMatchObject({ localId: 'local-1', status: 'Needs review', syncState: 'conflict', lastError: 'CONFLICT' });
    expect(JSON.parse(storage.get('letsgrow-field-ops-queue') ?? '{}').records).toHaveLength(1);
  });

  it('replays queued records once and preserves the idempotency key', async () => {
    const process = vi.fn(async (item: FieldCollectionRecord) => { expect(item.idempotencyKey).toBe('idem-0001'); return { ok: true, data: { receiptReference: 'RCT-1' } }; });
    const queue = new OfflineQueue(process);
    await queue.enqueue(record);
    await queue.processQueued();
    expect(process).toHaveBeenCalledTimes(1);
    expect((await queue.getRecords())[0].status).toBe('Posted');
    await queue.processQueued();
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('gets a token for replay, sends the complete capture, and stores the receipt', async () => {
    const getToken = vi.fn(async () => 'firebase-token');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer firebase-token');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        localId: record.localId,
        clientId: record.clientId,
        deviceId: record.deviceId,
        paymentMethod: record.paymentMethod,
        capturedAt: record.capturedAt,
      });
      return new Response(JSON.stringify({ ok: true, data: { receiptReference: 'RCT-SYNC-1' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const queue = new OfflineQueue(createPaymentSync(getToken));
    await queue.enqueue(record);
    await queue.processQueued();
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await queue.getRecords())[0]).toMatchObject({ status: 'Posted', receiptReference: 'RCT-SYNC-1', syncState: 'succeeded' });
    vi.unstubAllGlobals();
  });

  it('keeps an expired-auth replay queued for a later token refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Token expired' } }), { status: 401 })));
    const queue = new OfflineQueue(createPaymentSync(async () => 'expired-token'));
    await queue.enqueue(record);
    await queue.processQueued();
    expect((await queue.getRecords())[0]).toMatchObject({ status: 'Queued', syncState: 'queued', lastError: 'Token expired' });
    vi.unstubAllGlobals();
  });

  it('marks server conflicts for review instead of retrying them forever', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'CONFLICT', message: 'Loan already settled' } }), { status: 409 })));
    const queue = new OfflineQueue(createPaymentSync(async () => 'firebase-token'));
    await queue.enqueue(record);
    await queue.processQueued();
    expect((await queue.getRecords())[0]).toMatchObject({ status: 'Needs review', syncState: 'conflict', lastError: 'Loan already settled' });
    vi.unstubAllGlobals();
  });
});
