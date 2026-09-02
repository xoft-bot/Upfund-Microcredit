import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { listFieldCollections } from '../services/collection-queries.js';

interface CollectionQuery { branchId?: string; collectorId?: string; limit?: string; }

export function registerCollectionQueryRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get<{ Querystring: CollectionQuery }>('/api/v1/collections/queue', {
    preHandler: [
      authMiddleware(verifier, resolveUser),
      requireRoles(['admin', 'manager', 'officer', 'collector']),
      requireBranchScope((request) => (request.query as CollectionQuery | undefined)?.branchId ?? request.actor?.branchId ?? undefined),
    ],
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 }, collectorId: { type: 'string', minLength: 1 }, limit: { type: 'string', pattern: '^[1-9][0-9]{0,2}$' } } } },
  }, async (request, reply) => {
    const actor = request.actor!;
    const branchId = actor.role === 'admin' ? request.query.branchId : actor.branchId;
    if (!branchId) return reply.code(400).send({ ok: false, error: { code: 'BRANCH_REQUIRED', message: 'A branch is required for collection queries' }, version: SYSTEM_VERSION });
    if (actor.role === 'collector' && request.query.collectorId && request.query.collectorId !== actor.dbUserId) {
      return reply.code(403).send({ ok: false, error: { code: 'COLLECTOR_SCOPE_DENIED', message: 'Collectors may only view their own collections' }, version: SYSTEM_VERSION });
    }
    const collectorId = actor.role === 'collector' ? actor.dbUserId : request.query.collectorId;
    const records = await listFieldCollections({ branchId, collectorId, limit: Math.min(Number(request.query.limit ?? 100), 100) });
    return { ok: true, data: { records }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });
}