/**
 * One-off utility: creates (or reuses) the 7 standard test accounts in
 * Firebase Auth, then upserts matching rows into Postgres via the
 * project's own validated seedDatabase() pipeline.
 *
 * The client-role account is special: it must be linked to a row in the
 * clients table (SEED_CLIENT_ID_REQUIRED), so it's seeded in a second pass
 * once that client profile exists.
 *
 * Usage:
 *   npx tsx server/src/scripts/seed-test-accounts.ts
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import admin from 'firebase-admin';
import { getFirebaseApp } from '../config/firebaseAdmin.js';
import { pool, withTransaction } from '../db.js';
import { seedDatabase, type SeedInput, type SeedUser } from '../db/seed.js';
import { randomUUID } from 'node:crypto';
import type { UserRole } from '../../../shared/contracts.js';

interface TestAccountSpec {
  email: string;
  password: string;
  role: UserRole;
  displayName: string;
}

const TEST_ACCOUNTS: TestAccountSpec[] = [
  { email: 'admin@upfund.test', password: 'TestPassword123!', role: 'admin', displayName: 'System Admin' },
  { email: 'manager@upfund.test', password: 'TestPassword123!', role: 'manager', displayName: 'Branch Manager' },
  { email: 'officer@upfund.test', password: 'TestPassword123!', role: 'officer', displayName: 'Loan Officer' },
  { email: 'collector@upfund.test', password: 'TestPassword123!', role: 'collector', displayName: 'Field Collector' },
  { email: 'accountant@upfund.test', password: 'TestPassword123!', role: 'accountant', displayName: 'Branch Accountant' },
  { email: 'marketing@upfund.test', password: 'TestPassword123!', role: 'marketing', displayName: 'Marketing Analyst' },
  { email: 'client@upfund.test', password: 'TestPassword123!', role: 'client', displayName: 'Test Borrower' },
];

const BRANCH_CODE = 'MAIN';
const BRANCH_NAME = 'Main Branch';
const TEST_CLIENT_EXTERNAL_REF = 'TEST-CLIENT-001';

async function getOrCreateFirebaseUser(auth: admin.auth.Auth, spec: TestAccountSpec): Promise<string> {
  try {
    const existing = await auth.getUserByEmail(spec.email);
    return existing.uid;
  } catch (error) {
    const err = error as { code?: string };
    if (err.code !== 'auth/user-not-found') throw error;
  }
  const created = await auth.createUser({
    email: spec.email,
    password: spec.password,
    displayName: spec.displayName,
    emailVerified: true,
  });
  return created.uid;
}

async function getOrCreateTestClientId(branchId: string): Promise<string> {
  const existing = await pool.query<{ id: string }>('SELECT id FROM clients WHERE external_ref = $1', [TEST_CLIENT_EXTERNAL_REF]);
  if (existing.rowCount) return existing.rows[0].id;
  const created = await pool.query<{ id: string }>(
    `INSERT INTO clients (branch_id, external_ref, display_name) VALUES ($1, $2, $3) RETURNING id`,
    [branchId, TEST_CLIENT_EXTERNAL_REF, 'Test Borrower'],
  );
  return created.rows[0].id;
}

async function main(): Promise<void> {
  console.log('Starting test account seeding...');

  const auth = getFirebaseApp().auth();
  const clientSpec = TEST_ACCOUNTS.find((spec) => spec.role === 'client')!;

  console.log('--- 1. Creating/looking up Firebase Auth users (non-client roles) ---');
  const nonClientUsers: SeedUser[] = [];
  for (const spec of TEST_ACCOUNTS) {
    if (spec.role === 'client') continue;
    const firebaseUid = await getOrCreateFirebaseUser(auth, spec);
    console.log(`  ${spec.email} -> ${firebaseUid}`);
    nonClientUsers.push({
      id: randomUUID(),
      firebaseUid,
      email: spec.email,
      displayName: spec.displayName,
      role: spec.role,
      branchCode: BRANCH_CODE,
      status: 'active',
    });
  }

  console.log('--- 2. Seeding branch and non-client users into Postgres ---');
  const seedInput: SeedInput = {
    approved: true,
    branches: [{ code: BRANCH_CODE, name: BRANCH_NAME }],
    users: nonClientUsers,
    loanProducts: [],
  };
  const result = await seedDatabase(seedInput, withTransaction, undefined);
  console.log(`Seeded ${result.branches} branch(es) and ${result.users} user(s).`);

  console.log('--- 3. Ensuring a test client profile exists, then seeding the client-role account ---');
  const branchRow = await pool.query<{ id: string }>('SELECT id FROM branches WHERE code = $1', [BRANCH_CODE]);
  if (!branchRow.rowCount) throw new Error(`BRANCH_NOT_FOUND: ${BRANCH_CODE}`);
  const testClientId = await getOrCreateTestClientId(branchRow.rows[0].id);
  console.log(`  Test client profile -> ${testClientId}`);

  const clientFirebaseUid = await getOrCreateFirebaseUser(auth, clientSpec);
  console.log(`  ${clientSpec.email} -> ${clientFirebaseUid}`);
  const clientUserSeed: SeedInput = {
    approved: true,
    branches: [{ code: BRANCH_CODE, name: BRANCH_NAME }],
    users: [{
      id: randomUUID(),
      firebaseUid: clientFirebaseUid,
      email: clientSpec.email,
      displayName: clientSpec.displayName,
      role: 'client',
      branchCode: BRANCH_CODE,
      clientId: testClientId,
      status: 'active',
    }],
    loanProducts: [],
  };
  const clientResult = await seedDatabase(clientUserSeed, withTransaction, undefined);
  console.log(`  Seeded ${clientResult.users} client-role user(s), linked to client ${testClientId}.`);

  await pool.end();
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'SEED_TEST_ACCOUNTS_FAILED');
    process.exitCode = 1;
  });
}