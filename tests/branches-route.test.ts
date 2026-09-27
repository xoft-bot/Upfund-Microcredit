import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../server/src/app.js';
import { pool } from '../server/src/db.js';

const branches = [
  { id: 'branch-a', code: 'MAIN', name: 'Main Branch' },
  { id: 'branch-b', code: 'WEST', name: 'West Branch' },
];

afterEach(() => {
  vi.restoreAllMocks();
});

function appFor(role: 'admin' | 'manager', branchId: string | null) {
  return buildApp({
    tokenVerifier: vi.fn(async () => ({ uid: `firebase-${role}` }) as never),
    userResolver: vi.fn(async () => ({ dbUserId: `db-${role}`, firebaseUid: `firebase-${role}`, role, branchId })),
  });
}

describe('GET /api/v1/branches', () => {
  it('returns every branch to an admin', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: branches, rowCount: branches.length } as never);
    const app = appFor('admin', null);

    const response = await app.inject({ method: 'GET', url: '/api/v1/branches', headers: { authorization: 'Bearer test-token' } });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(branches);
    expect(pool.query).toHaveBeenCalledWith('SELECT id, code, name FROM branches ORDER BY name, code, id');
    await app.close();
  });

  it('returns only the authenticated branch to a non-admin', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [branches[0]], rowCount: 1 } as never);
    const app = appFor('manager', branches[0].id);

    const response = await app.inject({ method: 'GET', url: '/api/v1/branches', headers: { authorization: 'Bearer test-token' } });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([branches[0]]);
    expect(pool.query).toHaveBeenCalledWith('SELECT id, code, name FROM branches WHERE id = $1', [branches[0].id]);
    await app.close();
  });

  it('rejects a non-admin branch spoof before querying the database', async () => {
    const query = vi.spyOn(pool, 'query');
    const app = appFor('manager', branches[0].id);

    const response = await app.inject({ method: 'GET', url: `/api/v1/branches?branchId=${branches[1].id}`, headers: { authorization: 'Bearer test-token' } });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BRANCH_SCOPE_DENIED');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});