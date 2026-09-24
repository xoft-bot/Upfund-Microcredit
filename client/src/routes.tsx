import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useOutletContext } from 'react-router-dom';
import { AppShell, type ShellOutletContext, type ShellProps } from './components/shell/AppShell.js';
import { canAccess, isRole, type Role } from './config/navConfig.js';

const ActionCenter = lazy(() => import('./pages/ActionCenter.js'));
const Placeholder = lazy(() => import('./pages/Placeholder.js'));
const QueuePage = lazy(() => import('./pages/QueuePage.js'));
const ApplicationRecord = lazy(() => import('./pages/ApplicationRecord.js'));
const LoanRecord = lazy(() => import('./pages/LoanRecord.js'));
const ClientRecord = lazy(() => import('./pages/ClientRecord.js'));
const NewApplication = lazy(() => import('./pages/NewApplication.js'));
const NewClient = lazy(() => import('./pages/NewClient.js'));
const ManagerAnalyticsDashboard = lazy(async () => { const module = await import('./components/portals/ManagerAnalyticsDashboard.js'); return { default: module.ManagerAnalyticsDashboard }; });
const AccountantAuditDashboard = lazy(async () => { const module = await import('./components/portals/AccountantAuditDashboard.js'); return { default: module.AccountantAuditDashboard }; });
const MarketingProductReach = lazy(async () => { const module = await import('./components/portals/MarketingProductReach.js'); return { default: module.MarketingProductReach }; });

interface Props {
  shell: ShellProps;
  collectorHome: ReactNode;
  reconciliation: ReactNode;
  accountantReconciliation: ReactNode;
}

function Guard({ role }: { role: Role }) {
  const location = useLocation();
  const context = useOutletContext<ShellOutletContext>();
  if (!canAccess(role, location.pathname)) return <Navigate to="/" replace />;
  return <Suspense fallback={<p className="empty-state" role="status">Loading…</p>}><Outlet context={context} /></Suspense>;
}

export function AppRoutes({ shell, collectorHome, reconciliation, accountantReconciliation }: Props) {
  const role: Role = isRole(shell.identity.role) ? shell.identity.role : 'client';
  const manager = role === 'admin' || role === 'manager';
  const reports = manager ? <ManagerAnalyticsDashboard identity={shell.identity} />
    : role === 'accountant' ? <AccountantAuditDashboard identity={shell.identity} />
    : role === 'marketing' ? <MarketingProductReach identity={shell.identity} />
    : <Placeholder title="Reports" phase={4} />;
  const reconciliationView = manager ? reconciliation
    : role === 'accountant' ? accountantReconciliation
    : <Placeholder title="Reconciliation" phase={5} />;

  return (
    <Routes>
      <Route element={<AppShell {...shell} />}>
        <Route element={<Guard role={role} />}>
          <Route index element={role === 'collector' ? collectorHome : <ActionCenter />} />

          <Route path="applications/new" element={<NewApplication />} />
          <Route path="applications/record/:id" element={<ApplicationRecord />} />
          <Route path="applications/:queue?" element={<QueuePage module="applications" />} />
          <Route path="loans/record/:id" element={<LoanRecord />} />
          <Route path="loans/:queue?" element={<QueuePage module="loans" />} />
          <Route path="clients" element={<QueuePage module="clients" />} />
          <Route path="clients/new" element={<NewClient />} />
          <Route path="clients/:id" element={<ClientRecord />} />

          <Route path="collections" element={role === 'collector' ? collectorHome : <Placeholder title="Collections" phase={4} />} />
          <Route path="reconciliation" element={reconciliationView} />
          <Route path="reports" element={reports} />
          <Route path="apply" element={<NewApplication />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
