import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileBarChart,
  FilePlus2,
  Landmark,
  LayoutDashboard,
  Loader2,
  MapPin,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import {
  getGetPortfolioActivityQueryKey,
  getGetPortfolioOverviewQueryKey,
  getHealthCheckQueryKey,
  useAdvanceApplication,
  useCreateApplication,
  useCreateClient,
  useDisburseLoan,
  useGetPortfolioActivity,
  useGetPortfolioOverview,
  useHealthCheck,
  useRecordCollection,
} from '@workspace/api-client-react';
import type {
  Application,
  Client,
  CollectionInputMethod,
  Loan,
  PortfolioOverview,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/applications', label: 'Applications', icon: ClipboardList },
  { href: '/clients', label: 'Clients', icon: Users },
  { href: '/collections', label: 'Collections', icon: WalletCards },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
];

const roleOptions = ['Branch manager', 'Loan officer', 'Collector', 'Accountant', 'Administrator'];

function money(value: number | undefined) {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('en-UG', { style: 'currency', currency: 'UGX', maximumFractionDigits: 0 }).format(value);
}

function compactMoney(value: number | undefined) {
  if (value === undefined || value === null) return '—';
  if (value >= 1000000) return `UGX ${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `UGX ${(value / 1000).toFixed(0)}k`;
  return money(value);
}

function todayLabel() {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
}

function dateLabel(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function relativeTime(value?: string) {
  if (!value) return 'Recently';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return value;
  const minutes = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function StatusPill({ value }: { value?: string }) {
  const label = value?.replace(/_/g, ' ') || 'unknown';
  const tone = value?.toLowerCase().includes('risk') || value?.toLowerCase().includes('late') || value?.toLowerCase().includes('reject')
    ? 'danger'
    : value?.toLowerCase().includes('approv') || value?.toLowerCase().includes('paid') || value?.toLowerCase().includes('active') || value?.toLowerCase().includes('complete')
      ? 'success'
      : value?.toLowerCase().includes('review') || value?.toLowerCase().includes('pending')
        ? 'warn'
        : 'neutral';
  return <span data-testid={`status-pill-${value || 'unknown'}`} className={`status-pill status-${tone}`}>{label}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-muted ${className}`} aria-hidden="true" />;
}

