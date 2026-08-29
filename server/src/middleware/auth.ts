import type { FastifyReply, FastifyRequest } from 'fastify';
import type admin from 'firebase-admin';
import { createConfiguredTokenVerifier } from '../config/firebaseAdmin.js';
import type { Actor, UserRole } from '../../../shared/contracts.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { pool } from '../db.js';

const allowedRoles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant']);

export type TokenVerifier = (token: string) => Promise<admin.auth.DecodedIdToken>;
export interface AuthenticatedUser {
  dbUserId: string;
  db_user_id?: string;
  firebaseUid: string;
  firebase_uid?: string;
  role: UserRole;
  branchId: string | null;
  branch_id?: string | null;
}
export type UserResolver = (firebaseUid: string) => Promise<AuthenticatedUser | null>;

export function createTokenVerifier(): TokenVerifier { return createConfiguredTokenVerifier(); }

export async function resolveDatabaseUser(firebaseUid: string): Promise<AuthenticatedUser | null> {
  const result = await pool.query<{ db_user_id: string; firebase_uid: string; role: string; branch_id: string | null }>(
    `SELECT u.id AS db_user_id, u.firebase_uid, r.code AS role, u.branch_id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.firebase_uid = $1 AND u.status = 'active'`,
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
    try {
      const decoded = await verifier(header.slice('Bearer '.length));
      firebaseUid = decoded.uid;
    } catch {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid authentication token' }, version: SYSTEM_VERSION });
      return;
    }
    if (!firebaseUid) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid authentication token' }, version: SYSTEM_VERSION });
      return;
    }
    const user = await resolveUser(firebaseUid);
    if (!user) {
      await reply.code(403).send({ ok: false, error: { code: 'USER_NOT_FOUND', message: 'Firebase user is not mapped to an active account' }, version: SYSTEM_VERSION });
      return;
    }
    request.user = user;
    request.actor = { userId: user.dbUserId, dbUserId: user.dbUserId, firebaseUid: user.firebaseUid, role: user.role, branchId: user.branchId };
  };
}

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; user?: AuthenticatedUser; }
}
