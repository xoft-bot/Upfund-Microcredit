import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AuthIdentity } from '../../services/firebase.js';
import { assessApplicationRisk, createClient, createLoanApplication, decideApplication, disburseLoan, getApplicationTimeline, getPortalOverview, reviewApplicationKyc, submitLoanApplication, type ApplicationTimelineEntry, type PortalApplication, type PortalOverview } from '../../services/api.js';
import { getFirebaseIdToken } from '../../services/firebase.js';
import { ManagerAnalyticsDashboard } from './ManagerAnalyticsDashboard.js';
import { AccountantAuditDashboard } from './AccountantAuditDashboard.js';
import { CollectorReportingDashboard } from './CollectorReportingDashboard.js';

interface PortalDashboardProps { identity: AuthIdentity; }

const portalCopy = {
  manager: { eyebrow: 'Manager workspace', title: 'Portfolio control room', lede: 'Move applications through review, approval, and disbursement with a clear audit trail.' },
  admin: { eyebrow: 'Administrator workspace', title: 'Portfolio control room', lede: 'Oversee applications and loan performance across the microcredit operation.' },
  accountant: { eyebrow: 'Accountant workspace', title: 'Accounting & audit', lede: 'Trace posted financial activity, balance the books, and review reconciliation decisions.' },
  officer: { eyebrow: 'Loan officer workspace', title: 'Client pipeline', lede: 'Build trusted client records and move applications forward from one branch-aware workspace.' },
  client: { eyebrow: 'Client workspace', title: 'Your borrowing journey', lede: 'Track applications and active loans, then start the next request when you are ready.' },
  marketing: { eyebrow: 'Marketing workspace', title: 'Growth overview', lede: 'Understand product reach and demand without exposing sensitive client details.' },
} as const;

const money = (value: number): string => `${value.toLocaleString()} UGX`;
const titleCase = (value: string): string => value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="portal-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ApplicationRow({ application, action, actionLabel, onOpen, busy }: { application: PortalApplication; action?: (application: PortalApplication) => void; actionLabel?: string; onOpen: (application: PortalApplication) => void; busy: boolean }) {
  return <article className="portal-row">
    <button className="portal-row-main" type="button" onClick={() => onOpen(application)}><strong>{application.clientName}</strong><span>{application.productName} · {money(application.requestedAmount)}</span><small>{application.id}</small></button>
    <div className="portal-row-end"><span className={`status-badge status-${application.status}`}>{titleCase(application.status)}</span>{action && actionLabel && <button className="secondary-button" type="button" disabled={busy} onClick={() => action(application)}>{actionLabel}</button>}</div>
  </article>;
}

