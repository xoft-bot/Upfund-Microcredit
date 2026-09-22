import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../server/src/db.js';
import { authMiddleware, resolveDatabaseUser, type TokenVerifier, type UserResolver } from '../server/src/middleware/auth.js';
import { registerCollectionQueryRoutes } from '../server/src/routes/collectionQueries.js';
import { registerReconciliationRoutes } from '../server/src/routes/reconciliations.js';
import { registerSessionRoutes } from '../server/src/routes/session.js';

const managerUser = { dbUserId: '00000000-0000-4000-8000-000000000001', firebaseUid: 'manager-firebase', role: 'manager' as const, branchId: '00000000-0000-4000-8000-000000000002' };
const collectorUser = { dbUserId: '00000000-0000-4000-8000-000000000003', firebaseUid: 'collector-firebase', role: 'collector' as const, branchId: managerUser.branchId };
const verifier: TokenVerifier = vi.fn(async () => ({ uid: managerUser.firebaseUid } as never));

afterEach(() => vi.restoreAllMocks());

describe('Batch 1 authoritative authentication', () => {
  it('resolves Firebase uid to the active database user and ignores token role claims', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{ db_user_id: managerUser.dbUserId, firebase_uid: managerUser.firebaseUid, role: 'manager', branch_id: managerUser.branchId }],
      rowCount: 1,
    } as never);
    const user = await resolveDatabaseUser(managerUser.firebaseUid);
    expect(user).toMatchObject({ ...managerUser, db_user_id: managerUser.dbUserId, firebase_uid: managerUser.firebaseUid, branch_id: managerUser.branchId });
    expect(query.mock.calls[0][1]).toEqual([managerUser.firebaseUid]);
  });

  it('returns 403 for a valid Firebase token with no active database mapping', async () => {
    const app = Fastify();
    const noUser: UserResolver = async () => null;
    app.get('/protected', { preHandler: authMiddleware(verifier, noUser) }, async () => ({ ok: true }));
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
    await app.close();
  });

  it('attaches the database identity to the request after JWT verification', async () => {
    const app = Fastify();
    app.get('/protected', { preHandler: authMiddleware(verifier, async () => managerUser) }, async (request) => ({ user: request.user, actor: request.actor }));
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/protected', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ ...managerUser, db_user_id: managerUser.dbUserId, firebase_uid: managerUser.firebaseUid, branch_id: managerUser.branchId });
    expect(response.json().actor).toMatchObject({ userId: managerUser.dbUserId, dbUserId: managerUser.dbUserId, role: 'manager', branchId: managerUser.branchId });
    await app.close();
  });

  it('returns the database-authoritative session profile', async () => {
    const app = Fastify();
    registerSessionRoutes(app, verifier, async () => managerUser);
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/v1/session', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ userId: managerUser.dbUserId, firebaseUid: managerUser.firebaseUid, role: 'manager', branchId: managerUser.branchId, permissions: [] });
    await app.close();
  });
});

