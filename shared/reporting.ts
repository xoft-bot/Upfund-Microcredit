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