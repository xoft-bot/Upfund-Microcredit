#!/usr/bin/env bash
# Phase 3c installer. Run from the repo root: bash apply-3c.sh
set -euo pipefail
if [ ! -f package.json ] || [ ! -d client/src/pages ]; then echo "Run this from the repo root (where package.json is)."; exit 1; fi
if [ ! -f client/src/pages/ApplicationRecord.tsx ]; then echo "Phase 3b is not on this branch. Merge phase3b-records into main first."; exit 1; fi

mkdir -p "$(dirname "client/src/lib/lifecycle.ts")"
cat > "client/src/lib/lifecycle.ts" << 'UPFUND_EOF_0'
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
UPFUND_EOF_0
echo "wrote client/src/lib/lifecycle.ts"

mkdir -p "$(dirname "client/src/components/records/useAction.ts")"
cat > "client/src/components/records/useAction.ts" << 'UPFUND_EOF_1'
import { useState } from 'react';
import { ApiRequestError } from '../../services/api.js';

export function actionErrorText(error: unknown): string {
  if (error instanceof ApiRequestError) return `${error.message} (${error.code})`;
  return 'The action could not be completed. Check your connection and try again.';
}

/** One in-flight action at a time. On success the caller refetches the record. */
export function useAction(getToken: () => Promise<string>, onSuccess: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (operation: (token: string) => Promise<unknown>, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      await operation(await getToken());
      setNotice(success);
      onSuccess();
      return true;
    } catch (caught) {
      setError(actionErrorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, notice, run };
}
UPFUND_EOF_1
echo "wrote client/src/components/records/useAction.ts"

mkdir -p "$(dirname "client/src/components/records/ApplicationActions.tsx")"
cat > "client/src/components/records/ApplicationActions.tsx" << 'UPFUND_EOF_2'
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
UPFUND_EOF_2
echo "wrote client/src/components/records/ApplicationActions.tsx"

mkdir -p "$(dirname "client/src/components/records/LoanActions.tsx")"
cat > "client/src/components/records/LoanActions.tsx" << 'UPFUND_EOF_3'
import { useState } from 'react';
import { canDisburse, disbursePayload } from '../../lib/lifecycle.js';
import { disburseLoan } from '../../services/api.js';
import { Card } from './RecordFrame.js';
import { useAction } from './useAction.js';

interface Props { id: string; role: string; status: string; getToken: () => Promise<string>; onDone: () => void }

export function LoanActions({ id, role, status, getToken, onDone }: Props) {
  const { busy, error, notice, run } = useAction(getToken, onDone);
  const [confirm, setConfirm] = useState(false);
  const allowed = canDisburse(role, status);
  const payload = disbursePayload(id);

  if (!allowed && !notice && !error) return null;
  return (
    <Card title="Actions" wide>
    <div className="act">
      {notice && <p className="act-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {allowed && (
        <div className="act-block">
          <p className="note">Disbursement moves money out and generates the repayment schedule. Reference {payload.disbursementReference}. Retrying is safe: the same request cannot disburse twice.</p>
          {!confirm ? (
            <button className="primary-button" type="button" disabled={busy} onClick={() => setConfirm(true)}>Disburse loan</button>
          ) : (
            <div className="act-row">
              <button className="primary-button" type="button" disabled={busy} onClick={() => void run((token) => disburseLoan(id, payload, token), 'Loan disbursed.').then(() => setConfirm(false))}>Confirm disbursement</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
    </Card>
  );
}
UPFUND_EOF_3
echo "wrote client/src/components/records/LoanActions.tsx"

mkdir -p "$(dirname "client/src/components/records/RecordFrame.tsx")"
cat > "client/src/components/records/RecordFrame.tsx" << 'UPFUND_EOF_4'
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError } from '../../services/api.js';
import { StatusPill } from '../lists/QueueList.js';

export function recordErrorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 404 || /NOT_FOUND$/.test(error.code)) return 'This record was not found, or it is outside your access.';
    if (error.code === 'FORBIDDEN' || error.status === 403) return 'Your role cannot view this record.';
    return `${error.message} (${error.code})`;
  }
  return 'Could not load this record. Check your connection and try again.';
}

export interface RecordState<T> { data: T | null; error: string; loading: boolean }

/**
 * Loads one record. Stale responses are dropped. Changing `key` (a different record) resets to loading;
 * bumping `version` (after an action) refetches silently and keeps the current data on screen.
 */
