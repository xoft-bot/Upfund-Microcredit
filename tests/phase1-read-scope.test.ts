import { describe, expect, it } from 'vitest';
import { scopeFor } from '../server/src/routes/readApis.js';
import type { Actor } from '../shared/contracts.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const actor = (role: Actor['role'], extra: Partial<Actor> = {}): Actor => ({ userId: 'u1', dbUserId: 'u1', firebaseUid: 'f1', role, branchId: A, clientId: null, ...extra });
const placeholders = (sql: string) => new Set(sql.match(/\$\d+/g) ?? []).size;

describe('Phase 1 read scope (defense in depth)', () => {
  it('always binds exactly the parameters it references, for every role and kind', () => {
    const roles: Actor['role'][] = ['admin', 'manager', 'officer', 'collector', 'accountant', 'client', 'marketing'];
    const kinds = ['application', 'loan', 'client', 'payment', 'reconciliation', 'audit'] as const;
    for (const role of roles) for (const kind of kinds) {
      const scope = scopeFor(actor(role, { clientId: 'c1' }), kind, 'x', undefined, 3);
      expect(placeholders(scope.sql), `${role}/${kind}`).toBe(scope.values.length);
      expect(scope.next).toBe(3 + scope.values.length);
    }
  });
  it('forces an explicit branch predicate for non-admin roles and denies other branches', () => {
    expect(scopeFor(actor('manager'), 'loan', 'l').sql).toContain('l.branch_id = $1');
    expect(scopeFor(actor('manager'), 'loan', 'l', B).sql).toBe('FALSE');
    expect(scopeFor(actor('manager', { branchId: null }), 'loan', 'l').sql).toBe('FALSE');
    expect(scopeFor(actor('admin', { branchId: null }), 'loan', 'l').sql).toBe('TRUE');
    expect(scopeFor(actor('admin', { branchId: null }), 'loan', 'l', B).values).toEqual([B]);
  });
  it('scopes officers to records they created, except clients which stay branch-wide', () => {
    const officer = actor('officer', { dbUserId: 'off-1' });
    expect(scopeFor(officer, 'application', 'la')).toMatchObject({ values: [A, 'off-1'] });
    expect(scopeFor(officer, 'application', 'la').sql).toContain('la.created_by = $2');
    expect(scopeFor(officer, 'loan', 'l').sql).toContain('oa.created_by = $2');
    expect(scopeFor(officer, 'payment', 'p').sql).toContain('oa.created_by = $2');
    expect(scopeFor(officer, 'client', 'c').values).toEqual([A]);
  });
  it('limits collectors to actively assigned loans and denies every other kind', () => {
    const collector = actor('collector', { dbUserId: 'col-1' });
    const loan = scopeFor(collector, 'loan', 'l');
    expect(loan.sql).toContain('collector_assignments');
    expect(loan.values).toEqual([A, 'col-1']);
    for (const kind of ['application', 'client', 'payment', 'reconciliation', 'audit'] as const) expect(scopeFor(collector, kind, 'x').sql).toBe('FALSE');
  });
  it('limits clients to their own records and never emits a client_id predicate on tables without that column', () => {
    const client = actor('client', { clientId: 'c1' });
    expect(scopeFor(client, 'application', 'la').sql).toBe('la.client_id = $1');
    expect(scopeFor(client, 'client', 'c').sql).toBe('c.id = $1');
    expect(scopeFor(client, 'payment', 'p').sql).not.toMatch(/\bp\.client_id\b/);
    expect(scopeFor(client, 'reconciliation', 'r').sql).toBe('FALSE');
    expect(scopeFor(actor('client'), 'loan', 'l').sql).toBe('FALSE');
  });
});
