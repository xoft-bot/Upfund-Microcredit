import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthIdentity } from '../../services/firebase.js';
import { getFirebaseIdToken } from '../../services/firebase.js';
import { getManagerReport } from '../../services/api.js';
import type { ManagerReportingSnapshot } from '../../../../shared/reporting.js';

interface ManagerAnalyticsDashboardProps { identity: AuthIdentity; }

const money = (value: number): string => `${value.toLocaleString()} UGX`;
const percent = (value: number): string => `${value.toFixed(2)}%`;
const readable = (value: string): string => value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());

function Kpi({ label, value, detail, tone = '' }: { label: string; value: string; detail?: string; tone?: string }) {
  return <article className={`reporting-kpi ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function ParCard({ label, metric }: { label: string; metric: ManagerReportingSnapshot['summary']['par30'] }) {
  return <article className="par-card"><div><span>{label}</span><strong>{percent(metric.ratio)}</strong></div><small>{money(metric.amount)} at risk · {metric.loanCount} loans</small></article>;
}

export function ManagerAnalyticsDashboard({ identity }: ManagerAnalyticsDashboardProps) {
  const [snapshot, setSnapshot] = useState<ManagerReportingSnapshot | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState(identity.role === 'manager' ? identity.branchId ?? '' : '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (filters: { branchId?: string; from?: string; to?: string } = {}) => {
    setLoading(true);
    setError('');
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
      setSnapshot(await getManagerReport(token, { ...filters, branchId: identity.role === 'admin' ? filters.branchId : identity.branchId ?? undefined }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'REPORTING_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [identity.branchId, identity.role]);

  useEffect(() => { void load({ branchId: identity.role === 'admin' ? branchId || undefined : undefined }); }, [branchId, identity.role, identity.uid, load]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void load({ branchId: branchId || undefined, from: from || undefined, to: to || undefined });
  };

  const dailyMax = useMemo(() => Math.max(1, ...(snapshot?.dailyCollections.map((item) => item.reconciledAmount + item.pendingAmount) ?? [])), [snapshot]);
  if (loading && !snapshot) return <section className="reporting-shell portal-card" aria-labelledby="reporting-title"><p className="eyebrow">Manager analytics</p><h3 id="reporting-title">Loading reporting snapshot…</h3><p className="empty-state" role="status">Reading server-authoritative portfolio data.</p></section>;
  if (error && !snapshot) return <section className="reporting-shell portal-card" aria-labelledby="reporting-title"><p className="eyebrow">Manager analytics</p><h3 id="reporting-title">Reporting unavailable</h3><p className="form-error" role="alert">{error.includes('403') || error.includes('FORBIDDEN') ? 'Your account is not authorized to view manager reporting.' : error}</p><button className="primary-button" type="button" onClick={() => void load()}>Retry</button></section>;
  if (!snapshot) return null;

  return <section className="reporting-shell" aria-labelledby="reporting-title">
    <div className="reporting-heading">
      <div><p className="eyebrow">Manager analytics</p><h3 id="reporting-title">Portfolio performance</h3><p className="note">Read-only snapshot · {snapshot.filters.from} to {snapshot.filters.to} · as of {snapshot.filters.asOf}</p></div>
      {loading && <span className="reporting-refresh" role="status">Refreshing…</span>}
    </div>
    <form className="reporting-filters portal-card" onSubmit={submit}>
      {identity.role === 'admin' && <label>Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">All branches</option>{snapshot.branchPerformance.map((branch) => <option value={branch.branchId} key={branch.branchId}>{branch.branchName}</option>)}</select></label>}
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="secondary-button" type="submit" disabled={loading}>Refresh report</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="reporting-kpis">
      <Kpi label="Outstanding portfolio" value={money(snapshot.summary.portfolioOutstanding)} detail={`${snapshot.summary.activeLoans} active loans`} />
      <Kpi label="Collection efficiency" value={percent(snapshot.summary.collectionEfficiency)} detail={`${money(snapshot.summary.realizedDueAmount)} of ${money(snapshot.summary.scheduledAmount)} due`} tone="positive" />
      <Kpi label="Disbursed in period" value={money(snapshot.summary.disbursementAmount)} detail={`${snapshot.summary.disbursementCount} disbursements`} />
      <Kpi label="Open reconciliations" value={String(snapshot.openReconciliations.count)} detail={`${money(snapshot.openReconciliations.variance)} total variance`} tone={snapshot.openReconciliations.count ? 'warning' : 'positive'} />
    </div>
    <div className="par-grid"><ParCard label="PAR 30" metric={snapshot.summary.par30} /><ParCard label="PAR 60" metric={snapshot.summary.par60} /><ParCard label="PAR 90" metric={snapshot.summary.par90} /></div>
    <div className="reporting-grid">
      <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Collections</p><h3>Daily field activity</h3></div><span className="count-pill">{snapshot.dailyCollections.length} days</span></div>{snapshot.dailyCollections.length === 0 ? <p className="empty-state">No field collections in this period.</p> : <div className="reporting-bars">{snapshot.dailyCollections.map((day) => <div className="reporting-bar-row" key={day.date}><div className="reporting-bar-label"><strong>{day.date}</strong><span>{money(day.reconciledAmount + day.pendingAmount)}</span></div><div className="reporting-bar-track" role="img" aria-label={`${day.date}: ${money(day.reconciledAmount)} reconciled and ${money(day.pendingAmount)} pending`}><span className="reporting-bar-reconciled" style={{ width: `${Math.min(100, day.reconciledAmount / dailyMax * 100)}%` }} /><span className="reporting-bar-pending" style={{ width: `${Math.min(100, day.pendingAmount / dailyMax * 100)}%` }} /></div><small>{day.reconciledCount} reconciled · {day.pendingCount} pending</small></div>)}</div>}</section>
      <section className="portal-card reporting-panel"><p className="eyebrow">Revenue and capital</p><h3>Posted allocation split</h3><div className="allocation-list"><div><span>Principal recovery</span><strong>{money(snapshot.allocations.principalRecovery)}</strong></div><div><span>Realized interest</span><strong>{money(snapshot.allocations.realizedInterest)}</strong></div><div><span>Realized penalty</span><strong>{money(snapshot.allocations.realizedPenalty)}</strong></div><div className="allocation-revenue"><span>Recognized revenue</span><strong>{money(snapshot.allocations.realizedRevenue)}</strong></div><div className="allocation-liability"><span>Overpayment liability</span><strong>{money(snapshot.allocations.overpaymentLiability)}</strong><small>{money(snapshot.allocations.heldOverpaymentBalance)} currently held</small></div></div><p className="note">Overpayment holdings are liabilities, never revenue or deployable capital.</p></section>
    </div>
    <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Branch performance</p><h3>Operational comparison</h3></div></div>{snapshot.branchPerformance.length === 0 ? <p className="empty-state">No branches are available for this scope.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Branch performance for the selected reporting period</caption><thead><tr><th>Branch</th><th>Outstanding</th><th>Disbursed</th><th>Reconciled</th><th>Pending</th><th>Efficiency</th></tr></thead><tbody>{snapshot.branchPerformance.map((branch) => <tr key={branch.branchId}><th scope="row">{branch.branchName}<small>{branch.openReconciliations} open reconciliation{branch.openReconciliations === 1 ? '' : 's'}</small></th><td>{money(branch.outstandingPrincipal)}</td><td>{money(branch.disbursementAmount)}</td><td>{money(branch.reconciledCollections)}</td><td>{money(branch.pendingCollections)}</td><td>{percent(branch.collectionEfficiency)}</td></tr>)}</tbody></table></div>}</section>
    <section className="portal-card reporting-panel"><div className="portal-card-heading"><div><p className="eyebrow">Field performance</p><h3>Collector and method breakdown</h3></div></div>{snapshot.collectionBreakdown.length === 0 ? <p className="empty-state">No collection records are available for this period.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Field collection breakdown by collector, branch, method, and day</caption><thead><tr><th>Date</th><th>Collector</th><th>Branch</th><th>Method</th><th>Reconciled</th><th>Pending</th></tr></thead><tbody>{snapshot.collectionBreakdown.map((row) => <tr key={`${row.date}-${row.branchId}-${row.collectorId ?? 'unassigned'}-${row.paymentMethod}`}><td>{row.date}</td><td>{row.collectorName}</td><td>{row.branchName}</td><td>{readable(row.paymentMethod)}</td><td>{money(row.reconciledAmount)}<small>{row.reconciledCount} records</small></td><td>{money(row.pendingAmount)}<small>{row.pendingCount} records</small></td></tr>)}</tbody></table></div>}</section>
    <section className="portal-card reporting-panel" id="reconciliation-review"><div className="portal-card-heading"><div><p className="eyebrow">Reconciliation queue</p><h3>Open variances</h3></div><a className="text-button reporting-link" href="#reconciliation-review">Open review section</a></div>{snapshot.openReconciliations.batches.length === 0 ? <p className="empty-state">No open reconciliation variances.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><caption className="sr-only">Open reconciliation variances</caption><thead><tr><th>Batch</th><th>Branch</th><th>Recorded</th><th>Variance</th><th>Status</th></tr></thead><tbody>{snapshot.openReconciliations.batches.map((batch) => <tr key={batch.id}><th scope="row">{batch.batchReference}<small>{batch.collectionDate} · {batch.submittedByName ?? batch.submittedBy}</small></th><td>{batch.branchName}</td><td>{money(batch.recordedAmount)}</td><td>{money(batch.variance)}</td><td><span className={`status-badge status-${batch.status}`}>{readable(batch.status)}</span></td></tr>)}</tbody></table></div>}</section>
  </section>;
}