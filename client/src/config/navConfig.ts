// Single source of truth for role navigation (FRONTEND_SPEC §2.1).
// Hidden means not rendered; the server remains the authority on access.
// Pure data + pure functions: no React imports, so it is unit-testable.

export type Role = 'admin' | 'manager' | 'officer' | 'collector' | 'accountant' | 'marketing' | 'client';
export type CountModule = 'applications' | 'loans' | 'payments';

export interface CountRef { module: CountModule; queue: string }
export interface NavItem { id: string; label: string; path: string; badge?: CountRef }
export interface ActionCard { id: string; label: string; hint: string; ref: CountRef; path: string }

/** Queue names exactly as the Phase 1 read API defines them. */
export const QUEUES: Record<CountModule, ReadonlyArray<{ id: string; label: string }>> = {
  applications: [
    { id: 'draft', label: 'Drafts' },
    { id: 'in_review', label: 'In review' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ],
  loans: [
    { id: 'approved', label: 'Awaiting disbursement' },
    { id: 'active', label: 'Active' },
    { id: 'due_today', label: 'Due today' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'defaulted', label: 'Defaulted' },
    { id: 'written_off', label: 'Written off' },
    { id: 'completed', label: 'Completed' },
  ],
  payments: [
    { id: 'recorded', label: 'Recorded' },
    { id: 'pending_reconciliation', label: 'Pending reconciliation' },
    { id: 'verified', label: 'Verified' },
    { id: 'posted', label: 'Posted' },
    { id: 'reversed', label: 'Reversed' },
  ],
};

const nav = (id: string, label: string, path: string, badge?: CountRef): NavItem => ({ id, label, path, badge });
const b = (module: CountModule, queue: string): CountRef => ({ module, queue });


// "Accounting (read)" and "Admin" are intentionally absent: no backend until Phase 6.
// Collector "Sync" and "History" live inside the existing collector workflow until Phase 4.
export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  admin: [
    nav('home', 'Overview', '/'),
    nav('clients', 'Clients', '/clients'),
    nav('applications', 'Applications', '/applications', b('applications', 'in_review')),
    nav('loans', 'Loans', '/loans', b('loans', 'overdue')),
    nav('collections', 'Collections', '/collections'),
    nav('reconciliation', 'Reconciliation', '/reconciliation', b('payments', 'pending_reconciliation')),
    nav('reports', 'Reports', '/reports'),
  ],
  manager: [
    nav('home', 'Overview', '/'),
    nav('clients', 'Clients', '/clients'),
    nav('applications', 'Applications', '/applications', b('applications', 'in_review')),
    nav('loans', 'Loans', '/loans', b('loans', 'overdue')),
    nav('collections', 'Collections', '/collections'),
    nav('reconciliation', 'Reconciliation', '/reconciliation', b('payments', 'pending_reconciliation')),
    nav('reports', 'Reports', '/reports'),
  ],
  officer: [
    nav('home', 'My work', '/'),
    nav('clients', 'Clients', '/clients'),
    nav('applications', 'Applications', '/applications', b('applications', 'in_review')),
    nav('loans', 'Loans', '/loans', b('loans', 'overdue')),
    nav('collections', 'Collections', '/collections'),
  ],
  collector: [
    nav('home', 'Today', '/'),
    nav('loans', 'My loans', '/loans', b('loans', 'due_today')),
    nav('collections', 'Capture', '/collections'),
  ],
  accountant: [
    nav('home', 'Control room', '/'),
    nav('reconciliation', 'Reconciliation', '/reconciliation', b('payments', 'pending_reconciliation')),
    nav('reports', 'Ledger and reports', '/reports'),
  ],
  marketing: [
    nav('home', 'Product reach', '/'),
    nav('reports', 'Reports', '/reports'),
  ],
  client: [
    nav('my-loans', 'My loans', '/loans'),
    nav('my-applications', 'My applications', '/applications'),
    nav('apply', 'Apply', '/apply'),
  ],
};

