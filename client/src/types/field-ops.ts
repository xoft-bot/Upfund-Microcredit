export const COLLECTION_STATUSES = ['Draft', 'Queued', 'Syncing', 'Recorded', 'Pending reconciliation', 'Posted', 'Rejected', 'Needs review'] as const;
export type CollectionStatus = typeof COLLECTION_STATUSES[number];

export type PaymentMethod = 'cash' | 'mobile_money';
export type SyncState = 'local' | 'queued' | 'syncing' | 'succeeded' | 'failed' | 'conflict';

export interface FieldCollectionRecord {
  localId: string;
  idempotencyKey: string;
  clientId: string;
  loanId: string;
  scheduleId?: string;
  branchId: string;
  collectorId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: CollectionStatus;
  syncState: SyncState;
  deviceId: string;
  receiptReference?: string;
  correlationId: string;
  capturedAt: string;
  updatedAt: string;
  syncedAt?: string;
  retryCount: number;
  lastError?: string;
}

export interface CollectionBatch {
  localId: string;
  idempotencyKey: string;
  branchId: string;
  collectorId: string;
  deviceId: string;
  collectionDate: string;
  recordIds: string[];
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
  status: CollectionStatus;
  syncState: SyncState;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
  retryCount: number;
  lastError?: string;
}

export interface QueueSnapshot {
  records: FieldCollectionRecord[];
  batches: CollectionBatch[];
  lastProcessedAt?: string;
  metrics?: QueueMetrics;
}

export interface QueueMetrics {
  queued: number;
  syncing: number;
  rejected: number;
  conflict: number;
}
