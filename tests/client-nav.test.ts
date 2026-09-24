import { describe, expect, it } from 'vitest';
import {
  ACTION_CARDS, NAV_BY_ROLE, QUEUES, breadcrumbsFor, canAccess, countFor, countsEnabled,
  canViewAudit, hasBottomBar, hasSearch, isRole, navFor, type Role,
} from '../client/src/config/navConfig.js';

const ROLES = Object.keys(NAV_BY_ROLE) as Role[];
const ids = (role: Role) => navFor(role).map((item) => item.id);

describe('navConfig role visibility', () => {
  it('covers exactly the 7 server roles', () => {
    expect([...ROLES].sort()).toEqual(['accountant', 'admin', 'client', 'collector', 'manager', 'marketing', 'officer']);
    expect(isRole('admin')).toBe(true);
    expect(isRole('superuser')).toBe(false);
  });

  it('client sees only My loans, My applications, Apply', () => {
    expect(ids('client')).toEqual(['my-loans', 'my-applications', 'apply']);
  });

  it('collector sees only Today, My loans, Capture', () => {
    expect(ids('collector')).toEqual(['home', 'loans', 'collections']);
  });

  it('no role gets an Admin or Accounting item before Phase 6', () => {
    for (const role of ROLES) {
      expect(ids(role)).not.toContain('admin');
      expect(ids(role)).not.toContain('accounting');
    }
  });

  it('only admin and manager see Reconciliation with the batch dashboard; accountant sees it read-only', () => {
    expect(ids('admin')).toContain('reconciliation');
    expect(ids('manager')).toContain('reconciliation');
    expect(ids('accountant')).toContain('reconciliation');
    for (const role of ['officer', 'collector', 'marketing', 'client'] as Role[]) expect(ids(role)).not.toContain('reconciliation');
  });

  it('accountant and marketing never see client or loan lists', () => {
    for (const role of ['accountant', 'marketing'] as Role[]) {
      expect(canAccess(role, '/clients')).toBe(false);
      expect(canAccess(role, '/loans')).toBe(false);
      expect(canAccess(role, '/applications')).toBe(false);
    }
  });

  it('search is hidden for collector and marketing only', () => {
    expect(ROLES.filter((role) => !hasSearch(role)).sort()).toEqual(['collector', 'marketing']);
  });

  it('marketing never calls queue counts; everyone else does', () => {
    expect(ROLES.filter((role) => !countsEnabled(role))).toEqual(['marketing']);
  });

  it('bottom bar is for collector and officer', () => {
    expect(ROLES.filter(hasBottomBar).sort()).toEqual(['collector', 'officer']);
  });
});

describe('canAccess', () => {
  it('lets every role reach home', () => { for (const role of ROLES) expect(canAccess(role, '/')).toBe(true); });
  it('matches sub-paths of allowed items', () => {
    expect(canAccess('admin', '/loans/overdue')).toBe(true);
    expect(canAccess('admin', '/loans/record/abc')).toBe(true);
    expect(canAccess('officer', '/clients/abc')).toBe(true);
  });
  it('does not match by string prefix alone', () => {
    expect(canAccess('collector', '/loansX')).toBe(false);
  });
  it('blocks paths outside the role', () => {
    expect(canAccess('collector', '/clients')).toBe(false);
    expect(canAccess('collector', '/reconciliation')).toBe(false);
    expect(canAccess('officer', '/reconciliation')).toBe(false);
    expect(canAccess('client', '/clients')).toBe(false);
    expect(canAccess('client', '/workspace')).toBe(false);
    expect(canAccess('client', '/apply')).toBe(true);
  });
});

describe('badges and cards use real queue names', () => {
  const valid = (module: keyof typeof QUEUES, queue: string) => QUEUES[module].some((entry) => entry.id === queue);
  it('every nav badge references a defined queue', () => {
    for (const role of ROLES) for (const item of navFor(role)) if (item.badge) expect(valid(item.badge.module, item.badge.queue)).toBe(true);
  });
  it('every action card references a defined queue and an accessible path', () => {
    for (const role of ROLES) for (const card of ACTION_CARDS[role]) {
      expect(valid(card.ref.module, card.ref.queue)).toBe(true);
      expect(canAccess(role, card.path)).toBe(true);
    }
  });
});

describe('countFor', () => {
  const counts = {
    applications: { draft: 2, submitted: 3, kyc_verified: 1, risk_assessed: 4, approved: 5 },
    loans: { active: 6, disbursed: 2, overdue: 7, due_today: 4 },
    payments: {},
  } as never;
  it('reads plain status counts', () => {
    expect(countFor(counts, { module: 'loans', queue: 'due_today' })).toBe(4);
    expect(countFor(counts, { module: 'loans', queue: 'overdue' })).toBe(7);
  });
  it('sums derived queues like the server predicates', () => {
    expect(countFor(counts, { module: 'applications', queue: 'in_review' })).toBe(8);
    expect(countFor(counts, { module: 'loans', queue: 'active' })).toBe(8);
  });
  it('treats a missing status in a loaded module as zero', () => {
    expect(countFor(counts, { module: 'payments', queue: 'posted' })).toBe(0);
    expect(countFor(counts, { module: 'loans', queue: 'defaulted' })).toBe(0);
  });
  it('is undefined until counts load or when data is malformed', () => {
    expect(countFor(null, { module: 'loans', queue: 'due_today' })).toBeUndefined();
    expect(countFor({ loans: { overdue: '7' } } as never, { module: 'loans', queue: 'overdue' })).toBeUndefined();
  });
});

describe('breadcrumbsFor', () => {
  it('builds queue and record crumbs', () => {
    expect(breadcrumbsFor('admin', '/').map((c) => c.label)).toEqual(['Overview']);
    expect(breadcrumbsFor('admin', '/loans/due_today').map((c) => c.label)).toEqual(['Overview', 'Loans', 'Due today']);
    expect(breadcrumbsFor('admin', '/applications/record/0123456789abcdef').map((c) => c.label)).toEqual(['Overview', 'Applications', '01234567…']);
    expect(breadcrumbsFor('collector', '/loans').map((c) => c.label)).toEqual(['Today', 'My loans']);
  });
});

describe('canViewAudit', () => {
  it('is limited to admin, manager and officer', () => {
    expect(ROLES.filter(canViewAudit).sort()).toEqual(['admin', 'manager', 'officer']);
  });
});
