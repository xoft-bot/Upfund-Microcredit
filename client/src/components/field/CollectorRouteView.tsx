import { useEffect, useState } from 'react';
import type { FieldCollectionRecord } from '../../types/field-ops.js';
import { OfflineQueue } from '../../services/offlineQueue.js';

interface CollectorRouteViewProps { queue: OfflineQueue; routeName: string; expectedAmount: number; records: FieldCollectionRecord[]; onCollect: () => void; }

const badgeClass = (status: FieldCollectionRecord['status']): string => status.toLowerCase().replaceAll(' ', '-');

export function CollectorRouteView({ queue, routeName, expectedAmount, records, onCollect }: CollectorRouteViewProps) {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? false : navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => { const onlineHandler = () => setOnline(true); const offlineHandler = () => setOnline(false); window.addEventListener('online', onlineHandler); window.addEventListener('offline', offlineHandler); return () => { window.removeEventListener('online', onlineHandler); window.removeEventListener('offline', offlineHandler); }; }, []);
  const pending = records.filter((record) => !['Posted', 'Rejected'].includes(record.status));
  const collected = records.reduce((total, record) => total + record.amount, 0);
  const sync = async () => { setSyncing(true); await queue.processQueued(); setSyncing(false); };
  return <section className="field-card" aria-labelledby="collector-route-title">
    <div className="field-card-heading"><div><p className="eyebrow">Collector route</p><h2 id="collector-route-title">{routeName}</h2></div><span className={`network-pill ${online ? 'online' : 'offline'}`} role="status">{online ? 'Online' : 'Offline'}</span></div>
    <div className="metric-grid"><div><span>Expected</span><strong>{expectedAmount.toLocaleString()} UGX</strong></div><div><span>Recorded</span><strong>{collected.toLocaleString()} UGX</strong></div><div><span>Pending</span><strong>{pending.length}</strong></div></div>
    <div className="field-card-heading queue-heading"><h3>Queue</h3><button type="button" className="secondary-button" onClick={() => void sync()} disabled={!online || syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button></div>
    {records.length === 0 ? <p className="empty-state">No field collections recorded today.</p> : <ul className="queue-list">{records.map((record) => <li key={record.localId}><div><strong>{record.clientId}</strong><span>{record.amount.toLocaleString()} UGX · {record.paymentMethod}</span></div><span className={`status-badge ${badgeClass(record.status)}`}>{record.status}</span></li>)}</ul>}
    <button type="button" className="primary-button full-button" onClick={onCollect}>Record collection</button>
  </section>;
}