function EmptyState({ icon: Icon, title, detail, action }: { icon: typeof Users; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="empty-state" data-testid="state-empty">
      <div className="empty-icon"><Icon size={21} /></div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="state-panel state-error" data-testid="state-error">
      <CircleAlert size={20} />
      <div><strong>We couldn’t load this workspace view.</strong><span>Check the connection to the branch ledger and try again.</span></div>
      {onRetry && <button className="button button-ghost" onClick={onRetry} data-testid="button-retry"><RefreshCw size={15} /> Retry</button>}
    </div>
  );
}

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card animate-rise" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog" data-testid="button-close-dialog"><X size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [role, setRole] = useState(() => localStorage.getItem('upfund-role') || 'Branch manager');
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), retry: 0 } });
  const overview = useGetPortfolioOverview({ role }, { query: { queryKey: getGetPortfolioOverviewQueryKey({ role }), retry: 0 } });
  const activity = useGetPortfolioActivity({ query: { queryKey: getGetPortfolioActivityQueryKey(), retry: 0 } });
  const applicationsCount = overview.data?.applications?.filter((item) => item.status !== 'disbursed').length;

  function changeRole(nextRole: string) {
    setRole(nextRole);
    localStorage.setItem('upfund-role', nextRole);
  }

  const pageTitle = location === '/' ? 'Portfolio overview' : navItems.find((item) => item.href === location)?.label || 'Workspace';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Landmark size={19} strokeWidth={2.4} /></div>
          <div><strong>upfund</strong><span>microcredit OS</span></div>
        </div>
        <div className="branch-switcher">
          <span className="small-label">ACTIVE BRANCH</span>
          <button className="branch-button" data-testid="button-branch-switcher"><span className="branch-dot" /> Kampala Central <ChevronDown size={14} /></button>
        </div>
        <nav className="side-nav" aria-label="Primary navigation">
          <span className="small-label nav-label">WORKSPACE</span>
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={`nav-item ${location === href ? 'nav-item-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid={`link-${label.toLowerCase().replace(' ', '-')}`}>
              <Icon size={17} /><span>{label}</span>
              {label === 'Applications' && applicationsCount ? <em>{applicationsCount}</em> : null}
            </Link>
          ))}
          <span className="small-label nav-label nav-label-lower">CONTROL</span>
          <Link href="/settings" className={`nav-item ${location === '/settings' ? 'nav-item-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid="link-settings"><Settings2 size={17} /><span>Settings</span></Link>
        </nav>
        <div className="sidebar-bottom">
          <div className={`connection-state ${health.isError ? 'connection-offline' : ''}`} data-testid="status-connection">
            <span className="connection-dot" /><span>{health.isLoading ? 'Checking ledger…' : health.isError ? 'Ledger offline' : 'Ledger connected'}</span>
          </div>
          <div className="user-context">
            <div className="avatar avatar-sidebar">AM</div>
            <div><strong>Amina Namatovu</strong><span>{role}</span></div>
            <button className="icon-button icon-button-dark" aria-label="User options" data-testid="button-user-options"><MoreHorizontal size={17} /></button>
          </div>
        </div>
      </aside>
      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation" />}
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={19} /></button><div><span className="breadcrumb">Kampala Central / {pageTitle}</span><h1>{pageTitle}</h1></div></div>
          <div className="topbar-actions">
            <button className="icon-button notification-button" aria-label="Notifications" data-testid="button-notifications"><Bell size={18} /><span /></button>
            <div className="role-context"><span className="small-label">VIEWING AS</span><select value={role} onChange={(event) => changeRole(event.target.value)} data-testid="select-active-role">{roleOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
          </div>
        </header>
        <div className="page-content">
          <AppDataContext.Provider value={{ overview: overview.data, overviewLoading: overview.isLoading, overviewError: overview.isError, refetchOverview: overview.refetch, activity: activity.data, activityLoading: activity.isLoading, activityError: activity.isError, refetchActivity: activity.refetch, role }}>
            {children}
          </AppDataContext.Provider>
        </div>
      </main>
    </div>
  );
}

type AppData = { overview?: PortfolioOverview; overviewLoading: boolean; overviewError: boolean; refetchOverview: () => unknown; activity?: { id: string; type: string; title: string; detail: string; timestamp: string }[]; activityLoading: boolean; activityError: boolean; refetchActivity: () => unknown; role: string };
const AppDataContext = createContext<AppData | null>(null);
function useAppData() { return useContext(AppDataContext)!; }

function MetricCard({ label, value, meta, icon: Icon, accent, testId }: { label: string; value: string; meta: string; icon: typeof Activity; accent?: string; testId: string }) {
  return <article className={`metric-card ${accent || ''} animate-rise`} data-testid={testId}><div className="metric-top"><span>{label}</span><div className="metric-icon"><Icon size={16} /></div></div><strong className="metric-value font-data">{value}</strong><span className="metric-meta">{meta}</span></article>;
}

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-intro animate-rise"><div><span className="eyebrow">{eyebrow}</span><h2 className="display-title">{title}</h2><p>{detail}</p></div>{action}</div>;
}

