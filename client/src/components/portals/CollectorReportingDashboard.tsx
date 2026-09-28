import { useCallback, useEffect, useState } from 'react';
import type { AuthIdentity } from '../../services/firebase.js';
import { getCollectorReport } from '../../services/api.js';
import type { CollectorReportingSnapshot } from '../../../../shared/reporting.js';
import { getFirebaseIdToken } from '../../services/firebase.js';
import type { QueueMetrics } from '../../types/field-ops.js';
import { computeQueueSyncStatus } from '../field/CollectorRouteView.js';

export interface CollectorReportingDashboardProps {
  identity: AuthIdentity;
  metrics?: QueueMetrics;
  queueReady?: boolean;
  queueError?: string;
  isSyncing?: boolean;
  onSync?: () => Promise<void> | void;
  initialSnapshot?: CollectorReportingSnapshot;
}

const money = (value: number): string => `${value.toLocaleString()} UGX`;
const titleCase = (value: string): string => value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
const today = (): string => new Date().toISOString().slice(0, 10);

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="portal-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function CollectorReportingDashboard({ identity, metrics, queueReady = true, queueError, isSyncing = false, onSync, initialSnapshot }: CollectorReportingDashboardProps) {
  const [snapshot, setSnapshot] = useState<CollectorReportingSnapshot | null>(initialSnapshot ?? null);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState('');
  const [asOf, setAsOf] = useState(today);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : (navigator.onLine ?? true));

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const load = useCallback(async (date = asOf) => {
    setLoading(true);
    setError('');
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
      setSnapshot(await getCollectorReport(token, { asOf: date, from: date, to: date, branchId: identity.branchId ?? undefined }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'COLLECTOR_REPORT_LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, [asOf, identity.branchId]);

  useEffect(() => { void load(); }, [identity.uid, load]);

  const activeMetrics: QueueMetrics = metrics ?? {
    queued: snapshot?.offlineQueue.filter((q) => q.syncStatus === 'queued' || q.syncStatus === 'pending_reconciliation').length ?? 0,
    syncing: 0,
    rejected: snapshot?.offlineQueue.filter((q) => q.syncStatus === 'reversed').length ?? 0,
    conflict: 0,
    stale: 0,
  };

  const syncStatus = computeQueueSyncStatus({
    online,
    isSyncing,
    metrics: activeMetrics,
    queueReady,
    queueError,
  });

  if (loading && !snapshot) return <section className="reporting-shell portal-card" role="status"><p className="eyebrow">Route reporting</p><h3>Loading route status…</h3></section>;
  if (error && !snapshot) return <section className="reporting-shell portal-card" aria-labelledby="collector-report-error"><p className="eyebrow">Route reporting</p><h3 id="collector-report-error">Reporting unavailable</h3><p className="form-error" role="alert">{error.includes('403') || error.includes('FORBIDDEN') ? 'Your account is not authorized to view route reporting.' : error}</p><button className="primary-button" type="button" onClick={() => void load()}>Retry</button></section>;
  if (!snapshot) return <section className="reporting-shell portal-card"><p className="empty-state">No route reporting data is available yet.</p></section>;

  const progress = Math.min(snapshot.targetProgress.progressPercent, 100);
  return <section className="reporting-shell collector-reporting" aria-labelledby="collector-report-title">
     <div className="reporting-heading">
       <div>
         <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
           <p className="eyebrow" style={{ margin: 0 }}>Field route status</p>
           <span
             className={`sync-status-badge sync-status-${syncStatus.status}`}
             data-testid="collector-dashboard-sync-badge"
             role="status"
             aria-label={`Offline queue status: ${syncStatus.badgeText}`}
           >
             <span className={`sync-status-mini-dot is-${syncStatus.status}`} aria-hidden="true" />
             <span>Queue: {syncStatus.badgeText}</span>
           </span>
         </div>
         <h3 id="collector-report-title">Today’s collection plan</h3>
         <p className="note">Targets are the scheduled amount due for your active client assignments.</p>
       </div>
       <label className="reporting-filter">As of<input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} /></label>
     </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="portal-metrics reporting-metrics">
      <Metric label="Daily target" value={money(snapshot.targetProgress.targetAmount)} detail={`${snapshot.targetProgress.scheduledClientCount} clients scheduled`} />
      <Metric label="Posted actual" value={money(snapshot.targetProgress.actualAmount)} detail={`${snapshot.targetProgress.progressPercent}% complete`} />
      <Metric label="Pending capture" value={money(snapshot.targetProgress.pendingAmount)} detail="Awaiting reconciliation" />
      <Metric label="Overdue clients" value={snapshot.targetProgress.overdueClientCount.toLocaleString()} detail="Needs follow-up" />
    </div>
    <div className="target-progress" aria-label={`Collection target progress ${snapshot.targetProgress.progressPercent}%`}><div style={{ width: `${progress}%` }} /></div>
    <div className="reporting-grid">
      <section className="portal-card"><div className="portal-card-heading"><div><p className="eyebrow">Assigned routes</p><h4>Route progress</h4></div><span className="count-pill">{snapshot.routes.length}</span></div>{snapshot.routes.length === 0 ? <p className="empty-state">No active routes are assigned.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><thead><tr><th>Route</th><th>Clients</th><th>Target</th><th>Actual</th><th>Progress</th></tr></thead><tbody>{snapshot.routes.map((route) => <tr key={route.routeCode}><td>{route.routeCode}</td><td>{route.assignedClientCount}</td><td>{money(route.targetAmount)}</td><td>{money(route.actualAmount)}</td><td>{route.progressPercent}%</td></tr>)}</tbody></table></div>}</section>
      <section className="portal-card"><div className="portal-card-heading"><div><p className="eyebrow">Payment methods</p><h4>Collection mix</h4></div><span className="count-pill">{snapshot.paymentMethods.length}</span></div>{snapshot.paymentMethods.length === 0 ? <p className="empty-state">No collection captures for this date.</p> : <div className="reporting-list">{snapshot.paymentMethods.map((method) => <div className="reporting-list-row" key={method.paymentMethod}><div><strong>{titleCase(method.paymentMethod)}</strong><span>{method.postedCount} posted · {method.pendingCount} pending</span></div><strong>{money(method.postedAmount)}</strong></div>)}</div>}</section>
    </div>
    <section className="portal-card portal-wide"><div className="portal-card-heading"><div><p className="eyebrow">Repayment schedule</p><h4>Assigned client collections</h4></div><span className="count-pill">{snapshot.assignedClientSchedules.length}</span></div>{snapshot.assignedClientSchedules.length === 0 ? <p className="empty-state">No repayment schedules fall in this reporting window.</p> : <div className="reporting-table-wrap"><table className="reporting-table"><thead><tr><th>Client</th><th>Route</th><th>Due</th><th>Scheduled</th><th>Paid</th><th>Remaining</th></tr></thead><tbody>{snapshot.assignedClientSchedules.map((schedule) => <tr key={schedule.scheduleId}><td><strong>{schedule.clientName}</strong><small>{schedule.loanId}</small></td><td>{schedule.routeCode}</td><td>{schedule.dueOn}</td><td>{money(schedule.amountDue)}</td><td>{money(schedule.amountPaid)}</td><td><span className={schedule.remainingAmount > 0 ? 'status-badge status-pending_reconciliation' : 'status-badge status-posted'}>{money(schedule.remainingAmount)}</span></td></tr>)}</tbody></table></div>}</section>
    <div className="reporting-grid">
      <section className="portal-card"><div className="portal-card-heading"><div><p className="eyebrow">Watchlist</p><h4>Overdue loans</h4></div><span className="count-pill">{snapshot.overdueWatchlist.length}</span></div>{snapshot.overdueWatchlist.length === 0 ? <p className="empty-state">No overdue assigned loans.</p> : <div className="reporting-list">{snapshot.overdueWatchlist.map((loan) => <div className="reporting-list-row" key={`${loan.loanId}-${loan.oldestDueOn}`}><div><strong>{loan.clientName}</strong><span>{loan.routeCode} · {loan.daysOverdue} days overdue</span></div><strong>{money(loan.overdueAmount)}</strong></div>)}</div>}</section>
      <section className="portal-card" data-testid="collector-offline-queue-card">
        <div className="portal-card-heading">
          <div>
            <p className="eyebrow">Offline queue</p>
            <h4>Sync status & receipts</h4>
          </div>
          <span className={`sync-status-badge sync-status-${syncStatus.status}`} data-testid="reporting-sync-badge">
            <span className={`sync-status-mini-dot is-${syncStatus.status}`} aria-hidden="true" />
            <span>{syncStatus.badgeText}</span>
          </span>
        </div>

        {/* Dedicated visual status indicator */}
        <div
          className={`queue-sync-indicator-card status-${syncStatus.status}`}
          data-testid="collector-reporting-sync-indicator"
          role="status"
          aria-live="polite"
        >
          <div className="queue-sync-header">
            <div className="queue-sync-main">
              <div className={`queue-sync-icon-wrap is-${syncStatus.status}`} aria-hidden="true">
                <span className={`queue-sync-dot is-${syncStatus.status}`} />
              </div>
              <div className="queue-sync-text">
                <div className="queue-sync-title-row">
                  <h4 className="queue-sync-title">{syncStatus.title}</h4>
                  <span className={`queue-sync-badge ${syncStatus.badgeClass}`}>
                    {syncStatus.badgeText}
                  </span>
                </div>
                <p className="queue-sync-description">{syncStatus.summary}</p>
              </div>
            </div>
            {onSync && (
              <div className="queue-sync-actions">
                <button
                  type="button"
                  className="queue-sync-btn primary"
                  onClick={() => void onSync()}
                  disabled={!online || isSyncing || !queueReady}
                  data-testid="button-sync-dashboard"
                  aria-label="Synchronize offline queue now"
                >
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              </div>
            )}
          </div>
          <div className="queue-sync-strip">
            <div className="queue-sync-counts" aria-label="Offline queue breakdown">
              <span><strong>{activeMetrics.queued}</strong> queued</span>
              <span aria-hidden="true">·</span>
              <span><strong>{activeMetrics.syncing}</strong> syncing</span>
              <span aria-hidden="true">·</span>
              <span><strong>{activeMetrics.conflict}</strong> conflicts</span>
              <span aria-hidden="true">·</span>
              <span><strong>{activeMetrics.rejected}</strong> rejected</span>
            </div>
            <a
              href="#collector-queue-title"
              className="queue-sync-link"
              onClick={(e) => {
                const target = document.getElementById('collector-queue-title');
                if (target) {
                  e.preventDefault();
                  target.scrollIntoView({ behavior: 'smooth' });
                }
              }}
            >
              View local queue <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>

        {snapshot.offlineQueue.length === 0 ? <p className="empty-state">No sync receipts in this reporting window.</p> : <div className="reporting-list">{snapshot.offlineQueue.map((item) => <div className="reporting-list-row" key={item.id}><div><strong>{item.clientName}</strong><span>{item.localId} · {titleCase(item.paymentMethod)}</span></div><span className={`status-badge status-${item.syncStatus}`}>{titleCase(item.syncStatus)}</span></div>)}</div>}
      </section>
    </div>
  </section>;
}