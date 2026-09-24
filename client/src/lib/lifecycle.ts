// Lifecycle rules, copied from the classic PortalDashboard so behavior is unchanged.
// The server remains the authority; this only decides which controls to render.

export type ApplicationAction = 'submit' | 'kyc' | 'risk' | 'approve';

export const APPROVE_REASON = 'Application passed the recorded KYC and risk review.';
export const KYC_METHODS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'national_id_check', label: 'National ID check' },
  { id: 'site_visit', label: 'Site visit' },
  { id: 'employer_reference', label: 'Employer reference' },
  { id: 'document_review', label: 'Document review' },
];

export function applicationActions(status: string, permissions: readonly string[]): ApplicationAction[] {
  const has = (permission: string) => permissions.includes(permission);
  const actions: ApplicationAction[] = [];
  if (status === 'draft' && has('applications.submit')) actions.push('submit');
  if (status === 'submitted' && has('kyc.review')) actions.push('kyc');
  if (status === 'kyc_verified' && has('risk.assess')) actions.push('risk');
  if (status === 'risk_assessed' && has('loans.approve')) actions.push('approve');
  return actions;
}

/** Classic view offered Disburse to admin and manager on loans in status "approved". */
export function canDisburse(role: string, status: string): boolean {
  return (role === 'admin' || role === 'manager') && status === 'approved';
}

/** Same reference and idempotency key the classic view used, so a retry can never disburse twice. */
export function disbursePayload(loanId: string): { disbursementReference: string; idempotencyKey: string } {
  return { disbursementReference: `DSB-${loanId.slice(0, 8)}`, idempotencyKey: `disburse-${loanId}` };
}

export interface RiskInput { score: string; grade: string; policy: string; rationale: string }
export function validateRisk(input: RiskInput): string | null {
  const score = Number(input.score);
  if (input.score.trim() === '' || !Number.isInteger(score) || score < 0 || score > 100) return 'Score must be a whole number from 0 to 100.';
  if (!input.grade.trim() || input.grade.length > 20) return 'Enter a risk grade (up to 20 characters).';
  if (!input.policy.trim() || input.policy.length > 64) return 'Enter the policy version (up to 64 characters).';
  if (!input.rationale.trim()) return 'Explain the assessment and decision basis.';
  return null;
}