export function useRecord<T>(getToken: () => Promise<string>, load: (token: string) => Promise<T>, key: string, version = 0): RecordState<T> {
  const [state, setState] = useState<RecordState<T>>({ data: null, error: '', loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastKey = useRef(key);
  useEffect(() => {
    let active = true;
    const sameRecord = lastKey.current === key;
    lastKey.current = key;
    setState((previous) => (sameRecord && previous.data ? { ...previous, error: '' } : { data: null, error: '', loading: true }));
    void (async () => {
      try {
        const data = await loadRef.current(await getToken());
        if (active) setState({ data, error: '', loading: false });
      } catch (caught) {
        if (active) setState((previous) => ({ data: sameRecord ? previous.data : null, error: recordErrorText(caught), loading: false }));
      }
    })();
    return () => { active = false; };
  }, [key, version, getToken]);
  return state;
}

interface FrameProps { title: string; subtitle?: string; status?: unknown; backTo: string; backLabel: string; children: ReactNode }

export function RecordFrame({ title, subtitle, status, backTo, backLabel, children }: FrameProps) {
  return (
    <section className="rec">
      <Link className="rec-back" to={backTo}>← {backLabel}</Link>
      <div className="rec-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="rec-sub">{subtitle}</p>}
        </div>
        {status !== undefined && <StatusPill status={status} />}
      </div>
      {children}
    </section>
  );
}

export function LoadState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <p className="empty-state" role="status">Loading…</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  return null;
}

export function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return <section className={`rec-card${wide ? ' is-wide' : ''}`}><h2>{title}</h2>{children}</section>;
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="rec-facts">
      {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === '' || value === null || value === undefined ? '–' : value}</dd></div>)}
    </dl>
  );
}
UPFUND_EOF_4
echo "wrote client/src/components/records/RecordFrame.tsx"

mkdir -p "$(dirname "client/src/components/records/AuditPanel.tsx")"
cat > "client/src/components/records/AuditPanel.tsx" << 'UPFUND_EOF_5'
import { getAuditTrail, type Paged } from '../../services/api.js';
import { formatDateTime, humanize, str } from '../../lib/format.js';
import { Card, useRecord } from './RecordFrame.js';