export const ACTION_CARDS: Record<Role, ActionCard[]> = {
  admin: [
    { id: 'apps-review', label: 'Applications in review', hint: 'Waiting for a decision', ref: b('applications', 'in_review'), path: '/applications/in_review' },
    { id: 'loans-approved', label: 'Awaiting disbursement', hint: 'Approved, not yet paid out', ref: b('loans', 'approved'), path: '/loans/approved' },
    { id: 'loans-due', label: 'Due today', hint: 'Installments falling due', ref: b('loans', 'due_today'), path: '/loans/due_today' },
    { id: 'loans-overdue', label: 'Overdue loans', hint: 'Past their due date', ref: b('loans', 'overdue'), path: '/loans/overdue' },
    { id: 'pay-recon', label: 'Pending reconciliation', hint: 'Payments waiting for a batch decision', ref: b('payments', 'pending_reconciliation'), path: '/reconciliation' },
  ],
  manager: [
    { id: 'apps-review', label: 'Applications in review', hint: 'Waiting for a decision', ref: b('applications', 'in_review'), path: '/applications/in_review' },
    { id: 'loans-approved', label: 'Awaiting disbursement', hint: 'Approved, not yet paid out', ref: b('loans', 'approved'), path: '/loans/approved' },
    { id: 'loans-due', label: 'Due today', hint: 'Installments falling due', ref: b('loans', 'due_today'), path: '/loans/due_today' },
    { id: 'loans-overdue', label: 'Overdue loans', hint: 'Past their due date', ref: b('loans', 'overdue'), path: '/loans/overdue' },
    { id: 'pay-recon', label: 'Pending reconciliation', hint: 'Payments waiting for a batch decision', ref: b('payments', 'pending_reconciliation'), path: '/reconciliation' },
  ],
  officer: [
    { id: 'apps-draft', label: 'My drafts', hint: 'Applications you have not submitted', ref: b('applications', 'draft'), path: '/applications/draft' },
    { id: 'apps-review', label: 'My applications in review', hint: 'Waiting for a decision', ref: b('applications', 'in_review'), path: '/applications/in_review' },
    { id: 'loans-due', label: 'Due today', hint: 'Your loans with installments due', ref: b('loans', 'due_today'), path: '/loans/due_today' },
    { id: 'loans-overdue', label: 'Overdue loans', hint: 'Your loans past their due date', ref: b('loans', 'overdue'), path: '/loans/overdue' },
  ],
  collector: [
    { id: 'loans-due', label: 'Due today', hint: 'Assigned loans to visit', ref: b('loans', 'due_today'), path: '/loans/due_today' },
    { id: 'loans-overdue', label: 'Overdue', hint: 'Assigned loans past due', ref: b('loans', 'overdue'), path: '/loans/overdue' },
  ],
  accountant: [
    { id: 'pay-recon', label: 'Pending reconciliation', hint: 'Payments waiting for a batch decision', ref: b('payments', 'pending_reconciliation'), path: '/reconciliation' },
    { id: 'pay-recorded', label: 'Recorded', hint: 'Payments recorded, not yet verified', ref: b('payments', 'recorded'), path: '/reconciliation' },
    { id: 'pay-reversed', label: 'Reversed', hint: 'Payments reversed in this branch', ref: b('payments', 'reversed'), path: '/reconciliation' },
  ],
  marketing: [],
  client: [
    { id: 'apps-review', label: 'Applications in review', hint: 'Waiting for a decision', ref: b('applications', 'in_review'), path: '/applications/in_review' },
    { id: 'loans-active', label: 'Active loans', hint: 'Loans you are repaying', ref: b('loans', 'active'), path: '/loans/active' },
  ],
};

export const HOME_TITLE: Record<Role, string> = {
  admin: 'Action center',
  manager: 'Action center',
  officer: 'My work',
  collector: 'Today',
  accountant: 'Control room',
  marketing: 'Product reach',
  client: 'My account',
};

export function isRole(value: string): value is Role {
  return Object.prototype.hasOwnProperty.call(NAV_BY_ROLE, value);
}

