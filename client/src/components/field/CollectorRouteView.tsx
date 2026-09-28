import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FieldCollectionRecord, QueueMetrics } from '../../types/field-ops.js';
import { OfflineQueue } from '../../services/offlineQueue.js';

interface CollectorRouteViewProps {
  queue: OfflineQueue;
  routeName: string;
  expectedAmount?: number;
  records: FieldCollectionRecord[];
  metrics: QueueMetrics;
  queueReady: boolean;
  queueError?: string;
  onCollect: () => void;
}

export type QueueSyncState = 'synced' | 'syncing' | 'offline' | 'pending' | 'attention';

export interface QueueSyncStatusInfo {
  status: QueueSyncState;
  badgeText: string;
  badgeClass: 'is-positive' | 'is-info' | 'is-warning' | 'is-critical';
  title: string;
  summary: string;
  detail: string;
}

export function computeQueueSyncStatus({
  online,
  isSyncing,
  metrics,
  queueReady,
  queueError,
}: {
  online: boolean;
  isSyncing: boolean;
  metrics: QueueMetrics;
  queueReady: boolean;
  queueError?: string;
}): QueueSyncStatusInfo {
  if (queueError || metrics.rejected > 0 || metrics.conflict > 0) {
    const errorCount = metrics.rejected + metrics.conflict;
    return {
      status: 'attention',
      badgeText: 'Attention required',
      badgeClass: 'is-critical',
      title: 'Sync Attention Required',
      summary: queueError || `${errorCount} payment${errorCount === 1 ? '' : 's'} encountered an issue and need review`,
      detail: 'Review conflicting items in the offline queue inspector to reconcile with the ledger.',
    };
  }

  if (isSyncing || metrics.syncing > 0) {
    const count = metrics.syncing || metrics.queued || 1;
    return {
      status: 'syncing',
      badgeText: 'Syncing…',
      badgeClass: 'is-info',
      title: 'Syncing Payments to Ledger',
      summary: `Uploading ${count} payment${count === 1 ? '' : 's'} to the central ledger`,
      detail: 'Connecting to server and posting atomic double-entry transactions.',
    };
  }

  if (!online) {
    const localCount = metrics.queued;
    return {
      status: 'offline',
      badgeText: 'Offline Mode',
      badgeClass: 'is-warning',
      title: 'Offline Queue Active',
      summary: localCount > 0
        ? `${localCount} payment${localCount === 1 ? '' : 's'} stored securely on device`
        : 'Network disconnected. Payments will be queued locally and synced when connection returns.',
      detail: 'IndexedDB offline storage is active. Device will auto-sync upon reconnection.',
    };
  }

  if (metrics.queued > 0) {
    return {
      status: 'pending',
      badgeText: 'Pending Sync',
      badgeClass: 'is-warning',
      title: `${metrics.queued} Payment${metrics.queued === 1 ? '' : 's'} Queued`,
      summary: 'Collections are saved in local storage and ready for ledger posting.',
      detail: 'Auto-sync scheduled, or click "Sync now" to upload immediately.',
    };
  }

  if (!queueReady) {
    return {
      status: 'syncing',
      badgeText: 'Initializing',
      badgeClass: 'is-info',
      title: 'Initializing Offline Storage',
      summary: 'Opening local IndexedDB storage partition…',
      detail: 'Preparing encrypted on-device payment queue.',
    };
  }

  return {
    status: 'synced',
    badgeText: 'All Synced',
    badgeClass: 'is-positive',
    title: 'Offline Queue Synchronized',
    summary: 'All recorded payments are posted and verified on the server.',
    detail: 'No pending items in device storage. Ready for field collections.',
  };
}

