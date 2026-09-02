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

export function CollectorRouteView({ queue, routeName, expectedAmount, records, metrics, queueReady, queueError, onCollect }: CollectorRouteViewProps) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? false : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { const onlineHandler = () => setOnline(true); const offlineHandler = () => setOnline(false); window.addEventListener('online', onlineHandler); window.addEventListener('offline', offlineHandler); return () => { window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); }; }, []);
  const pending = records.filter((record) => !['Posted', 'Rejected'].includes(record.status));
  const collected = records.reduce((total, record) => total + record.amount, 0);
  const sync = async () => { setSyncing(true); try { await queue.retry(); } finally { setSyncing(false); } };
  return <section className="field-card" aria-labelledby="collector-route-title">
    <div className="field-card-heading"><div><p className="eyebrow">Collector route</p><h2 id="collector-route-title">{routeName}</h2></div><span className={`network-pill ${online ? 'online' : 'offline'}`} role="status">{online ? 'Online' : 'Offline'}</span></div>
    <div className="metric-grid"><div><span>Expected</span><strong>{expectedAmount === undefined ? 'Not available' : `${expectedAmount.toLocaleString()} UGX`}</strong></div><div><span>Recorded</span><strong>{collected.toLocaleString()} UGX</strong></div><div><span>Pending</span><strong>{pending.length}</strong></div></div>
    <div className="field-card-heading queue-heading"><h3>Queue</h3><button type="button" className="secondary-button" onClick={() => void sync()} disabled={!online || syncing || !queueReady}>{syncing || metrics.syncing > 0 ? 'Syncing…' : 'Retry queued items'}</button></div>
    <div className="metric-grid queue-metrics" aria-label="Queue status"><div><span>Queued</span><strong>{metrics.queued}</strong></div><div><span>Syncing</span><strong>{metrics.syncing}</strong></div><div><span>Rejected</span><strong>{metrics.rejected}</strong></div><div><span>Conflicts</span><strong>{metrics.conflict}</strong></div></div>
    {!queueReady && !queueError && <p className="empty-state" role="status">Preparing offline storage…</p>}
    {queueError && <p className="form-error" role="alert">{queueError}</p>}
    {records.length === 0 ? <p className="empty-state">No field collections recorded today.</p> : <ul className="queue-list">{records.map((record) => <li key={record.localId}><div><strong>{record.clientId}</strong><span>{record.amount.toLocaleString()} UGX · {record.paymentMethod}</span></div><span className={`status-badge ${badgeClass(record.status)}`}>{record.status}</span></li>)}</ul>}
    <button type="button" className="primary-button full-button" onClick={onCollect}>Record collection</button>
  </section>;
}
