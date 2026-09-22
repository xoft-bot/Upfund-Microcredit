import type { FastifyReply, FastifyRequest } from 'fastify';
import type admin from 'firebase-admin';
import { createConfiguredTokenVerifier } from '../config/firebaseAdmin.js';
import type { Actor, UserRole } from '../../../shared/contracts.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { pool } from '../db.js';

const allowedRoles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant', 'client', 'marketing']);

export type TokenVerifier = (token: string) => Promise<admin.auth.DecodedIdToken>;
export interface AuthenticatedUser {
  dbUserId: string;
  db_user_id?: string;
  firebaseUid: string;
  firebase_uid?: string;
  role: UserRole;
  branchId: string | null;
  branch_id?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  permissions?: string[];
}
export type UserResolver = (firebaseUid: string, email?: string) => Promise<AuthenticatedUser | null>;

export function createTokenVerifier(): TokenVerifier { return createConfiguredTokenVerifier(); }

export async function resolveDatabaseUser(firebaseUid: string, _email?: string): Promise<AuthenticatedUser | null> {
  // SECURITY: match strictly on firebase_uid (NOT NULL UNIQUE, set once at
  // row-creation time by an admin/seed process — see server/src/db/seed.ts).
  // There is no "invited, not yet linked" state in this schema, so an email
  // or raw-id fallback here has no legitimate use case and only creates an
  // account-takeover vector: if a user's Firebase account is ever recreated
  // or another Firebase account reuses their email, an email-based match
  // would silently hand over the original account's role/branch/permissions
  // to whoever now controls that email address, with no verification that
  // they are actually the same person. Do not reintroduce email or raw-id
  // matching here without a real, deliberate provisioning design (e.g. an
  // explicit `pending_link` status plus an `email_verified` check plus an
  // atomic bind-on-first-login step) — see the removed history of this
  // function for the exact vulnerability that was here before.
  const result = await pool.query<{ db_user_id: string; firebase_uid: string; role: string; branch_id: string | null; client_id: string | null; permissions: string[] }>(
    `SELECT u.id AS db_user_id, u.firebase_uid, r.code AS role, u.branch_id, u.client_id,
            COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE u.status = 'active'
         AND u.firebase_uid = $1
       GROUP BY u.id, u.firebase_uid, r.code, u.branch_id, u.client_id`,
    [firebaseUid],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  if (!allowedRoles.has(row.role as UserRole)) return null;
  return {
    dbUserId: row.db_user_id,
    db_user_id: row.db_user_id,
    firebaseUid: row.firebase_uid,
    firebase_uid: row.firebase_uid,
    role: row.role as UserRole,
    branchId: row.branch_id,
    branch_id: row.branch_id,
    clientId: row.client_id,
    client_id: row.client_id,
    permissions: row.permissions,
  };
}

export function authMiddleware(
  verifier: TokenVerifier = createTokenVerifier(),
  resolveUser: UserResolver = resolveDatabaseUser,
) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, version: SYSTEM_VERSION });
      return;
    }
    let firebaseUid: string;
    let email: string | undefined;
    try {
      const decoded = await verifier(header.slice('Bearer '.length));
      firebaseUid = decoded.uid;
      email = decoded.email;
    } catch {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid authentication token' }, version: SYSTEM_VERSION });
      return;
    }
    if (!firebaseUid) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid authentication token' }, version: SYSTEM_VERSION });
      return;
    }
    const user = await resolveUser(firebaseUid, email);
    if (!user) {
      await reply.code(403).send({ ok: false, error: { code: 'USER_NOT_FOUND', message: 'Firebase user is not mapped to an active account' }, version: SYSTEM_VERSION });
      return;
    }
    const dbUserId = user.dbUserId ?? user.db_user_id;
    const firebaseUserId = firebaseUid;
    const branchId = user.branchId ?? user.branch_id ?? null;
    if (!dbUserId || !firebaseUserId) {
      await reply.code(403).send({ ok: false, error: { code: 'USER_IDENTITY_INVALID', message: 'Database identity is incomplete' }, version: SYSTEM_VERSION });
      return;
    }
    request.user = { ...user, dbUserId, db_user_id: dbUserId, firebaseUid: firebaseUserId, firebase_uid: firebaseUserId, branchId, branch_id: branchId, clientId: user.clientId ?? user.client_id ?? null, client_id: user.clientId ?? user.client_id ?? null, permissions: user.permissions ?? [] };
    request.actor = { userId: dbUserId, dbUserId, firebaseUid: firebaseUserId, role: user.role, branchId, clientId: user.clientId ?? user.client_id ?? null, permissions: user.permissions ?? [] };
  };
}

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; user?: AuthenticatedUser; }
}
