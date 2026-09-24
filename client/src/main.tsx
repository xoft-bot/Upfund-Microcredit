import { StrictMode, Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import './shell.css';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { CollectorRouteView } from './components/field/CollectorRouteView.js';
import { FieldCollectionForm } from './components/field/FieldCollectionForm.js';
import { OfflineQueue, createPaymentSync } from './services/offlineQueue.js';
import { ApiRequestError, getAssignedLoans, getCollectionQueue, getHealth, getReconciliationQueue, getSession, type AssignedLoanOption, type CollectionRecordResult, type ReconciliationQueueBatch } from './services/api.js';
import { getFirebaseIdToken, signOutFirebase, subscribeToFirebaseAuth, type AuthIdentity, type AuthSession } from './services/firebase.js';
import { telemetry } from './services/telemetry.js';
import type { FieldCollectionRecord, QueueMetrics, QueueSnapshot } from './types/field-ops.js';
import { CollectorReportingDashboard } from './components/portals/CollectorReportingDashboard.js';
import { SignInCard } from './components/auth/SignInCard.js';
import { AppRoutes } from './routes.js';

const appVersion = import.meta.env.VITE_APP_VERSION ?? '1.0.01';
const gitSha = import.meta.env.VITE_GIT_SHA ?? 'dev';
const LazyManagerVarianceDashboard = lazy(async () => { const module = await import('./components/field/ManagerVarianceDashboard.js'); return { default: module.ManagerVarianceDashboard }; });
const LazyReceiptPreview = lazy(async () => { const module = await import('./components/field/ReceiptPreview.js'); return { default: module.ReceiptPreview }; });
const emptyMetrics: QueueMetrics = { queued: 0, syncing: 0, rejected: 0, conflict: 0, stale: 0 };
const COLLECTION_QUEUE_ROLES = ['admin', 'manager', 'officer', 'collector'];

// Module-level so its identity is stable for effects in the shell (search, counts).
async function getToken(): Promise<string> {
  const token = await getFirebaseIdToken();
  if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
  return token;
}

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
  const [assignedLoans, setAssignedLoans] = useState<AssignedLoanOption[]>([]);

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
    // Bind the offline queue's storage to whoever is currently authenticated
    // (or the anonymous namespace on sign-out) before touching any queued
    // records — see OfflineQueue.bindUser for why this matters on shared
    // devices.
    void queue.bindUser(session?.uid);
    if (!session) { setIdentity(null); setIdentityError(''); setServerRecords([]); setReconciliationBatches([]); setAssignedLoans([]); return () => { active = false; }; }
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
        // Admins have no branchId of their own (they're a cross-branch
        // role) — the server already supports admins passing one
        // explicitly via a query param, but there's no branch-picker UI
        // yet. Until there is, an admin can bookmark/visit
        // ?branchId=<id> to view that branch's queues; with none given,
        // skip these branch-scoped calls entirely instead of erroring —
        // an admin viewing no specific branch has nothing branch-scoped
        // to show, which isn't a failure.
        const adminSelectedBranchId = nextIdentity.role === 'admin'
          ? new URLSearchParams(window.location.search).get('branchId') ?? undefined
          : undefined;
        const canLoadBranchScoped = nextIdentity.role !== 'admin' || Boolean(adminSelectedBranchId);
        if (COLLECTION_QUEUE_ROLES.includes(nextIdentity.role) && canLoadBranchScoped) {
          const collections = await getCollectionQueue(token, { branchId: adminSelectedBranchId });
          if (active) setServerRecords(collections.records.map(serverRecordToFieldRecord));
        } else if (active) setServerRecords([]);
        if (['collector', 'officer'].includes(nextIdentity.role)) {
          const assigned = await getAssignedLoans(token);
          if (active) setAssignedLoans(assigned.loans);
        } else if (active) setAssignedLoans([]);
        if (['admin', 'manager'].includes(nextIdentity.role) && canLoadBranchScoped) {
          const reconciliations = await getReconciliationQueue(token, { branchId: adminSelectedBranchId });
          if (active) setReconciliationBatches(reconciliations.batches);
        } else if (active) setReconciliationBatches([]);
        if (active && nextIdentity.role === 'admin' && !adminSelectedBranchId) {
          setIdentityError('Admin view: add ?branchId=<id> to the URL to see that branch\'s queues.');
        }
      } catch (error) {
        if (active) {
          setIdentity(null);
          setIdentityError(
            error instanceof ApiRequestError && error.code === 'USER_NOT_FOUND' ? 'Your Firebase account is not mapped to an active Upfund account.'
              : error instanceof ApiRequestError && error.code === 'BRANCH_REQUIRED' ? 'Your account has no branch assigned, so this workspace cannot load.'
                : error instanceof ApiRequestError && error.code === 'FORBIDDEN' ? 'Your account does not have permission to view this data.'
                  : 'Could not load your authorized workspace. Check your connection and try again.'
          );
          setServerRecords([]); setReconciliationBatches([]); setAssignedLoans([]);
        }
      } finally {
        if (active) setIdentityLoading(false);
      }
    })();
    return () => { active = false; };
  }, [queue, session]);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      telemetry.capture('pwa.service_worker_registration_failed', { reason: error instanceof Error ? error.message : 'SERVICE_WORKER_REGISTRATION_FAILED' });
    });
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
  const collectorContextReady = Boolean(identity && ['collector', 'officer'].includes(identity.role) && identity.branchId);
  const managerContext = identity && ['admin', 'manager'].includes(identity.role) ? identity : null;
  const routeName = identity?.branchName ? `${identity.branchName} route` : 'Assigned collection route';
  const displayedRecords = [...serverRecords, ...records.filter((local) => !serverRecords.some((server) => server.localId === local.localId))];

  // Before sign-in (and while identity loads) keep the original header, without the shell.
  if (!identity) {
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
                : <p className="form-error" role="alert">{identityError || 'This account is not authorized for field operations.'}</p>}
        </header>
        <footer className="footer">System version v{appVersion} ({gitSha}) · Backend: {backendLive ? 'Live' : 'Unavailable'}</footer>
      </main>
    );
  }

  // Existing collector workflow, unchanged, mounted as the content of Today / Capture.
  const collectorHome = collectorContextReady
    ? <div className="workflow-grid">
      <CollectorReportingDashboard identity={identity} />
      <CollectorRouteView queue={queue} routeName={routeName} records={displayedRecords} metrics={metrics} queueReady={queueReady} queueError={queueError} onCollect={() => document.getElementById('collection-form')?.scrollIntoView({ behavior: 'smooth' })} />
      <div id="collection-form">
        <FieldCollectionForm queue={queue} collectorId={identity.collectorId} branchId={identity.branchId!} deviceId={getDeviceId()} assignedLoans={assignedLoans} onQueued={addRecord} disabled={!queueReady || Boolean(queueError)} />
      </div>
      {lastRecord && <Suspense fallback={<p className="empty-state">Loading receipt…</p>}><LazyReceiptPreview clientId={lastRecord.clientId} loanId={lastRecord.loanId} amount={lastRecord.amount} collectorId={lastRecord.collectorId} capturedAt={lastRecord.capturedAt} status={lastRecord.status} receiptReference={lastRecord.receiptReference} principalAmount={lastRecord.amount} /></Suspense>}
    </div>
    : <p className="empty-state workflow-empty">{['collector', 'officer'].includes(identity.role) ? 'This account has no branch assignment, so collections are unavailable.' : 'No field collection workflow is assigned to this account.'}</p>;

  // Existing manager variance dashboard, unchanged, mounted as the content of Reconciliation.
  const reconciliation = managerContext
    ? <Suspense fallback={<p className="empty-state">Loading manager review…</p>}>
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
      }))} branchId={managerContext.branchId} getToken={getToken} onResolved={(batchReference) => setReconciliationBatches((current) => current.filter((batch) => batch.batchReference !== batchReference))} />
    </Suspense>
    : null;

  return (
    <BrowserRouter>
      <AppRoutes
        shell={{ identity, email: session?.email ?? undefined, backendLive, identityError, onSignOut: () => void signOutFirebase(), getToken, versionLabel: `System version v${appVersion} (${gitSha})` }}
        collectorHome={collectorHome}
        reconciliation={reconciliation}
      />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
