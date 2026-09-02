import { FormEvent, useMemo, useState } from 'react';
import './_group.css';

type CollectionStatus = 'Posted' | 'Pending reconciliation' | 'Needs review';
type PaymentMethod = 'cash' | 'mobile_money';

interface Collection {
  localId: string;
  clientId: string;
  loanId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: CollectionStatus;
  capturedAt: string;
  receiptReference?: string;
}

interface VarianceBatch {
  batchReference: string;
  branchId: string;
  collectionDate: string;
  expectedAmount: number;
  recordedAmount: number;
  submittedAmount: number;
  variance: number;
  status: string;
  payments: Collection[];
}

const initialRecords: Collection[] = [
  {
    localId: 'collection-001',
    clientId: 'CL-1048',
    loanId: 'LN-2048',
    amount: 45000,
    paymentMethod: 'mobile_money',
    status: 'Posted',
    capturedAt: '2026-08-28T08:42:00.000Z',
    receiptReference: 'UPF-0828-1048',
  },
  {
    localId: 'collection-002',
    clientId: 'CL-1172',
    loanId: 'LN-2172',
    amount: 50000,
    paymentMethod: 'cash',
    status: 'Pending reconciliation',
    capturedAt: '2026-08-28T10:16:00.000Z',
    receiptReference: 'UPF-0828-1172',
  },
];

const formatAmount = (amount: number, includeCurrency = true) =>
  `${amount.toLocaleString()}${includeCurrency ? ' UGX' : ''}`;

const badgeClass = (status: string): string => status.toLowerCase().replaceAll(' ', '-');

