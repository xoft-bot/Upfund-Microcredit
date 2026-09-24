import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import type { AuthIdentity } from '../../services/firebase.js';
import { useQueueCounts, type QueueCountsState } from '../../hooks/useQueueCounts.js';
import { breadcrumbsFor, countFor, countsEnabled, hasBottomBar, hasSearch, isRole, navFor, type NavItem, type Role } from '../../config/navConfig.js';
import { GlobalSearch } from './GlobalSearch.js';

export interface ShellProps {
  identity: AuthIdentity;
  email?: string;
  backendLive: boolean;
  identityError: string;
  onSignOut: () => void;
  getToken: () => Promise<string>;
  versionLabel: string;
}
/** Passed to every route via <Outlet context>. Read it with useOutletContext<ShellOutletContext>(). */
export type ShellOutletContext = QueueCountsState & { role: Role; countsEnabled: boolean; getToken: () => Promise<string>; permissions: readonly string[]; branchId: string | null; clientId: string | null };

function Badge({ item, counts }: { item: NavItem; counts: QueueCountsState['counts'] }) {
  if (!item.badge) return null;
  const value = countFor(counts, item.badge);
  if (!value) return null;
  return <span className="nav-badge" aria-label={`${value} waiting`}>{value > 99 ? '99+' : value}</span>;
}

export function AppShell({ identity, email, backendLive, identityError, onSignOut, getToken, versionLabel }: ShellProps) {
  const role: Role = isRole(identity.role) ? identity.role : 'client';
  const items = navFor(role);
  const enabled = countsEnabled(role);
  const queueCounts = useQueueCounts(getToken, enabled);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useEffect(() => { setDrawer(false); }, [location.pathname]);

  const crumbs = breadcrumbsFor(role, location.pathname);
  const bottomItems = hasBottomBar(role) ? items.slice(0, 4) : [];
  const context: ShellOutletContext = { ...queueCounts, role, countsEnabled: enabled, getToken, permissions: identity.permissions ?? [], branchId: identity.branchId ?? null, clientId: identity.clientId ?? null };

  return (
    <div className={`app-shell${bottomItems.length ? ' has-bottom-bar' : ''}`}>
      <header className="topbar">
        <button className="topbar-menu" type="button" aria-label="Menu" aria-expanded={drawer} onClick={() => setDrawer((open) => !open)}>
          <span /><span /><span />
        </button>
        <Link className="topbar-brand" to="/">Upfund</Link>
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