function OverviewPage() {
  const { overview, overviewLoading, overviewError, refetchOverview, activity, activityLoading, activityError, refetchActivity } = useAppData();
  const metrics = overview?.metrics;
  return (
    <div className="content-stack">
      <PageIntro eyebrow={todayLabel()} title="Keep the branch moving." detail="A clear view of today’s lending work, from first application to last collection." action={<Link href="/applications" className="button button-primary" data-testid="link-review-queue"><ClipboardList size={16} /> Review queue <ArrowRight size={15} /></Link>} />
      {overviewError ? <ErrorState onRetry={() => refetchOverview()} /> : overviewLoading ? <div className="metric-grid">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} className="h-32" />)}</div> : (
        <div className="metric-grid">
          <MetricCard label="Total disbursed" value={compactMoney(metrics?.totalDisbursed)} meta="Across all active cycles" icon={ArrowDownToLine} accent="metric-navy" testId="metric-total-disbursed" />
          <MetricCard label="Outstanding principal" value={compactMoney(metrics?.outstandingPrincipal)} meta="Current book balance" icon={BriefcaseBusiness} accent="metric-teal" testId="metric-outstanding-principal" />
          <MetricCard label="Collected this month" value={compactMoney(metrics?.collectedThisMonth)} meta="Since 01 October" icon={CircleDollarSign} accent="metric-gold" testId="metric-collected-month" />
          <MetricCard label="Active loans" value={metrics?.activeLoans?.toLocaleString() || '—'} meta="Repayment in progress" icon={CreditCard} testId="metric-active-loans" />
          <MetricCard label="At risk" value={metrics?.atRisk?.toLocaleString() || '—'} meta="Needs a follow-up" icon={CircleAlert} accent="metric-alert" testId="metric-at-risk" />
          <MetricCard label="Repayment rate" value={metrics?.repaymentRate !== undefined ? `${metrics.repaymentRate.toFixed(1)}%` : '—'} meta="On-time portfolio rate" icon={BarChart3} accent="metric-rate" testId="metric-repayment-rate" />
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel panel-large animate-rise stagger-1">
          <div className="panel-heading"><div><span className="eyebrow">Pipeline</span><h3>Applications needing a decision</h3></div><Link href="/applications" className="text-link" data-testid="link-all-applications">View all <ArrowRight size={14} /></Link></div>
          {overviewLoading ? <div className="table-skeleton">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-12" />)}</div> : overview?.applications?.length ? <ApplicationTable applications={overview.applications.slice(0, 5)} compact /> : <EmptyState icon={ClipboardList} title="Your pipeline is clear" detail="New applications will appear here when clients are ready for review." action={<Link href="/applications" className="text-link" data-testid="link-start-application">Create an application <ArrowRight size={14} /></Link>} />}
        </section>
        <section className="panel activity-panel animate-rise stagger-2">
          <div className="panel-heading"><div><span className="eyebrow">Audit trail</span><h3>Recent activity</h3></div><Activity size={17} className="heading-icon" /></div>
          {activityError ? <ErrorState onRetry={() => refetchActivity()} /> : activityLoading ? <div className="activity-list">{[1, 2, 3].map((item) => <div className="activity-row" key={item}><Skeleton className="h-8 w-8 rounded-full" /><div className="flex-1"><Skeleton className="h-3 w-2/3 mb-2" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div> : activity?.length ? <ActivityList items={activity.slice(0, 6)} /> : <EmptyState icon={Activity} title="No activity yet" detail="Every meaningful portfolio action will be recorded here." />}
        </section>
      </div>
      <section className="panel animate-rise stagger-3">
        <div className="panel-heading"><div><span className="eyebrow">Repayment queue</span><h3>Loans to watch this week</h3></div><Link href="/collections" className="text-link" data-testid="link-collections-queue">Open collections <ArrowRight size={14} /></Link></div>
        {overview?.loans?.length ? <LoanTable loans={overview.loans.slice(0, 5)} /> : <EmptyState icon={WalletCards} title="Nothing due in the queue" detail="Loans approaching their next repayment date will surface here." />}
      </section>
    </div>
  );
}

function ApplicationTable({ applications, compact = false, onAdvance, onDisburse }: { applications: Application[]; compact?: boolean; onAdvance?: (application: Application) => void; onDisburse?: (application: Application) => void }) {
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Client</th><th>Product</th><th>Requested</th><th>Submitted</th><th>Status</th>{!compact && <th className="text-right">Action</th>}</tr></thead><tbody>{applications.map((application) => <tr key={application.id} data-testid={`row-application-${application.id}`}><td><div className="person-cell"><div className="avatar">{initials(application.clientName)}</div><div><strong>{application.clientName}</strong><span className="mono-sub">{application.clientId}</span></div></div></td><td>{application.productName}</td><td className="font-data">{money(application.requestedAmount)}</td><td>{dateLabel(application.createdAt)}</td><td><StatusPill value={application.status} /></td>{!compact && <td className="text-right">{application.status?.toLowerCase().includes('approv') ? <button className="button button-small button-primary" onClick={() => onDisburse?.(application)} data-testid={`button-disburse-${application.id}`}><ArrowDownToLine size={14} /> Disburse</button> : application.status?.toLowerCase().includes('disburs') ? <span className="muted-action">Completed</span> : <button className="button button-small button-outline" onClick={() => onAdvance?.(application)} data-testid={`button-advance-${application.id}`}>Advance <ArrowRight size={14} /></button>}</td>}</tr>)}</tbody></table></div>;
}

function ActivityList({ items }: { items: { id: string; type: string; title: string; detail: string; timestamp: string }[] }) {
  return <div className="activity-list">{items.map((item) => <div className="activity-row" key={item.id} data-testid={`activity-${item.id}`}><div className={`activity-icon activity-${item.type}`}><Activity size={14} /></div><div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><time>{relativeTime(item.timestamp)}</time></div>)}</div>;
}

function LoanTable({ loans }: { loans: Loan[] }) {
  return <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Client</th><th>Product</th><th>Principal</th><th>Outstanding</th><th>Due date</th><th>Status</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id} data-testid={`row-loan-${loan.id}`}><td><div className="person-cell"><div className="avatar avatar-teal">{initials(loan.clientName)}</div><strong>{loan.clientName}</strong></div></td><td>{loan.productName}</td><td className="font-data">{money(loan.principalAmount)}</td><td className="font-data">{money(loan.outstandingPrincipal)}</td><td>{dateLabel(loan.dueDate)}</td><td><StatusPill value={loan.status} /></td></tr>)}</tbody></table></div>;
}

