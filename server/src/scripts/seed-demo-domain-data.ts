/**
 * One-off utility: populates realistic domain test data for end-to-end
 * stress-testing — loan products, sample clients, and loans spanning the
 * pending/active/overdue/fully-paid lifecycle — entirely through the
 * project's own validated services (seedDatabase, lifecycle.ts,
 * payment-posting.ts). No schedule-math is reimplemented here: loan
 * products persist their own rate/term/cycle (see loan_products migration),
 * and decideApplication (services/lifecycle.ts) generates and persists a
 * full repayment schedule on approval via services/schedule.ts. This script
 * only overrides that schedule's anchor date for the 'overdue' scenario, so
 * the first installment is genuinely past due.
 *
 * Prerequisites: run seed-test-accounts.ts first (needs the MAIN branch and
 * the officer/manager/collector test users already in Postgres).
 *
 * Usage:
 *   npx tsx server/src/scripts/seed-demo-domain-data.ts
 *
 * NOT idempotent: client external_ref values are unique. Re-running as-is
 * will fail on the UNIQUE constraint. Change DEMO_RUN_TAG below (or clear
 * the demo rows) before re-running.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pool, withTransaction } from '../db.js';
import { seedDatabase, type SeedInput } from '../db/seed.js';
import {
  createClient as createPortalClient,
  createLoanApplication,
  submitLoanApplication,
  reviewKyc,
  assessApplicationRisk,
  decideApplication,
  disburseLoan,
  transitionLoan,
} from '../services/lifecycle.js';
import { loadProductTerms, buildRepaymentSchedule, persistRepaymentSchedule } from '../services/schedule.js';
import { postManualPayment } from '../services/payment-posting.js';
import type { Actor, UserRole } from '../../../shared/contracts.js';

const DEMO_RUN_TAG = '006';
const BRANCH_CODE = 'MAIN';

type ProductCode = 'PERSONAL' | 'BUSINESS_GROWTH' | 'EMERGENCY';

interface PersistedScheduleRow { dueOn: string; principalDue: number; interestDue: number; }

async function backdateScheduleForOverdue(loanId: string, productId: string, principal: number, anchor: Date): Promise<void> {
  await withTransaction(async (client) => {
    const terms = await loadProductTerms(client, productId);
    const rows = buildRepaymentSchedule(principal, terms, anchor);
    await persistRepaymentSchedule(client, loanId, rows);
  });
}

async function loadPersistedSchedule(loanId: string): Promise<PersistedScheduleRow[]> {
  const result = await pool.query<{ due_on: string; principal_due: string; interest_due: string }>(
    `SELECT due_on, principal_due, interest_due FROM repayment_schedules WHERE loan_id = $1 ORDER BY due_on ASC`,
    [loanId],
  );
  return result.rows.map((row) => ({ dueOn: row.due_on, principalDue: Number(row.principal_due), interestDue: Number(row.interest_due) }));
}

async function loadActor(email: string): Promise<Actor> {
  const result = await pool.query<{ id: string; firebase_uid: string; branch_id: string; role_code: string }>(
    `SELECT u.id, u.firebase_uid, u.branch_id, r.code AS role_code
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.email = $1`,
    [email],
  );
  if (!result.rowCount) throw new Error(`SEED_ACTOR_NOT_FOUND: ${email} — run seed-test-accounts.ts first`);
  const row = result.rows[0];
  return { userId: row.id, dbUserId: row.id, firebaseUid: row.firebase_uid, role: row.role_code as UserRole, branchId: row.branch_id, clientId: null, permissions: [] };
}

async function loadUserSeedSnapshot(email: string): Promise<{ id: string; firebaseUid: string; email: string; displayName: string; roleCode: string; status: 'active' | 'disabled' }> {
  const result = await pool.query<{ id: string; firebase_uid: string; email: string; display_name: string; role_code: string; status: 'active' | 'disabled' }>(
    `SELECT u.id, u.firebase_uid, u.email, u.display_name, r.code AS role_code, u.status
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.email = $1`,
    [email],
  );
  if (!result.rowCount) throw new Error(`SEED_ACTOR_NOT_FOUND: ${email} — run seed-test-accounts.ts first`);
  const row = result.rows[0];
  return { id: row.id, firebaseUid: row.firebase_uid, email: row.email, displayName: row.display_name, roleCode: row.role_code, status: row.status };
}

async function loadBranchId(code: string): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM branches WHERE code = $1', [code]);
  if (!result.rowCount) throw new Error(`SEED_BRANCH_NOT_FOUND: ${code} — run seed-test-accounts.ts first`);
  return result.rows[0].id;
}

async function loadProductIds(codes: ProductCode[]): Promise<Record<ProductCode, string>> {
  const result = await pool.query<{ code: string; id: string }>('SELECT code, id FROM loan_products WHERE code = ANY($1::text[])', [codes]);
  const map = {} as Record<ProductCode, string>;
  for (const row of result.rows) map[row.code as ProductCode] = row.id;
  for (const code of codes) if (!map[code]) throw new Error(`SEED_PRODUCT_NOT_FOUND: ${code}`);
  return map;
}

type Scenario = 'pending_approval' | 'active' | 'overdue' | 'fully_paid';

interface ClientSpec {
  externalRef: string;
  displayName: string;
  product: ProductCode;
  requestedAmount: number;
  scenario: Scenario;
}

const CLIENTS: ClientSpec[] = [
  { externalRef: `DEMO-${DEMO_RUN_TAG}-001`, displayName: 'Grace Nakato', product: 'PERSONAL', requestedAmount: 800_000, scenario: 'pending_approval' },
  { externalRef: `DEMO-${DEMO_RUN_TAG}-002`, displayName: 'Peter Okello', product: 'BUSINESS_GROWTH', requestedAmount: 3_000_000, scenario: 'active' },
  { externalRef: `DEMO-${DEMO_RUN_TAG}-003`, displayName: 'Sarah Amuge', product: 'EMERGENCY', requestedAmount: 400_000, scenario: 'overdue' },
  { externalRef: `DEMO-${DEMO_RUN_TAG}-004`, displayName: 'David Mugisha', product: 'PERSONAL', requestedAmount: 600_000, scenario: 'fully_paid' },
];

async function main(): Promise<void> {
  console.log('--- 1. Seeding loan products (Personal, Business Growth; Emergency already exists) ---');
  const productSeed: SeedInput = {
    approved: true,
    branches: [{ code: BRANCH_CODE, name: 'Main Branch' }],
    users: [],
    loanProducts: [
      { code: 'PERSONAL', name: 'Personal Loan', currency: 'UGX', active: true, annualRatePercent: 24, installments: 6, repaymentCycle: 'monthly' },
      { code: 'BUSINESS_GROWTH', name: 'Business Growth Loan', currency: 'UGX', active: true, annualRatePercent: 20, installments: 12, repaymentCycle: 'monthly' },
    ],
  };
  await seedDatabase(productSeed, withTransaction, undefined);

  const branchId = await loadBranchId(BRANCH_CODE);
  const productIds = await loadProductIds(['PERSONAL', 'BUSINESS_GROWTH', 'EMERGENCY']);
  const officer = await loadActor('officer@upfund.test');
  const manager = await loadActor('manager@upfund.test');
  const collector = await loadActor('collector@upfund.test');

  console.log('--- 2. Creating sample clients ---');
  const clientIds: Record<string, string> = {};
  for (const spec of CLIENTS) {
    const client = await createPortalClient(officer, { branchId, externalRef: spec.externalRef, displayName: spec.displayName });
    clientIds[spec.externalRef] = client.id;
    console.log(`  ${spec.displayName} (${spec.externalRef}) -> ${client.id}`);
  }

  console.log('--- 3. Assigning clients to officer@upfund.test ---');
  const officerSnapshot = await loadUserSeedSnapshot('officer@upfund.test');
  const assignmentSeed: SeedInput = {
    approved: true,
    branches: [{ code: BRANCH_CODE, name: 'Main Branch' }],
    users: [{
      id: officerSnapshot.id,
      firebaseUid: officerSnapshot.firebaseUid,
      email: officerSnapshot.email,
      displayName: officerSnapshot.displayName,
      role: officerSnapshot.roleCode as UserRole,
      branchCode: BRANCH_CODE,
      status: officerSnapshot.status,
    }],
    loanProducts: [],
    collectorAssignments: CLIENTS.map((spec) => ({
      officerFirebaseUid: officer.firebaseUid,
      clientId: clientIds[spec.externalRef],
      branchCode: BRANCH_CODE,
      routeCode: `SEED-ROUTE-${DEMO_RUN_TAG}`,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    })),
  };
  await seedDatabase(assignmentSeed, withTransaction, undefined);

  console.log('--- 4. Running loan applications through the real lifecycle ---');
  for (const spec of CLIENTS) {
    const clientId = clientIds[spec.externalRef];
    const application = await createLoanApplication(officer, { clientId, productId: productIds[spec.product], requestedAmount: spec.requestedAmount });
    await submitLoanApplication(officer, application.id);
    console.log(`  [${spec.displayName}] application ${application.id} submitted`);

    if (spec.scenario === 'pending_approval') {
      console.log(`  [${spec.displayName}] left at 'submitted' — this is the pending-approval bucket`);
      continue;
    }

    await reviewKyc(manager, application.id, { status: 'verified', verificationMethod: 'National ID', evidenceNotes: 'ID and address verified during seed run' });
    await assessApplicationRisk(manager, application.id, { score: 72, riskGrade: 'B', status: 'approved', policyVersion: 'seed-v1', rationale: 'Acceptable risk profile for stress-test seed data' });
    const decision = await decideApplication(manager, application.id, { decision: 'approve', reason: 'Approved via seed-demo-domain-data script' });
    const loanId = decision.loanId!;

    if (spec.scenario === 'overdue') {
      const anchor = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      await backdateScheduleForOverdue(loanId, productIds[spec.product], spec.requestedAmount, anchor);
    }

    await disburseLoan(officer, loanId, { disbursementReference: `SEED-DISB-${DEMO_RUN_TAG}-${spec.externalRef}`, idempotencyKey: randomUUID() });
    await transitionLoan(officer, loanId, 'active', 'Loan activated after disbursement');
    console.log(`  [${spec.displayName}] loan ${loanId} disbursed and activated`);

    if (spec.scenario === 'active') {
      const schedule = await loadPersistedSchedule(loanId);
      const first = schedule[0];
      await postManualPayment({
        actorUserId: collector.dbUserId,
        loanId,
        branchId,
        clientId,
        amount: first.principalDue + first.interestDue,
        idempotencyKey: randomUUID(),
        correlationId: randomUUID(),
        paymentMethod: 'cash',
      });
      console.log(`  [${spec.displayName}] first installment paid — loan remains active with a balance`);
    } else if (spec.scenario === 'overdue') {
      await transitionLoan(officer, loanId, 'overdue', 'First installment missed past its due date');
      console.log(`  [${spec.displayName}] flagged overdue — first installment is unpaid and past due`);
    } else if (spec.scenario === 'fully_paid') {
      const schedule = await loadPersistedSchedule(loanId);
      for (const installment of schedule) {
        await postManualPayment({
          actorUserId: collector.dbUserId,
          loanId,
          branchId,
          clientId,
          amount: installment.principalDue + installment.interestDue,
          idempotencyKey: randomUUID(),
          correlationId: randomUUID(),
          paymentMethod: 'cash',
        });
      }
      console.log(`  [${spec.displayName}] all installments paid — loan is now completed`);
    }
  }

  console.log('Done.');
  await pool.end();
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'SEED_DEMO_DOMAIN_DATA_FAILED');
    process.exitCode = 1;
  });
}