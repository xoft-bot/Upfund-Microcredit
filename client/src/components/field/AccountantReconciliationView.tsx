import { useState } from 'react';
import type { VarianceBatch } from './ManagerVarianceDashboard.js';

interface AccountantReconciliationViewProps { batches: VarianceBatch[]; branchId?: string | null; }

export function AccountantReconciliationView({ batches, branchId }: AccountantReconciliationViewProps) {
  const [selected, setSelected] = useState<VarianceBatch | undefined>();
  return <section className="field-card manager-dashboard" aria-labelledby="accountant-variance-title">
    <p className="eyebrow">Read-only evidence</p>
    <h2 id="accountant-variance-title">Reconciliation variances</h2>
    {branchId ? <p className="note">Review queue for branch {branchId}. This view is read-only — decisions are made by a manager or admin.</p> : <p className="note">No branch is assigned to this account.</p>}
    {batches.length === 0 ? <p className="empty-state">No batches are currently open.</p> : <div className="variance-list">
      {batches.map((batch) => <button className="variance-row" type="button" key={batch.batchReference} onClick={() => setSelected(batch)}>
        <span><strong>{batch.batchReference}</strong><small>{batch.collectionDate} · {batch.branchId}</small></span>
        <span><strong>{batch.variance.toLocaleString()} UGX</strong><small>{batch.status}</small></span>
      </button>)}
    </div>}
    {selected && <div className="variance-detail" aria-live="polite">
      <div className="field-card-heading"><h3>{selected.batchReference}</h3><button className="text-button" type="button" onClick={() => setSelected(undefined)}>Close</button></div>
      <div className="metric-grid">
        <div><span>Expected</span><strong>{selected.expectedAmount.toLocaleString()}</strong></div>
        <div><span>Recorded</span><strong>{selected.recordedAmount.toLocaleString()}</strong></div>
        <div><span>Submitted</span><strong>{selected.submittedAmount.toLocaleString()}</strong></div>
        <div><span>Variance</span><strong>{selected.variance.toLocaleString()}</strong></div>
      </div>
      <ul className="payment-evidence">
        {selected.payments.map((payment) => <li key={payment.paymentId}><span>{payment.clientId} · {payment.amount.toLocaleString()} UGX</span><small>{payment.receiptReference ?? 'No server receipt'} · {payment.status}</small></li>)}
      </ul>
      <p className="note">Submitted by {selected.submittedBy}.{selected.decisionReason ? ` Decision on file: ${selected.decisionReason}` : ' No decision recorded yet.'}</p>
    </div>}
  </section>;
}
