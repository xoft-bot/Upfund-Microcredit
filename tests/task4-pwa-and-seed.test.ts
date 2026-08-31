import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { identityFromClaims } from '../client/src/services/firebase.js';
import { OfflineQueue } from '../client/src/services/offlineQueue.js';
import type { FieldCollectionRecord } from '../client/src/types/field-ops.js';
import { parseSeedInput, readApprovedSeedInput, seedDatabase, stableAdminUserId, withAdminFirebaseUid, type SeedInput } from '../server/src/db/seed.js';
import type { DbClient } from '../server/src/db.js';

const storage = new Map<string, string>();
const browserWindow = { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: vi.fn(), removeEventListener: vi.fn() };
Object.defineProperty(globalThis, 'window', { value: browserWindow, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });

const record: FieldCollectionRecord = { localId: 'task4-record', idempotencyKey: 'task4-idempotency', clientId: 'client-task4', loanId: 'loan-task4', branchId: 'branch-task4', collectorId: 'collector-task4', amount: 5000, paymentMethod: 'cash', status: 'Queued', syncState: 'queued', deviceId: 'device-task4', correlationId: 'correlation-task4', capturedAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z', retryCount: 0 };

describe('Task 4 PWA shell and queue state', () => {
  beforeEach(() => storage.clear());

  it('serves a manifest and a service worker that bypasses API and mutation requests', async () => {
    const [manifest, worker] = await Promise.all([
      readFile('client/public/manifest.webmanifest', 'utf8'),
      readFile('client/public/sw.js', 'utf8'),
    ]);
    expect(JSON.parse(manifest)).toMatchObject({ name: 'Upfund Microcredit Field Operations', start_url: '/', display: 'standalone' });
    expect(worker).toContain("request.method === 'GET'");
    expect(worker).toContain("url.pathname.startsWith(path)");
    expect(worker).toContain("if (!isStaticShellRequest(request, url)) return");
    expect(worker).not.toContain("cache.put(request, response)");
  });

  it('notifies subscribers with queue counts whenever persisted state changes', async () => {
    const queue = new OfflineQueue(async () => ({ ok: true }));
    const snapshots: Array<{ queued: number; syncing: number; rejected: number; conflict: number }> = [];
    queue.subscribe((snapshot) => snapshots.push(snapshot.metrics!));
    await queue.enqueue(record);
    await queue.updateStatus(record.localId, 'Needs review', 'CONFLICT');
    expect(snapshots.at(-2)).toMatchObject({ queued: 1, syncing: 0, rejected: 0, conflict: 0 });
    expect(snapshots.at(-1)).toMatchObject({ queued: 0, syncing: 0, rejected: 0, conflict: 1 });
  });
});

describe('Task 4 authenticated identity', () => {
  it('derives collector and branch context from Firebase claims without defaults', () => {
    expect(identityFromClaims('uid-1', { role: 'collector', branchId: 'branch-1', collectorId: 'collector-1' })).toMatchObject({ uid: 'uid-1', collectorId: 'collector-1', branchId: 'branch-1', role: 'collector' });
    expect(identityFromClaims('uid-2', { role: 'collector' })).toMatchObject({ uid: 'uid-2', collectorId: 'uid-2', branchId: null });
    expect(identityFromClaims('uid-3', { role: 'unknown', branchId: 'branch-3' })).toBeNull();
  });
});

const approvedSeed: SeedInput = {
  approved: true,
  branches: [{ code: 'KLA-CENTRAL', name: 'Kampala Central' }],
  users: [{ id: '00000000-0000-4000-8000-000000000001', firebaseUid: 'firebase-collector-1', email: 'collector@example.test', displayName: 'Field Collector', role: 'collector', branchCode: 'KLA-CENTRAL' }],
  loanProducts: [{ code: 'STANDARD-UGX', name: 'Standard microcredit', currency: 'UGX', active: true }],
};

describe('Task 4 fail-closed seed', () => {
  it('rejects missing, unapproved, empty, duplicate, and unknown-branch inputs', async () => {
    await expect(readApprovedSeedInput(undefined, undefined)).rejects.toThrow('SEED_INPUT_REQUIRED');
    expect(() => parseSeedInput({})).toThrow('SEED_INPUT_NOT_APPROVED');
    expect(() => parseSeedInput({ approved: true })).toThrow('SEED_INPUT_EMPTY');
    expect(() => parseSeedInput({ ...approvedSeed, branches: [...approvedSeed.branches, approvedSeed.branches[0]] })).toThrow('SEED_DUPLICATE_BRANCH_CODE');
    expect(() => parseSeedInput({ ...approvedSeed, users: [{ ...approvedSeed.users[0], branchCode: 'UNKNOWN' }] })).toThrow('SEED_UNKNOWN_BRANCH');
    expect(() => parseSeedInput({ ...approvedSeed, loanProducts: { code: 'not-a-list' } })).toThrow('SEED_INVALID_LOAN_PRODUCTS_LIST');
  });

  it('upserts branches, roles, RBAC users, and products inside one transaction', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('INSERT INTO branches')) return { rows: [{ id: 'branch-db-id' }] };
        if (sql.includes('INSERT INTO roles')) return { rows: [{ id: 'role-db-id' }] };
        return { rows: [] };
      }),
    } as unknown as DbClient;
    const transaction = async <T>(fn: (dbClient: DbClient) => Promise<T>): Promise<T> => fn(client);
    await seedDatabase(approvedSeed, transaction);
    expect(queries.filter((query) => query.sql.includes('ON CONFLICT')).map((query) => query.sql)).toHaveLength(4);
    expect(queries.some((query) => query.sql.includes('INSERT INTO branches'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO users') && query.sql.includes('role_id'))).toBe(true);
    expect(queries.some((query) => query.sql.includes('INSERT INTO loan_products'))).toBe(true);
    expect(queries.find((query) => query.sql.includes('INSERT INTO users'))?.params).toContain('branch-db-id');
  });

  it('parses approved Firebase UID-based collector assignments', () => {
    const parsed = parseSeedInput({
      ...approvedSeed,
      collectorAssignments: [{
        officerFirebaseUid: 'firebase-collector-1',
        clientId: '00000000-0000-4000-8000-000000000002',
        branchCode: 'KLA-CENTRAL',
        routeCode: 'KLA-CENTRAL-A',
        effectiveFrom: '2026-08-01',
      }],
    });
    expect(parsed.collectorAssignments).toEqual([expect.objectContaining({ officerFirebaseUid: 'firebase-collector-1', routeCode: 'KLA-CENTRAL-A', effectiveTo: null })]);
  });

  it('creates a deterministic admin mapping from a supplied Firebase UID', () => {
    const admin = withAdminFirebaseUid({ approved: true, branches: [], users: [], loanProducts: [] }, 'firebase-admin-real');
    expect(admin.users).toEqual([expect.objectContaining({ id: stableAdminUserId('firebase-admin-real'), firebaseUid: 'firebase-admin-real', role: 'admin', displayName: 'Administrator' })]);
    expect(parseSeedInput(admin).users).toHaveLength(1);
  });

  it('promotes an existing supplied Firebase UID without duplicating it', () => {
    const input = withAdminFirebaseUid(approvedSeed, approvedSeed.users[0].firebaseUid);
    expect(input.users).toHaveLength(1);
    expect(input.users[0].role).toBe('admin');
    expect(withAdminFirebaseUid(input, approvedSeed.users[0].firebaseUid).users).toHaveLength(1);
  });
});