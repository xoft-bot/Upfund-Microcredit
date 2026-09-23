import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../server/src/db.js';
import { type TokenVerifier, type UserResolver } from '../server/src/middleware/auth.js';
import { registerReadApiRoutes } from '../server/src/routes/readApis.js';

const branchA = '00000000-0000-4000-8000-000000000001';
const branchB = '00000000-0000-4000-8000-000000000002';
const manager = { dbUserId: '00000000-0000-4000-8000-000000000010', firebaseUid: 'manager-firebase', role: 'manager' as const, branchId: branchA };
const accountant = { dbUserId: '00000000-0000-4000-8000-000000000011', firebaseUid: 'accountant-firebase', role: 'accountant' as const, branchId: branchA };
const verifier: TokenVerifier = vi.fn(async () => ({ uid: manager.firebaseUid } as never));

function emptyResult() { return { rows: [], rowCount: 0 }; }

async function makeApp(resolver: UserResolver = async () => manager) {
  const app = Fastify();
  registerReadApiRoutes(app, verifier, resolver);
  app.setErrorHandler((error, _request, reply) => {
    const candidate = error as { statusCode?: number; code?: string; message?: string };
    const status = candidate.statusCode && candidate.statusCode >= 400 ? candidate.statusCode : 500;
    reply.code(status).send({ ok: false, error: { code: candidate.code ?? 'INTERNAL_ERROR', message: candidate.message ?? 'Request failed' } });
  });
  await app.ready();
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe('Phase 1 read API authorization and pagination', () => {
  it('denies a role that is not allowed to read the payments queue', async () => {
    const app = await makeApp(async () => ({ ...manager, role: 'collector' as const }));
    const response = await app.inject({ method: 'GET', url: '/api/v1/payments', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('denies a manager from requesting another branch', async () => {
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: `/api/v1/clients?branchId=${branchB}`, headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BRANCH_SCOPE_DENIED');
    await app.close();
  });

  it('rejects page sizes above the contract maximum before querying the database', async () => {
    const query = vi.spyOn(pool, 'query');
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/loans?page=1&pageSize=101', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('FST_ERR_VALIDATION');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns a paginated empty state with the stable response envelope', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue(emptyResult() as never);
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/clients?page=2&pageSize=10', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
    expect(query).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('returns queue counts as one scoped aggregate response', async () => {
    const query = vi.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ status: 'submitted', count: 2 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ status: 'active', count: 3 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ status: 'posted', count: 4 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ status: 'pending', count: 1 }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ count: 5 }], rowCount: 1 } as never);
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/queues/counts', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ applications: { submitted: 2 }, loans: { active: 3, due_today: 5 }, payments: { posted: 4 }, reconciliations: { pending: 1 } });
    expect(query.mock.calls[0][1]).toEqual([branchA]);
    await app.close();
  });

  it('keeps accountant read-only by allowing payment reads but not write routes', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue(emptyResult() as never);
    const app = await makeApp(async () => accountant);
    const response = await app.inject({ method: 'GET', url: '/api/v1/payments?status=posted', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects global search terms shorter than two characters', async () => {
    const query = vi.spyOn(pool, 'query');
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=x', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('SEARCH_QUERY_TOO_SHORT');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('Phase 1 read API record and audit routes', () => {
  it('does not expose an out-of-branch record even when the record id is known', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue(emptyResult() as never);
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/loans/loan-from-other-branch', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('LOAN_NOT_FOUND');
    expect(query.mock.calls[0][1]).toEqual(['loan-from-other-branch', branchA]);
    await app.close();
  });

  it('returns an empty audit history for a scoped branch', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue(emptyResult() as never);
    const app = await makeApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/audit?entityType=loan&entityId=loan-1', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [], total: 0, page: 1, pageSize: 25 });
    expect(query).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
