import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/src/app.js';
import { assertBalanced } from '../server/src/services/ledger.js';

const validVerifier = vi.fn(async () => ({ uid: 'user-1', role: 'manager', branchId: 'branch-1' }) as never);

describe('Stage 1 security boundary', () => {
  it('fails closed when the bearer token is absent', async () => {
    const app = buildApp({ tokenVerifier: validVerifier });
    const response = await app.inject({ method: 'POST', url: '/api/stage1/commands/audit-ledger', payload: { branchId: 'branch-1', idempotencyKey: 'missing-auth' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('rejects a valid user outside the requested branch', async () => {
    const app = buildApp({ tokenVerifier: validVerifier });
    const response = await app.inject({ method: 'POST', url: '/api/stage1/commands/audit-ledger', headers: { authorization: 'Bearer test-token' }, payload: { branchId: 'branch-2', idempotencyKey: 'branch-scope-1' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BRANCH_SCOPE_DENIED');
    await app.close();
  });
});

describe('Stage 1 ledger invariant', () => {
  it('rejects unbalanced journal lines', () => {
    expect(() => assertBalanced([
      { accountCode: 'cash', side: 'debit', amount: 100 },
      { accountCode: 'income', side: 'credit', amount: 99 },
    ])).toThrow('LEDGER_UNBALANCED');
  });

  it('accepts balanced positive journal lines', () => {
    expect(() => assertBalanced([
      { accountCode: 'cash', side: 'debit', amount: 100 },
      { accountCode: 'income', side: 'credit', amount: 100 },
    ])).not.toThrow();
  });
});
