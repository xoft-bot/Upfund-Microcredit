import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthIdentity } from '../../services/firebase.js';
import { getFirebaseIdToken } from '../../services/firebase.js';
import { getAccountantReport } from '../../services/api.js';
import type { AccountantReportingSnapshot } from '../../../../shared/reporting.js';

interface AccountantAuditDashboardProps { identity: AuthIdentity; }

const money = (value: number): string => `${value.toLocaleString()} UGX`;
const readable = (value: string): string => value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const dateTime = (value: string | null): string => value ? new Date(value).toLocaleString() : '—';

function AuditMetric({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) {
  return <article className={`reporting-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

export function AccountantAuditDashboard({ identity }: AccountantAuditDashboardProps) {
  const [snapshot, setSnapshot] = useState<AccountantReportingSnapshot | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState(identity.role === 'accountant' ? identity.branchId ?? '' : '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (filters: { branchId?: string; from?: string; to?: string } = {}) => {
    setLoading(true);
    setError('');
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
      setSnapshot(await getAccountantReport(token, { ...filters, branchId: identity.role === 'admin' ? filters.branchId : identity.branchId ?? undefined }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ACCOUNTING_REPORT_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load({ branchId: identity.role === 'admin' ? branchId || undefined : undefined }); }, [identity.uid]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void load({ branchId: branchId || undefined, from: from || undefined, to: to || undefined });
  };

  const totalDebits = useMemo(() => snapshot?.trialBalance.reduce((sum, row) => sum + row.debitTotal, 0) ?? 0, [snapshot]);
  const totalCredits = useMemo(() => snapshot?.trialBalance.reduce((sum, row) => sum + row.creditTotal, 0) ?? 0, [snapshot]);
  if (loading && !snapshot) return <section className="reporting-shell portal-card" aria-labelledby="accounting-title"><p className="eyebrow">Accounting & audit</p><h3 id="accounting-title">Loading accounting snapshot…</h3><p className="empty-state" role="status">Reading posted journal entries and reconciliation evidence.</p></section>;
  if (error && !snapshot) return <section className="reporting-shell portal-card" aria-labelledby="accounting-title"><p className="eyebrow">Accounting & audit</p><h3 id="accounting-title">Accounting view unavailable</h3><p className="form-error" role="alert">{error.includes('403') || error.includes('FORBIDDEN') ? 'Your account is not authorized to view accounting reports.' : error}</p><button className="primary-button" type="button" onClick={() => void load()}>Retry</button></section>;
  if (!snapshot) return null;

  return <section className="reporting-shell" aria-labelledby="accounting-title">
    <div className="reporting-heading"><div><p className="eyebrow">Accountant / audit</p><h3 id="accounting-title">Accounting control room</h3><p className="note">Posted evidence only · {snapshot.filters.from} to {snapshot.filters.to} · as of {snapshot.filters.asOf}</p></div>{loading && <span className="reporting-refresh" role="status">Refreshing…</span>}</div>
    <form className="reporting-filters portal-card" onSubmit={submit}>
      {identity.role === 'admin' && <label>Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{snapshot.branches.map((branch) => <option value={branch.branchId} key={branch.branchId}>{branch.branchName}</option>)}</select></label>}
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="secondary-button" type="submit" disabled={loading}>Refresh audit view</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="reporting-kpis">
      <AuditMetric label="Posted journal entries" value={String(snapshot.journalEntries.length)} detail={`${snapshot.journalEntries.filter((entry) => entry.balanced).length} balanced`} tone="positive" />
      <AuditMetric label="Posted payment value" value={money(snapshot.waterfallTotals.postedAmount)} detail={`${snapshot.waterfallAllocations.length} payment allocations`} />
      <AuditMetric label="Recognized revenue" value={money(snapshot.waterfallTotals.realizedInterest + snapshot.waterfallTotals.realizedPenalty)} detail="Interest + penalty only" tone="positive" />
      <AuditMetric label="Override decisions" value={String(snapshot.reconciliationOverrides.length)} detail={`${snapshot.varianceLogs.length} variance logs`} tone={snapshot.reconciliationOverrides.length ? 'warning' : 'positive'} />
    </div>
    <div className="reporting-grid">
      <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Waterfall allocation</p><h3>Posted payment split</h3></div><span className="count-pill">{snapshot.waterfallAllocations.length} rows</span></div><div className="audit-allocation-list"><div><span>Principal recovery</span><strong>{money(snapshot.waterfallTotals.principalRecovery)}</strong></div><div><span>Realized interest</span><strong>{money(snapshot.waterfallTotals.realizedInterest)}</strong></div><div><span>Realized penalty</span><strong>{money(snapshot.waterfallTotals.realizedPenalty)}</strong></div><div className="allocation-liability"><span>Overpayment liabilities</span><strong>{money(snapshot.waterfallTotals.overpaymentLiability)}</strong></div><div className={snapshot.waterfallTotals.allocationDelta === 0 ? 'allocation-revenue' : 'allocation-liability'}><span>Allocation check</span><strong>{snapshot.waterfallTotals.allocationDelta === 0 ? 'Balanced' : money(snapshot.waterfallTotals.allocationDelta)}</strong></div></div><p className="note">Every posted payment is checked against its stored principal, interest, penalty, and overpayment components.</p></section>
      <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Trial balance</p><h3>Debit and credit control</h3></div><span className={`status-badge ${totalDebits === totalCredits ? 'posted' : 'status-variance'}`}>{totalDebits === totalCredits ? 'Balanced' : 'Out of balance'}</span></div><div className="trial-balance-total"><span>Total debits<strong>{money(totalDebits)}</strong></span><span>Total credits<strong>{money(totalCredits)}</strong></span></div>{snapshot.trialBalance.length === 0 ? <p className="empty-state">No ledger entries in this period.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Trial balance by ledger account</caption><thead><tr><th>Account</th><th>Debits</th><th>Credits</th><th>Net</th></tr></thead><tbody>{snapshot.trialBalance.map((row) => <tr key={row.accountCode}><th scope="row">{row.accountCode}</th><td>{money(row.debitTotal)}</td><td>{money(row.creditTotal)}</td><td>{money(row.netBalance)}</td></tr>)}</tbody></table></div>}</section>
    </div>
    <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Journal audit log</p><h3>Double-entry evidence</h3></div></div>{snapshot.journalEntries.length === 0 ? <p className="empty-state">No posted journal entries in this period.</p> : <div className="audit-journal-list">{snapshot.journalEntries.map((entry) => <details className="audit-journal-entry" key={entry.transactionId}><summary><span><strong>{entry.description}</strong><small>{dateTime(entry.postedAt)} · {entry.sourceType} · {entry.branchName ?? 'Unassigned scope'}</small></span><span className={`status-badge ${entry.balanced ? 'posted' : 'status-variance'}`}>{entry.balanced ? 'Balanced' : 'Unbalanced'}</span></summary><div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Journal lines for {entry.transactionId}</caption><thead><tr><th>Account</th><th>Side</th><th>Amount</th><th>Currency</th></tr></thead><tbody>{entry.lines.map((line) => <tr key={line.id}><th scope="row">{line.accountCode}</th><td>{readable(line.side)}</td><td>{money(line.amount)}</td><td>{line.currency}</td></tr>)}</tbody></table></div><p className="note">Posted by {entry.postedByName ?? entry.postedBy} · Debits {money(entry.totalDebits)} · Credits {money(entry.totalCredits)}</p></details>)}</div>}</section>
    <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Manual override audit</p><h3>Reviewer decisions and reasons</h3></div></div>{snapshot.reconciliationOverrides.length === 0 ? <p className="empty-state">No manual reconciliation overrides in this period.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Manual reconciliation override audit trail</caption><thead><tr><th>Batch</th><th>Reviewer</th><th>Decision</th><th>Variance</th><th>Reason</th></tr></thead><tbody>{snapshot.reconciliationOverrides.map((audit) => <tr key={audit.reconciliationId}><th scope="row">{audit.batchReference}<small>{audit.collectionDate} · {audit.branchName}</small></th><td>{audit.reviewedByName ?? audit.reviewedBy}</td><td><span className={`status-badge status-${audit.status}`}>{readable(audit.status)}</span><small>{dateTime(audit.reviewedAt)}</small></td><td>{money(audit.variance)}</td><td className="audit-reason">{audit.decisionReason ?? 'No reason recorded'}</td></tr>)}</tbody></table></div>}</section>
    <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Variance log</p><h3>Reconciliation exceptions</h3></div></div>{snapshot.varianceLogs.length === 0 ? <p className="empty-state">No reconciliation variances in this period.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Reconciliation variance log</caption><thead><tr><th>Batch</th><th>Expected</th><th>Recorded</th><th>Submitted</th><th>Variance</th><th>Status</th></tr></thead><tbody>{snapshot.varianceLogs.map((audit) => <tr key={audit.reconciliationId}><th scope="row">{audit.batchReference}<small>{audit.collectionDate} · {audit.branchName}</small></th><td>{money(audit.expectedAmount)}</td><td>{money(audit.recordedAmount)}</td><td>{money(audit.submittedAmount)}</td><td>{money(audit.variance)}</td><td><span className={`status-badge status-${audit.status}`}>{readable(audit.status)}</span>{audit.decisionReason && <small>{audit.decisionReason}</small>}</td></tr>)}</tbody></table></div>}</section>
  </section>;
}