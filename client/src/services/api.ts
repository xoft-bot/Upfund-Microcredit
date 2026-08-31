import type { AccountantReportingSnapshot, ManagerReportingSnapshot } from '../../../shared/reporting.js';

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
export interface ReconciliationCommand { branchId: string; batchReference: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; paymentIds: string[]; policyVersion: string; managerOverride: boolean; decision?: 'approve' | 'reject'; decisionReason?: string; }
export interface ReconciliationResult { reconciliationId: string; status: string; variance: number; decisionReason?: string | null; created?: boolean; }
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
export interface ReconciliationQueueBatch { id: string; batchReference: string; branchId: string; collectionDate: string; expectedAmount: number; recordedAmount: number; submittedAmount: number; variance: number; status: string; decisionReason: string | null; reviewedAt: string | null; submittedBy: string; submittedByName: string | null; payments: ReconciliationQueuePayment[]; }
export interface HealthResult { service: string; database: string; }
export interface SessionProfile { userId: string; firebaseUid: string; role: string; branchId: string | null; clientId: string | null; permissions: string[]; }
export interface PortalApplication { id: string; clientId: string; clientName: string; productName: string; branchId: string; requestedAmount: number; status: string; createdAt: string; submittedAt: string | null; }
export interface PortalLoan { id: string; clientId: string; clientName: string; branchId: string; principalAmount: number; outstandingPrincipal: number; status: string; createdAt: string; }
export interface PortalClient { id: string; externalRef: string; displayName: string; branchId: string; createdAt: string; }
export interface PortalProduct { id: string; code: string; name: string; currency: string; active: boolean; }
export interface PortalOverview {
  role: string;
  metrics: { clients: number; applications: number; submittedApplications: number; activeLoans: number; outstandingPrincipal: number; products: number };
  applications: PortalApplication[];
  loans: PortalLoan[];
  clients: PortalClient[];
  products: PortalProduct[];
}
export interface CreateClientCommand { branchId: string; externalRef: string; displayName: string; }
export interface CreateApplicationCommand { clientId: string; productId: string; branchId?: string; requestedAmount: number; }

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
export function getSession(token: string): Promise<SessionProfile> { return request<SessionProfile>('/api/v1/session', { headers: { authorization: `Bearer ${token}` } }); }
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
export function getManagerReport(token: string, options: { branchId?: string; asOf?: string; from?: string; to?: string } = {}): Promise<ManagerReportingSnapshot> {
  const params = new URLSearchParams();
  if (options.branchId) params.set('branchId', options.branchId);
  if (options.asOf) params.set('asOf', options.asOf);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  return request<ManagerReportingSnapshot>(`/api/v1/reports/manager${params.size ? `?${params.toString()}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
}
export function getAccountantReport(token: string, options: { branchId?: string; asOf?: string; from?: string; to?: string } = {}): Promise<AccountantReportingSnapshot> {
  const params = new URLSearchParams();
  if (options.branchId) params.set('branchId', options.branchId);
  if (options.asOf) params.set('asOf', options.asOf);
  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);
  return request<AccountantReportingSnapshot>(`/api/v1/reports/accountant${params.size ? `?${params.toString()}` : ''}`, { headers: { authorization: `Bearer ${token}` } });
}
export function getPortalOverview(token: string): Promise<PortalOverview> {
  return request<PortalOverview>('/api/v1/portal/overview', { headers: { authorization: `Bearer ${token}` } });
}
export function createClient(command: CreateClientCommand, token: string): Promise<PortalClient> {
  return request<PortalClient>('/api/v1/clients', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
}
export function createLoanApplication(command: CreateApplicationCommand, token: string): Promise<PortalApplication> {
  return request<PortalApplication>('/api/v1/loan-applications', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
}
export function submitLoanApplication(id: string, token: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/api/v1/loan-applications/${id}/submit`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
}
export function reviewApplicationKyc(id: string, command: { status: 'verified' | 'rejected'; verificationMethod: string; reason?: string }, token: string): Promise<{ id: string; applicationStatus: string; kycStatus: string }> {
  return request<{ id: string; applicationStatus: string; kycStatus: string }>(`/api/v1/loan-applications/${id}/kyc`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
}
export function assessApplicationRisk(id: string, command: { score: number; riskGrade: string; status: 'approved' | 'declined'; policyVersion: string }, token: string): Promise<{ id: string; applicationStatus: string; riskStatus: string }> {
  return request<{ id: string; applicationStatus: string; riskStatus: string }>(`/api/v1/loan-applications/${id}/risk`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
}
export function decideApplication(id: string, command: { decision: 'approve' | 'reject'; reason: string }, token: string): Promise<{ id: string; status: string; loanId?: string }> {
  return request<{ id: string; status: string; loanId?: string }>(`/api/v1/loan-applications/${id}/decision`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
}
export function disburseLoan(id: string, command: { disbursementReference: string; idempotencyKey: string }, token: string): Promise<{ loanId: string; status: string; disbursementReference: string; amount: number; created: boolean }> {
  return request<{ loanId: string; status: string; disbursementReference: string; amount: number; created: boolean }>(`/api/v1/loans/${id}/disburse`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(command) });
}
