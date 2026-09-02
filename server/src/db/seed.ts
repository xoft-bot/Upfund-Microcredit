import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pool, withTransaction, type DbClient } from '../db.js';
import type { UserRole } from '../../../shared/contracts.js';

const allowedRoles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant', 'client', 'marketing']);
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface SeedBranch { code: string; name: string; }
export interface SeedUser {
  id: string;
  firebaseUid: string;
  email?: string;
  displayName: string;
  role: UserRole;
  branchCode?: string | null;
  clientId?: string | null;
  status?: 'active' | 'disabled';
}
export interface SeedLoanProduct { code: string; name: string; currency?: string; active?: boolean; }
export interface SeedCollectorAssignment {
  officerFirebaseUid: string;
  clientId: string;
  branchCode: string;
  routeCode: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}
export interface SeedInput {
  approved: true;
  branches: SeedBranch[];
  users: SeedUser[];
  loanProducts: SeedLoanProduct[];
  collectorAssignments?: SeedCollectorAssignment[];
}
export interface SeedResult { branches: number; users: number; loanProducts: number; collectorAssignments: number; }
export type TransactionRunner = <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;

export function stableAdminUserId(firebaseUid: string): string {
  const digest = createHash('sha256').update(`upfund-admin:${firebaseUid}`).digest('hex').slice(0, 32).split('');
  digest[12] = '5';
  digest[16] = ['8', '9', 'a', 'b'][parseInt(digest[16], 16) % 4];
  return `${digest.slice(0, 8).join('')}-${digest.slice(8, 12).join('')}-${digest.slice(12, 16).join('')}-${digest.slice(16, 20).join('')}-${digest.slice(20).join('')}`;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`SEED_INVALID_${label.toUpperCase()}`);
  return value.trim();
}

function stableCode(value: unknown, label: string): string {
  const code = requiredText(value, label);
  if (!codePattern.test(code)) throw new Error(`SEED_INVALID_${label.toUpperCase()}_CODE`);
  return code;
}

function uniqueCodes(items: Array<{ code: string }>, label: string): void {
  const codes = items.map((item) => item.code);
  if (new Set(codes).size !== codes.length) throw new Error(`SEED_DUPLICATE_${label.toUpperCase()}_CODE`);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`SEED_INVALID_${label.toUpperCase()}`);
  return value as Record<string, unknown>;
}

function listValue(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`SEED_INVALID_${label.toUpperCase()}_LIST`);
  return value;
}

function dateValue(value: unknown, label: string): string {
  const date = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) throw new Error(`SEED_INVALID_${label.toUpperCase()}_DATE`);
  return date;
}

