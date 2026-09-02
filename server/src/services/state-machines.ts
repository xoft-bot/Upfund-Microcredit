export type KycStatus = 'pending' | 'verified' | 'rejected';
export type ApplicationStatus = 'draft' | 'submitted' | 'kyc_verified' | 'risk_assessed' | 'approved' | 'rejected';
export type LoanStatus = 'approved' | 'disbursed' | 'active' | 'overdue' | 'defaulted' | 'written_off' | 'completed';
export type PaymentStatus = 'recorded' | 'pending_reconciliation' | 'verified' | 'posted' | 'reversed';
export type ReconciliationStatus = 'pending' | 'matched' | 'variance' | 'approved';

type TransitionMap<T extends string> = Record<T, readonly T[]>;

const kycTransitions: TransitionMap<KycStatus> = { pending: ['verified', 'rejected'], verified: [], rejected: [] };
const applicationTransitions: TransitionMap<ApplicationStatus> = { draft: ['submitted'], submitted: ['kyc_verified', 'rejected'], kyc_verified: ['risk_assessed', 'rejected'], risk_assessed: ['approved', 'rejected'], approved: [], rejected: [] };
const loanTransitions: TransitionMap<LoanStatus> = { approved: ['disbursed'], disbursed: ['active'], active: ['overdue', 'completed'], overdue: ['active', 'defaulted', 'completed'], defaulted: ['written_off', 'active'], written_off: ['completed'], completed: [] };
const paymentTransitions: TransitionMap<PaymentStatus> = { recorded: ['pending_reconciliation', 'reversed'], pending_reconciliation: ['verified', 'reversed'], verified: ['posted', 'reversed'], posted: ['reversed'], reversed: [] };
const reconciliationTransitions: TransitionMap<ReconciliationStatus> = { pending: ['matched', 'variance'], matched: ['approved'], variance: ['approved'], approved: [] };

export function assertTransition<T extends string>(map: TransitionMap<T>, current: T, next: T): void {
  if (!map[current].includes(next)) throw new Error(`INVALID_STATE_TRANSITION:${current}:${next}`);
}

export const assertKycTransition = (current: KycStatus, next: KycStatus) => assertTransition(kycTransitions, current, next);
export const assertApplicationTransition = (current: ApplicationStatus, next: ApplicationStatus) => assertTransition(applicationTransitions, current, next);
export const assertLoanTransition = (current: LoanStatus, next: LoanStatus) => assertTransition(loanTransitions, current, next);
export const assertPaymentTransition = (current: PaymentStatus, next: PaymentStatus) => assertTransition(paymentTransitions, current, next);
export const assertReconciliationTransition = (current: ReconciliationStatus, next: ReconciliationStatus) => assertTransition(reconciliationTransitions, current, next);
