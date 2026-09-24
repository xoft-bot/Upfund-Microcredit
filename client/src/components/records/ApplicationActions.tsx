import { useState, type FormEvent } from 'react';
import { APPROVE_REASON, KYC_METHODS, applicationActions, validateRisk } from '../../lib/lifecycle.js';
import { assessApplicationRisk, decideApplication, reviewApplicationKyc, submitLoanApplication } from '../../services/api.js';
import { useAction } from './useAction.js';

interface Props { id: string; status: string; permissions: readonly string[]; getToken: () => Promise<string>; onDone: () => void }

export function ApplicationActions({ id, status, permissions, getToken, onDone }: Props) {
  const actions = applicationActions(status, permissions);
  const { busy, error, notice, run } = useAction(getToken, onDone);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approveReason, setApproveReason] = useState(APPROVE_REASON);
  const [kycStatus, setKycStatus] = useState<'verified' | 'rejected'>('verified');
  const [kycMethod, setKycMethod] = useState(KYC_METHODS[0]!.id);
  const [kycNotes, setKycNotes] = useState('');
  const [risk, setRisk] = useState({ score: '', grade: '', policy: '', rationale: '' });
  const [formError, setFormError] = useState('');

  const submitKyc = (event: FormEvent) => {
    event.preventDefault();
    if (!kycNotes.trim()) { setFormError('Record what was verified and where the evidence is stored.'); return; }
    setFormError('');
    void run((token) => reviewApplicationKyc(id, { status: kycStatus, verificationMethod: kycMethod, evidenceNotes: kycNotes }, token), 'KYC review recorded.').then((ok) => { if (ok) setKycNotes(''); });
  };
  const submitRisk = (event: FormEvent) => {
    event.preventDefault();
    const problem = validateRisk(risk);
    if (problem) { setFormError(problem); return; }
    setFormError('');
    void run((token) => assessApplicationRisk(id, { score: Number(risk.score), riskGrade: risk.grade, status: 'approved', policyVersion: risk.policy, rationale: risk.rationale }, token), 'Risk assessment recorded.').then((ok) => { if (ok) setRisk({ score: '', grade: '', policy: '', rationale: '' }); });
  };
  const approve = () => {
    if (!approveReason.trim()) { setFormError('A reason is required to approve.'); return; }
    setFormError('');
    void run((token) => decideApplication(id, { decision: 'approve', reason: approveReason }, token), 'Application approved and loan account created.').then(() => setConfirmApprove(false));
  };

  return (
    <div className="act">
      {notice && <p className="act-notice" role="status">{notice}</p>}
      {(error || formError) && <p className="form-error" role="alert">{error || formError}</p>}
      {actions.length === 0 && <p className="note">No actions are available to you at this stage.</p>}

      {actions.includes('submit') && (
        <div className="act-block">
          <p className="note">This draft has not been submitted for review.</p>
          <button className="primary-button" type="button" disabled={busy} onClick={() => void run((token) => submitLoanApplication(id, token), 'Application submitted for review.')}>Submit application</button>
        </div>
      )}

      {actions.includes('kyc') && (
        <form className="act-form" onSubmit={submitKyc}>
          <h3>Controlled KYC review</h3>
          <label>Decision<select value={kycStatus} onChange={(event) => setKycStatus(event.target.value as 'verified' | 'rejected')}><option value="verified">Verified</option><option value="rejected">Rejected</option></select></label>
          <label>Verification method<select value={kycMethod} onChange={(event) => setKycMethod(event.target.value)}>{KYC_METHODS.map((method) => <option key={method.id} value={method.id}>{method.label}</option>)}</select></label>
          <label>Evidence and notes<textarea value={kycNotes} onChange={(event) => setKycNotes(event.target.value)} placeholder="Record what was verified and where evidence is stored." /></label>
          <button className="primary-button" type="submit" disabled={busy}>{kycStatus === 'verified' ? 'Verify KYC' : 'Reject KYC'}</button>
        </form>
      )}

      {actions.includes('risk') && (
        <form className="act-form" onSubmit={submitRisk}>
          <h3>Controlled risk assessment</h3>
          <label>Score (0 to 100)<input type="number" inputMode="numeric" min={0} max={100} step={1} value={risk.score} onChange={(event) => setRisk({ ...risk, score: event.target.value })} /></label>
          <label>Risk grade<input value={risk.grade} maxLength={20} placeholder="A, B, C…" onChange={(event) => setRisk({ ...risk, grade: event.target.value })} /></label>
          <label>Policy version<input value={risk.policy} maxLength={64} placeholder="Credit policy version" onChange={(event) => setRisk({ ...risk, policy: event.target.value })} /></label>
          <label>Rationale<textarea value={risk.rationale} placeholder="Explain the assessment and decision basis." onChange={(event) => setRisk({ ...risk, rationale: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={busy}>Record risk assessment</button>
        </form>
      )}

      {actions.includes('approve') && (
        <div className="act-block">
          <p className="note">Approving creates the loan account. This cannot be undone from here.</p>
          {!confirmApprove ? (
            <button className="primary-button" type="button" disabled={busy} onClick={() => setConfirmApprove(true)}>Approve application</button>
          ) : (
            <div className="act-form">
              <label>Reason (kept in the audit trail)<textarea value={approveReason} onChange={(event) => setApproveReason(event.target.value)} /></label>
              <div className="act-row">
                <button className="primary-button" type="button" disabled={busy} onClick={approve}>Confirm approval</button>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmApprove(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
