import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfflineQueue } from '../client/src/services/offlineQueue.js';
import { hasDecisionReason, ManagerVarianceDashboard } from '../client/src/components/field/ManagerVarianceDashboard.js';
import { ReceiptPreview } from '../client/src/components/field/ReceiptPreview.js';
import type { FieldCollectionRecord } from '../client/src/types/field-ops.js';

const storage = new Map<string, string>();
const browserWindow = { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { pathname: '/field' } };
Object.defineProperty(globalThis, 'window', { value: browserWindow, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const record: FieldCollectionRecord = { localId: 'local-flow-1', idempotencyKey: 'idem-flow-1', clientId: 'client-flow-1', loanId: 'loan-flow-1', branchId: 'branch-flow-1', collectorId: 'collector-flow-1', amount: 5000, paymentMethod: 'cash', status: 'Draft', syncState: 'local', deviceId: 'device-flow-1', correlationId: 'corr-flow-1', capturedAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z', retryCount: 0 };

describe('Stage 3 PWA field flow', () => {
  beforeEach(() => storage.clear());
  it('enqueues unique idempotency keys and progresses Draft to Posted', async () => {
    const process = vi.fn(async (item: FieldCollectionRecord) => { expect(item.idempotencyKey).toBe('idem-flow-1'); return { ok: true, data: { receiptReference: 'RCT-FLOW-1' } }; });
    const queue = new OfflineQueue(process);
    await queue.enqueue(record);
    await queue.updateStatus(record.localId, 'Queued');
    await queue.updateStatus(record.localId, 'Pending reconciliation');
    await queue.processQueued();
    const stored = await queue.getRecords();
    expect(stored[0]).toMatchObject({ idempotencyKey: 'idem-flow-1', status: 'Posted', syncState: 'succeeded' });
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('renders the pending and posted receipt labels correctly', () => {
    const pending = renderToStaticMarkup(<ReceiptPreview clientId="client-1" loanId="loan-1" amount={5000} collectorId="collector-1" capturedAt={record.capturedAt} status="Pending reconciliation" />);
    const posted = renderToStaticMarkup(<ReceiptPreview clientId="client-1" loanId="loan-1" amount={5000} collectorId="collector-1" capturedAt={record.capturedAt} status="Posted" receiptReference="RCT-1" />);
    expect(pending).toContain('Pending Reconciliation');
    expect(pending).toContain('not confirmed as paid');
    expect(posted).toContain('RCT-1');
    expect(posted).toContain('Payment receipt');
  });

  it('requires a manager decision reason before protected approval', () => {
    const onResolved = vi.fn();
    const markup = renderToStaticMarkup(<ManagerVarianceDashboard batches={[{ batchReference: 'BATCH-1', branchId: 'branch-1', collectionDate: '2026-08-25', expectedAmount: 100000, recordedAmount: 95000, submittedAmount: 95000, variance: -5000, status: 'variance', submittedBy: 'collector-1', payments: [] }]} getToken={async () => 'test-token'} onResolved={onResolved} />);
    expect(markup).toContain('BATCH-1');
    expect(markup).toContain('variance');
    expect(hasDecisionReason('')).toBe(false);
    expect(hasDecisionReason('Manager confirmed cash count')).toBe(true);
    expect(onResolved).not.toHaveBeenCalled();
  });
});
