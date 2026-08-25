import type { FastifyReply, FastifyRequest } from 'fastify';
import type admin from 'firebase-admin';
import { createConfiguredTokenVerifier } from '../config/firebaseAdmin.js';
import type { Actor, UserRole } from '../../../shared/contracts.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

const allowedRoles = new Set<UserRole>(['admin', 'manager', 'officer', 'collector', 'accountant']);

export type TokenVerifier = (token: string) => Promise<admin.auth.DecodedIdToken>;

export function createTokenVerifier(): TokenVerifier { return createConfiguredTokenVerifier(); }

export function authMiddleware(verifier: TokenVerifier = createTokenVerifier()) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, version: SYSTEM_VERSION });
      return;
    }
    try {
      const decoded = await verifier(header.slice('Bearer '.length));
      const role = decoded.role as UserRole | undefined;
      if (!role || !allowedRoles.has(role)) {
        await reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Role is not authorized' }, version: SYSTEM_VERSION });
        return;
      }
      request.actor = { userId: String(decoded.uid), firebaseUid: decoded.uid, role, branchId: typeof decoded.branchId === 'string' ? decoded.branchId : null };
    } catch {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Invalid authentication token' }, version: SYSTEM_VERSION });
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest { actor?: Actor; }
}