export function parseSeedInput(raw: unknown, options: { allowEmpty?: boolean } = {}): SeedInput {
  if (!raw || typeof raw !== 'object' || (raw as { approved?: unknown }).approved !== true) throw new Error('SEED_INPUT_NOT_APPROVED');
  const input = raw as Record<string, unknown>;
  const branches = listValue(input.branches, 'branches').map((item) => {
    const value = objectValue(item, 'branch');
    return { code: stableCode(value.code, 'branch'), name: requiredText(value.name, 'branch_name') };
  });
  const users = listValue(input.users, 'users').map((item) => {
    const value = objectValue(item, 'user');
    const role = requiredText(value.role, 'user_role') as UserRole;
    if (!allowedRoles.has(role)) throw new Error('SEED_INVALID_USER_ROLE');
    const id = requiredText(value.id, 'user_id');
    if (!uuidPattern.test(id)) throw new Error('SEED_INVALID_USER_ID');
    const firebaseUid = requiredText(value.firebaseUid, 'firebase_uid');
    const branchCode = value.branchCode === null || value.branchCode === undefined ? null : stableCode(value.branchCode, 'branch');
    const clientId = value.clientId === null || value.clientId === undefined ? null : requiredText(value.clientId, 'client_id');
    if (clientId && !uuidPattern.test(clientId)) throw new Error('SEED_INVALID_CLIENT_ID');
    const status: SeedUser['status'] = value.status === undefined ? 'active' : value.status as SeedUser['status'];
    if (status !== 'active' && status !== 'disabled') throw new Error('SEED_INVALID_USER_STATUS');
    if (role === 'client' && !clientId) throw new Error('SEED_CLIENT_ID_REQUIRED');
    return { id, firebaseUid, email: value.email === undefined ? undefined : requiredText(value.email, 'user_email'), displayName: requiredText(value.displayName, 'display_name'), role, branchCode, clientId, status };
  });
  const loanProducts = listValue(input.loanProducts, 'loan_products').map((item) => {
    const value = objectValue(item, 'loan_product');
    const currency = value.currency === undefined ? 'UGX' : requiredText(value.currency, 'currency').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('SEED_INVALID_CURRENCY');
    if (value.active !== undefined && typeof value.active !== 'boolean') throw new Error('SEED_INVALID_LOAN_PRODUCT_ACTIVE');
    return { code: stableCode(value.code, 'loan_product'), name: requiredText(value.name, 'loan_product_name'), currency, active: value.active === undefined ? true : value.active };
  });
  const collectorAssignments = listValue(input.collectorAssignments, 'collector_assignments').map((item) => {
    const value = objectValue(item, 'collector_assignment');
    const officerFirebaseUid = requiredText(value.officerFirebaseUid, 'officer_firebase_uid');
    const clientId = requiredText(value.clientId, 'client_id');
    if (!uuidPattern.test(clientId)) throw new Error('SEED_INVALID_CLIENT_ID');
    const effectiveFrom = dateValue(value.effectiveFrom, 'effective_from');
    const effectiveTo = value.effectiveTo === null || value.effectiveTo === undefined ? null : dateValue(value.effectiveTo, 'effective_to');
    if (effectiveTo && effectiveTo < effectiveFrom) throw new Error('SEED_INVALID_ASSIGNMENT_DATE_RANGE');
    return { officerFirebaseUid, clientId, branchCode: stableCode(value.branchCode, 'branch'), routeCode: stableCode(value.routeCode, 'route_code'), effectiveFrom, effectiveTo };
  });
  if (!options.allowEmpty && branches.length + users.length + loanProducts.length + collectorAssignments.length === 0) throw new Error('SEED_INPUT_EMPTY');
  uniqueCodes(branches, 'branch');
  uniqueCodes(loanProducts, 'loan_product');
  if (new Set(users.map((user) => user.firebaseUid)).size !== users.length) throw new Error('SEED_DUPLICATE_FIREBASE_UID');
  if (new Set(users.map((user) => user.id)).size !== users.length) throw new Error('SEED_DUPLICATE_USER_ID');
  const branchCodes = new Set(branches.map((branch) => branch.code));
  if (users.some((user) => user.branchCode && !branchCodes.has(user.branchCode))) throw new Error('SEED_UNKNOWN_BRANCH');
  const userUids = new Set(users.map((user) => user.firebaseUid));
  if (collectorAssignments.some((assignment) => !userUids.has(assignment.officerFirebaseUid))) throw new Error('SEED_UNKNOWN_ASSIGNMENT_USER');
  if (collectorAssignments.some((assignment) => !branchCodes.has(assignment.branchCode))) throw new Error('SEED_UNKNOWN_BRANCH');
  if (users.some((user) => collectorAssignments.some((assignment) => assignment.officerFirebaseUid === user.firebaseUid) && !['officer', 'collector'].includes(user.role))) throw new Error('SEED_ASSIGNMENT_USER_ROLE_INVALID');
  return { approved: true, branches, users, loanProducts, collectorAssignments };
}

export function withAdminFirebaseUid(input: SeedInput, firebaseUid: string): SeedInput {
  const uid = requiredText(firebaseUid, 'admin_firebase_uid');
  const existing = input.users.find((user) => user.firebaseUid === uid);
  if (existing) {
    return {
      ...input,
      users: input.users.map((user) => user.firebaseUid === uid ? { ...user, role: 'admin' } : user),
    };
  }
  return {
    ...input,
    users: [...input.users, { id: stableAdminUserId(uid), firebaseUid: uid, displayName: 'Administrator', role: 'admin', status: 'active' }],
  };
}