function ApplicationsPage() {
  const { overview, overviewLoading, overviewError, refetchOverview, role } = useAppData();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('All');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const advance = useAdvanceApplication();
  const disburse = useDisburseLoan();
  const create = useCreateApplication();
  const applications = useMemo(() => (overview?.applications || []).filter((item) => filter === 'All' || item.status.toLowerCase().includes(filter.toLowerCase())), [overview?.applications, filter]);
  function refresh() { queryClient.invalidateQueries({ queryKey: getGetPortfolioOverviewQueryKey({ role }) }); }
  function advanceItem(application: Application) { advance.mutate({ id: application.id }, { onSuccess: () => { setNotice(`${application.clientName} moved to the next review stage.`); refresh(); }, onError: () => setNotice('Could not advance this application. Try again.') }); }
  function disburseItem(application: Application) { disburse.mutate({ id: application.id }, { onSuccess: () => { setNotice(`${application.clientName} has been marked for disbursement.`); refresh(); }, onError: () => setNotice('Could not disburse this loan. Try again.') }); }
  return <div className="content-stack"><PageIntro eyebrow="Lending workflow" title="Applications" detail="Review the next best decision, then keep the record moving." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-new-application"><Plus size={16} /> New application</button>} />{notice && <div className="success-banner" data-testid="status-application-notice"><Check size={16} /> {notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice" data-testid="button-dismiss-notice"><X size={15} /></button></div>}<section className="panel"><div className="toolbar"><div className="filter-tabs">{['All', 'Pending', 'Approved', 'Disbursed'].map((item) => <button key={item} className={`filter-tab ${filter === item ? 'filter-tab-active' : ''}`} onClick={() => setFilter(item)} data-testid={`button-filter-${item.toLowerCase()}`}>{item}{item === 'All' ? ` · ${overview?.applications?.length || 0}` : ''}</button>)}</div><button className="button button-ghost" onClick={() => refetchOverview()} data-testid="button-refresh-applications"><RefreshCw size={15} /> Refresh</button></div>{overviewError ? <ErrorState onRetry={() => refetchOverview()} /> : overviewLoading ? <div className="table-skeleton">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14" />)}</div> : applications.length ? <ApplicationTable applications={applications} onAdvance={advanceItem} onDisburse={disburseItem} /> : <EmptyState icon={ClipboardList} title="No applications in this view" detail="Try another status filter or create a fresh application from the branch desk." action={<button className="button button-outline" onClick={() => setShowCreate(true)} data-testid="button-empty-new-application"><Plus size={15} /> New application</button>} />}</section>{showCreate && <CreateApplicationModal clients={overview?.clients || []} products={overview?.products || []} loading={create.isPending} onClose={() => setShowCreate(false)} onSubmit={(data) => create.mutate({ data }, { onSuccess: () => { setNotice('Application created and added to the review queue.'); setShowCreate(false); refresh(); }, onError: () => setNotice('Application could not be created. Check the details and try again.') })} />}</div>;
}

