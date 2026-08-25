import { assertApplicationTransition, assertKycTransition, assertLoanTransition } from './state-machines.js';

export interface WorkflowState {
  kyc: 'pending' | 'verified' | 'rejected';
  application: 'draft' | 'submitted' | 'kyc_verified' | 'risk_assessed' | 'approved' | 'rejected';
  loan: 'approved' | 'disbursed' | 'active' | 'overdue' | 'defaulted' | 'written_off' | 'completed';
}

export function submitApplication(state: WorkflowState): WorkflowState {
  assertApplicationTransition(state.application, 'submitted');
  return { ...state, application: 'submitted' };
}

export function verifyClientKyc(state: WorkflowState): WorkflowState {
  assertKycTransition(state.kyc, 'verified');
  assertApplicationTransition(state.application, 'kyc_verified');
  return { ...state, kyc: 'verified', application: 'kyc_verified' };
}

export function assessAndApprove(state: WorkflowState): WorkflowState {
  assertApplicationTransition(state.application, 'risk_assessed');
  assertApplicationTransition('risk_assessed', 'approved');
  return { ...state, application: 'approved' };
}

export function disburseLoan(state: WorkflowState): WorkflowState {
  assertLoanTransition(state.loan, 'disbursed');
  return { ...state, loan: 'disbursed' };
}
