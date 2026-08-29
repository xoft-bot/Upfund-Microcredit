export interface ApiEnvelope<T> { ok: boolean; data?: T; error?: { code?: string; message?: string }; correlationId?: string; version?: string; }
export interface PaymentCommand {
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
export interface PaymentResult {
  paymentId: string;
  receiptReference: string;
  principalAmount: number;
  penaltyAmount: number;
  interestAmount: number;
  chargeAmount: number;
  overpaymentAmount: number;
  outstandingPrincipal: number;
  loanStatus: string;
  ledgerTransactionId: string;
  created: boolean;
}
export interface ReconciliationCommand { branchId: string; batchReference: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; paymentIds: string[]; policyVersion: string; managerOverride: boolean; }
export interface ReconciliationResult { reconciliationId: string; status: string; variance: number; }
export interface CollectionRecordResult {
  id: string;
  localId: string;
  idempotencyKey: string;
  branchId: string;
  paymentId: string | null;
  clientId: string | null;
  clientName: string | null;
  loanId: string | null;
  collectorId: string | null;
  amount: number;
  status: string;
  deviceId: string;
  paymentMethod: string | null;
  receiptReference: string | null;
  principalAmount: number;
  penaltyAmount: number;
  interestAmount: number;
  overpaymentAmount: number;
  capturedAt: string;
  createdAt: string;
  syncedAt: string | null;
}
export interface ReconciliationQueuePayment { paymentId: string; clientId: string | null; amount: number; receiptReference: string | null; status: string; principalAmount: number; penaltyAmount: number; interestAmount: number; overpaymentAmount: number; }
export interface ReconciliationQueueBatch { id: string; batchReference: string; branchId: string; collectionDate: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; variance: number; status: string; submittedBy: string; submittedByName: string | null; payments: ReconciliationQueuePayment[]; }
export interface HealthResult { service: string; database: string; }

export class ApiRequestError extends Error {
  readonly code: string;
  readonly correlationId?: string;
  readonly status: number;
  constructor(code: string, message: string, correlationId?: string, status = 0) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.correlationId = correlationId;
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.ok || body.data === undefined) throw new ApiRequestError(body.error?.code ?? 'API_REQUEST_FAILED', body.error?.message ?? 'API request failed', body.correlationId, response.status);
  return body.data;
}

export function getHealth(): Promise<HealthResult> { return request<HealthResult>('/health'); }
export function postPayment(command: PaymentCommand, token?: string, apiBaseUrl = '', correlationId: string = crypto.randomUUID()): Promise<PaymentResult> { return request<PaymentResult>(`${apiBaseUrl}/api/v1/payments`, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-correlation-id': correlationId }, body: JSON.stringify(command) }); }
export function postReconciliation(command: ReconciliationCommand, token: string, apiBaseUrl = ''): Promise<ReconciliationResult> { return request<ReconciliationResult>(`${apiBaseUrl}/api/v1/reconciliations/post-batch`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-correlation-id': crypto.randomUUID() }, body: JSON.stringify(command) }); }
export function getCollectionQueue(token: string, options: { branchId?: string; collectorId?: string; apiBaseUrl?: string } = {}): Promise<{ records: CollectionRecordResult[] }> {
  const params = new URLSearchParams();
  if (options.branchId) params.set('branchId', options.branchId);
  if (options.collectorId) params.set('collectorId', options.collectorId);
  return request<{ records: CollectionRecordResult[] }>(`${options.apiBaseUrl ?? ''}/api/v1/collections/queue${params.size ? `?${params.toString()}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
}
export function getReconciliationQueue(token: string, options: { branchId?: string; apiBaseUrl?: string } = {}): Promise<{ batches: ReconciliationQueueBatch[] }> {
  const params = new URLSearchParams();
  if (options.branchId) params.set('branchId', options.branchId);
  return request<{ batches: ReconciliationQueueBatch[] }>(`${options.apiBaseUrl ?? ''}/api/v1/reconciliations/queue${params.size ? `?${params.toString()}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
}