export async function readApprovedSeedInput(filePath = process.env.SEED_INPUT_FILE, inlineJson = process.env.SEED_INPUT_JSON, adminFirebaseUid = process.env.ADMIN_FIREBASE_UID): Promise<SeedInput> {
  if (filePath && inlineJson) throw new Error('SEED_INPUT_AMBIGUOUS');
  if (!filePath && !inlineJson) throw new Error('SEED_INPUT_REQUIRED');
  const raw = filePath ? await readFile(resolve(filePath), 'utf8') : inlineJson!;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('SEED_INPUT_INVALID_JSON'); }
  return parseSeedInput(parsed, { allowEmpty: Boolean(adminFirebaseUid?.trim()) });
}

const roleNames: Record<UserRole, string> = { admin: 'Administrator', manager: 'Manager', officer: 'Loan Officer', collector: 'Field Collector', accountant: 'Accountant', client: 'Client', marketing: 'Marketing' };

export async function seedDatabase(input: SeedInput, transaction: TransactionRunner = withTransaction, adminFirebaseUid = process.env.ADMIN_FIREBASE_UID): Promise<SeedResult> {
  const parsed = parseSeedInput(input, { allowEmpty: Boolean(adminFirebaseUid?.trim()) });
  const validated = adminFirebaseUid?.trim() ? parseSeedInput(withAdminFirebaseUid(parsed, adminFirebaseUid)) : parsed;
  return transaction(async (client) => {
    const branchIds = new Map<string, string>();
    for (const branch of validated.branches) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO branches (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [branch.code, branch.name],
      );
      branchIds.set(branch.code, result.rows[0].id);
    }

    const roleIds = new Map<UserRole, string>();
    for (const role of new Set(validated.users.map((user) => user.role))) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO roles (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [role, roleNames[role]],
      );
      roleIds.set(role, result.rows[0].id);
    }

    for (const user of validated.users) {
      await client.query(
        `INSERT INTO users (id, firebase_uid, email, display_name, status, role_id, branch_id, client_id)
          VALUES ($1, $2, $3, $4, $5::user_status, $6, $7, $8)
         ON CONFLICT (firebase_uid) DO UPDATE SET
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           role_id = EXCLUDED.role_id,
           branch_id = EXCLUDED.branch_id,
            client_id = EXCLUDED.client_id,
           updated_at = now()`,
        [user.id, user.firebaseUid, user.email ?? null, user.displayName, user.status ?? 'active', roleIds.get(user.role), user.branchCode ? branchIds.get(user.branchCode) : null, user.clientId ?? null],
      );
    }

    for (const assignment of validated.collectorAssignments ?? []) {
      const officer = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE firebase_uid = $1 AND status = 'active'`,
        [assignment.officerFirebaseUid],
      );
      if (!officer.rowCount) throw new Error('SEED_ASSIGNMENT_USER_NOT_FOUND');
      await client.query(
        `INSERT INTO collector_assignments (officer_id, client_id, branch_id, route_code, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5::date, $6::date)
         ON CONFLICT (officer_id, client_id, route_code, effective_from) DO UPDATE SET
           branch_id = EXCLUDED.branch_id,
           effective_to = EXCLUDED.effective_to`,
        [officer.rows[0].id, assignment.clientId, branchIds.get(assignment.branchCode), assignment.routeCode, assignment.effectiveFrom, assignment.effectiveTo],
      );
    }

    for (const product of validated.loanProducts) {
      await client.query(
        `INSERT INTO loan_products (code, name, currency, active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency, active = EXCLUDED.active`,
        [product.code, product.name, product.currency ?? 'UGX', product.active ?? true],
      );
    }
    return { branches: validated.branches.length, users: validated.users.length, loanProducts: validated.loanProducts.length, collectorAssignments: validated.collectorAssignments?.length ?? 0 };
  });
}

export async function runSeedFromEnvironment(): Promise<SeedResult> {
  const input = await readApprovedSeedInput();
  return seedDatabase(input, withTransaction, process.env.ADMIN_FIREBASE_UID);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runSeedFromEnvironment()
    .then((result) => console.log(`Seeded ${result.branches} branches, ${result.users} users, and ${result.loanProducts} loan products.`))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'SEED_FAILED'); process.exitCode = 1; })
    .finally(() => pool.end());
}