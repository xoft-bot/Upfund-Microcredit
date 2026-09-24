import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { LoadState, useRecord } from '../components/records/RecordFrame.js';
import { actionErrorText } from '../components/records/useAction.js';
import { canCreateApplication, validateNewApplication } from '../lib/lifecycle.js';
import { createLoanApplication, getPortalOverview, type PortalOverview } from '../services/api.js';

/** Start a draft application. Officers pick a client; clients apply for themselves. */
export default function NewApplication() {
  const navigate = useNavigate();
  const { role, getToken, branchId, clientId } = useOutletContext<ShellOutletContext>();
  const options = useRecord<PortalOverview>(getToken, (token) => getPortalOverview(token), 'portal-options');
  const [productId, setProductId] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isClient = role === 'client';

  useEffect(() => {
    if (!productId && options.data?.products[0]) setProductId(options.data.products[0].id);
    if (!selectedClient && options.data?.clients[0]) setSelectedClient(options.data.clients[0].id);
  }, [options.data, productId, selectedClient]);

  if (!canCreateApplication(role)) return <Navigate to="/applications" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const chosenClient = isClient ? clientId : selectedClient;
    const problem = validateNewApplication({ productId, clientId: chosenClient, amount });
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      const created = await createLoanApplication({ clientId: chosenClient!, productId, branchId: branchId ?? undefined, requestedAmount: Number(amount) }, await getToken());
      navigate(`/applications/record/${encodeURIComponent(created.id)}`, { replace: true });
    } catch (caught) {
      setError(actionErrorText(caught));
      setBusy(false);
    }
  };

  const data = options.data;
  return (
    <section className="rec">
      <Link className="rec-back" to="/applications">← Applications</Link>
      <div className="rec-head"><h1>New application</h1></div>
      <LoadState loading={options.loading} error={options.error} />
      {data && (
        <form className="act-form rec-card" onSubmit={(event) => void submit(event)}>
          <label>Loan product
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">Choose a product</option>
              {data.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          {!isClient && (
            <label>Client
              <select value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}>
                <option value="">Choose a client</option>
                {data.clients.map((client) => <option key={client.id} value={client.id}>{client.displayName} · {client.externalRef}</option>)}
              </select>
            </label>
          )}
          <label>Requested amount (UGX)
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" placeholder="e.g. 500000" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="act-row">
            <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
            <Link className="secondary-button" to="/applications">Cancel</Link>
          </div>
          <p className="note">The draft is saved first. You can submit it for review from its record page.</p>
        </form>
      )}
    </section>
  );
}