function CollectorRoute({ records, online, onSync, onRecord }: {
  records: Collection[];
  online: boolean;
  onSync: () => void;
  onRecord: () => void;
}) {
  const pending = records.filter((record) => !['Posted', 'Rejected'].includes(record.status));
  const collected = records.reduce((total, record) => total + record.amount, 0);

  return (
    <section className="field-card" aria-labelledby="collector-route-title">
      <div className="field-card-heading">
        <div>
          <p className="eyebrow">Collector route</p>
          <h2 id="collector-route-title">Kampala Central route</h2>
        </div>
        <span className={`network-pill ${online ? 'online' : 'offline'}`} role="status">
          {online ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="metric-grid">
        <div><span>Expected</span><strong>{formatAmount(100000)}</strong></div>
        <div><span>Recorded</span><strong>{formatAmount(collected)}</strong></div>
        <div><span>Pending</span><strong>{pending.length}</strong></div>
      </div>
      <div className="field-card-heading queue-heading">
        <h3>Queue</h3>
        <button type="button" className="secondary-button" onClick={onSync} disabled={!online}>
          Sync now
        </button>
      </div>
      <ul className="queue-list">
        {records.map((record) => (
          <li key={record.localId}>
            <div>
              <strong>{record.clientId}</strong>
              <span>{formatAmount(record.amount)} · {record.paymentMethod === 'cash' ? 'Cash' : 'Mobile money'}</span>
            </div>
            <span className={`status-badge ${badgeClass(record.status)}`}>{record.status}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="primary-button full-button" onClick={onRecord}>
        Record collection
      </button>
    </section>
  );
}

function CollectionForm({ onSaved }: { onSaved: (record: Collection) => void }) {
  const [clientId, setClientId] = useState('');
  const [loanId, setLoanId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    const parsedAmount = Number(amount);
    if (!clientId.trim() || !loanId.trim()) {
      setError('Client and loan references are required.');
      return;
    }
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      setError('Enter a whole amount greater than zero.');
      return;
    }
    const record: Collection = {
      localId: `collection-${Date.now()}`,
      clientId: clientId.trim(),
      loanId: loanId.trim(),
      amount: parsedAmount,
      paymentMethod: method,
      status: 'Pending reconciliation',
      capturedAt: new Date().toISOString(),
      receiptReference: `UPF-0828-${clientId.trim().replace(/\W/g, '').slice(-4)}`,
    };
    onSaved(record);
    setClientId('');
    setLoanId('');
    setAmount('');
    setSaved(true);
  };

  return (
    <form className="field-card collection-form" onSubmit={submit} noValidate aria-labelledby="collection-form-title">
      <p className="eyebrow">Daily collection</p>
      <h2 id="collection-form-title">Record payment</h2>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="form-success" role="status">Saved to the offline queue.</p>}
      <label>Client reference<input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" required /></label>
      <label>Loan reference<input value={loanId} onChange={(event) => setLoanId(event.target.value)} autoComplete="off" required /></label>
      <label>Amount (UGX)<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" min="1" step="1" required /></label>
      <label>Payment method
        <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile money</option>
        </select>
      </label>
      <button className="primary-button full-button" type="submit">Save collection</button>
    </form>
  );
}

function Receipt({ record }: { record: Collection }) {
  return (
    <section className="receipt-card" aria-labelledby="receipt-title">
      <div className="receipt-toolbar">
        <div><p className="eyebrow">Latest receipt</p><h2 id="receipt-title">Collection receipt</h2></div>
        <span className={`status-badge ${badgeClass(record.status)}`}>{record.status}</span>
      </div>
      <div className="receipt-paper">
        <dl className="receipt-details">
          <div><dt>Client</dt><dd>{record.clientId}</dd></div>
          <div><dt>Loan</dt><dd>{record.loanId}</dd></div>
          <div><dt>Amount</dt><dd>{formatAmount(record.amount)}</dd></div>
          <div><dt>Method</dt><dd>{record.paymentMethod === 'cash' ? 'Cash' : 'Mobile money'}</dd></div>
          <div><dt>Reference</dt><dd>{record.receiptReference}</dd></div>
        </dl>
        <p className="receipt-footer">Captured for collector-demo · {new Date(record.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <button type="button" className="secondary-button full-button print-button" onClick={() => window.print()}>Print receipt</button>
    </section>
  );
}

function ManagerReview({ batch }: { batch: VarianceBatch }) {
  const [selected, setSelected] = useState(false);
  const [reason, setReason] = useState('');
  const [resolved, setResolved] = useState(false);

  return (
    <section className="field-card manager-dashboard" aria-labelledby="variance-title">
      <p className="eyebrow">Manager review</p>
      <h2 id="variance-title">Reconciliation variances</h2>
      {resolved ? (
        <p className="form-success" role="status">Variance decision recorded for {batch.batchReference}.</p>
      ) : (
        <div className="variance-list">
          <button className="variance-row" type="button" onClick={() => setSelected(true)}>
            <span><strong>{batch.batchReference}</strong><small>{batch.collectionDate} · {batch.branchId}</small></span>
            <span><strong>{formatAmount(batch.variance)}</strong><small>{batch.status}</small></span>
          </button>
        </div>
      )}
      {selected && !resolved && (
        <div className="variance-detail" aria-live="polite">
          <div className="field-card-heading">
            <h3>{batch.batchReference}</h3>
            <button className="text-button" type="button" onClick={() => setSelected(false)}>Close</button>
          </div>
          <div className="metric-grid">
            <div><span>Expected</span><strong>{formatAmount(batch.expectedAmount, false)}</strong></div>
            <div><span>Recorded</span><strong>{formatAmount(batch.recordedAmount, false)}</strong></div>
            <div><span>Submitted</span><strong>{formatAmount(batch.submittedAmount, false)}</strong></div>
            <div><span>Variance</span><strong>{formatAmount(batch.variance, false)}</strong></div>
          </div>
          <ul className="payment-evidence">
            {batch.payments.map((payment) => (
              <li key={payment.localId}>
                <span>{payment.clientId} · {formatAmount(payment.amount)}</span>
                <small>{payment.receiptReference} · {payment.status}</small>
              </li>
            ))}
          </ul>
          <label>Decision reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required /></label>
          <div className="action-row">
            <button className="secondary-button" type="button" onClick={() => setResolved(true)} disabled={!reason.trim()}>Reject</button>
            <button className="primary-button" type="button" onClick={() => setResolved(true)} disabled={!reason.trim()}>Approve variance</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function Current() {
  const [records, setRecords] = useState(initialRecords);
  const [online, setOnline] = useState(true);
  const lastRecord = records[records.length - 1];
  const batch = useMemo<VarianceBatch>(() => ({
    batchReference: 'DEMO-BATCH-001',
    branchId: 'Kampala Central',
    collectionDate: '2026-08-28',
    expectedAmount: 100000,
    recordedAmount: records.reduce((total, record) => total + record.amount, 0),
    submittedAmount: records.reduce((total, record) => total + record.amount, 0),
    variance: records.reduce((total, record) => total + record.amount, 0) - 100000,
    status: 'Needs review',
    payments: records,
  }), [records]);

  return (
    <div className="mockup-page">
      <main className="shell">
        <header className="app-header">
          <p className="eyebrow">UPFUND MICROCREDIT · FIELD OPERATIONS</p>
          <h1>Upfund Microcredit</h1>
          <p className="lede">Offline-ready collections with server-authoritative posting.</p>
          <button type="button" className={`status ${online ? '' : 'offline'}`} onClick={() => setOnline((current) => !current)} aria-label="Toggle network preview">
            <span className="dot" />Backend: {online ? 'Live' : 'Unavailable'}
          </button>
        </header>
        <div className="workflow-grid">
          <CollectorRoute records={records} online={online} onSync={() => setOnline(true)} onRecord={() => document.getElementById('collection-form')?.scrollIntoView({ behavior: 'smooth' })} />
          <div id="collection-form">
            <CollectionForm onSaved={(record) => setRecords((current) => [...current, record])} />
          </div>
          {lastRecord && <Receipt record={lastRecord} />}
        </div>
        <ManagerReview batch={batch} />
        <footer className="footer">System version v1.0.01 (preview) · Backend: {online ? 'Live' : 'Unavailable'}</footer>
      </main>
    </div>
  );
}