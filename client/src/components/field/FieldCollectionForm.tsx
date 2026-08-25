import { FormEvent, useState } from 'react';
import type { FieldCollectionRecord, PaymentMethod } from '../../types/field-ops.js';
import { OfflineQueue } from '../../services/offlineQueue.js';

interface FieldCollectionFormProps { queue: OfflineQueue; collectorId: string; branchId: string; deviceId: string; onQueued: (record: FieldCollectionRecord) => void; }
const makeId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function FieldCollectionForm({ queue, collectorId, branchId, deviceId, onQueued }: FieldCollectionFormProps) {
  const [clientId, setClientId] = useState(''); const [loanId, setLoanId] = useState(''); const [amount, setAmount] = useState(''); const [method, setMethod] = useState<PaymentMethod>('cash'); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSaved(false); const parsedAmount = Number(amount);
    if (!clientId.trim() || !loanId.trim()) return setError('Client and loan references are required.');
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) return setError('Enter a whole amount greater than zero.');
    const timestamp = new Date().toISOString(); const record: FieldCollectionRecord = { localId: makeId(), idempotencyKey: makeId(), clientId: clientId.trim(), loanId: loanId.trim(), branchId, collectorId, amount: parsedAmount, paymentMethod: method, status: 'Queued', syncState: 'queued', deviceId, correlationId: makeId(), capturedAt: timestamp, updatedAt: timestamp, retryCount: 0 };
    await queue.enqueue(record); onQueued(record); setClientId(''); setLoanId(''); setAmount(''); setSaved(true);
  };
  return <form className="field-card collection-form" onSubmit={submit} noValidate aria-labelledby="collection-form-title"><p className="eyebrow">Daily collection</p><h2 id="collection-form-title">Record payment</h2>{error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="form-success" role="status">Saved to the offline queue.</p>}<label>Client reference<input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" required /></label><label>Loan reference<input value={loanId} onChange={(event) => setLoanId(event.target.value)} autoComplete="off" required /></label><label>Amount (UGX)<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" min="1" step="1" required /></label><label>Payment method<select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label><button className="primary-button full-button" type="submit">Save collection</button></form>;
}
