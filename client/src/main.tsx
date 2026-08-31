import { StrictMode, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { CollectorRouteView } from './components/field/CollectorRouteView.js';
import { FieldCollectionForm } from './components/field/FieldCollectionForm.js';
import { OfflineQueue, createPaymentSync } from './services/offlineQueue.js';
import { getCollectionQueue, getHealth, getReconciliationQueue, getSession, type CollectionRecordResult, type ReconciliationQueueBatch } from './services/api.js';
import { getFirebaseIdToken, signOutFirebase, subscribeToFirebaseAuth, type AuthIdentity, type AuthSession } from './services/firebase.js';
import type { FieldCollectionRecord, QueueMetrics, QueueSnapshot } from './types/field-ops.js';
import { PortalDashboard } from './components/portals/PortalDashboard.js';
import { SignInCard } from './components/auth/SignInCard.js';

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

function serverRecordToFieldRecord(record: CollectionRecordResult): FieldCollectionRecord {
  const status = record.status === 'posted' ? 'Posted' : record.status === 'pending_reconciliation' ? 'Pending reconciliation' : record.status === 'recorded' ? 'Recorded' : 'Needs review';
  return {
    localId: record.localId,
    idempotencyKey: record.idempotencyKey,
    clientId: record.clientId ?? 'Unknown client',
    loanId: record.loanId ?? 'Unknown loan',
    branchId: record.branchId,
    collectorId: record.collectorId ?? 'Unknown collector',
    amount: record.amount,
    paymentMethod: record.paymentMethod === 'mobile_money' ? 'mobile_money' : 'cash',
    status,
    syncState: status === 'Posted' ? 'succeeded' : 'queued',
    deviceId: record.deviceId,
    receiptReference: record.receiptReference ?? undefined,
    correlationId: record.id,
    capturedAt: record.capturedAt,
    updatedAt: record.syncedAt ?? record.createdAt,
    syncedAt: record.syncedAt ?? undefined,
    retryCount: 0,
  };
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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [identityError, setIdentityError] = useState('');
  const [serverRecords, setServerRecords] = useState<FieldCollectionRecord[]>([]);
  const [reconciliationBatches, setReconciliationBatches] = useState<ReconciliationQueueBatch[]>([]);

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

  useEffect(() => subscribeToFirebaseAuth((nextSession) => { setSession(nextSession); setAuthLoading(false); }), []);

  useEffect(() => {
    let active = true;
    if (!session) { setIdentity(null); setIdentityError(''); setServerRecords([]); setReconciliationBatches([]); return () => { active = false; }; }
    setIdentityLoading(true);
    void (async () => {
      try {
        const token = await getFirebaseIdToken();
        if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
        const profile = await getSession(token);
        const nextIdentity: AuthIdentity = { uid: session.uid, userId: profile.userId, collectorId: profile.userId, role: profile.role as AuthIdentity['role'], branchId: profile.branchId, clientId: profile.clientId, permissions: profile.permissions };
        if (!active) return;
        setIdentity(nextIdentity);
        setIdentityError('');
        await queue.retry();
        const collections = await getCollectionQueue(token);
        if (active) setServerRecords(collections.records.map(serverRecordToFieldRecord));
        if (['admin', 'manager'].includes(nextIdentity.role)) {
          const reconciliations = await getReconciliationQueue(token);
          if (active) setReconciliationBatches(reconciliations.batches);
        } else if (active) setReconciliationBatches([]);
      } catch (error) {
        if (active) { setIdentity(null); setIdentityError(error instanceof Error && error.message === 'USER_NOT_FOUND' ? 'Your Firebase account is not mapped to an active Upfund account.' : 'Could not load your authorized workspace. Check your connection and try again.'); setServerRecords([]); setReconciliationBatches([]); }
      } finally {
        if (active) setIdentityLoading(false);
      }
    })();
    return () => { active = false; };
  }, [queue, session]);

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
  const portalContext = identity && ['admin', 'manager', 'officer', 'client', 'marketing'].includes(identity.role);
  const routeName = identity?.branchName ? `${identity.branchName} route` : 'Assigned collection route';

  const displayedRecords = [...serverRecords, ...records.filter((local) => !serverRecords.some((server) => server.localId === local.localId))];
  return (
    <main className="shell">
      <header className="app-header">
        <div className="header-topline">
          <div>
            <p className="eyebrow">UPFUND MICROCREDIT · FIELD OPERATIONS</p>
            <h1>Upfund Microcredit</h1>
            <p className="lede">Offline-ready collections with server-authoritative posting.</p>
          </div>
          {session && <button className="text-button sign-out-button" type="button" onClick={() => void signOutFirebase()}>Sign out</button>}
        </div>
        <div className={`status ${backendLive ? '' : 'offline'}`} role="status"><span className="dot" />Backend: {backendLive ? 'Live' : 'Unavailable'}</div>
        {authLoading ? <p className="empty-state" role="status">Loading authenticated workspace…</p>
          : !session ? <SignInCard />
            : identityLoading ? <p className="empty-state" role="status">Loading your authorized workspace…</p>
              : identity ? <p className="auth-context" role="status">Signed in as {session.email ?? session.uid} · {identity.role} · Branch: {identity.branchId ?? 'Unassigned'}</p>
                : <p className="form-error" role="alert">{identityError || 'This account is not authorized for field operations.'}</p>}
      </header>

      {identity && (portalContext
        ? <PortalDashboard identity={identity} />
        : collectorContextReady
          ? <div className="workflow-grid">
            <CollectorRouteView queue={queue} routeName={routeName} records={displayedRecords} metrics={metrics} queueReady={queueReady} queueError={queueError} onCollect={() => document.getElementById('collection-form')?.scrollIntoView({ behavior: 'smooth' })} />
            <div id="collection-form">
              <FieldCollectionForm queue={queue} collectorId={identity.collectorId} branchId={identity.branchId!} deviceId={getDeviceId()} onQueued={addRecord} disabled={!queueReady || Boolean(queueError)} />
            </div>
            {lastRecord && <Suspense fallback={<p className="empty-state">Loading receipt…</p>}><LazyReceiptPreview clientId={lastRecord.clientId} loanId={lastRecord.loanId} amount={lastRecord.amount} collectorId={lastRecord.collectorId} capturedAt={lastRecord.capturedAt} status={lastRecord.status} receiptReference={lastRecord.receiptReference} principalAmount={lastRecord.amount} /></Suspense>}
          </div>
          : <p className="empty-state workflow-empty">{identity.role === 'collector' ? 'This account has no branch assignment, so collections are unavailable.' : 'No field collection workflow is assigned to this account.'}</p>)}

      {managerContext && <Suspense fallback={<p className="empty-state">Loading manager review…</p>}>
        <LazyManagerVarianceDashboard batches={reconciliationBatches.map((batch) => ({
          batchReference: batch.batchReference,
          branchId: batch.branchId,
          collectionDate: batch.collectionDate,
          expectedAmount: batch.expectedAmount,
          recordedAmount: batch.recordedAmount,
          submittedAmount: batch.submittedAmount,
          variance: batch.variance,
          status: batch.status,
          decisionReason: batch.decisionReason,
          reviewedAt: batch.reviewedAt,
          submittedBy: batch.submittedByName ?? batch.submittedBy,
          payments: batch.payments.map((payment) => ({
            paymentId: payment.paymentId,
            clientId: payment.clientId ?? 'Unknown client',
            amount: payment.amount,
            receiptReference: payment.receiptReference ?? undefined,
            status: payment.status,
          })),
        }))} branchId={managerContext.branchId} getToken={async () => {
          const token = await getFirebaseIdToken();
          if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
          return token;
        }} onResolved={(batchReference) => setReconciliationBatches((current) => current.filter((batch) => batch.batchReference !== batchReference))} />
      </Suspense>}
      <footer className="footer">System version v{appVersion} ({gitSha}) · Backend: {backendLive ? 'Live' : 'Unavailable'}</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
