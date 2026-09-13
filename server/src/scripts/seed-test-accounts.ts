/**
 * One-off utility: creates (or reuses) the 4 standard test accounts in
 * Firebase Auth, then upserts matching rows into Postgres via the
 * project's own validated seedDatabase() pipeline.
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
];

const BRANCH_CODE = 'MAIN';
const BRANCH_NAME = 'Main Branch';

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

async function main(): Promise<void> {
  console.log('Starting test account seeding...');

  const auth = getFirebaseApp().auth();

  console.log('--- 1. Creating/looking up Firebase Auth users ---');
  const users: SeedUser[] = [];
  for (const spec of TEST_ACCOUNTS) {
    const firebaseUid = await getOrCreateFirebaseUser(auth, spec);
    console.log(`  ${spec.email} -> ${firebaseUid}`);
    users.push({
      id: randomUUID(),
      firebaseUid,
      email: spec.email,
      displayName: spec.displayName,
      role: spec.role,
      branchCode: BRANCH_CODE,
      status: 'active',
    });
  }

  console.log('--- 2. Seeding branch and users into Postgres ---');
  const seedInput: SeedInput = {
    approved: true,
    branches: [{ code: BRANCH_CODE, name: BRANCH_NAME }],
    users,
    loanProducts: [],
  };

  const result = await seedDatabase(seedInput, withTransaction, undefined);
  console.log(`Seeded ${result.branches} branch(es) and ${result.users} user(s).`);

  await pool.end();
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'SEED_TEST_ACCOUNTS_FAILED');
    process.exitCode = 1;
  });
}
