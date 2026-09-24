import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { actionErrorText } from '../components/records/useAction.js';
import { canCreateClient, validateNewClient } from '../lib/lifecycle.js';
import { createClient } from '../services/api.js';

/** Add a client to the officer's branch. */
export default function NewClient() {
  const navigate = useNavigate();
  const { role, getToken, branchId } = useOutletContext<ShellOutletContext>();
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canCreateClient(role)) return <Navigate to="/clients" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const problem = validateNewClient({ name, reference, branchId });
    if (problem) { setError(problem); return; }
    setBusy(true); setError('');
    try {
      const created = await createClient({ branchId: branchId!, externalRef: reference.trim(), displayName: name.trim() }, await getToken());
      navigate(`/clients/${encodeURIComponent(created.id)}`, { replace: true });
    } catch (caught) {
      setError(actionErrorText(caught));
      setBusy(false);
    }
  };

  return (
    <section className="rec">
      <Link className="rec-back" to="/clients">← Clients</Link>
      <div className="rec-head"><h1>Add client</h1></div>
      <form className="act-form rec-card" onSubmit={(event) => void submit(event)}>
        <label>Client name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" /></label>
        <label>External reference<input value={reference} onChange={(event) => setReference(event.target.value)} autoComplete="off" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="act-row">
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create client'}</button>
          <Link className="secondary-button" to="/clients">Cancel</Link>
        </div>
      </form>
    </section>
  );
}
