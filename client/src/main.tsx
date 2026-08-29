import { StrictMode, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { CollectorRouteView } from './components/field/CollectorRouteView.js';
import { FieldCollectionForm } from './components/field/FieldCollectionForm.js';
import { OfflineQueue, createPaymentSync } from './services/offlineQueue.js';
import { getHealth } from './services/api.js';
import { getFirebaseIdToken, subscribeToFirebaseAuth, type AuthIdentity } from './services/firebase.js';
import type { FieldCollectionRecord, QueueMetrics, QueueSnapshot } from './types/field-ops.js';

const appVersion = import.meta.env.VITE_APP_VERSION ?? '1.0.01';
const gitSha = import.meta.env.VITE_GIT_SHA ?? 'dev';
const LazyManagerVarianceDashboard = lazy(async () => { const module = await import('./components/field/ManagerVarianceDashboard.js'); return { default: module.ManagerVarianceDashboard }; });
const LazyReceiptPreview = lazy(async () => { const module = await import('./components/field/ReceiptPreview.js'); return { default: module.ReceiptPreview }; });
const emptyMetrics: QueueMetrics = { queued: 0, syncing: 0, rejected: 0, conflict: 0 };

function getDeviceId(): string {
  const key = 'letsgrow-field-ops-device-id';
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function App() {
  const queue = useMemo(() => new OfflineQueue(createPaymentSync(getFirebaseIdToken)), []);
  const [records, setRecords] = useState<FieldCollectionRecord[]>([]);
  const [lastRecord, setLastRecord] = useState<FieldCollectionRecord>();
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>({ records: [], batches: [], metrics: emptyMetrics });
  const [queueReady, setQueueReady] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [backendLive, setBackendLive] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = queue.subscribe((snapshot) => {
      if (active) { setQueueSnapshot(snapshot); setRecords(snapshot.records); }
    });
    void (async () => {
      try {
        await queue.open();
        if (!active) return;
        const snapshot = await queue.getSnapshot();
        setQueueSnapshot(snapshot);
        setRecords(snapshot.records);
        setQueueReady(true);
        await queue.start();
      } catch (error) {
        if (active) setQueueError(error instanceof Error ? error.message : 'OFFLINE_STORAGE_UNAVAILABLE');
      }
    })();
    return () => { active = false; unsubscribe(); queue.stop(); };
  }, [queue]);

  useEffect(() => subscribeToFirebaseAuth((nextIdentity) => { setIdentity(nextIdentity); setAuthLoading(false); }), []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    const checkBackend = async () => {
      try {
        const health = await getHealth();
        if (active) setBackendLive(health.database === 'up');
      } catch {
        if (active) setBackendLive(false);
      }
    };
    void checkBackend();
    const timer = window.setInterval(() => void checkBackend(), 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const addRecord = (record: FieldCollectionRecord) => { setRecords((current) => [...current.filter((item) => item.localId !== record.localId), record]); setLastRecord(record); };
  const metrics = queueSnapshot.metrics ?? emptyMetrics;
  const collectorContextReady = identity?.role === 'collector' && Boolean(identity.branchId);
  const managerContext = identity && ['admin', 'manager', 'accountant'].includes(identity.role) ? identity : null;
  const routeName = identity?.branchName ? `${identity.branchName} route` : 'Assigned collection route';

  return <main className="shell"><header className="app-header"><p className="eyebrow">UPFUND MICROCREDIT · FIELD OPERATIONS</p><h1>Upfund Microcredit</h1><p className="lede">Offline-ready collections with server-authoritative posting.</p><div className={`status ${backendLive ? '' : 'offline'}`} role="status"><span className="dot" />Backend: {backendLive ? 'Live' : 'Unavailable'}</div>{authLoading ? <p className="empty-state" role="status">Loading authenticated workspace…</p> : identity ? <p className="auth-context" role="status">Signed in as {identity.role} · Branch: {identity.branchId ?? 'Unassigned'}</p> : <p className="form-error" role="alert">Sign in with an authorized Firebase account to access field operations.</p>}</header>{collectorContextReady ? <div className="workflow-grid"><CollectorRouteView queue={queue} routeName={routeName} records={records} metrics={metrics} queueReady={queueReady} queueError={queueError} onCollect={() => document.getElementById('collection-form')?.scrollIntoView({ behavior: 'smooth' })} /><div id="collection-form"><FieldCollectionForm queue={queue} collectorId={identity.collectorId} branchId={identity.branchId!} deviceId={getDeviceId()} onQueued={addRecord} disabled={!queueReady || Boolean(queueError)} /></div>{lastRecord && <Suspense fallback={<p className="empty-state">Loading receipt…</p>}><LazyReceiptPreview clientId={lastRecord.clientId} loanId={lastRecord.loanId} amount={lastRecord.amount} collectorId={lastRecord.collectorId} capturedAt={lastRecord.capturedAt} status={lastRecord.status} receiptReference={lastRecord.receiptReference} principalAmount={lastRecord.amount} /></Suspense>}</div> : !authLoading && identity && <p className="empty-state workflow-empty">{identity.role === 'collector' ? 'This account has no branch assignment, so collections are unavailable.' : 'No field collection workflow is assigned to this account.'}</p>}{managerContext && <Suspense fallback={<p className="empty-state">Loading manager review…</p>}><LazyManagerVarianceDashboard batches={[]} branchId={managerContext.branchId} getToken={async () => { const token = await getFirebaseIdToken(); if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE'); return token; }} onResolved={() => undefined} /></Suspense>}<footer className="footer">System version v{appVersion} ({gitSha}) · Backend: {backendLive ? 'Live' : 'Unavailable'}</footer></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
