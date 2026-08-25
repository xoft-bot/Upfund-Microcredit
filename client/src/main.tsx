import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { CollectorRouteView } from './components/field/CollectorRouteView.js';
import { FieldCollectionForm } from './components/field/FieldCollectionForm.js';
import { ManagerVarianceDashboard, type VarianceBatch } from './components/field/ManagerVarianceDashboard.js';
import { ReceiptPreview } from './components/field/ReceiptPreview.js';
import { OfflineQueue, createPaymentSync } from './services/offlineQueue.js';
import type { FieldCollectionRecord } from './types/field-ops.js';

function App() {
  const queue = useMemo(() => new OfflineQueue(createPaymentSync()), []);
  const [records, setRecords] = useState<FieldCollectionRecord[]>([]);
  const [lastRecord, setLastRecord] = useState<FieldCollectionRecord>();
  useEffect(() => { void queue.open().then(() => queue.getRecords().then(setRecords)); queue.start(); return () => queue.stop(); }, [queue]);
  const addRecord = (record: FieldCollectionRecord) => { setRecords((current) => [...current, record]); setLastRecord(record); };
  const batch: VarianceBatch = { batchReference: 'DEMO-BATCH-001', branchId: 'branch-demo', collectionDate: new Date().toISOString().slice(0, 10), expectedAmount: 100000, recordedAmount: 95000, submittedAmount: 95000, variance: -5000, status: 'variance', submittedBy: 'collector-demo', payments: records.map((record) => ({ paymentId: record.localId, clientId: record.clientId, amount: record.amount, receiptReference: record.receiptReference, status: record.status })) };
  return <main className="shell"><header className="app-header"><p className="eyebrow">FIELD OPERATIONS · STAGE 3</p><h1>Letsgrow Microcredit</h1><p className="lede">Offline-ready collections with server-authoritative posting.</p></header><div className="workflow-grid"><CollectorRouteView queue={queue} routeName="Kampala Central route" expectedAmount={100000} records={records} onCollect={() => document.getElementById('collection-form')?.scrollIntoView({ behavior: 'smooth' })} /><div id="collection-form"><FieldCollectionForm queue={queue} collectorId="collector-demo" branchId="branch-demo" deviceId="device-demo" onQueued={addRecord} /></div>{lastRecord && <ReceiptPreview clientId={lastRecord.clientId} loanId={lastRecord.loanId} amount={lastRecord.amount} collectorId={lastRecord.collectorId} capturedAt={lastRecord.capturedAt} status={lastRecord.status} receiptReference={lastRecord.receiptReference} principalAmount={lastRecord.amount} />}</div><ManagerVarianceDashboard batches={[batch]} getToken={async () => ''} onResolved={() => undefined} /><footer className="footer">System version 1.0.01 · Backend routes frozen</footer></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