export function navFor(role: Role): NavItem[] { return NAV_BY_ROLE[role] ?? []; }
export function cardsFor(role: Role): ActionCard[] { return ACTION_CARDS[role] ?? []; }

/** Search is hidden for collector and marketing (spec + server denies both). */
export function hasSearch(role: Role): boolean { return role !== 'collector' && role !== 'marketing'; }
/** Marketing has no read-API access, so it never calls /queues/counts. */
export function countsEnabled(role: Role): boolean { return role !== 'marketing'; }
/** Audit trail panel: staff who can read /audit (collector, marketing and client cannot; accountant has no record screens yet). */
export function canViewAudit(role: Role): boolean { return role === 'admin' || role === 'manager' || role === 'officer'; }
/** Collector and officer get a mobile bottom bar. */
export function hasBottomBar(role: Role): boolean { return role === 'collector' || role === 'officer'; }

export function canAccess(role: Role, pathname: string): boolean {
  if (pathname === '/') return true;
  return navFor(role).some((item) => item.path !== '/' && (pathname === item.path || pathname.startsWith(`${item.path}/`)));
}

/** Accepts any object so a differently-declared QueueCounts type still fits. Reads are guarded at runtime. */
export type QueueCountsLike = object | null | undefined;

/**
 * The server groups counts by raw status and omits statuses with no rows, so:
 *  - a missing status inside a loaded module means 0, and
 *  - the UI queues "in_review" and "active" are sums of several raw statuses,
 *    mirroring applicationQueueSql() and the loans "active" predicate in readApis.ts.
 * Returns undefined only when counts have not loaded (or the module is absent).
 */
const DERIVED_QUEUES: Record<string, readonly string[]> = {
  'applications:in_review': ['submitted', 'kyc_verified', 'risk_assessed'],
  'loans:active': ['active', 'disbursed'],
};

export function countFor(counts: QueueCountsLike, ref: CountRef): number | undefined {
  const group = (counts as Record<string, unknown> | null | undefined)?.[ref.module] as Record<string, unknown> | null | undefined;
  if (!group || typeof group !== 'object') return undefined;
  const keys = DERIVED_QUEUES[`${ref.module}:${ref.queue}`] ?? [ref.queue];
  let total = 0;
  for (const key of keys) {
    const value = group[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    total += value;
  }
  return total;
}

export function queueLabel(module: CountModule, queue: string): string | undefined {
  return QUEUES[module].find((entry) => entry.id === queue)?.label;
}

const SEGMENT_LABELS: Record<string, string> = {
  applications: 'Applications', loans: 'Loans',
  clients: 'Clients', collections: 'Collections', reconciliation: 'Reconciliation',
  reports: 'Reports', apply: 'Apply',
};

export interface Crumb { label: string; path: string }

export function breadcrumbsFor(role: Role, pathname: string): Crumb[] {
  const home = navFor(role).find((item) => item.path === '/')?.label ?? HOME_TITLE[role];
  const crumbs: Crumb[] = [{ label: home, path: '/' }];
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return crumbs;
  const first = segments[0]!;
  const navItem = navFor(role).find((item) => item.path === `/${first}`);
  crumbs.push({ label: navItem?.label ?? SEGMENT_LABELS[first] ?? first, path: `/${first}` });
  const second = segments[1];
  if (!second) return crumbs;
  if (second === 'new') {
    crumbs.push({ label: 'New', path: pathname });
    return crumbs;
  }
  if (second === 'record') {
    const id = segments[2];
    if (id) crumbs.push({ label: id.length > 12 ? `${id.slice(0, 8)}…` : id, path: pathname });
    return crumbs;
  }
  if (first === 'applications' || first === 'loans') {
    crumbs.push({ label: queueLabel(first, second) ?? second, path: pathname });
  } else {
    crumbs.push({ label: second.length > 12 ? `${second.slice(0, 8)}…` : second, path: pathname });
  }
  return crumbs;
}