/** Read-only trail for one record. Metadata is deliberately not shown (may contain personal data). */
export function AuditPanel({ entityId, getToken, version = 0 }: { entityId: string; getToken: () => Promise<string>; version?: number }) {
  const { data, error, loading } = useRecord<Paged>(getToken, (token) => getAuditTrail(token, { entityId, pageSize: 20 }), `audit:${entityId}`, version);
  return (
    <Card title="Audit trail" wide>
      {loading && <p className="note">Loading…</p>}
      {error && <p className="note">Audit trail unavailable for your role.</p>}
      {data && data.items.length === 0 && <p className="note">No audit events recorded for this record.</p>}
      {data && data.items.length > 0 && (
        <ul className="rec-timeline">
          {data.items.map((row) => (
            <li key={str(row.id)}>
              <strong>{humanize(row.action)}</strong>
              <span>{str(row.actorName) || 'System'} · {formatDateTime(row.createdAt)}</span>
              {str(row.correlationId) && <small>Ref {str(row.correlationId).slice(0, 8)}</small>}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && <p className="note">Showing the latest {data.items.length} of {data.total}.</p>}
    </Card>
  );
}
UPFUND_EOF_5
echo "wrote client/src/components/records/AuditPanel.tsx"

mkdir -p "$(dirname "client/src/pages/ApplicationRecord.tsx")"
cat > "client/src/pages/ApplicationRecord.tsx" << 'UPFUND_EOF_6'
import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { ApplicationActions } from '../components/records/ApplicationActions.js';
import { AuditPanel } from '../components/records/AuditPanel.js';
import { Card, Facts, LoadState, RecordFrame, useRecord } from '../components/records/RecordFrame.js';
import { canAccess, canViewAudit } from '../config/navConfig.js';
import { formatDateTime, formatUgx, humanize, str } from '../lib/format.js';
import { getApplicationTimeline, getLoanApplicationRecord, type ApplicationTimelineEntry, type ListRow } from '../services/api.js';

export default function ApplicationRecord() {
  const { id = '' } = useParams();
  const { role, getToken, permissions } = useOutletContext<ShellOutletContext>();
  const [version, setVersion] = useState(0);
  const record = useRecord<ListRow>(getToken, (token) => getLoanApplicationRecord(id, token), `app:${id}`, version);
  const timeline = useRecord<ApplicationTimelineEntry[]>(getToken, (token) => getApplicationTimeline(id, token), `timeline:${id}`, version);
  const row = record.data;

  if (!row) return <RecordFrame title="Application" backTo="/applications" backLabel="Applications"><LoadState loading={record.loading} error={record.error} /></RecordFrame>;

  const clientLink = canAccess(role, '/clients') && str(row.clientId) ? <Link to={`/clients/${encodeURIComponent(str(row.clientId))}`}>{str(row.clientName) || str(row.clientId)}</Link> : (str(row.clientName) || '–');
  return (
    <RecordFrame title={`${str(row.clientName) || 'Application'}: ${formatUgx(row.requestedAmount)}`} subtitle={str(row.productName)} status={row.status} backTo="/applications" backLabel="Applications">
      <div className="rec-grid">
        <Card title="Application">
          <Facts items={[
            ['Client', clientLink],
            ['Client reference', str(row.clientExternalRef)],
            ['Product', str(row.productName)],
            ['Requested', formatUgx(row.requestedAmount)],
            ['Branch', str(row.branchId).slice(0, 8)],
            ['Created', formatDateTime(row.createdAt)],
            ['Submitted', row.submittedAt ? formatDateTime(row.submittedAt) : 'Not yet'],
          ]} />
        </Card>
        <Card title="KYC">
          {str(row.kycId) ? <Facts items={[['Status', humanize(row.kycStatus)], ['Method', str(row.verificationMethod) || str(row.kycVerificationMethod)], ['Evidence notes', str(row.kycEvidenceNotes)]]} /> : <p className="note">No KYC review recorded yet.</p>}
        </Card>
        <Card title="Risk assessment">
          {str(row.riskId) ? <Facts items={[['Outcome', humanize(row.riskStatus)], ['Grade', str(row.riskGrade)], ['Score', str(row.riskScore)], ['Policy version', str(row.riskPolicyVersion)], ['Rationale', str(row.riskRationale)]]} /> : <p className="note">No risk assessment recorded yet.</p>}
        </Card>
        <Card title="Timeline" wide>
          <LoadState loading={timeline.loading} error={timeline.error} />
          {timeline.data && timeline.data.length === 0 && <p className="note">No transitions recorded yet.</p>}
          {timeline.data && timeline.data.length > 0 && (
            <ul className="rec-timeline">
              {timeline.data.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.fromState ? `${humanize(entry.fromState)} → ${humanize(entry.toState)}` : humanize(entry.toState)}</strong>
                  <span>{formatDateTime(entry.createdAt)}</span>
                  {entry.reason && <small>{entry.reason}</small>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canViewAudit(role) && <AuditPanel entityId={id} getToken={getToken} version={version} />}
        <Card title="Actions" wide>
          <ApplicationActions id={id} status={str(row.status)} permissions={permissions} getToken={getToken} onDone={() => setVersion((current) => current + 1)} />
        </Card>
      </div>
    </RecordFrame>
  );
}
UPFUND_EOF_6
echo "wrote client/src/pages/ApplicationRecord.tsx"

mkdir -p "$(dirname "client/src/pages/LoanRecord.tsx")"
cat > "client/src/pages/LoanRecord.tsx" << 'UPFUND_EOF_7'
import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { StatusPill } from '../components/lists/QueueList.js';
import { AuditPanel } from '../components/records/AuditPanel.js';
import { LoanActions } from '../components/records/LoanActions.js';
import { Card, Facts, LoadState, RecordFrame, useRecord } from '../components/records/RecordFrame.js';
import { canAccess, canViewAudit } from '../config/navConfig.js';
import { formatAmount, formatDate, formatDateTime, formatUgx, str } from '../lib/format.js';
import { getLoanRecord, type ListRow } from '../services/api.js';

const asRows = (value: unknown): ListRow[] => (Array.isArray(value) ? (value as ListRow[]) : []);
const Pair = ({ paid, due }: { paid: unknown; due: unknown }) => <>{formatAmount(paid)} <small>of {formatAmount(due)}</small></>;

export default function LoanRecord() {
  const { id = '' } = useParams();
  const { role, getToken } = useOutletContext<ShellOutletContext>();
  const [version, setVersion] = useState(0);
  const record = useRecord<ListRow>(getToken, (token) => getLoanRecord(id, token), `loan:${id}`, version);
  const row = record.data;

  if (!row) return <RecordFrame title="Loan" backTo="/loans" backLabel="Loans"><LoadState loading={record.loading} error={record.error} /></RecordFrame>;

  const schedule = asRows(row.schedule);
  const payments = asRows(row.payments);
  const clientLink = canAccess(role, '/clients') && str(row.clientId) ? <Link to={`/clients/${encodeURIComponent(str(row.clientId))}`}>{str(row.clientName) || str(row.clientId)}</Link> : (str(row.clientName) || '–');
  const applicationLink = canAccess(role, '/applications') && str(row.applicationId) ? <Link to={`/applications/record/${encodeURIComponent(str(row.applicationId))}`}>Open application</Link> : '';

  return (
    <RecordFrame title={`${str(row.clientName) || 'Loan'}: ${formatUgx(row.outstandingPrincipal)} outstanding`} subtitle={`Principal ${formatUgx(row.principalAmount)}`} status={row.status} backTo="/loans" backLabel="Loans">
      <div className="rec-grid">
        <Card title="Loan">
          <Facts items={[
            ['Client', clientLink],
            ['Client reference', str(row.clientExternalRef)],
            ['Principal', formatUgx(row.principalAmount)],
            ['Outstanding principal', formatUgx(row.outstandingPrincipal)],
            ['Branch', str(row.branchId).slice(0, 8)],
            ['Created', formatDateTime(row.createdAt)],
            ['Application', applicationLink],
          ]} />
        </Card>

        <LoanActions id={id} role={role} status={str(row.status)} getToken={getToken} onDone={() => setVersion((current) => current + 1)} />

        <Card title={`Repayment schedule (${schedule.length})`} wide>
          {schedule.length === 0 ? <p className="note">No schedule yet. It is generated at disbursement.</p> : (
            <div className="ql-scroll"><table className="ql-table">
              <thead><tr><th scope="col">Due</th><th scope="col" className="num">Principal</th><th scope="col" className="num">Interest</th><th scope="col" className="num">Penalty</th><th scope="col" className="num">Charges</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {schedule.map((item) => (
                  <tr key={str(item.id)}>
                    <td data-label="Due">{formatDate(item.dueOn)}</td>
                    <td data-label="Principal" className="num"><Pair paid={item.principalPaid} due={item.principalDue} /></td>
                    <td data-label="Interest" className="num"><Pair paid={item.interestPaid} due={item.interestDue} /></td>
                    <td data-label="Penalty" className="num"><Pair paid={item.penaltyPaid} due={item.penaltyDue} /></td>
                    <td data-label="Charges" className="num"><Pair paid={item.chargePaid} due={item.chargeDue} /></td>
                    <td data-label="Status"><StatusPill status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="note">Amounts show paid of due, in UGX.</p>
        </Card>

        <Card title={`Payments (${payments.length})`} wide>
          {payments.length === 0 ? <p className="note">No payments recorded.</p> : (
            <div className="ql-scroll"><table className="ql-table">
              <thead><tr><th scope="col">Receipt</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Recorded</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={str(payment.id)}>
                    <td data-label="Receipt">{str(payment.receiptReference) || '–'}</td>
                    <td data-label="Amount" className="num">{formatUgx(payment.amount)}</td>
                    <td data-label="Status"><StatusPill status={payment.status} /></td>
                    <td data-label="Recorded">{formatDateTime(payment.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>

        {canViewAudit(role) && <AuditPanel entityId={id} getToken={getToken} version={version} />}
      </div>
    </RecordFrame>
  );
}
UPFUND_EOF_7
echo "wrote client/src/pages/LoanRecord.tsx"

mkdir -p "$(dirname "client/src/components/shell/AppShell.tsx")"
cat > "client/src/components/shell/AppShell.tsx" << 'UPFUND_EOF_8'
import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import type { AuthIdentity } from '../../services/firebase.js';
import { useQueueCounts, type QueueCountsState } from '../../hooks/useQueueCounts.js';
import { breadcrumbsFor, countFor, countsEnabled, hasBottomBar, hasSearch, isRole, navFor, type NavItem, type Role } from '../../config/navConfig.js';
import { GlobalSearch } from './GlobalSearch.js';

export interface ShellProps {
  identity: AuthIdentity;
  email?: string;
  backendLive: boolean;
  identityError: string;
  onSignOut: () => void;
  getToken: () => Promise<string>;
  versionLabel: string;
}
/** Passed to every route via <Outlet context>. Read it with useOutletContext<ShellOutletContext>(). */
export type ShellOutletContext = QueueCountsState & { role: Role; countsEnabled: boolean; getToken: () => Promise<string>; permissions: readonly string[] };

function Badge({ item, counts }: { item: NavItem; counts: QueueCountsState['counts'] }) {
  if (!item.badge) return null;
  const value = countFor(counts, item.badge);
  if (!value) return null;
  return <span className="nav-badge" aria-label={`${value} waiting`}>{value > 99 ? '99+' : value}</span>;
}

export function AppShell({ identity, email, backendLive, identityError, onSignOut, getToken, versionLabel }: ShellProps) {
  const role: Role = isRole(identity.role) ? identity.role : 'client';
  const items = navFor(role);
  const enabled = countsEnabled(role);
  const queueCounts = useQueueCounts(getToken, enabled);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawer(false); }, [location.pathname]);

  const crumbs = breadcrumbsFor(role, location.pathname);
  const bottomItems = hasBottomBar(role) ? items.slice(0, 4) : [];
  const context: ShellOutletContext = { ...queueCounts, role, countsEnabled: enabled, getToken, permissions: identity.permissions ?? [] };

  return (
    <div className={`app-shell${bottomItems.length ? ' has-bottom-bar' : ''}`}>
      <header className="topbar">
        <button className="topbar-menu" type="button" aria-label="Menu" aria-expanded={drawer} onClick={() => setDrawer((open) => !open)}>
          <span /><span /><span />
        </button>
        <Link className="topbar-brand" to="/">Upfund</Link>
        {hasSearch(role) && <GlobalSearch role={role} getToken={getToken} />}
        <div className="topbar-user">
          <span className="topbar-who">{email ?? identity.uid}</span>
          <span className="topbar-meta">{identity.role}, branch {identity.branchId ?? 'none'}</span>
        </div>
        <span className={`topbar-status${backendLive ? '' : ' is-down'}`} role="status" title={backendLive ? 'Backend live' : 'Backend unavailable'}>
          <span className="dot" />{backendLive ? 'Live' : 'Offline'}
        </span>
        <button className="topbar-signout" type="button" onClick={onSignOut}>Sign out</button>
      </header>

      <div className="shell-body">
        {drawer && <button className="drawer-scrim" type="button" aria-label="Close menu" onClick={() => setDrawer(false)} />}
        <nav className={`sidebar${drawer ? ' is-open' : ''}`} aria-label="Main">
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <NavLink to={item.path} end={item.path === '/' || item.id === 'classic'} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                  <span>{item.label}</span>
                  <Badge item={item} counts={queueCounts.counts} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shell-main">
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={crumb.path}>
                  {index === crumbs.length - 1 ? <span aria-current="page">{crumb.label}</span> : <Link to={crumb.path}>{crumb.label}</Link>}
                </li>
              ))}
            </ol>
          </nav>
          {identityError && <p className="form-error" role="status">{identityError}</p>}
          <div className="shell-content"><Outlet context={context} /></div>
          <footer className="footer">{versionLabel} · Backend: {backendLive ? 'Live' : 'Unavailable'}</footer>
        </div>
      </div>

      {bottomItems.length > 0 && (
        <nav className="bottombar" aria-label="Quick navigation">
          {bottomItems.map((item) => (
            <NavLink key={item.id} to={item.path} end={item.path === '/'} className={({ isActive }) => `bottombar-link${isActive ? ' is-active' : ''}`}>
              <span>{item.label}</span>
              <Badge item={item} counts={queueCounts.counts} />
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
UPFUND_EOF_8
echo "wrote client/src/components/shell/AppShell.tsx"

mkdir -p "$(dirname "client/src/shell.css")"
cat > "client/src/shell.css" << 'UPFUND_EOF_9'
/* Phase 2 shell. Scoped to .app-shell so the legacy styles.css is untouched. */
.app-shell {
  --sh-bg: #f2f4f0;
  --sh-surface: #ffffff;
  --sh-ink: #17261f;
  --sh-muted: #5d6b64;
  --sh-line: #d7ddd6;
  --sh-brand: #1d5c47;
  --sh-brand-ink: #ffffff;
  --sh-work: #b26a00;
  --sh-danger: #a4281f;
  --sh-top: 52px;
  min-height: 100vh;
  background: var(--sh-bg);
  color: var(--sh-ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.app-shell *, .app-shell *::before, .app-shell *::after { box-sizing: border-box; }
.app-shell a { color: var(--sh-brand); }
.app-shell :focus-visible { outline: 3px solid #e3a008; outline-offset: 2px; }

.topbar {
  position: sticky; top: 0; z-index: 30; height: var(--sh-top);
  display: flex; align-items: center; gap: 10px; padding: 0 12px;
  background: var(--sh-brand); color: var(--sh-brand-ink);
}
.topbar-brand { color: inherit !important; font-weight: 700; letter-spacing: .01em; text-decoration: none; }
.topbar-menu { display: none; width: 36px; height: 36px; border: 0; background: transparent; padding: 8px 7px; cursor: pointer; flex-direction: column; justify-content: space-between; }
.topbar-menu span { display: block; height: 2px; background: #fff; border-radius: 1px; }
.topbar-user { display: flex; flex-direction: column; line-height: 1.15; margin-left: auto; text-align: right; min-width: 0; }
.topbar-who { font-size: .8rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.topbar-meta { font-size: .7rem; opacity: .8; }
.topbar-status { display: inline-flex; align-items: center; gap: 5px; font-size: .75rem; }
.topbar-status .dot { width: 8px; height: 8px; border-radius: 50%; background: #7ee2a8; display: inline-block; }
.topbar-status.is-down .dot { background: #ffb4a8; }
.topbar-signout { border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff; border-radius: 6px; padding: 5px 10px; font: inherit; font-size: .8rem; cursor: pointer; }

.gs { position: relative; flex: 1 1 260px; max-width: 420px; }
.gs-input { width: 100%; height: 34px; border: 0; border-radius: 6px; padding: 0 10px; font: inherit; font-size: .9rem; color: var(--sh-ink); background: #fff; }
.gs-panel { position: absolute; left: 0; right: 0; top: 40px; max-height: 70vh; overflow: auto; background: var(--sh-surface); color: var(--sh-ink); border: 1px solid var(--sh-line); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.14); padding: 6px; }
.gs-panel ul { list-style: none; margin: 0; padding: 0; }
.gs-panel a { display: flex; flex-direction: column; padding: 8px; border-radius: 6px; text-decoration: none; color: var(--sh-ink); }
.gs-panel a:hover, .gs-panel a:focus-visible { background: #e8efe9; }
.gs-panel small { color: var(--sh-muted); }
.gs-group { margin: 8px 8px 2px; font-size: .78rem; font-weight: 600; color: var(--sh-muted); }
.gs-note { margin: 8px; color: var(--sh-muted); }
.gs-error { color: var(--sh-danger); }

.shell-body { display: flex; min-height: calc(100vh - var(--sh-top)); }
.sidebar { width: 210px; flex: none; background: var(--sh-surface); border-right: 1px solid var(--sh-line); padding: 10px 8px; }
.sidebar ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.nav-link { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; border-radius: 6px; color: var(--sh-ink) !important; text-decoration: none; font-size: .92rem; }
.nav-link:hover { background: #eef2ee; }
.nav-link.is-active { background: #dcebe3; font-weight: 600; box-shadow: inset 3px 0 0 var(--sh-brand); }
.nav-badge { min-width: 22px; padding: 1px 6px; border-radius: 11px; background: var(--sh-work); color: #fff; font-size: .74rem; font-weight: 700; text-align: center; }

.shell-main { flex: 1; min-width: 0; padding: 12px 16px 24px; }
.crumbs ol { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0 0 10px; padding: 0; font-size: .82rem; color: var(--sh-muted); }
.crumbs li + li::before { content: "/"; margin-right: 6px; color: var(--sh-line); }
.crumbs a { text-decoration: none; }
.crumbs [aria-current] { color: var(--sh-ink); font-weight: 600; }
.shell-content { min-width: 0; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.page-head h1 { margin: 0; font-size: 1.35rem; }

.ac-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
.ac-card { display: grid; gap: 2px; padding: 14px 16px; background: var(--sh-surface); border: 1px solid var(--sh-line); border-radius: 10px; text-decoration: none; color: var(--sh-ink) !important; }
.ac-card:hover { border-color: var(--sh-brand); }
.ac-card.has-work { border-left: 5px solid var(--sh-work); }
.ac-count { font-size: 2rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.ac-label { font-weight: 600; }
.ac-hint { color: var(--sh-muted); font-size: .85rem; }

.footer { margin-top: 24px; color: var(--sh-muted); font-size: .75rem; }
.drawer-scrim { display: none; }
.bottombar { display: none; }

@media (max-width: 860px) {
  .topbar-menu { display: flex; }
  .topbar-who, .topbar-meta { display: none; }
  .topbar-user { display: none; }
  .gs { max-width: none; }
  .sidebar { position: fixed; z-index: 40; top: var(--sh-top); bottom: 0; left: 0; transform: translateX(-100%); transition: transform .18s ease; }
  .sidebar.is-open { transform: none; box-shadow: 4px 0 20px rgba(0,0,0,.2); }
  .drawer-scrim { display: block; position: fixed; z-index: 35; inset: var(--sh-top) 0 0 0; border: 0; background: rgba(0,0,0,.35); }
  .shell-main { padding: 10px 12px 20px; }
  .has-bottom-bar .shell-main { padding-bottom: 76px; }
  .bottombar { display: flex; position: fixed; z-index: 30; left: 0; right: 0; bottom: 0; background: var(--sh-surface); border-top: 1px solid var(--sh-line); padding-bottom: env(safe-area-inset-bottom, 0); }
  .bottombar-link { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 52px; padding: 6px 4px; text-align: center; font-size: .8rem; color: var(--sh-ink) !important; text-decoration: none; }
  .bottombar-link.is-active { color: var(--sh-brand) !important; font-weight: 700; box-shadow: inset 0 3px 0 var(--sh-brand); }
}
@media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }

/* --- Phase 3a: queues and lists ------------------------------------------------ */
.ql-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 10px; }
.ql-tab { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--sh-line); border-radius: 999px; background: var(--sh-surface); color: var(--sh-ink) !important; text-decoration: none; font-size: .86rem; white-space: nowrap; }
.ql-tab.is-active { background: var(--sh-brand); border-color: var(--sh-brand); color: #fff !important; font-weight: 600; }
.ql-tab-count { min-width: 20px; padding: 0 6px; border-radius: 10px; background: var(--sh-work); color: #fff; font-size: .72rem; font-weight: 700; text-align: center; }
.ql-filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; margin-bottom: 12px; }
.ql-search { flex: 1 1 240px; max-width: 420px; height: 36px; padding: 0 10px; border: 1px solid var(--sh-line); border-radius: 6px; font: inherit; background: #fff; color: var(--sh-ink); }
.ql-date { display: grid; gap: 2px; font-size: .75rem; color: var(--sh-muted); }
.ql-date input { height: 36px; padding: 0 8px; border: 1px solid var(--sh-line); border-radius: 6px; font: inherit; background: #fff; color: var(--sh-ink); }
.ql.is-loading .ql-scroll { opacity: .55; }
.ql-scroll { overflow-x: auto; background: var(--sh-surface); border: 1px solid var(--sh-line); border-radius: 10px; }
.ql-table { width: 100%; border-collapse: collapse; font-size: .9rem; }
.ql-table th { text-align: left; font-weight: 600; font-size: .78rem; color: var(--sh-muted); padding: 10px 12px; border-bottom: 1px solid var(--sh-line); white-space: nowrap; }
.ql-table td { padding: 10px 12px; border-bottom: 1px solid #edf0ec; vertical-align: top; }
.ql-table tbody tr:last-child td { border-bottom: 0; }
.ql-table tbody tr:hover { background: #f5f8f5; }
.ql-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ql-person { display: grid; gap: 1px; }
.ql-person small { color: var(--sh-muted); }
.ql-open a { font-weight: 600; text-decoration: none; }
.ql-pager { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: .85rem; color: var(--sh-muted); }
.ql-pager-btns { display: inline-flex; align-items: center; gap: 12px; }
.ql-pager .text-button:disabled { opacity: .4; cursor: default; }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: .76rem; font-weight: 600; background: #e9ecea; color: #37453e; }
.pill-ok { background: #dcefe3; color: #17593f; }
.pill-warn { background: #fbecc8; color: #7a4a00; }
.pill-bad { background: #f6d9d5; color: #8f231b; }

@media (max-width: 640px) {
  .ql-table thead { position: absolute; left: -9999px; }
  .ql-table, .ql-table tbody, .ql-table tr, .ql-table td { display: block; width: 100%; }
  .ql-table tr { padding: 8px 4px; border-bottom: 1px solid var(--sh-line); }
  .ql-table td { display: flex; justify-content: space-between; gap: 12px; border: 0; padding: 4px 10px; text-align: right; }
  .ql-table td::before { content: attr(data-label); color: var(--sh-muted); font-size: .78rem; text-align: left; }
  .ql-table td.ql-open { justify-content: flex-end; }
  .ql-table td.ql-open::before { content: none; }
  .ql-person { text-align: right; }
}

/* --- Phase 3b: record workspaces ------------------------------------------------ */
.rec-back { display: inline-block; margin-bottom: 8px; font-size: .85rem; text-decoration: none; }
.rec-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.rec-head h1 { margin: 0; font-size: 1.3rem; line-height: 1.25; }
.rec-sub { margin: 2px 0 0; color: var(--sh-muted); }
.rec-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: start; }
.rec-card { background: var(--sh-surface); border: 1px solid var(--sh-line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.rec-card.is-wide { grid-column: 1 / -1; }
.rec-card h2 { margin: 0 0 10px; font-size: .95rem; }
.rec-facts { display: grid; gap: 8px; margin: 0; }
.rec-facts div { display: grid; grid-template-columns: 9.5rem 1fr; gap: 8px; }
.rec-facts dt { color: var(--sh-muted); font-size: .84rem; }
.rec-facts dd { margin: 0; overflow-wrap: anywhere; }
.rec-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.rec-timeline li { display: grid; gap: 1px; padding-left: 12px; border-left: 3px solid var(--sh-line); }
.rec-timeline span, .rec-timeline small { color: var(--sh-muted); font-size: .82rem; }
.rec-links { margin: 0; padding-left: 18px; }
.rec-card .note { color: var(--sh-muted); font-size: .85rem; margin: 6px 0 0; }
@media (max-width: 640px) { .rec-facts div { grid-template-columns: 1fr; gap: 0; } .rec-grid { grid-template-columns: 1fr; } }

/* --- Phase 3c: lifecycle actions ------------------------------------------------ */
.act { display: grid; gap: 12px; }
.act-block { display: grid; gap: 8px; justify-items: start; }
.act-form { display: grid; gap: 10px; max-width: 520px; width: 100%; }
.act-form h3 { margin: 0; font-size: .95rem; }
.act-form label { display: grid; gap: 4px; font-size: .84rem; color: var(--sh-muted); }
.act-form input, .act-form select, .act-form textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--sh-line); border-radius: 6px; font: inherit; color: var(--sh-ink); background: #fff; }
.act-form textarea { min-height: 84px; resize: vertical; }
.act-row { display: flex; flex-wrap: wrap; gap: 8px; }
.act-notice { margin: 0; padding: 8px 10px; border-radius: 6px; background: #dcefe3; color: #17593f; font-size: .88rem; }
UPFUND_EOF_9
echo "wrote client/src/shell.css"

mkdir -p "$(dirname "tests/client-lifecycle.test.ts")"
cat > "tests/client-lifecycle.test.ts" << 'UPFUND_EOF_10'
import { describe, expect, it } from 'vitest';
import { APPROVE_REASON, applicationActions, canDisburse, disbursePayload, validateRisk } from '../client/src/lib/lifecycle.js';

describe('applicationActions', () => {
  it('offers exactly one action per status when the permission is held', () => {
    expect(applicationActions('draft', ['applications.submit'])).toEqual(['submit']);
    expect(applicationActions('submitted', ['kyc.review'])).toEqual(['kyc']);
    expect(applicationActions('kyc_verified', ['risk.assess'])).toEqual(['risk']);
    expect(applicationActions('risk_assessed', ['loans.approve'])).toEqual(['approve']);
  });
  it('offers nothing without the matching permission', () => {
    expect(applicationActions('draft', [])).toEqual([]);
    expect(applicationActions('submitted', ['applications.submit'])).toEqual([]);
    expect(applicationActions('risk_assessed', ['risk.assess', 'kyc.review'])).toEqual([]);
  });
  it('offers nothing on terminal or in-between statuses', () => {
    for (const status of ['approved', 'rejected', 'declined', 'kyc_rejected', '']) expect(applicationActions(status, ['applications.submit', 'kyc.review', 'risk.assess', 'loans.approve'])).toEqual([]);
  });
});

describe('disbursement', () => {
  it('is for admin and manager on approved loans only', () => {
    expect(canDisburse('admin', 'approved')).toBe(true);
    expect(canDisburse('manager', 'approved')).toBe(true);
    for (const role of ['officer', 'collector', 'accountant', 'client', 'marketing']) expect(canDisburse(role, 'approved')).toBe(false);
    for (const status of ['active', 'disbursed', 'completed', 'overdue']) expect(canDisburse('admin', status)).toBe(false);
  });
  it('keeps the classic reference and a stable idempotency key', () => {
    expect(disbursePayload('0123456789abcdef')).toEqual({ disbursementReference: 'DSB-01234567', idempotencyKey: 'disburse-0123456789abcdef' });
    expect(disbursePayload('abc')).toEqual(disbursePayload('abc'));
  });
});

describe('validateRisk', () => {
  const ok = { score: '72', grade: 'B', policy: 'v3', rationale: 'Stable income.' };
  it('accepts a complete assessment', () => { expect(validateRisk(ok)).toBeNull(); });
  it('rejects bad scores', () => {
    for (const score of ['', '-1', '101', '7.5', 'abc']) expect(validateRisk({ ...ok, score })).not.toBeNull();
    expect(validateRisk({ ...ok, score: '0' })).toBeNull(); expect(validateRisk({ ...ok, score: '100' })).toBeNull();
  });
  it('requires grade, policy and rationale within server limits', () => {
    expect(validateRisk({ ...ok, grade: ' ' })).not.toBeNull();
    expect(validateRisk({ ...ok, grade: 'x'.repeat(21) })).not.toBeNull();
    expect(validateRisk({ ...ok, policy: 'p'.repeat(65) })).not.toBeNull();
    expect(validateRisk({ ...ok, rationale: '  ' })).not.toBeNull();
  });
  it('has a non-empty default approval reason', () => { expect(APPROVE_REASON.length).toBeGreaterThan(10); });
});
UPFUND_EOF_10
echo "wrote tests/client-lifecycle.test.ts"

echo; echo "Done. Next: npx tsc --noEmit && npm test && npm run build"
