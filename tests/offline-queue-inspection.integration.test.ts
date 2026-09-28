import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../server/src/app.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const testPool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 4 }) : null;

let branchId: string;
let otherBranchId: string;
let clientId: string;
let managerFirebaseUid: string;
let app: ReturnType<typeof buildApp>;

function capturedAt(daysAgo: number): string {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() - daysAgo);
  return value.toISOString();
}

async function insertRecord(input: { status: string; daysAgo: number; localId: string; synced?: boolean }): Promise<void> {
  await testPool!.query(
    `INSERT INTO field_collection_records
      (branch_id, local_id, idempotency_key, amount, status, device_id, captured_at, client_id, payment_method, synced_at)
     VALUES ($1, $2, $3, 1000, $4::payment_status, 'offline-inspection-test', $5, $6, 'cash', $7)`,
    [
      branchId,
      input.localId,
      `offline-inspection-key-${input.localId}`,
      input.status,
      capturedAt(input.daysAgo),
      clientId,
      input.synced ? new Date() : null,
    ],
  );
}

suite('stale offline queue inspection API', () => {
  beforeAll(async () => {
    const branch = await testPool!.query<{ id: string }>(
      `INSERT INTO branches (code, name) VALUES ($1, 'Offline Inspection Branch') RETURNING id`,
      [`OFFLINE-${randomUUID().slice(0, 8)}`],
    );
    const otherBranch = await testPool!.query<{ id: string }>(
      `INSERT INTO branches (code, name) VALUES ($1, 'Other Offline Inspection Branch') RETURNING id`,
      [`OFFLINE-OTHER-${randomUUID().slice(0, 8)}`],
    );
    branchId = branch.rows[0].id;
    otherBranchId = otherBranch.rows[0].id;
    clientId = randomUUID();
    managerFirebaseUid = `offline-inspection-manager-${randomUUID()}`;
    await testPool!.query(
      `INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Emma Auma')`,
      [clientId, branchId, `offline-client-${clientId}`],
    );
    await testPool!.query(
      `INSERT INTO field_collection_records
        (branch_id, local_id, idempotency_key, amount, status, device_id, captured_at, client_id, payment_method)
       VALUES ($1, $2, $3, 1000, 'pending_reconciliation', 'offline-inspection-test', $4, $5, 'cash')`,
      [otherBranchId, `other-branch-${otherBranchId}`, `other-branch-key-${otherBranchId}`, capturedAt(1), clientId],
    );
    await insertRecord({ status: 'pending_reconciliation', daysAgo: 8, localId: 'stale-pending-record' });
    await insertRecord({ status: 'pending_reconciliation', daysAgo: 1, localId: 'recent-pending-record' });
    await insertRecord({ status: 'recorded', daysAgo: 8, localId: 'synced-record', synced: true });
    await insertRecord({ status: 'posted', daysAgo: 8, localId: 'posted-unsynced-record' });
    for (let index = 0; index < 26; index++) {
      await insertRecord({ status: 'pending_reconciliation', daysAgo: 1, localId: `page-two-record-${String(index).padStart(2, '0')}` });
    }

    app = buildApp({
      tokenVerifier: async () => ({ uid: managerFirebaseUid } as never),
      userResolver: async () => ({
        dbUserId: randomUUID(),
        firebaseUid: managerFirebaseUid,
        role: 'manager',
        branchId,
        clientId: null,
        permissions: [],
      }),
    });
  });

  afterAll(async () => {
    await app?.close();
    if (testPool) {
      await testPool.query('DELETE FROM field_collection_records WHERE branch_id = $1 OR branch_id = $2', [branchId, otherBranchId]);
      await testPool.query('DELETE FROM clients WHERE id = $1', [clientId]);
      await testPool.query('DELETE FROM branches WHERE id = $1 OR id = $2', [branchId, otherBranchId]);
      await testPool.end();
    }
  });

  it('uses the same stale predicate as queue counts', async () => {
    const headers = { authorization: 'Bearer offline-inspection-test' };
    const countsResponse = await app.inject({ method: 'GET', url: `/api/v1/queues/counts?branchId=${branchId}`, headers });
    const staleResponse = await app.inject({ method: 'GET', url: `/api/v1/field-collection-records?branchId=${branchId}&staleOnly=true&pageSize=100`, headers });

    expect(countsResponse.statusCode).toBe(200);
    expect(staleResponse.statusCode).toBe(200);
    const counts = countsResponse.json().data.offline_queue;
    const stale = staleResponse.json().data;
    expect(counts).toEqual({ pending: 29, stale: 1 });
    expect(stale.summary).toEqual(counts);
    expect(stale.total).toBe(1);
    expect(stale.items[0]).toMatchObject({ localId: 'stale-pending-record', ageDays: 8, status: 'pending_reconciliation' });
  });

  it('denies a manager access to another branch', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/field-collection-records?branchId=${otherBranchId}`,
      headers: { authorization: 'Bearer offline-inspection-test' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('BRANCH_SCOPE_DENIED');
  });

  it('returns records beyond the first page', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/field-collection-records?branchId=${branchId}&staleOnly=false&page=2&pageSize=25`,
      headers: { authorization: 'Bearer offline-inspection-test' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ total: 30, page: 2, pageSize: 25 });
    expect(response.json().data.items).toHaveLength(5);
  });
});