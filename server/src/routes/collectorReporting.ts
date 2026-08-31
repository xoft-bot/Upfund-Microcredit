import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { getCollectorReportingSnapshot } from '../services/collector-reporting.js';

interface CollectorReportQuery {
  branchId?: string;
  collectorId?: string;
  asOf?: string;
  from?: string;
  to?: string;
}

export function registerCollectorReportingRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get<{ Querystring: CollectorReportQuery }>('/api/v1/reports/collector', {
    preHandler: [
      authMiddleware(verifier, resolveUser),
      requireRoles(['admin', 'manager', 'collector', 'officer']),
      requireBranchScope((request) => {
        const query = request.query as CollectorReportQuery;
        return request.actor?.role === 'admin' ? query.branchId : request.actor?.branchId ?? undefined;
      }),
    ],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branchId: { type: 'string', format: 'uuid' },
          collectorId: { type: 'string', format: 'uuid' },
          asOf: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        },
      },
    },
  }, async (request, reply) => {
    const actor = request.actor!;
    const query = request.query;
    const branchId = actor.role === 'admin' ? query.branchId : actor.branchId;
    if (!branchId) {
      return reply.code(400).send({ ok: false, error: { code: 'BRANCH_REQUIRED', message: 'A branch is required for collector reporting' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
    }
    const collectorId = ['collector', 'officer'].includes(actor.role) ? actor.userId : query.collectorId;
    try {
      const snapshot = await getCollectorReportingSnapshot({ branchId, collectorId, asOf: query.asOf, from: query.from, to: query.to });
      return { ok: true, data: snapshot, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
    } catch (error) {
      if (error instanceof Error && ['REPORTING_AS_OF_INVALID', 'REPORTING_DATE_RANGE_INVALID'].includes(error.message)) {
        return reply.code(400).send({ ok: false, error: { code: error.message, message: 'Reporting dates must use a valid YYYY-MM-DD range' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
      }
      throw error;
    }
  });
}