function CreateApplicationModal({ clients, products, loading, onClose, onSubmit }: { clients: Client[]; products: { id: string; name: string; code: string; termWeeks: number; serviceCharge: number }[]; loading: boolean; onClose: () => void; onSubmit: (data: { clientId: string; productId: string; requestedAmount: number }) => void }) {
  const [clientId, setClientId] = useState(clients[0]?.id || '');
  const [productId, setProductId] = useState(products[0]?.id || '');
  const [amount, setAmount] = useState('');
  return <Modal title="Start a loan application" eyebrow="New lending record" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (clientId && productId && Number(amount) > 0) onSubmit({ clientId, productId, requestedAmount: Number(amount) }); }}><label>Client<select value={clientId} onChange={(event) => setClientId(event.target.value)} required data-testid="select-application-client"><option value="">Select a client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName} · {client.externalRef}</option>)}</select></label><label>Product<select value={productId} onChange={(event) => setProductId(event.target.value)} required data-testid="select-application-product"><option value="">Select a product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.termWeeks} weeks</option>)}</select></label><label>Requested amount<div className="input-prefix"><span>UGX</span><input type="number" min="1" placeholder="e.g. 1,800,000" value={amount} onChange={(event) => setAmount(event.target.value)} required data-testid="input-application-amount" /></div></label><div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} data-testid="button-cancel-application">Cancel</button><button type="submit" className="button button-primary" disabled={loading || !clientId || !productId || Number(amount) <= 0} data-testid="button-submit-application">{loading && <Loader2 className="spin" size={15} />} Create application <ArrowRight size={15} /></button></div></form></Modal>;
}

function ClientsPage() {
  const { overview, overviewLoading, overviewError, refetchOverview, role } = useAppData();
  const queryClient = useQueryClient();
  const create = useCreateClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const clients = useMemo(() => (overview?.clients || []).filter((client) => `${client.displayName} ${client.externalRef} ${client.location}`.toLowerCase().includes(search.toLowerCase())), [overview?.clients, search]);
  return <div className="content-stack"><PageIntro eyebrow="People & places" title="Client directory" detail="Know who the branch serves, where they are, and what comes next." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-new-client"><Plus size={16} /> Add client</button>} />{notice && <div className="success-banner" data-testid="status-client-notice"><Check size={16} /> {notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice" data-testid="button-dismiss-client-notice"><X size={15} /></button></div>}<section className="panel"><div className="toolbar"><div className="search-field"><Search size={17} /><input type="search" placeholder="Search by name, reference, or location…" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-clients" /></div><span className="result-count">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</span></div>{overviewError ? <ErrorState onRetry={() => refetchOverview()} /> : overviewLoading ? <div className="client-grid">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-36" />)}</div> : clients.length ? <div className="client-grid">{clients.map((client) => <ClientCard key={client.id} client={client} />)}</div> : <EmptyState icon={Users} title={search ? 'No matches found' : 'The directory is ready for its first client'} detail={search ? 'Try a different name, reference, or location.' : 'Add the first client record from the branch desk.'} action={<button className="button button-outline" onClick={() => setShowCreate(true)} data-testid="button-empty-new-client"><Plus size={15} /> Add client</button>} />}</section>{showCreate && <CreateClientModal loading={create.isPending} onClose={() => setShowCreate(false)} onSubmit={(data) => create.mutate({ data }, { onSuccess: () => { setNotice('Client added to the directory.'); setShowCreate(false); queryClient.invalidateQueries({ queryKey: getGetPortfolioOverviewQueryKey({ role }) }); }, onError: () => setNotice('Client could not be created. Check the details and try again.') })} />}</div>;
}

function ClientCard({ client }: { client: Client }) {
  return <article className="client-card" data-testid={`card-client-${client.id}`}><div className="client-card-top"><div className="avatar avatar-large">{initials(client.displayName)}</div><button className="icon-button" aria-label={`More options for ${client.displayName}`} data-testid={`button-client-options-${client.id}`}><MoreHorizontal size={17} /></button></div><h3>{client.displayName}</h3><span className="mono-sub">{client.externalRef}</span><div className="client-location"><MapPin size={14} /> {client.location}</div><div className="client-card-foot"><span>Joined {dateLabel(client.createdAt)}</span><button className="text-link" data-testid={`button-view-client-${client.id}`}>View record <ArrowRight size={13} /></button></div></article>;
}

