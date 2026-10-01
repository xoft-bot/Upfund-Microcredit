import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import type { AuthIdentity } from '../../services/firebase.js';
import { useQueueCounts, type QueueCountsState } from '../../hooks/useQueueCounts.js';
import { breadcrumbsFor, countFor, countsEnabled, hasBottomBar, hasSearch, isRole, navFor, type NavItem, type Role } from '../../config/navConfig.js';
import { GlobalSearch } from './GlobalSearch.js';
import { BranchSelector } from './BranchSelector.js';

export interface ShellProps {
  identity: AuthIdentity;
  email?: string;
  backendLive: boolean;
  identityError: string;
  onSignOut: () => void;
  getToken: () => Promise<string>;
  versionLabel: string;
  branches: ReadonlyArray<{ id: string; code: string; name: string }>;
  selectedBranchId?: string;
  onSelectBranch: (branchId: string) => void;
}
/** Passed to every route via <Outlet context>. Read it with useOutletContext<ShellOutletContext>(). */
export type ShellOutletContext = QueueCountsState & { role: Role; countsEnabled: boolean; getToken: () => Promise<string>; permissions: readonly string[]; branchId: string | null; clientId: string | null; userId: string | null; branches: ReadonlyArray<{ id: string; code: string; name: string }>; selectedBranchId?: string };

function Badge({ item, counts }: { item: NavItem; counts: QueueCountsState['counts'] }) {
  if (!item.badge) return null;
  const value = countFor(counts, item.badge);
  if (!value) return null;
  return <span className="nav-badge" aria-label={`${value} waiting`}>{value > 99 ? '99+' : value}</span>;
}

export function AppShell({ identity, email, backendLive, identityError, onSignOut, getToken, versionLabel, branches, selectedBranchId, onSelectBranch }: ShellProps) {
  // Persisted once per mount from localStorage (or the signed-in identity's own role as a
  // fallback). Nothing in this component currently changes it after mount — there's no
  // role-switcher UI yet — so this is read-only scaffolding for that feature, not a bug.
  const [storedRole] = useState<Role>(() => {
    try {
      const saved = localStorage.getItem('upfund_active_role');
      if (saved && isRole(saved)) return saved as Role;
    } catch {
      // localStorage can throw in restrictive environments (e.g. Safari private mode) — fall through to the identity-derived default below.
    }
    return isRole(identity.role) ? (identity.role as Role) : 'client';
  });

  const role: Role = storedRole;
  useEffect(() => {
    try {
      localStorage.setItem('upfund_active_role', role);
    } catch {
      // Same restrictive-environment case as above — persistence is a convenience, not a requirement.
    }
  }, [role]);
  const items = navFor(role);
  const enabled = countsEnabled(role);
  const queueCounts = useQueueCounts(getToken, enabled);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawer(false); }, [location.pathname]);

  const crumbs = breadcrumbsFor(role, location.pathname);
  const bottomItems = hasBottomBar(role) ? items.slice(0, 4) : [];
  // Manager is pinned to their own branch regardless of the picker (branch isolation);
  // everyone else (admin, with the cross-branch picker) uses whatever's selected.
  const effectiveBranchId = (role === 'manager' && identity.branchId) ? identity.branchId : selectedBranchId;
  const filteredBranches = role === 'manager' && effectiveBranchId ? branches.filter(b => b.id === effectiveBranchId || b.name === effectiveBranchId) : branches;
  const context: ShellOutletContext = { ...queueCounts, role, countsEnabled: enabled, getToken, permissions: identity.permissions ?? [], branchId: effectiveBranchId ?? null, clientId: identity.clientId ?? null, userId: identity.userId ?? null, branches: filteredBranches, selectedBranchId: effectiveBranchId };

  return (
    <div className={`app-shell${bottomItems.length ? ' has-bottom-bar' : ''}`}>
      <header className="topbar">
        <button className="topbar-menu" type="button" aria-label="Menu" aria-expanded={drawer} onClick={() => setDrawer((open) => !open)}>
          <span /><span /><span />
        </button>
        <Link className="topbar-brand" to="/">Upfund</Link>
        <BranchSelector branches={branches} selectedBranchId={selectedBranchId} onSelect={onSelectBranch} />
        {hasSearch(role) && <GlobalSearch role={role} getToken={getToken} />}
        <div className="topbar-user">
          <span className="topbar-who">{email ?? identity.uid}</span>
          <span className="topbar-meta">{identity.role}, branch {identity.branchId ?? 'none'}</span>
        </div>
        <span className={`topbar-status${backendLive ? '' : ' is-down'}`} role="status" title={backendLive ? 'Backend live' : 'Backend unavailable'}>
          <span className="dot" />{backendLive ? 'Live' : 'Offline'}
        </span>
        <button className="topbar-signout" type="button" onClick={onSignOut}>Sign out</button>
      </header>

      <div className="shell-body">
        {drawer && <button className="drawer-scrim" type="button" aria-label="Close menu" onClick={() => setDrawer(false)} />}
        <nav className={`sidebar${drawer ? ' is-open' : ''}`} aria-label="Main">
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <NavLink to={item.path} end={item.path === '/' || item.id === 'classic'} className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
                  <span>{item.label}</span>
                  <Badge item={item} counts={queueCounts.counts} />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shell-main">
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={crumb.path}>
                  {index === crumbs.length - 1 ? <span aria-current="page">{crumb.label}</span> : <Link to={crumb.path}>{crumb.label}</Link>}
                </li>
              ))}
            </ol>
          </nav>
          {identityError && <p className="form-error" role="status">{identityError}</p>}
          <div className="shell-content"><Outlet context={context} /></div>
          <footer className="footer">{versionLabel} · Backend: {backendLive ? 'Live' : 'Unavailable'}</footer>
        </div>
      </div>

      {bottomItems.length > 0 && (
        <nav className="bottombar" aria-label="Quick navigation">
          {bottomItems.map((item) => (
            <NavLink key={item.id} to={item.path} end={item.path === '/'} className={({ isActive }) => `bottombar-link${isActive ? ' is-active' : ''}`}>
              <span>{item.label}</span>
              <Badge item={item} counts={queueCounts.counts} />
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