export function PortalDashboard({ identity }: PortalDashboardProps) {
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [clientName, setClientName] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [selectedApplication, setSelectedApplication] = useState<PortalApplication | null>(null);
  const [timeline, setTimeline] = useState<ApplicationTimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [kycMethod, setKycMethod] = useState('national_id_check');
  const [kycEvidence, setKycEvidence] = useState('');
  const [riskScore, setRiskScore] = useState('');
  const [riskGrade, setRiskGrade] = useState('');
  const [riskPolicy, setRiskPolicy] = useState('');
  const [riskRationale, setRiskRationale] = useState('');

  const copy = portalCopy[identity.role as keyof typeof portalCopy] ?? portalCopy.officer;
  const isManager = identity.role === 'admin' || identity.role === 'manager';
  const isOfficer = identity.role === 'officer';
  const isClient = identity.role === 'client';
  const isMarketing = identity.role === 'marketing';
  const isAccountant = identity.role === 'accountant';

  const load = async () => {
    const token = await getFirebaseIdToken();
    if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
    setOverview(await getPortalOverview(token));
  };

  useEffect(() => {
    let active = true;
    void load().catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'PORTAL_LOAD_FAILED'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [identity.uid]);

  useEffect(() => {
    if (!selectedProduct && overview?.products[0]) setSelectedProduct(overview.products[0].id);
    if (!selectedClient && overview?.clients[0]) setSelectedClient(overview.clients[0].id);
  }, [overview, selectedClient, selectedProduct]);

  const run = async (operation: (token: string) => Promise<unknown>, success: string) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const token = await getFirebaseIdToken();
      if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE');
      await operation(token);
      await load();
      setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'PORTAL_ACTION_FAILED');
    } finally {
      setBusy(false);
    }
  };

  const can = (permission: string): boolean => identity.permissions?.includes(permission) ?? false;
  const openApplication = async (application: PortalApplication) => {
    setSelectedApplication(application); setTimeline([]); setTimelineLoading(true); setError('');
    try { const token = await getFirebaseIdToken(); if (!token) throw new Error('AUTH_TOKEN_UNAVAILABLE'); setTimeline(await getApplicationTimeline(application.id, token)); }
    catch (openError) { setError(openError instanceof Error ? openError.message : 'TIMELINE_LOAD_FAILED'); }
    finally { setTimelineLoading(false); }
  };
  const applicationAction = (application: PortalApplication): { action: (application: PortalApplication) => void; label: string } | undefined => {
    if (application.status === 'draft' && can('applications.submit')) {
      return { action: (current) => { void run((token) => submitLoanApplication(current.id, token), 'Application submitted for review.'); }, label: 'Submit application' };
    }
    if (application.status === 'risk_assessed' && can('loans.approve')) {
      return { action: (current) => { void run((token) => decideApplication(current.id, { decision: 'approve', reason: 'Application passed the recorded KYC and risk review.' }, token), 'Application approved and loan account created.'); }, label: 'Approve application' };
    }
    return undefined;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overview || !selectedProduct || !Number.isSafeInteger(Number(requestedAmount)) || Number(requestedAmount) <= 0) { setError('Choose a product and enter a positive whole amount.'); return; }
    const clientId = isClient ? identity.clientId : selectedClient;
    if (!clientId) { setError('Select a client before creating an application.'); return; }
    void run((token) => createLoanApplication({ clientId, productId: selectedProduct, branchId: identity.branchId ?? undefined, requestedAmount: Number(requestedAmount) }, token), 'Application saved as a draft.');
    setRequestedAmount('');
  };

  const addClient = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identity.branchId) { setError('This account needs a branch assignment before creating clients.'); return; }
    void run((token) => createClient({ branchId: identity.branchId!, externalRef, displayName: clientName }, token), 'Client profile created.');
    setClientName(''); setExternalRef('');
  };

  const applications = useMemo(() => overview?.applications ?? [], [overview]);
  if (loading) return <section className="portal-loading" role="status">Loading your workspace…</section>;
  if (error && !overview) return <section className="portal-card"><p className="form-error" role="alert">{error}</p><button className="primary-button" type="button" onClick={() => { setLoading(true); void load().catch(() => setError('PORTAL_LOAD_FAILED')).finally(() => setLoading(false)); }}>Retry</button></section>;
  if (!overview) return null;

  return <section className="portal-shell" aria-labelledby="portal-title">
    <div className="portal-hero"><div><p className="eyebrow">{copy.eyebrow}</p><h2 id="portal-title">{copy.title}</h2><p className="lede">{copy.lede}</p></div><span className="role-chip">{titleCase(identity.role)}</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    {isManager && <ManagerAnalyticsDashboard identity={identity} />}
    {isAccountant && <AccountantAuditDashboard identity={identity} />}
    {isOfficer && <CollectorReportingDashboard identity={identity} />}
    <div className="portal-metrics"><Metric label="Clients" value={overview.metrics.clients} /><Metric label="Applications" value={overview.metrics.applications} /><Metric label="Active loans" value={overview.metrics.activeLoans} /><Metric label="Outstanding" value={money(overview.metrics.outstandingPrincipal)} /></div>
    {isMarketing ? <div className="portal-grid"><section className="portal-card"><p className="eyebrow">Demand signal</p><h3>{overview.metrics.submittedApplications} applications in review</h3><p className="note">Marketing sees aggregate demand and active product availability only.</p></section><section className="portal-card"><p className="eyebrow">Live products</p><div className="product-list">{overview.products.map((product) => <div className="product-row" key={product.id}><strong>{product.name}</strong><span>{product.code} · {product.currency}</span></div>)}</div></section></div> : <div className="portal-grid">
      {(isOfficer || isClient) && <section className="portal-card"><p className="eyebrow">New application</p><h3>Start a request</h3><form onSubmit={submit} className="portal-form"><label>Loan product<select value={selectedProduct} onChange={(event) => setSelectedProduct(event.target.value)}><option value="">Choose a product</option>{overview.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>{isOfficer && <label>Client<select value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}><option value="">Choose a client</option>{overview.clients.map((client) => <option value={client.id} key={client.id}>{client.displayName} · {client.externalRef}</option>)}</select></label>}<label>Requested amount (UGX)<input value={requestedAmount} onChange={(event) => setRequestedAmount(event.target.value)} inputMode="numeric" min="1" step="1" required /></label><button className="primary-button" type="submit" disabled={busy}>Save draft</button></form></section>}
      {isOfficer && <section className="portal-card"><p className="eyebrow">Client book</p><h3>Add a client</h3><form onSubmit={addClient} className="portal-form"><label>Client name<input value={clientName} onChange={(event) => setClientName(event.target.value)} required /></label><label>External reference<input value={externalRef} onChange={(event) => setExternalRef(event.target.value)} required /></label><button className="secondary-button" type="submit" disabled={busy}>Create client</button></form></section>}
      <section className="portal-card portal-wide"><div className="portal-card-heading"><div><p className="eyebrow">{isManager ? 'Decision queue' : isClient ? 'Your applications' : 'Application pipeline'}</p><h3>Loan applications</h3></div><span className="count-pill">{applications.length}</span></div>{applications.length === 0 ? <p className="empty-state">No applications in this scope yet.</p> : <div className="portal-list">{applications.map((application) => { const action = applicationAction(application); return <ApplicationRow application={application} key={application.id} action={action?.action} actionLabel={action?.label} onOpen={openApplication} busy={busy} />; })}</div>}</section>
      <section className="portal-card portal-wide"><div className="portal-card-heading"><div><p className="eyebrow">Repayment book</p><h3>Loans</h3></div><span className="count-pill">{overview.loans.length}</span></div>{overview.loans.length === 0 ? <p className="empty-state">Approved loans will appear here.</p> : <div className="portal-list">{overview.loans.map((loan) => <article className="portal-row" key={loan.id}><div><strong>{loan.clientName}</strong><span>{money(loan.outstandingPrincipal)} outstanding · {titleCase(loan.status)}</span><small>{loan.id}</small></div>{isManager && loan.status === 'approved' && <button className="primary-button" type="button" disabled={busy} onClick={() => void run((token) => disburseLoan(loan.id, { disbursementReference: `DSB-${loan.id.slice(0, 8)}`, idempotencyKey: `disburse-${loan.id}` }, token), 'Loan disbursed.')}>Disburse</button>}</article>)}</div>}</section>
    </div>}
    {selectedApplication && <div className="portal-modal-backdrop" role="presentation"><section className="portal-modal" role="dialog" aria-modal="true" aria-labelledby="application-detail-title"><div className="portal-card-heading"><div><p className="eyebrow">Underwriting workspace</p><h3 id="application-detail-title">{selectedApplication.clientName} · {titleCase(selectedApplication.status)}</h3></div><button className="secondary-button" type="button" onClick={() => setSelectedApplication(null)}>Close</button></div>
      <div className="application-timeline"><h4>Application timeline</h4>{timelineLoading ? <p className="note">Loading transition history…</p> : timeline.length === 0 ? <p className="note">No timeline events recorded yet.</p> : timeline.map((entry) => <div className="timeline-entry" key={entry.id}><span className="timeline-dot" /><div><strong>{titleCase(entry.toState)}</strong><small>{new Date(entry.createdAt).toLocaleString()} · {entry.actorUserId ?? 'System'}</small>{entry.reason && <p>{entry.reason}</p>}</div></div>)}</div>
      {(can('kyc.review') && selectedApplication.status === 'submitted') && <form className="portal-form underwriting-form" onSubmit={(event) => { event.preventDefault(); void run((token) => reviewApplicationKyc(selectedApplication.id, { status: 'verified', verificationMethod: kycMethod, evidenceNotes: kycEvidence }, token), 'KYC review recorded.'); setKycEvidence(''); }}><h4>Controlled KYC review</h4><label>Verification method<select value={kycMethod} onChange={(event) => setKycMethod(event.target.value)}><option value="national_id_check">National ID check</option><option value="site_visit">Site visit</option><option value="employer_reference">Employer reference</option><option value="document_review">Document review</option></select></label><label>Evidence and notes<textarea value={kycEvidence} onChange={(event) => setKycEvidence(event.target.value)} minLength={1} required placeholder="Record what was verified and where evidence is stored." /></label><button className="primary-button" type="submit" disabled={busy}>Verify KYC</button></form>}
      {(can('risk.assess') && selectedApplication.status === 'kyc_verified') && <form className="portal-form underwriting-form" onSubmit={(event) => { event.preventDefault(); void run((token) => assessApplicationRisk(selectedApplication.id, { score: Number(riskScore), riskGrade, status: 'approved', policyVersion: riskPolicy, rationale: riskRationale }, token), 'Risk assessment recorded.'); setRiskScore(''); setRiskGrade(''); setRiskPolicy(''); setRiskRationale(''); }}><h4>Controlled risk assessment</h4><label>Score (0–100)<input type="number" min="0" max="100" step="1" value={riskScore} onChange={(event) => setRiskScore(event.target.value)} required /></label><label>Risk grade<input value={riskGrade} onChange={(event) => setRiskGrade(event.target.value)} maxLength={20} required placeholder="A, B, C…" /></label><label>Policy version<input value={riskPolicy} onChange={(event) => setRiskPolicy(event.target.value)} maxLength={64} required placeholder="Credit policy version" /></label><label>Rationale<textarea value={riskRationale} onChange={(event) => setRiskRationale(event.target.value)} minLength={1} required placeholder="Explain the assessment and decision basis." /></label><button className="primary-button" type="submit" disabled={busy}>Record risk assessment</button></form>}
    </section></div>}
  </section>;
}