function CreateClientModal({ loading, onClose, onSubmit }: { loading: boolean; onClose: () => void; onSubmit: (data: { displayName: string; externalRef: string; location: string }) => void }) {
  const [form, setForm] = useState({ displayName: '', externalRef: '', location: '' });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <Modal title="Add a client" eyebrow="New client record" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}><label>Full name<input value={form.displayName} onChange={(event) => update('displayName', event.target.value)} minLength={2} required placeholder="e.g. Wanjiku Njeri" data-testid="input-client-name" /></label><label>External reference<input value={form.externalRef} onChange={(event) => update('externalRef', event.target.value)} minLength={2} required placeholder="e.g. KBN-1048" data-testid="input-client-reference" /></label><label>Location<input value={form.location} onChange={(event) => update('location', event.target.value)} minLength={2} required placeholder="e.g. Olympic Estate" data-testid="input-client-location" /></label><div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} data-testid="button-cancel-client">Cancel</button><button type="submit" className="button button-primary" disabled={loading} data-testid="button-submit-client">{loading && <Loader2 className="spin" size={15} />} Save client <Check size={15} /></button></div></form></Modal>;
}

function CollectionsPage() {
  const { overview, overviewLoading, overviewError, refetchOverview, role } = useAppData();
  const queryClient = useQueryClient();
  const record = useRecordCollection();
  const [showRecord, setShowRecord] = useState(false);
  const [notice, setNotice] = useState('');
  const loans = overview?.loans || [];
  return <div className="content-stack"><PageIntro eyebrow="Field operations" title="Collections" detail="Turn today’s routes into traceable repayments." action={<button className="button button-primary" onClick={() => setShowRecord(true)} data-testid="button-record-collection"><Plus size={16} /> Record collection</button>} />{notice && <div className="success-banner" data-testid="status-collection-notice"><Check size={16} /> {notice}<button onClick={() => setNotice('')} aria-label="Dismiss notice" data-testid="button-dismiss-collection-notice"><X size={15} /></button></div>}<div className="collection-summary"><div className="route-card"><div className="route-card-copy"><span className="eyebrow">Today’s route</span><strong>{loans.length || '—'} <small>accounts in view</small></strong><span>Prioritise overdue accounts before the afternoon round.</span></div><div className="route-ring"><span>{overview?.metrics?.atRisk ?? '—'}</span><small>at risk</small></div></div><div className="mini-stat"><span>Collected this month</span><strong className="font-data">{compactMoney(overview?.metrics?.collectedThisMonth)}</strong><span className="positive"><ArrowDownToLine size={13} /> Ledger total</span></div><div className="mini-stat"><span>Repayment rate</span><strong className="font-data">{overview?.metrics?.repaymentRate !== undefined ? `${overview.metrics.repaymentRate.toFixed(1)}%` : '—'}</strong><span className="positive"><ShieldCheck size={13} /> Portfolio health</span></div></div><section className="panel"><div className="panel-heading"><div><span className="eyebrow">Repayment queue</span><h3>Accounts requiring a visit</h3></div><button className="button button-ghost" onClick={() => refetchOverview()} data-testid="button-refresh-collections"><RefreshCw size={15} /> Refresh</button></div>{overviewError ? <ErrorState onRetry={() => refetchOverview()} /> : overviewLoading ? <div className="table-skeleton">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-14" />)}</div> : loans.length ? <LoanTable loans={loans} /> : <EmptyState icon={WalletCards} title="No repayment visits queued" detail="When loans are disbursed, the next repayment date will anchor the field queue." />}</section>{showRecord && <RecordCollectionModal loans={loans} loading={record.isPending} onClose={() => setShowRecord(false)} onSubmit={(data) => record.mutate({ data }, { onSuccess: () => { setNotice('Collection recorded in the branch ledger.'); setShowRecord(false); queryClient.invalidateQueries({ queryKey: getGetPortfolioOverviewQueryKey({ role }) }); }, onError: () => setNotice('Collection could not be recorded. Try again.') })} />}</div>;
}

function RecordCollectionModal({ loans, loading, onClose, onSubmit }: { loans: Loan[]; loading: boolean; onClose: () => void; onSubmit: (data: { loanId: string; amount: number; method: CollectionInputMethod }) => void }) {
  const [loanId, setLoanId] = useState(loans[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CollectionInputMethod>('mobile_money');
  return <Modal title="Record a collection" eyebrow="Field payment" onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (loanId && Number(amount) > 0) onSubmit({ loanId, amount: Number(amount), method }); }}><label>Loan account<select value={loanId} onChange={(event) => setLoanId(event.target.value)} required data-testid="select-collection-loan"><option value="">Select an account</option>{loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.clientName} · {loan.id}</option>)}</select></label><label>Amount collected<div className="input-prefix"><span>UGX</span><input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="e.g. 250,000" data-testid="input-collection-amount" /></div></label><fieldset><legend>Payment method</legend><div className="method-grid"><button type="button" className={`method-option ${method === 'mobile_money' ? 'method-selected' : ''}`} onClick={() => setMethod('mobile_money')} data-testid="button-method-mobile-money"><Smartphone size={17} /><span>Mobile money</span><small>MTN / Airtel wallet</small></button><button type="button" className={`method-option ${method === 'cash' ? 'method-selected' : ''}`} onClick={() => setMethod('cash')} data-testid="button-method-cash"><CircleDollarSign size={17} /><span>Cash</span><small>Received in field</small></button></div></fieldset><div className="modal-actions"><button type="button" className="button button-ghost" onClick={onClose} data-testid="button-cancel-collection">Cancel</button><button type="submit" className="button button-primary" disabled={loading || !loanId || Number(amount) <= 0} data-testid="button-submit-collection">{loading && <Loader2 className="spin" size={15} />} Record payment <Check size={15} /></button></div></form></Modal>;
}

