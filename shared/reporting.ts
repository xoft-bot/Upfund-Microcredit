export interface ReportingFilters {
  asOf: string;
  from: string;
  to: string;
  branchId: string | null;
}

export interface ReportingParMetric {
  amount: number;
  ratio: number;
  loanCount: number;
}

export interface ManagerReportingSummary {
  portfolioOutstanding: number;
  activeLoans: number;
  scheduledAmount: number;
  realizedDueAmount: number;
  collectionEfficiency: number;
  par30: ReportingParMetric;
  par60: ReportingParMetric;
  par90: ReportingParMetric;
  disbursementCount: number;
  disbursementAmount: number;
}

export interface DailyCollectionSummary {
  date: string;
  reconciledCount: number;
  reconciledAmount: number;
  pendingCount: number;
  pendingAmount: number;
}

export interface CollectionBreakdown {
  date: string;
  branchId: string;
  branchName: string;
  collectorId: string | null;
  collectorName: string;
  paymentMethod: string;
  reconciledCount: number;
  reconciledAmount: number;
  pendingCount: number;
  pendingAmount: number;
}

export interface BranchPerformance {
  branchId: string;
  branchName: string;
  outstandingPrincipal: number;
  disbursementCount: number;
  disbursementAmount: number;
  reconciledCollections: number;
  pendingCollections: number;
  openReconciliations: number;
  collectionEfficiency: number;
}

export interface ReportingAllocationSummary {
  postedAmount: number;
  principalRecovery: number;
  realizedInterest: number;
  realizedPenalty: number;
  realizedRevenue: number;
  overpaymentLiability: number;
  heldOverpaymentBalance: number;
}

export interface OpenReconciliation {
  id: string;
  batchReference: string;
  branchId: string;
  branchName: string;
  collectionDate: string;
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
  variance: number;
  status: string;
  submittedBy: string;
  submittedByName: string | null;
}

export interface ManagerReportingSnapshot {
  filters: ReportingFilters;
  summary: ManagerReportingSummary;
  dailyCollections: DailyCollectionSummary[];
  collectionBreakdown: CollectionBreakdown[];
  branchPerformance: BranchPerformance[];
  allocations: ReportingAllocationSummary;
  openReconciliations: {
    count: number;
    recordedAmount: number;
    variance: number;
    batches: OpenReconciliation[];
  };
}

export interface AccountantJournalLine {
  id: string;
  accountCode: string;
  side: 'debit' | 'credit';
  amount: number;
  currency: string;
}

export interface AccountantJournalEntry {
  transactionId: string;
  sourceType: string;
  sourceId: string;
  branchId: string | null;
  branchName: string | null;
  postedAt: string;
  postedBy: string;
  postedByName: string | null;
  description: string;
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  lines: AccountantJournalLine[];
}

export interface AccountantWaterfallAllocation {
  paymentId: string;
  loanId: string;
  branchId: string;
  branchName: string;
  postedAt: string;
  amount: number;
  principalRecovery: number;
  realizedInterest: number;
  realizedPenalty: number;
  overpaymentLiability: number;
  allocationDelta: number;
}

export interface AccountantWaterfallTotals {
  postedAmount: number;
  principalRecovery: number;
  realizedInterest: number;
  realizedPenalty: number;
  overpaymentLiability: number;
  allocationDelta: number;
}

export interface AccountantTrialBalanceLine {
  accountCode: string;
  debitTotal: number;
  creditTotal: number;
  netBalance: number;
}

export interface AccountantReconciliationAudit {
  reconciliationId: string;
  batchReference: string;
  branchId: string;
  branchName: string;
  collectionDate: string;
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
  variance: number;
  status: string;
  submittedBy: string;
  submittedByName: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  auditAction: string | null;
  auditAt: string | null;
}

export interface AccountantReportingSnapshot {
  filters: ReportingFilters;
  branches: Array<{ branchId: string; branchName: string }>;
  journalEntries: AccountantJournalEntry[];
  waterfallAllocations: AccountantWaterfallAllocation[];
  waterfallTotals: AccountantWaterfallTotals;
  trialBalance: AccountantTrialBalanceLine[];
  reconciliationOverrides: AccountantReconciliationAudit[];
  varianceLogs: AccountantReconciliationAudit[];
}

export interface CollectorReportingFilters {
  asOf: string;
  from: string;
  to: string;
  branchId: string | null;
  collectorId: string | null;
}

export interface CollectorTargetProgress {
  targetAmount: number;
  actualAmount: number;
  pendingAmount: number;
  progressPercent: number;
  scheduledClientCount: number;
  overdueClientCount: number;
}

export interface CollectorRouteMetric {
  routeCode: string;
  assignedClientCount: number;
  targetAmount: number;
  actualAmount: number;
  pendingAmount: number;
  progressPercent: number;
}

export interface CollectorSchedule {
  scheduleId: string;
  clientId: string;
  clientName: string;
  loanId: string;
  dueOn: string;
  amountDue: number;
  amountPaid: number;
  remainingAmount: number;
  status: string;
  routeCode: string;
}

export interface CollectorOverdueAccount {
  clientId: string;
  clientName: string;
  loanId: string;
  oldestDueOn: string;
  daysOverdue: number;
  overdueAmount: number;
  routeCode: string;
}

export interface CollectorPaymentMethodSummary {
  paymentMethod: string;
  postedCount: number;
  postedAmount: number;
  pendingCount: number;
  pendingAmount: number;
}

export interface CollectorOfflineQueueItem {
  id: string;
  localId: string;
  clientId: string;
  clientName: string;
  loanId: string | null;
  routeCode: string;
  amount: number;
  capturedAt: string;
  status: string;
  syncStatus: 'queued' | 'pending_reconciliation' | 'posted' | 'verified' | 'reversed';
  paymentMethod: string;
  receiptReference: string | null;
  syncedAt: string | null;
}

export interface CollectorReportingSnapshot {
  filters: CollectorReportingFilters;
  targetProgress: CollectorTargetProgress;
  routes: CollectorRouteMetric[];
  assignedClientSchedules: CollectorSchedule[];
  overdueWatchlist: CollectorOverdueAccount[];
  paymentMethods: CollectorPaymentMethodSummary[];
  offlineQueue: CollectorOfflineQueueItem[];
}