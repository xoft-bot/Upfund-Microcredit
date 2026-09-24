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
const PortalDashboard = lazy(async () => { const module = await import('./components/portals/PortalDashboard.js'); return { default: module.PortalDashboard }; });

interface Props {
  shell: ShellProps;
  /** Existing collector workflow (route view + capture form + receipt), built in main.tsx because it owns the offline queue. */
  collectorHome: ReactNode;
  /** Existing manager variance dashboard, mounted for admin/manager. */
  reconciliation: ReactNode;
}

/** Hidden means not rendered; unlisted paths bounce home. The server stays the authority. */
function Guard({ role }: { role: Role }) {
  const location = useLocation();
  const context = useOutletContext<ShellOutletContext>();
  if (!canAccess(role, location.pathname)) return <Navigate to="/" replace />;
  // Suspense lives inside the shell so lazy pages never blank the nav.
  return <Suspense fallback={<p className="empty-state" role="status">Loading…</p>}><Outlet context={context} /></Suspense>;
}

export function AppRoutes({ shell, collectorHome, reconciliation }: Props) {
  const role: Role = isRole(shell.identity.role) ? shell.identity.role : 'client';
  const classic = <PortalDashboard identity={shell.identity} />;
  const manager = role === 'admin' || role === 'manager';

  return (
    <>
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
            <Route path="reconciliation" element={manager ? reconciliation : <Placeholder title="Reconciliation" phase={4} />} />

            {/* Existing dashboards stay mounted until Phases 3-5 reach parity. */}
            <Route path="reports" element={classic} />
            <Route path="workspace" element={classic} />
            <Route path="apply" element={<NewApplication />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