function ReportsPage() {
  const { overview, overviewLoading, overviewError, refetchOverview } = useAppData();
  const [period, setPeriod] = useState('This month');
  const metrics = overview?.metrics;
  const bars = [44, 61, 52, 70, 63, 79, 88, 76, 93, 84, 97, 91];
  return <div className="content-stack"><PageIntro eyebrow="Management reporting" title="Portfolio signals" detail="A practical read on liquidity, repayment, and risk concentration." action={<button className="button button-outline" onClick={() => refetchOverview()} data-testid="button-refresh-report"><RefreshCw size={15} /> Refresh data</button>} />{overviewError ? <ErrorState onRetry={() => refetchOverview()} /> : overviewLoading ? <div className="report-grid"><Skeleton className="h-80" /><Skeleton className="h-80" /></div> : <><div className="report-grid"><section className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">Collections trend</span><h3>Cash in, month to date</h3></div><select className="period-select" value={period} onChange={(event) => setPeriod(event.target.value)} data-testid="select-report-period"><option>This month</option><option>Last 3 months</option><option>This year</option></select></div><div className="chart-legend"><span><i className="legend-dot legend-teal" /> Collections</span><strong className="font-data">{compactMoney(metrics?.collectedThisMonth)}</strong></div><div className="bar-chart" aria-label="Collections trend chart">{bars.map((height, index) => <div className="bar-column" key={index}><div className="bar" style={{ height: `${height}%` }} /><span>{['Nov 23', 'Dec 23', 'Jan 24', 'Feb 24', 'Mar 24', 'Apr 24', 'May 24', 'Jun 24', 'Jul 24', 'Aug 24', 'Sep 24', 'Oct 24'][index]}</span></div>)}</div></section><section className="panel risk-panel"><div className="panel-heading"><div><span className="eyebrow">Risk watch</span><h3>Book composition</h3></div><CircleAlert size={17} className="heading-icon" /></div><div className="risk-score"><div className="score-number">{metrics?.repaymentRate !== undefined ? Math.round(metrics.repaymentRate) : '—'}<small>/ 100</small></div><div><strong>Portfolio resilience</strong><span>Based on current repayment rate and at-risk accounts.</span></div></div><div className="risk-meter"><span style={{ width: `${Math.min(metrics?.repaymentRate || 0, 100)}%` }} /></div><div className="risk-rows"><div><span><i className="risk-dot dot-teal" /> Performing</span><strong>{metrics?.activeLoans ? Math.max(0, metrics.activeLoans - (metrics.atRisk || 0)) : '—'}</strong></div><div><span><i className="risk-dot dot-gold" /> At risk</span><strong>{metrics?.atRisk ?? '—'}</strong></div><div><span><i className="risk-dot dot-red" /> Watchlist</span><strong>{metrics?.atRisk ? Math.ceil(metrics.atRisk / 2) : '—'}</strong></div></div></section></div><section className="panel report-table-panel"><div className="panel-heading"><div><span className="eyebrow">Product performance</span><h3>What the branch is lending</h3></div><span className="muted-caption">Updated from live ledger</span></div>{overview?.products?.length ? <div className="product-report-list">{overview.products.map((product) => <div className="product-report-row" key={product.id} data-testid={`report-product-${product.id}`}><div className="product-code">{product.code}</div><div className="product-name"><strong>{product.name}</strong><span>{product.termWeeks} week term · {product.serviceCharge}% service charge</span></div><div className="product-bar"><span style={{ width: `${Math.min(100, 30 + product.termWeeks * 2)}%` }} /></div><strong className="font-data">{product.termWeeks}w</strong><button className="icon-button" aria-label={`View ${product.name} detail`} data-testid={`button-product-report-${product.id}`}><ArrowRight size={15} /></button></div>)}</div> : <EmptyState icon={FileBarChart} title="Product data will appear here" detail="Create products in the lending catalogue before reviewing performance." />}</section></>}</div>;
}

function SettingsPage() {
  const { role } = useAppData();
  const [saved, setSaved] = useState(false);
  const [toggles, setToggles] = useState({ reminders: true, dailyDigest: true, compact: false });
  return <div className="content-stack settings-page"><PageIntro eyebrow="Workspace control" title="Settings" detail="Keep the branch context consistent for every person on the desk." action={<button className="button button-primary" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2200); }} data-testid="button-save-settings"><Check size={15} /> Save preferences</button>} />{saved && <div className="success-banner" data-testid="status-settings-saved"><Check size={16} /> Preferences saved for this workspace.</div>}<div className="settings-grid"><section className="panel settings-card"><div className="settings-heading"><div className="settings-icon"><ShieldCheck size={18} /></div><div><span className="eyebrow">Role context</span><h3>What you can see and do</h3></div></div><p className="settings-copy">Upfund adapts the workspace to the person responsible for the next decision. Your current view is set to:</p><div className="role-display"><div className="avatar avatar-large avatar-gold">AN</div><div><strong>Amina Namatovu</strong><span>{role}</span></div><Check size={17} /></div><div className="permission-list"><div><Check size={14} /> Review and advance applications</div><div><Check size={14} /> Capture field collections</div><div><Check size={14} /> View branch-level reporting</div></div></section><section className="panel settings-card"><div className="settings-heading"><div className="settings-icon settings-icon-teal"><Bell size={18} /></div><div><span className="eyebrow">Notifications</span><h3>Useful, not noisy</h3></div></div><div className="toggle-list"><ToggleRow label="Repayment reminders" detail="Flag accounts before they fall behind." checked={toggles.reminders} onChange={() => setToggles((state) => ({ ...state, reminders: !state.reminders }))} testId="toggle-repayment-reminders" /><ToggleRow label="Daily branch digest" detail="Send a morning summary to the manager." checked={toggles.dailyDigest} onChange={() => setToggles((state) => ({ ...state, dailyDigest: !state.dailyDigest }))} testId="toggle-daily-digest" /><ToggleRow label="Compact data tables" detail="Fit more accounts on smaller screens." checked={toggles.compact} onChange={() => setToggles((state) => ({ ...state, compact: !state.compact }))} testId="toggle-compact-tables" /></div></section></div><section className="panel preferences-panel"><div className="settings-heading"><div className="settings-icon settings-icon-navy"><Settings2 size={18} /></div><div><span className="eyebrow">Branch preferences</span><h3>Kampala Central workspace</h3></div></div><div className="preference-fields"><label>Branch name<input value="Kampala Central" readOnly data-testid="input-branch-name" /></label><label>Base currency<input value="Ugandan Shilling (UGX)" readOnly data-testid="input-base-currency" /></label><label>Week starts on<select defaultValue="Monday" data-testid="select-week-start"><option>Monday</option><option>Sunday</option></select></label></div></section></div>;
}

function ToggleRow({ label, detail, checked, onChange, testId }: { label: string; detail: string; checked: boolean; onChange: () => void; testId: string }) {
  return <div className="toggle-row"><div><strong>{label}</strong><span>{detail}</span></div><button className={`toggle ${checked ? 'toggle-on' : ''}`} role="switch" aria-checked={checked} onClick={onChange} data-testid={testId}><span /></button></div>;
}

function Router() {
  return <RoutedErrorBoundary><Shell><Switch><Route path="/" component={OverviewPage} /><Route path="/applications" component={ApplicationsPage} /><Route path="/clients" component={ClientsPage} /><Route path="/collections" component={CollectionsPage} /><Route path="/reports" component={ReportsPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></Shell></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;