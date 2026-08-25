import type { CollectionBatch, CollectionStatus, FieldCollectionRecord, QueueSnapshot, SyncState } from '../types/field-ops.js';
import { telemetry } from './telemetry.js';
import { postPayment } from './api.js';

const databaseName = 'letsgrow-field-ops';
const databaseVersion = 1;
const eventStore = 'collection-events';
const stateStore = 'collection-state';
const batchStore = 'batch-state';
const fallbackKey = 'letsgrow-field-ops-queue';

type QueueEvent = { id?: number; localId: string; kind: 'recorded' | 'status'; record?: FieldCollectionRecord; status?: CollectionStatus; at: string };
type SyncResponse = { ok: boolean; data?: { receiptReference?: string }; error?: { code?: string; message?: string } };
type PaymentSync = (record: FieldCollectionRecord) => Promise<SyncResponse>;

function now(): string { return new Date().toISOString(); }
function isBrowser(): boolean { return typeof window !== 'undefined'; }
function readFallback(): QueueSnapshot { if (!isBrowser()) return { records: [], batches: [] }; const value = window.localStorage.getItem(fallbackKey); return value ? JSON.parse(value) as QueueSnapshot : { records: [], batches: [] }; }
function writeFallback(snapshot: QueueSnapshot): void { if (isBrowser()) window.localStorage.setItem(fallbackKey, JSON.stringify(snapshot)); }
function syncStateFor(status: CollectionStatus): SyncState { return status === 'Queued' || status === 'Pending reconciliation' ? 'queued' : status === 'Syncing' ? 'syncing' : status === 'Posted' ? 'succeeded' : status === 'Rejected' ? 'failed' : 'local'; }

export class OfflineQueue {
  private readonly processPayment: PaymentSync;
  private database?: IDBDatabase;
  private processing = false;
  private onlineHandler?: () => void;

  constructor(processPayment: PaymentSync) { this.processPayment = processPayment; }