const badgeClass = (status: FieldCollectionRecord['status']): string => status.toLowerCase().replaceAll(' ', '-');

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="portal-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function SyncIcon({ status }: { status: QueueSyncState }) {
  if (status === 'synced') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === 'syncing') {
    return (
      <svg className="spin-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
      </svg>
    );
  }
  if (status === 'offline') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m2 2 20 20M4.14 8.7A6.5 6.5 0 0 0 2 13a6 6 0 0 0 6 6h11a5.9 5.9 0 0 0 3-1M12 4a6.5 6.5 0 0 1 6.5 6.5v.5" />
      </svg>
    );
  }
  if (status === 'attention') {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function formatLastSync(date: Date | null): string {
  if (!date) return 'Just now';
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CollectorRouteView({ queue, routeName, expectedAmount, records, metrics, queueReady, queueError, onCollect }: CollectorRouteViewProps) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : (navigator.onLine ?? true));
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(() => new Date());

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); };
  }, []);

  const pending = records.filter((record) => !['Posted', 'Rejected'].includes(record.status));
  const collected = records.reduce((total, record) => total + record.amount, 0);

  const sync = async () => {
    setSyncing(true);
    try {
      await queue.retry();
      setLastSyncAt(new Date());
    } finally {
      setSyncing(false);
    }
  };

  const isSyncing = syncing || metrics.syncing > 0;
  const syncStatus = computeQueueSyncStatus({ online, isSyncing, metrics, queueReady, queueError });

  return <div className="collector-stack">
    {/* Route & operational overview card */}
    <section className="portal-card" aria-labelledby="collector-route-title">
      <div className="portal-card-heading">
        <div>
          <p className="eyebrow">Collector route</p>
          <h2 id="collector-route-title">{routeName}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span className={`sync-status-badge sync-status-${syncStatus.status}`} data-testid="compact-sync-badge">
            <span className={`sync-status-mini-dot is-${syncStatus.status}`} aria-hidden="true" />
            <span>Queue: {syncStatus.badgeText}</span>
          </span>
          <span className={`network-pill ${online ? 'online' : 'offline'}`} role="status">
            {online ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>
      <div className="portal-metrics">
        <Metric label="Expected" value={expectedAmount === undefined ? 'Not available' : `${expectedAmount.toLocaleString()} UGX`} />
        <Metric label="Recorded" value={`${collected.toLocaleString()} UGX`} />
        <Metric label="Pending" value={String(pending.length)} />
      </div>
    </section>

    {/* Dedicated visual sync status indicator for the offline payment queue */}
    <article
      className={`queue-sync-indicator-card status-${syncStatus.status}`}
      data-testid="queue-sync-status-indicator"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="queue-sync-header">
        <div className="queue-sync-main">
          <div className={`queue-sync-icon-wrap is-${syncStatus.status}`} aria-hidden="true">
            <SyncIcon status={syncStatus.status} />
            <span className={`queue-sync-dot is-${syncStatus.status}`} />
          </div>
          <div className="queue-sync-text">
            <div className="queue-sync-title-row">
              <h3 className="queue-sync-title">{syncStatus.title}</h3>
              <span className={`queue-sync-badge ${syncStatus.badgeClass}`}>
                {syncStatus.badgeText}
              </span>
            </div>
            <p className="queue-sync-description">{syncStatus.summary}</p>
          </div>
        </div>

        <div className="queue-sync-actions">
          <button
            type="button"
            className="queue-sync-btn primary"
            onClick={() => void sync()}
            disabled={!online || isSyncing || !queueReady}
            data-testid="button-sync-now"
            aria-label="Synchronize offline queue now"
          >
            {isSyncing ? (
              <>
                <span className="spin-icon" aria-hidden="true">⟳</span>
                <span>Syncing…</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">↻</span>
                <span>Sync now</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="queue-sync-strip">
        <div className="queue-sync-counts" aria-label="Offline queue breakdown">
          <span><strong>{metrics.queued}</strong> queued</span>
          <span aria-hidden="true">·</span>
          <span><strong>{metrics.syncing}</strong> syncing</span>
          <span aria-hidden="true">·</span>
          <span><strong>{metrics.conflict}</strong> conflicts</span>
          <span aria-hidden="true">·</span>
          <span><strong>{metrics.rejected}</strong> rejected</span>
          {lastSyncAt && (
            <>
              <span aria-hidden="true">·</span>
              <span>Updated: {formatLastSync(lastSyncAt)}</span>
            </>
          )}
        </div>

        <Link
          to="/collections/offline-queue"
          className="queue-sync-link"
          data-testid="link-inspect-offline-queue"
          onClick={(e) => {
            const queueEl = document.getElementById('collector-queue-title');
            if (queueEl && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              queueEl.scrollIntoView({ behavior: 'smooth' });
            }
          }}
        >
          Inspect queue <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>

    {/* Detailed queue record ledger card */}
    <section className="portal-card" aria-labelledby="collector-queue-title">
      <div className="portal-card-heading">
        <div><p className="eyebrow">Sync status</p><h3 id="collector-queue-title">Queue</h3></div>
        <button type="button" className="secondary-button" onClick={() => void sync()} disabled={!online || isSyncing || !queueReady}>
          {isSyncing ? 'Syncing…' : 'Retry queued items'}
        </button>
      </div>
      <div className="portal-metrics queue-metrics" aria-label="Queue status">
        <Metric label="Queued" value={String(metrics.queued)} />
        <Metric label="Syncing" value={String(metrics.syncing)} />
        <Metric label="Rejected" value={String(metrics.rejected)} />
        <Metric label="Conflicts" value={String(metrics.conflict)} />
      </div>
      {!queueReady && !queueError && <p className="empty-state" role="status">Preparing offline storage…</p>}
      {queueError && <p className="form-error" role="alert">{queueError}</p>}
      {records.length === 0
        ? <p className="empty-state">No field collections recorded today.</p>
        : <div className="reporting-list">
            {records.map((record) => (
              <div className="reporting-list-row" key={record.localId}>
                <div><strong>{record.clientId}</strong><span>{record.amount.toLocaleString()} UGX · {record.paymentMethod}</span></div>
                <span className={`status-badge status-${badgeClass(record.status)}`}>{record.status}</span>
              </div>
            ))}
          </div>}
    </section>

    <button type="button" className="primary-button full-button" onClick={onCollect}>Record collection</button>
  </div>;
}

