import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/src/app.js';
import { pool } from '../server/src/db.js';

const defaultRow = { par30_days: 30, par60_days: 60, par90_days: 90, updated_by: null, updated_at: '2026-01-01T00:00:00.000Z' };

afterEach(() => {
  vi.restoreAllMocks();
});

function appFor(role: 'admin' | 'manager' | 'accountant' | 'officer', branchId: string | null) {
  return buildApp({
    tokenVerifier: vi.fn(async () => ({ uid: `firebase-${role}` }) as never),
    userResolver: vi.fn(async () => ({ dbUserId: `db-${role}`, firebaseUid: `firebase-${role}`, role, branchId })),
  });
}

describe('GET /api/v1/reporting/par-thresholds', () => {
  it('returns the config to admin, manager, and accountant', async () => {
    for (const role of ['admin', 'manager', 'accountant'] as const) {
      vi.spyOn(pool, 'query').mockResolvedValue({ rows: [defaultRow], rowCount: 1 } as never);
      const app = appFor(role, 'branch-a');
      const response = await app.inject({ method: 'GET', url: '/api/v1/reporting/par-thresholds', headers: { authorization: 'Bearer test-token' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ par30Days: 30, par60Days: 60, par90Days: 90, updatedBy: null, updatedAt: defaultRow.updated_at });
      await app.close();
      vi.restoreAllMocks();
    }
  });

  it('denies a role with no PAR visibility (officer)', async () => {
    const app = appFor('officer', 'branch-a');
    const response = await app.inject({ method: 'GET', url: '/api/v1/reporting/par-thresholds', headers: { authorization: 'Bearer test-token' } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('PATCH /api/v1/reporting/par-thresholds', () => {
  it('allows accountant to update, and audit-logs it', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ par30_days: 15, par60_days: 45, par90_days: 75, updated_by: 'db-accountant', updated_at: '2026-02-01T00:00:00.000Z' }], rowCount: 1 }), release: vi.fn() };
    vi.spyOn(pool, 'connect').mockResolvedValue(client as never);
    const app = appFor('accountant', 'branch-a');

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/reporting/par-thresholds',
      headers: { authorization: 'Bearer test-token' },
      payload: { par30Days: 15, par60Days: 45, par90Days: 75 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.par30Days).toBe(15);
    // BEGIN, UPDATE, audit insert, COMMIT
    const queries = client.query.mock.calls.map((call) => String(call[0]));
    expect(queries.some((sql) => sql.includes('UPDATE par_threshold_config'))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO audit_events'))).toBe(true);
    await app.close();
  });

  it('denies manager write access (read-only for manager)', async () => {
    const app = appFor('manager', 'branch-a');
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/reporting/par-thresholds',
      headers: { authorization: 'Bearer test-token' },
      payload: { par30Days: 15, par60Days: 45, par90Days: 75 },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('rejects a non-increasing threshold order', async () => {
    const client = { query: vi.fn(), release: vi.fn() };
    vi.spyOn(pool, 'connect').mockResolvedValue(client as never);
    const app = appFor('accountant', 'branch-a');

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/reporting/par-thresholds',
      headers: { authorization: 'Bearer test-token' },
      payload: { par30Days: 60, par60Days: 30, par90Days: 90 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('PAR_THRESHOLD_ORDER_INVALID');
    await app.close();
  });
});
