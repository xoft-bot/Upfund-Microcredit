import type { FastifyInstance, FastifyReply } from 'fastify';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireBranchScope, requireRoles } from '../middleware/authorization.js';
import { getAssignmentWorkspace, createAssignment, endAssignment, updateRouteCode } from '../services/collector-assignments.js';

interface WorkspaceQuery { branchId?: string; }
interface CreateBody { branchId: string; officerId: string; clientId: string; routeCode: string; effectiveFrom?: string; }
interface EndBody { effectiveTo?: string; }
interface RouteCodeBody { routeCode: string; }
interface IdParams { id: string; }

// Every business-rule error the service layer can throw, mapped to the HTTP
// status the caller actually needs — same convention as PAYMENT_ERROR_STATUS
// in routes/payments.ts, so a genuinely-invalid request (unknown officer,
// wrong branch, bad role) never falls through to a generic 500.
const ASSIGNMENT_ERROR_STATUS: Record<string, { status: number; code: string; message: string }> = {
  ASSIGNMENT_ROLE_DENIED: { status: 403, code: 'FORBIDDEN', message: 'Only an admin or manager can manage collector assignments' },
  ASSIGNMENT_BRANCH_DENIED: { status: 403, code: 'BRANCH_SCOPE_DENIED', message: 'Branch scope denied' },
  OFFICER_NOT_FOUND: { status: 404, code: 'OFFICER_NOT_FOUND', message: 'That user was not found or is not active' },
  OFFICER_ROLE_INVALID: { status: 400, code: 'OFFICER_ROLE_INVALID', message: 'Only a collector or officer can be assigned to a client' },
  OFFICER_BRANCH_MISMATCH: { status: 409, code: 'OFFICER_BRANCH_MISMATCH', message: 'That user does not belong to this branch' },
  CLIENT_NOT_FOUND: { status: 404, code: 'CLIENT_NOT_FOUND', message: 'Client not found' },
  CLIENT_BRANCH_MISMATCH: { status: 409, code: 'CLIENT_BRANCH_MISMATCH', message: 'That client does not belong to this branch' },
  ASSIGNMENT_NOT_FOUND: { status: 404, code: 'ASSIGNMENT_NOT_FOUND', message: 'Assignment not found' },
  ASSIGNMENT_END_DATE_BEFORE_START: { status: 400, code: 'ASSIGNMENT_END_DATE_BEFORE_START', message: 'The end date cannot be before the assignment started' },
};

export function registerCollectorAssignmentRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  const auth = authMiddleware(verifier, resolveUser);

  async function withMappedErrors<T>(reply: FastifyReply, correlationId: unknown, fn: () => Promise<T>) {
    try {
      return { ok: true as const, data: await fn(), correlationId, version: SYSTEM_VERSION };
    } catch (error) {
      if (error instanceof Error) {
        const mapped = ASSIGNMENT_ERROR_STATUS[error.message];
        if (mapped) return reply.code(mapped.status).send({ ok: false, error: { code: mapped.code, message: mapped.message }, correlationId, version: SYSTEM_VERSION });
      }
      throw error;
    }
  }

  app.get<{ Querystring: WorkspaceQuery }>('/api/v1/collector-assignments', {
    preHandler: [
      auth,
      requireRoles(['admin', 'manager']),
      requireBranchScope((request) => (request.query as WorkspaceQuery | undefined)?.branchId ?? request.actor?.branchId ?? undefined),
    ],
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 } } } },
  }, async (request, reply) => {
    const actor = request.actor!;
    const branchId = actor.role === 'admin' ? request.query.branchId : actor.branchId;
    if (!branchId) return reply.code(400).send({ ok: false, error: { code: 'BRANCH_REQUIRED', message: 'A branch is required to view assignments' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
    return withMappedErrors(reply, request.headers['x-correlation-id'], () => getAssignmentWorkspace({ branchId, actorRole: actor.role, actorBranchId: actor.branchId }));
  });

  app.post<{ Body: CreateBody }>('/api/v1/collector-assignments', {
    preHandler: [auth, requireRoles(['admin', 'manager']), requireBranchScope((request) => (request.body as CreateBody | undefined)?.branchId)],
    schema: {
      body: {
        type: 'object',
        required: ['branchId', 'officerId', 'clientId', 'routeCode'],
        additionalProperties: false,
        properties: {
          branchId: { type: 'string', minLength: 1 },
          officerId: { type: 'string', minLength: 1 },
          clientId: { type: 'string', minLength: 1 },
          routeCode: { type: 'string', minLength: 1, maxLength: 80 },
          effectiveFrom: { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const actor = request.actor!;
    return withMappedErrors(reply, request.headers['x-correlation-id'], () => createAssignment({
      ...request.body,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorBranchId: actor.branchId,
      correlationId: String(request.headers['x-correlation-id']),
    }));
  });

  app.patch<{ Params: IdParams; Body: RouteCodeBody }>('/api/v1/collector-assignments/:id', {
    preHandler: [auth, requireRoles(['admin', 'manager'])],
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1 } } },
      body: { type: 'object', required: ['routeCode'], additionalProperties: false, properties: { routeCode: { type: 'string', minLength: 1, maxLength: 80 } } },
    },
  }, async (request, reply) => {
    const actor = request.actor!;
    return withMappedErrors(reply, request.headers['x-correlation-id'], async () => {
      await updateRouteCode({ id: request.params.id, routeCode: request.body.routeCode, actorUserId: actor.userId, actorRole: actor.role, actorBranchId: actor.branchId, correlationId: String(request.headers['x-correlation-id']) });
      return { id: request.params.id, updated: true };
    });
  });

  app.delete<{ Params: IdParams; Body: EndBody }>('/api/v1/collector-assignments/:id', {
    preHandler: [auth, requireRoles(['admin', 'manager'])],
    schema: {
      params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1 } } },
      body: { type: 'object', additionalProperties: false, properties: { effectiveTo: { type: 'string', format: 'date' } } },
    },
  }, async (request, reply) => {
    const actor = request.actor!;
    return withMappedErrors(reply, request.headers['x-correlation-id'], async () => {
      await endAssignment({ id: request.params.id, effectiveTo: request.body?.effectiveTo, actorUserId: actor.userId, actorRole: actor.role, actorBranchId: actor.branchId, correlationId: String(request.headers['x-correlation-id']) });
      return { id: request.params.id, unassigned: true };
    });
  });
}