describe('Batch 1 scoped collection and reconciliation queries', () => {
  it('loads collector collections using the authoritative branch and collector ids', async () => {
    const resolver: UserResolver = async () => collectorUser;
    const query = vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{
        id: 'collection-1',
        local_id: 'local-1',
        idempotency_key: 'idempotency-1',
        branch_id: collectorUser.branchId,
        payment_id: 'payment-1',
        client_id: 'client-1',
        client_name: 'Client One',
        loan_id: 'loan-1',
        collector_id: collectorUser.dbUserId,
        amount: '5000',
        status: 'pending_reconciliation',
        device_id: 'device-1',
        payment_method: 'cash',
        receipt_reference: 'RCT-1',
        principal_amount: '5000',
        penalty_amount: '0',
        interest_amount: '0',
        overpayment_amount: '0',
        captured_at: new Date('2026-08-29T00:00:00Z'),
        created_at: new Date('2026-08-29T00:00:00Z'),
        synced_at: new Date('2026-08-29T00:01:00Z'),
      }],
      rowCount: 1,
    } as never);
    const app = Fastify();
    registerCollectionQueryRoutes(app, verifier, resolver);
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/v1/collections/queue', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.records[0]).toMatchObject({ branchId: collectorUser.branchId, collectorId: collectorUser.dbUserId, clientName: 'Client One', amount: 5000 });
    expect(query.mock.calls[0][1]).toEqual([collectorUser.branchId, collectorUser.dbUserId, 100]);
    await app.close();
  });

  it('rejects collectors from reading another collector and non-managers from reconciliation review', async () => {
    const app = Fastify();
    registerCollectionQueryRoutes(app, verifier, async () => collectorUser);
    registerReconciliationRoutes(app, verifier, async () => collectorUser);
    await app.ready();
    const collection = await app.inject({ method: 'GET', url: `/api/v1/collections/queue?collectorId=${managerUser.dbUserId}`, headers: { authorization: 'Bearer valid' } });
    const reconciliation = await app.inject({ method: 'GET', url: '/api/v1/reconciliations/queue', headers: { authorization: 'Bearer valid' } });
    expect(collection.statusCode).toBe(403);
    expect(collection.json().error.code).toBe('COLLECTOR_SCOPE_DENIED');
    expect(reconciliation.statusCode).toBe(403);
    expect(reconciliation.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('loads reconciliation review data only from the requested manager branch', async () => {
    const query = vi.spyOn(pool, 'query').mockResolvedValue({
      rows: [{
        id: 'reconciliation-1',
        batch_reference: 'BATCH-1',
        branch_id: managerUser.branchId,
        collection_date: '2026-08-29',
        expected_amount: '10000',
        recorded_amount: '9000',
        submitted_amount: '9000',
        variance: '-1000',
        status: 'variance',
        submitted_by: collectorUser.dbUserId,
        submitted_by_name: 'Field Collector',
        payments: [{ paymentId: 'payment-1', clientId: 'client-1', amount: 9000, receiptReference: 'RCT-1', status: 'posted', principalAmount: 8000, penaltyAmount: 500, interestAmount: 500, overpaymentAmount: 0 }],
      }],
      rowCount: 1,
    } as never);
    const app = Fastify();
    registerReconciliationRoutes(app, verifier, async () => managerUser);
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/v1/reconciliations/queue', headers: { authorization: 'Bearer valid' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.batches[0]).toMatchObject({ batchReference: 'BATCH-1', branchId: managerUser.branchId, variance: -1000 });
    expect(query.mock.calls[0][1]).toEqual([managerUser.branchId, 100]);
    await app.close();
  });
});

describe('resolveDatabaseUser identity resolution (real database)', () => {
  it('does not authenticate a different Firebase account that merely shares an existing active user\'s email', async () => {
    // Regression test for the account-takeover vector: resolveDatabaseUser
    // used to fall back to matching on email (and on a raw DB id) when the
    // firebase_uid didn't match. That meant a second, unrelated Firebase
    // account presenting the same email as an existing active user — e.g.
    // after the original Firebase account was deleted and the email became
    // available for re-registration — would silently inherit that user's
    // role, branch, and permissions. This test proves that path is closed:
    // matching happens strictly on firebase_uid now.
    const roleResult = await pool.query<{ id: string }>(
      `INSERT INTO roles (code, name) VALUES ('manager', 'Manager') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const roleId = roleResult.rows[0].id;
    const originalFirebaseUid = `original-${randomUUID()}`;
    const impostorFirebaseUid = `impostor-${randomUUID()}`;
    const sharedEmail = `shared-${randomUUID()}@example.com`;

    await pool.query(
      `INSERT INTO users (id, firebase_uid, email, display_name, status, role_id)
       VALUES ($1, $2, $3, 'Original Manager', 'active', $4)`,
      [randomUUID(), originalFirebaseUid, sharedEmail, roleId],
    );

    try {
      // The impostor account: a different Firebase UID, but presents the
      // exact same email address (as would happen if they registered a new
      // Firebase account with that email after the original was deleted).
      const impostorResult = await resolveDatabaseUser(impostorFirebaseUid, sharedEmail);
      expect(impostorResult).toBeNull();

      // Sanity: the legitimate account, using its own real firebase_uid,
      // still resolves correctly — this isn't just breaking auth entirely.
      const legitimateResult = await resolveDatabaseUser(originalFirebaseUid, sharedEmail);
      expect(legitimateResult).not.toBeNull();
      expect(legitimateResult?.role).toBe('manager');
    } finally {
      await pool.query(`DELETE FROM users WHERE firebase_uid = $1`, [originalFirebaseUid]);
    }
  });

  it('does not authenticate by matching a raw database user id passed as the Firebase uid', async () => {
    const roleResult = await pool.query<{ id: string }>(
      `INSERT INTO roles (code, name) VALUES ('admin', 'Administrator') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const roleId = roleResult.rows[0].id;
    const dbUserId = randomUUID();
    const realFirebaseUid = `real-${randomUUID()}`;

    await pool.query(
      `INSERT INTO users (id, firebase_uid, email, display_name, status, role_id)
       VALUES ($1, $2, $3, 'Admin User', 'active', $4)`,
      [dbUserId, realFirebaseUid, `admin-${randomUUID()}@example.com`, roleId],
    );

    try {
      // Presenting the raw DB id string as if it were a Firebase uid must
      // not resolve to that user.
      const result = await resolveDatabaseUser(dbUserId);
      expect(result).toBeNull();
    } finally {
      await pool.query(`DELETE FROM users WHERE firebase_uid = $1`, [realFirebaseUid]);
    }
  });
});