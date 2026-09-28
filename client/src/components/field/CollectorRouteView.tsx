import { useEffect, useState } from 'react';
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

const badgeClass = (status: FieldCollectionRecord['status']): string => status.toLowerCase().replaceAll(' ', '-');

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="portal-metric"><span>{label}</span><strong>{value}</strong></div>;
}

export function CollectorRouteView({ queue, routeName, expectedAmount, records, metrics, queueReady, queueError, onCollect }: CollectorRouteViewProps) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? false : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => { window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); };
  }, []);
  const pending = records.filter((record) => !['Posted', 'Rejected'].includes(record.status));
  const collected = records.reduce((total, record) => total + record.amount, 0);
  const sync = async () => { setSyncing(true); try { await queue.retry(); } finally { setSyncing(false); } };
  const isSyncing = syncing || metrics.syncing > 0;

  return <div className="collector-stack">
    <section className="portal-card" aria-labelledby="collector-route-title">
      <div className="portal-card-heading">
        <div><p className="eyebrow">Collector route</p><h2 id="collector-route-title">{routeName}</h2></div>
        <span className={`network-pill ${online ? 'online' : 'offline'}`} role="status">{online ? 'Online' : 'Offline'}</span>
      </div>
      <div className="portal-metrics">
        <Metric label="Expected" value={expectedAmount === undefined ? 'Not available' : `${expectedAmount.toLocaleString()} UGX`} />
        <Metric label="Recorded" value={`${collected.toLocaleString()} UGX`} />
        <Metric label="Pending" value={String(pending.length)} />
      </div>
    </section>

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
