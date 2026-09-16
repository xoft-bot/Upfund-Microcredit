/**
 * Stress-test data generator: creates 20 clients (5 per lifecycle scenario)
 * spread across all three loan products and three collector routes, using
 * the same validated services as seed-demo-domain-data.ts. This is a
 * SEPARATE script, not a modification to that one — it exists purely to
 * give dashboards, tables, and pagination real volume to render against,
 * without touching the smaller, already-verified correctness-focused seed.
 *
 * Prerequisites: run seed-test-accounts.ts first.
 *
 * Usage:
 *   npx tsx server/src/scripts/seed-stress-test-data.ts
 *
 * NOT idempotent, same reason as seed-demo-domain-data.ts: bump
 * STRESS_RUN_TAG before re-running.
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

const STRESS_RUN_TAG = '001';
const BRANCH_CODE = 'MAIN';

type ProductCode = 'PERSONAL' | 'BUSINESS_GROWTH' | 'EMERGENCY';
type Scenario = 'pending_approval' | 'active' | 'overdue' | 'fully_paid';

interface PersistedScheduleRow { dueOn: string; principalDue: number; interestDue: number; }

const FIRST_NAMES = ['Grace', 'Peter', 'Sarah', 'David', 'Joyce', 'Moses', 'Ruth', 'Emmanuel', 'Agnes', 'Samuel', 'Betty', 'Isaac', 'Christine', 'Joseph', 'Florence', 'Daniel', 'Esther', 'James', 'Harriet', 'John'];
const LAST_NAMES = ['Nakato', 'Okello', 'Amuge', 'Mugisha', 'Namutebi', 'Byaruhanga', 'Achieng', 'Kato', 'Nabirye', 'Wamala', 'Kiwanuka', 'Auma', 'Ssemwogerere', 'Nankya', 'Tumusiime', 'Opio', 'Nalubega', 'Kiggundu', 'Akello', 'Mbabazi'];
const PRODUCTS: ProductCode[] = ['PERSONAL', 'BUSINESS_GROWTH', 'EMERGENCY'];
const ROUTES = ['ROUTE-A', 'ROUTE-B', 'ROUTE-C'];
const SCENARIOS: Scenario[] = ['pending_approval', 'active', 'overdue', 'fully_paid'];
const AMOUNTS_BY_PRODUCT: Record<ProductCode, number[]> = {
  PERSONAL: [400_000, 600_000, 800_000, 1_000_000],
  BUSINESS_GROWTH: [2_000_000, 3_000_000, 4_500_000, 6_000_000],
  EMERGENCY: [200_000, 300_000, 450_000, 500_000],
};

interface ClientSpec {
  externalRef: string;
  displayName: string;
  product: ProductCode;
  requestedAmount: number;
  scenario: Scenario;
  routeCode: string;
}

function buildClientSpecs(): ClientSpec[] {
  const specs: ClientSpec[] = [];
  let index = 0;
  for (const scenario of SCENARIOS) {
    for (let i = 0; i < 5; i += 1) {
      const product = PRODUCTS[index % PRODUCTS.length];
      const amounts = AMOUNTS_BY_PRODUCT[product];
      const amount = amounts[index % amounts.length];
      const route = ROUTES[index % ROUTES.length];
      const first = FIRST_NAMES[index % FIRST_NAMES.length];
      const last = LAST_NAMES[(index * 3 + 7) % LAST_NAMES.length];
      specs.push({
        externalRef: `STRESS-${STRESS_RUN_TAG}-${String(index + 1).padStart(3, '0')}`,
        displayName: `${first} ${last}`,
        product,
        requestedAmount: amount,
        scenario,
        routeCode: route,
      });
      index += 1;
    }
  }
  return specs;
}

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

async function main(): Promise<void> {
  const clients = buildClientSpecs();
  console.log(`--- Generating ${clients.length} stress-test clients (${SCENARIOS.length} scenarios x 5 each) ---`);

  const branchId = await loadBranchId(BRANCH_CODE);
  const productIds = await loadProductIds(PRODUCTS);
  const officer = await loadActor('officer@upfund.test');
  const manager = await loadActor('manager@upfund.test');
  const collector = await loadActor('collector@upfund.test');

  console.log('--- 1. Creating clients ---');
  const clientIds: Record<string, string> = {};
  for (const spec of clients) {
    const client = await createPortalClient(officer, { branchId, externalRef: spec.externalRef, displayName: spec.displayName });
    clientIds[spec.externalRef] = client.id;
  }
  console.log(`  Created ${clients.length} clients.`);

  console.log('--- 2. Assigning clients to officer@upfund.test across 3 routes ---');
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
    collectorAssignments: clients.map((spec) => ({
      officerFirebaseUid: officer.firebaseUid,
      clientId: clientIds[spec.externalRef],
      branchCode: BRANCH_CODE,
      routeCode: spec.routeCode,
      effectiveFrom: new Date().toISOString().slice(0, 10),
    })),
  };
  await seedDatabase(assignmentSeed, withTransaction, undefined);

  console.log('--- 3. Running applications through the real lifecycle ---');
  let processed = 0;
  for (const spec of clients) {
    const clientId = clientIds[spec.externalRef];
    const application = await createLoanApplication(officer, { clientId, productId: productIds[spec.product], requestedAmount: spec.requestedAmount });
    await submitLoanApplication(officer, application.id);

    if (spec.scenario === 'pending_approval') {
      processed += 1;
      continue;
    }

    await reviewKyc(manager, application.id, { status: 'verified', verificationMethod: 'National ID', evidenceNotes: 'Stress-test seed — auto-verified' });
    await assessApplicationRisk(manager, application.id, { score: 65 + (processed % 30), riskGrade: ['A', 'B', 'C'][processed % 3], status: 'approved', policyVersion: 'stress-v1', rationale: 'Stress-test seed — acceptable risk profile' });
    const decision = await decideApplication(manager, application.id, { decision: 'approve', reason: 'Approved via seed-stress-test-data script' });
    const loanId = decision.loanId!;

    if (spec.scenario === 'overdue') {
      const anchor = new Date(Date.now() - (30 + (processed % 3) * 15) * 24 * 60 * 60 * 1000);
      await backdateScheduleForOverdue(loanId, productIds[spec.product], spec.requestedAmount, anchor);
    }

    await disburseLoan(officer, loanId, { disbursementReference: `STRESS-DISB-${STRESS_RUN_TAG}-${spec.externalRef}`, idempotencyKey: randomUUID() });
    await transitionLoan(officer, loanId, 'active', 'Loan activated after disbursement');

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
        paymentMethod: processed % 2 === 0 ? 'cash' : 'mobile_money',
      });
    } else if (spec.scenario === 'overdue') {
      await transitionLoan(officer, loanId, 'overdue', 'First installment missed past its due date');
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
          paymentMethod: processed % 2 === 0 ? 'cash' : 'mobile_money',
        });
      }
    }

    processed += 1;
    if (processed % 5 === 0) console.log(`  ${processed}/${clients.length} processed...`);
  }

  console.log(`Done. ${clients.length} clients across ${ROUTES.length} routes: 5 pending_approval, 5 active, 5 overdue, 5 fully_paid.`);
  await pool.end();
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'SEED_STRESS_TEST_DATA_FAILED');
    process.exitCode = 1;
  });
}