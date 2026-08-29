import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { pool, withTransaction, type DbClient } from '../db.js';
import type { UserRole } from '../../../shared/contracts.js';

const allowedRoles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant']);
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
  status?: 'active' | 'disabled';
}
export interface SeedLoanProduct { code: string; name: string; currency?: string; active?: boolean; }
export interface SeedInput {
  approved: true;
  branches: SeedBranch[];
  users: SeedUser[];
  loanProducts: SeedLoanProduct[];
}
export interface SeedResult { branches: number; users: number; loanProducts: number; }
export type TransactionRunner = <T>(fn: (client: DbClient) => Promise<T>) => Promise<T>;

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

export function parseSeedInput(raw: unknown): SeedInput {
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
    const status: SeedUser['status'] = value.status === undefined ? 'active' : value.status as SeedUser['status'];
    if (status !== 'active' && status !== 'disabled') throw new Error('SEED_INVALID_USER_STATUS');
    return { id, firebaseUid, email: value.email === undefined ? undefined : requiredText(value.email, 'user_email'), displayName: requiredText(value.displayName, 'display_name'), role, branchCode, status };
  });
  const loanProducts = listValue(input.loanProducts, 'loan_products').map((item) => {
    const value = objectValue(item, 'loan_product');
    const currency = value.currency === undefined ? 'UGX' : requiredText(value.currency, 'currency').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('SEED_INVALID_CURRENCY');
    if (value.active !== undefined && typeof value.active !== 'boolean') throw new Error('SEED_INVALID_LOAN_PRODUCT_ACTIVE');
    return { code: stableCode(value.code, 'loan_product'), name: requiredText(value.name, 'loan_product_name'), currency, active: value.active === undefined ? true : value.active };
  });
  if (branches.length + users.length + loanProducts.length === 0) throw new Error('SEED_INPUT_EMPTY');
  uniqueCodes(branches, 'branch');
  uniqueCodes(loanProducts, 'loan_product');
  if (new Set(users.map((user) => user.firebaseUid)).size !== users.length) throw new Error('SEED_DUPLICATE_FIREBASE_UID');
  if (new Set(users.map((user) => user.id)).size !== users.length) throw new Error('SEED_DUPLICATE_USER_ID');
  const branchCodes = new Set(branches.map((branch) => branch.code));
  if (users.some((user) => user.branchCode && !branchCodes.has(user.branchCode))) throw new Error('SEED_UNKNOWN_BRANCH');
  return { approved: true, branches, users, loanProducts };
}

export async function readApprovedSeedInput(filePath = process.env.SEED_INPUT_FILE, inlineJson = process.env.SEED_INPUT_JSON): Promise<SeedInput> {
  if (filePath && inlineJson) throw new Error('SEED_INPUT_AMBIGUOUS');
  if (!filePath && !inlineJson) throw new Error('SEED_INPUT_REQUIRED');
  const raw = filePath ? await readFile(resolve(filePath), 'utf8') : inlineJson!;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('SEED_INPUT_INVALID_JSON'); }
  return parseSeedInput(parsed);
}

const roleNames: Record<UserRole, string> = { admin: 'Administrator', manager: 'Manager', officer: 'Loan Officer', collector: 'Field Collector', accountant: 'Accountant' };

export async function seedDatabase(input: SeedInput, transaction: TransactionRunner = withTransaction): Promise<SeedResult> {
  const validated = parseSeedInput(input);
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
        `INSERT INTO users (id, firebase_uid, email, display_name, status, role_id, branch_id)
         VALUES ($1, $2, $3, $4, $5::user_status, $6, $7)
         ON CONFLICT (firebase_uid) DO UPDATE SET
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           status = EXCLUDED.status,
           role_id = EXCLUDED.role_id,
           branch_id = EXCLUDED.branch_id,
           updated_at = now()`,
        [user.id, user.firebaseUid, user.email ?? null, user.displayName, user.status ?? 'active', roleIds.get(user.role), user.branchCode ? branchIds.get(user.branchCode) : null],
      );
    }

    for (const product of validated.loanProducts) {
      await client.query(
        `INSERT INTO loan_products (code, name, currency, active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency, active = EXCLUDED.active`,
        [product.code, product.name, product.currency ?? 'UGX', product.active ?? true],
      );
    }
    return { branches: validated.branches.length, users: validated.users.length, loanProducts: validated.loanProducts.length };
  });
}

export async function runSeedFromEnvironment(): Promise<SeedResult> {
  const input = await readApprovedSeedInput();
  return seedDatabase(input);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runSeedFromEnvironment()
    .then((result) => console.log(`Seeded ${result.branches} branches, ${result.users} users, and ${result.loanProducts} loan products.`))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'SEED_FAILED'); process.exitCode = 1; })
    .finally(() => pool.end());
}