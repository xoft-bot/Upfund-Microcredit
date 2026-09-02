import type { FastifyInstance } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { getAccountantReportingSnapshot } from '../services/accountant-reporting.js';

interface AccountantReportQuery {
  branchId?: string;
  asOf?: string;
  from?: string;
  to?: string;
}

export function registerAccountantReportingRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get<{ Querystring: AccountantReportQuery }>('/api/v1/reports/accountant', {
    preHandler: [
      authMiddleware(verifier, resolveUser),
      requireRoles(['admin', 'accountant']),
      requireBranchScope((request) => {
        const query = request.query as AccountantReportQuery;
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
    const actor = request.actor!;
    const query = request.query;
    const branchId = actor.role === 'admin' ? query.branchId : actor.branchId;
    if (actor.role !== 'admin' && !branchId) {
      return reply.code(400).send({ ok: false, error: { code: 'BRANCH_REQUIRED', message: 'A branch is required for accountant reporting' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
    }
    try {
      const snapshot = await getAccountantReportingSnapshot({ branchId, asOf: query.asOf, from: query.from, to: query.to });
      return { ok: true, data: snapshot, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
    } catch (error) {
      if (error instanceof Error && ['REPORTING_AS_OF_INVALID', 'REPORTING_DATE_RANGE_INVALID'].includes(error.message)) {
        return reply.code(400).send({ ok: false, error: { code: error.message, message: 'Reporting dates must use a valid YYYY-MM-DD range' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
      }
      throw error;
    }
  });
}