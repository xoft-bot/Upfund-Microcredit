import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireRoles } from '../middleware/authorization.js';
import { getParThresholdConfig, updateParThresholdConfig } from '../services/par-threshold-config.js';

interface ParThresholdBody { par30Days: number; par60Days: number; par90Days: number; }

const ERROR_STATUS: Record<string, number> = {
  PAR_THRESHOLD_INVALID: 400,
  PAR_THRESHOLD_ORDER_INVALID: 400,
  PAR_THRESHOLD_CONFIG_MISSING: 500,
};

// Same roles that can see PAR figures at all (reports.ts's /reports/manager is
// admin/manager, accountantReporting.ts's /reports/accountant is admin/accountant) —
// anyone who can view PAR should be able to see what window it's computed over.
const READ_ROLES = ['admin', 'manager', 'accountant'] as const;
// Write is narrower, per HANDOFF_6 §3 ("RBAC-gated to accountant") — accounting owns
// the policy, admin keeps platform-level override. Manager does not get write access.
const WRITE_ROLES = ['admin', 'accountant'] as const;

export function registerParThresholdConfigRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get('/api/v1/reporting/par-thresholds', {
    preHandler: [authMiddleware(verifier, resolveUser), requireRoles([...READ_ROLES])],
  }, async (request) => {
    const config = await getParThresholdConfig();
    return { ok: true, data: config, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });

  app.patch<{ Body: ParThresholdBody }>('/api/v1/reporting/par-thresholds', {
    preHandler: [authMiddleware(verifier, resolveUser), requireRoles([...WRITE_ROLES])],
    schema: {
      body: {
        type: 'object',
        required: ['par30Days', 'par60Days', 'par90Days'],
        additionalProperties: false,
        properties: {
          par30Days: { type: 'integer', minimum: 1 },
          par60Days: { type: 'integer', minimum: 1 },
          par90Days: { type: 'integer', minimum: 1 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const config = await updateParThresholdConfig({
        ...request.body,
        actorUserId: request.actor!.userId,
        correlationId: String(request.headers['x-correlation-id']),
      });
      return { ok: true, data: config, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'PAR_THRESHOLD_UPDATE_FAILED';
      const status = ERROR_STATUS[code] ?? 500;
      return reply.code(status).send({ ok: false, error: { code, message: 'Could not update PAR threshold config' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
    }
  });
}