  async open(): Promise<void> {
    if (!isBrowser() || !('indexedDB' in window)) return;
    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, databaseVersion);
      request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_OPEN_FAILED'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(eventStore)) db.createObjectStore(eventStore, { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains(stateStore)) db.createObjectStore(stateStore, { keyPath: 'localId' });
        if (!db.objectStoreNames.contains(batchStore)) db.createObjectStore(batchStore, { keyPath: 'localId' });
      };
      request.onsuccess = () => resolve(request.result);
    });
  }

  start(): void {
    if (!isBrowser()) return;
    this.onlineHandler = () => { void this.processQueued(); };
    window.addEventListener('online', this.onlineHandler);
    if (navigator.onLine) void this.processQueued();
  }

  stop(): void { if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler); this.onlineHandler = undefined; }

  async enqueue(record: FieldCollectionRecord): Promise<void> {
    const event: QueueEvent = { localId: record.localId, kind: 'recorded', record, at: now() };
    await this.append(event, record);
  }

  async enqueueBatch(batch: CollectionBatch): Promise<void> {
    if (!this.database) { const snapshot = readFallback(); snapshot.batches = [...snapshot.batches.filter((item) => item.localId !== batch.localId), batch]; snapshot.lastProcessedAt = now(); writeFallback(snapshot); return; }
    await new Promise<void>((resolve, reject) => {
      const transaction = this.database!.transaction([batchStore], 'readwrite');
      transaction.objectStore(batchStore).put(batch);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('BATCH_WRITE_FAILED'));
    });
  }

  async updateBatchStatus(localId: string, status: CollectionStatus, lastError?: string): Promise<void> {
    const batch = (await this.getBatches()).find((item) => item.localId === localId);
    if (!batch) throw new Error('QUEUE_BATCH_NOT_FOUND');
    await this.enqueueBatch({ ...batch, status, syncState: syncStateFor(status), updatedAt: now(), retryCount: status === 'Queued' ? batch.retryCount : batch.retryCount + 1, lastError });
  }

  async updateStatus(localId: string, status: CollectionStatus, lastError?: string): Promise<void> {
    const current = (await this.getRecords()).find((record) => record.localId === localId);
    if (!current) throw new Error('QUEUE_RECORD_NOT_FOUND');
    const updated: FieldCollectionRecord = { ...current, status, syncState: syncStateFor(status), updatedAt: now(), retryCount: status === 'Queued' ? current.retryCount : current.retryCount + 1, lastError };
    await this.append({ localId, kind: 'status', status, at: updated.updatedAt }, updated);
  }

  async getRecords(): Promise<FieldCollectionRecord[]> { return this.database ? this.readIndexedRecords() : readFallback().records; }
  async getBatches(): Promise<CollectionBatch[]> {
    if (!this.database) return readFallback().batches;
    return new Promise<CollectionBatch[]>((resolve, reject) => {
      const request = this.database!.transaction(batchStore, 'readonly').objectStore(batchStore).getAll();
      request.onsuccess = () => resolve(request.result as CollectionBatch[]);
      request.onerror = () => reject(request.error ?? new Error('BATCH_READ_FAILED'));
    });
  }

  async processQueued(): Promise<void> {
    if (this.processing || (isBrowser() && !navigator.onLine)) return;
    this.processing = true;
    try {
      for (const record of (await this.getRecords()).filter((item) => item.status === 'Queued' || item.status === 'Pending reconciliation' || item.status === 'Needs review')) {
        const startedAt = performance.now();
        telemetry.capture('queue.sync_started', { localId: record.localId, status: record.status }, { correlationId: record.correlationId });
        await this.updateStatus(record.localId, 'Syncing');
        try {
          const response = await this.processPayment({ ...record, status: 'Syncing', syncState: 'syncing' });
          const syncLatencyMs = Math.round(performance.now() - startedAt);
          if (response.ok) { await this.updateStatus(record.localId, 'Posted'); telemetry.capture('queue.sync_succeeded', { localId: record.localId, status: 'Posted' }, { correlationId: record.correlationId, syncLatencyMs }); }
          else { const status = response.error?.code === 'CONFLICT' ? 'Needs review' : 'Rejected'; await this.updateStatus(record.localId, status, response.error?.message); telemetry.capture('queue.sync_rejected', { localId: record.localId, status, errorCode: response.error?.code }, { correlationId: record.correlationId, syncLatencyMs }); }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'SYNC_FAILED';
          await this.updateStatus(record.localId, 'Queued', message);
          telemetry.capture('queue.sync_failed', { localId: record.localId, error: message }, { correlationId: record.correlationId, syncLatencyMs: Math.round(performance.now() - startedAt) });
        }
      }
    } finally { this.processing = false; }
  }

  private async append(event: QueueEvent, state: FieldCollectionRecord): Promise<void> {
    if (!this.database) { const snapshot = readFallback(); snapshot.records = [...snapshot.records.filter((item) => item.localId !== state.localId), state]; snapshot.lastProcessedAt = now(); writeFallback(snapshot); return; }
    await new Promise<void>((resolve, reject) => {
      const transaction = this.database!.transaction([eventStore, stateStore], 'readwrite');
      transaction.objectStore(eventStore).add(event);
      transaction.objectStore(stateStore).put(state);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('QUEUE_WRITE_FAILED'));
    });
  }

  private async readIndexedRecords(): Promise<FieldCollectionRecord[]> {
    return new Promise<FieldCollectionRecord[]>((resolve, reject) => {
      const request = this.database!.transaction(stateStore, 'readonly').objectStore(stateStore).getAll();
      request.onsuccess = () => resolve(request.result as FieldCollectionRecord[]);
      request.onerror = () => reject(request.error ?? new Error('QUEUE_READ_FAILED'));
    });
  }
}

export function createPaymentSync(apiBaseUrl = ''): PaymentSync {
  return async (record) => {
    try { const result = await postPayment({ loanId: record.loanId, branchId: record.branchId, amount: record.amount, idempotencyKey: record.idempotencyKey, receiptReference: record.receiptReference }, undefined, apiBaseUrl, record.correlationId); return { ok: true, data: { receiptReference: result.receiptReference } }; }
    catch (error) { const failure = error instanceof Error ? error.message : 'PAYMENT_SYNC_FAILED'; return { ok: false, error: { code: failure, message: failure } }; }
  };
}
