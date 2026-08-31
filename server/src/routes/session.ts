import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';

export function registerSessionRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get('/api/v1/session', {
    preHandler: [authMiddleware(verifier, resolveUser)],
  }, async (request) => {
    const actor = request.actor!;
    return {
      ok: true,
      data: {
        userId: actor.userId,
        firebaseUid: actor.firebaseUid,
        role: actor.role,
        branchId: actor.branchId,
        clientId: actor.clientId ?? null,
        permissions: actor.permissions ?? [],
      },
      correlationId: request.headers['x-correlation-id'],
      version: SYSTEM_VERSION,
    };
  });
}