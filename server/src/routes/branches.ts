import type { FastifyInstance } from 'fastify';
import { pool } from '../db.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import type { UserRole } from '../../../shared/contracts.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';

interface BranchQuery { branchId?: string; }
const roles: UserRole[] = ['admin', 'manager', 'officer', 'collector', 'accountant', 'client', 'marketing'];

export function registerBranchRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  app.get<{ Querystring: BranchQuery }>('/api/v1/branches', {
    preHandler: [
      authMiddleware(verifier, resolveUser),
      requireRoles(roles),
      requireBranchScope((request) => (request.query as BranchQuery | undefined)?.branchId ?? request.actor?.branchId ?? undefined),
    ],
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 } } } },
  }, async (request) => {
    const requestedBranch = request.query.branchId;
    const result = request.actor!.role === 'admin' && !requestedBranch
      ? await pool.query<{ id: string; code: string; name: string }>('SELECT id, code, name FROM branches ORDER BY name, code, id')
      : await pool.query<{ id: string; code: string; name: string }>('SELECT id, code, name FROM branches WHERE id = $1', [requestedBranch ?? request.actor!.branchId]);
    return { ok: true, data: result.rows, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });
}