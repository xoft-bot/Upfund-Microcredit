import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { getManagerReportingSnapshot } from '../services/reporting.js';

interface ManagerReportQuery {
  branchId?: string;
  asOf?: string;
  from?: string;
  to?: string;
}

export function registerReportingRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get<{ Querystring: ManagerReportQuery }>('/api/v1/reports/manager', {
    preHandler: [
      authMiddleware(verifier, resolveUser),
      requireRoles(['admin', 'manager']),
      requireBranchScope((request) => {
        const query = request.query as ManagerReportQuery;
        return request.actor?.role === 'admin' ? query.branchId : request.actor?.branchId ?? undefined;
      }),
    ],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branchId: { type: 'string', format: 'uuid' },
          asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query;
    const actor = request.actor!;
    const branchId = actor.role === 'admin' ? query.branchId : actor.branchId;
    if (actor.role !== 'admin' && !branchId) {
      return reply.code(400).send({ ok: false, error: { code: 'BRANCH_REQUIRED', message: 'A branch is required for manager reporting' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
    }
    try {
      const snapshot = await getManagerReportingSnapshot({ branchId, asOf: query.asOf, from: query.from, to: query.to });
      return { ok: true, data: snapshot, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
    } catch (error) {
      if (error instanceof Error && ['REPORTING_AS_OF_INVALID', 'REPORTING_DATE_RANGE_INVALID'].includes(error.message)) {
        return reply.code(400).send({ ok: false, error: { code: error.message, message: 'Reporting dates must use a valid YYYY-MM-DD range' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
      }
      throw error;
    }
  });
}