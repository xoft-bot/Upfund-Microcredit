import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, useOutletContext } from 'react-router-dom';
import { AppShell, type ShellOutletContext, type ShellProps } from './components/shell/AppShell.js';
import { canAccess, isRole, type Role } from './config/navConfig.js';

const ActionCenter = lazy(() => import('./pages/ActionCenter.js'));
const Placeholder = lazy(() => import('./pages/Placeholder.js'));
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

            <Route path="applications/record/:id" element={<Placeholder title="Application" />} />
            <Route path="applications/:queue?" element={<Placeholder title="Applications" module="applications" />} />
            <Route path="loans/record/:id" element={<Placeholder title="Loan" />} />
            <Route path="loans/:queue?" element={<Placeholder title="Loans" module="loans" />} />
            <Route path="clients/:id?" element={<Placeholder title="Clients" />} />

            <Route path="collections" element={role === 'collector' ? collectorHome : <Placeholder title="Collections" phase={4} />} />
            <Route path="reconciliation" element={manager ? reconciliation : <Placeholder title="Reconciliation" phase={4} />} />

            {/* Existing dashboards stay mounted until Phases 3-5 reach parity. */}
            <Route path="reports" element={classic} />
            <Route path="workspace" element={classic} />
            <Route path="apply" element={classic} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
