import { useState } from 'react';
import { canDisburse, disbursePayload } from '../../lib/lifecycle.js';
import { disburseLoan } from '../../services/api.js';
import { Card } from './RecordFrame.js';
import { useAction } from './useAction.js';

interface Props { id: string; role: string; status: string; getToken: () => Promise<string>; onDone: () => void }

export function LoanActions({ id, role, status, getToken, onDone }: Props) {
  const { busy, error, notice, run } = useAction(getToken, onDone);
  const [confirm, setConfirm] = useState(false);
  const allowed = canDisburse(role, status);
  const payload = disbursePayload(id);

  if (!allowed && !notice && !error) return null;
  return (
    <Card title="Actions" wide>
    <div className="act">
      {notice && <p className="act-notice" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {allowed && (
        <div className="act-block">
          <p className="note">Disbursement moves money out and generates the repayment schedule. Reference {payload.disbursementReference}. Retrying is safe: the same request cannot disburse twice.</p>
          {!confirm ? (
            <button className="primary-button" type="button" disabled={busy} onClick={() => setConfirm(true)}>Disburse loan</button>
          ) : (
            <div className="act-row">
              <button className="primary-button" type="button" disabled={busy} onClick={() => void run((token) => disburseLoan(id, payload, token), 'Loan disbursed.').then(() => setConfirm(false))}>Confirm disbursement</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
    </Card>
  );
}
