import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../../../shared/contracts.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

export function requireRoles(roles: UserRole[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.actor) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, version: SYSTEM_VERSION });
      return;
    }
    if (!roles.includes(request.actor.role)) {
      await reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Insufficient role' }, version: SYSTEM_VERSION });
    }
  };
}

export function requirePermissions(...permissions: string[]) {
  return async function permissionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.actor) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, version: SYSTEM_VERSION });
      return;
    }
    const granted = request.user?.permissions ?? [];
    if (!permissions.some((permission) => granted.includes(permission))) {
      await reply.code(403).send({ ok: false, error: { code: 'PERMISSION_DENIED', message: 'Required permission is not assigned' }, version: SYSTEM_VERSION });
    }
  };
}

export function requireBranchScope(getBranchId: (request: FastifyRequest) => string | undefined) {
  return async function branchGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const actor = request.actor;
    const requestedBranch = getBranchId(request);
    if (!actor) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, version: SYSTEM_VERSION });
      return;
    }
    if (actor.role !== 'admin' && (!actor.branchId || !requestedBranch || actor.branchId !== requestedBranch)) {
      await reply.code(403).send({ ok: false, error: { code: 'BRANCH_SCOPE_DENIED', message: 'Branch scope denied' }, version: SYSTEM_VERSION });
    }
  };
}

export function requireClientScope(getClientId: (request: FastifyRequest) => string | undefined) {
  return async function clientGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const actor = request.actor;
    if (!actor) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }, version: SYSTEM_VERSION });
      return;
    }
    const clientId = getClientId(request);
    if (actor.role === 'client' && (!actor.clientId || !clientId || actor.clientId !== clientId)) {
      await reply.code(403).send({ ok: false, error: { code: 'CLIENT_SCOPE_DENIED', message: 'Client scope denied' }, version: SYSTEM_VERSION });
    }
  };
}
