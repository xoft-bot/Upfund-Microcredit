import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UserRole } from '../../../shared/contracts.js';

export function requireRoles(roles: UserRole[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.actor) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      return;
    }
    if (!roles.includes(request.actor.role)) {
      await reply.code(403).send({ ok: false, error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
    }
  };
}

export function requireBranchScope(getBranchId: (request: FastifyRequest) => string | undefined) {
  return async function branchGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const actor = request.actor;
    const requestedBranch = getBranchId(request);
    if (!actor) {
      await reply.code(401).send({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      return;
    }
    if (actor.role !== 'admin' && (!actor.branchId || !requestedBranch || actor.branchId !== requestedBranch)) {
      await reply.code(403).send({ ok: false, error: { code: 'BRANCH_SCOPE_DENIED', message: 'Branch scope denied' } });
    }
  };
}
