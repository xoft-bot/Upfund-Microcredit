import { FormEvent, useState } from 'react';
import type { AssignedLoanOption } from '../../services/api.js';
import type { FieldCollectionRecord, PaymentMethod } from '../../types/field-ops.js';
import { OfflineQueue } from '../../services/offlineQueue.js';

interface FieldCollectionFormProps { queue: OfflineQueue; collectorId: string; branchId: string; deviceId: string; assignedLoans: AssignedLoanOption[]; onQueued: (record: FieldCollectionRecord) => void; disabled?: boolean; }
const makeId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export function FieldCollectionForm({ queue, collectorId, branchId, deviceId, assignedLoans, onQueued, disabled = false }: FieldCollectionFormProps) {
  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setError('');
    setSaved(false);
    const parsedAmount = Number(amount);
    const selectedLoan = assignedLoans.find((loan) => loan.loanId === selectedLoanId);
    if (!selectedLoan) return setError('Choose an assigned loan before recording a collection.');
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) return setError('Enter a whole amount greater than zero.');
    const timestamp = new Date().toISOString();
    const record: FieldCollectionRecord = {
      localId: makeId(), idempotencyKey: makeId(), clientId: selectedLoan.clientId, loanId: selectedLoan.loanId,
      branchId, collectorId, amount: parsedAmount, paymentMethod: method, status: 'Queued', syncState: 'queued',
      deviceId, correlationId: makeId(), capturedAt: timestamp, updatedAt: timestamp, retryCount: 0,
    };
    await queue.enqueue(record);
    onQueued(record);
    setSelectedLoanId('');
    setAmount('');
    setSaved(true);
  };

  return (
    <form className="portal-card collection-form" onSubmit={submit} noValidate aria-labelledby="collection-form-title">
      <div className="portal-card-heading">
        <div><p className="eyebrow">Daily collection</p><h2 id="collection-form-title">Record payment</h2></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="form-success" role="status">Saved to the offline queue.</p>}
      <label>Assigned loan
        <select value={selectedLoanId} onChange={(event) => setSelectedLoanId(event.target.value)} required disabled={disabled || assignedLoans.length === 0}>
          <option value="">{assignedLoans.length ? 'Choose an assigned loan' : 'No assigned loans available'}</option>
          {assignedLoans.map((loan) => <option value={loan.loanId} key={loan.loanId}>{loan.clientName} · {loan.routeCode} · {loan.outstandingPrincipal.toLocaleString()} UGX outstanding</option>)}
        </select>
      </label>
      <label>Amount (UGX)
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" min="1" step="1" required disabled={disabled} />
      </label>
      <label>Payment method
        <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} disabled={disabled}>
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile money</option>
        </select>
      </label>
      <button className="primary-button full-button" type="submit" disabled={disabled || assignedLoans.length === 0}>
        {disabled ? 'Queue unavailable' : assignedLoans.length === 0 ? 'No assigned loans' : 'Save collection'}
      </button>
    </form>
  );
}
