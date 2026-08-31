import type { FastifyInstance } from 'fastify';
import type { TokenVerifier, UserResolver } from '../middleware/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireBranchScope, requireClientScope, requirePermissions, requireRoles } from '../middleware/authorization.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { assessApplicationRisk, createClient, createLoanApplication, decideApplication, disburseLoan, getPortalOverview, reviewKyc, submitLoanApplication, transitionLoan } from '../services/lifecycle.js';

interface ClientBody { branchId: string; externalRef: string; displayName: string; }
interface ApplicationBody { clientId: string; productId: string; branchId?: string; requestedAmount: number; }
interface KycBody { status: 'verified' | 'rejected'; verificationMethod: string; reason?: string; }
interface RiskBody { score: number; riskGrade: string; status: 'approved' | 'declined'; policyVersion: string; }
interface DecisionBody { decision: 'approve' | 'reject'; reason: string; }
interface DisbursementBody { disbursementReference: string; idempotencyKey: string; }
interface TransitionBody { status: 'active' | 'overdue' | 'defaulted' | 'written_off' | 'completed'; reason: string; }

export function registerLifecycleRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  const auth = authMiddleware(verifier, resolveUser);
  app.get('/api/v1/portal/overview', {
    preHandler: [auth, requirePermissions('portal.manager', 'portal.officer', 'portal.client', 'portal.marketing')],
  }, async (request) => ({ ok: true, data: await getPortalOverview(request.actor!), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Body: ClientBody }>('/api/v1/clients', {
    preHandler: [auth, requirePermissions('clients.create'), requireBranchScope((request) => (request.body as ClientBody).branchId)],
    schema: { body: { type: 'object', required: ['branchId', 'externalRef', 'displayName'], additionalProperties: false, properties: { branchId: { type: 'string', minLength: 1 }, externalRef: { type: 'string', minLength: 1, maxLength: 128 }, displayName: { type: 'string', minLength: 1, maxLength: 160 } } } },
  }, async (request) => ({ ok: true, data: await createClient(request.actor!, request.body), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Body: ApplicationBody }>('/api/v1/loan-applications', {
    preHandler: [auth, requirePermissions('applications.create'), requireClientScope((request) => (request.body as ApplicationBody).clientId)],
    schema: { body: { type: 'object', required: ['clientId', 'productId', 'requestedAmount'], additionalProperties: false, properties: { clientId: { type: 'string', minLength: 1 }, productId: { type: 'string', minLength: 1 }, branchId: { type: 'string', minLength: 1 }, requestedAmount: { type: 'integer', minimum: 1 } } } },
  }, async (request) => ({ ok: true, data: await createLoanApplication(request.actor!, request.body), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Params: { id: string } }>('/api/v1/loan-applications/:id/submit', {
    preHandler: [auth, requirePermissions('applications.submit')],
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 1 } } } },
  }, async (request) => ({ ok: true, data: await submitLoanApplication(request.actor!, request.params.id), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Params: { id: string }; Body: KycBody }>('/api/v1/loan-applications/:id/kyc', {
    preHandler: [auth, requirePermissions('kyc.review')],
    schema: { body: { type: 'object', required: ['status', 'verificationMethod'], additionalProperties: false, properties: { status: { type: 'string', enum: ['verified', 'rejected'] }, verificationMethod: { type: 'string', minLength: 1, maxLength: 100 }, reason: { type: 'string', maxLength: 500 } } } },
  }, async (request) => ({ ok: true, data: await reviewKyc(request.actor!, request.params.id, request.body), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Params: { id: string }; Body: RiskBody }>('/api/v1/loan-applications/:id/risk', {
    preHandler: [auth, requirePermissions('risk.assess')],
    schema: { body: { type: 'object', required: ['score', 'riskGrade', 'status', 'policyVersion'], additionalProperties: false, properties: { score: { type: 'integer', minimum: 0, maximum: 100 }, riskGrade: { type: 'string', minLength: 1, maxLength: 20 }, status: { type: 'string', enum: ['approved', 'declined'] }, policyVersion: { type: 'string', minLength: 1, maxLength: 64 } } } },
  }, async (request) => ({ ok: true, data: await assessApplicationRisk(request.actor!, request.params.id, request.body), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Params: { id: string }; Body: DecisionBody }>('/api/v1/loan-applications/:id/decision', {
    preHandler: [auth, requirePermissions('loans.approve')],
    schema: { body: { type: 'object', required: ['decision', 'reason'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['approve', 'reject'] }, reason: { type: 'string', minLength: 1, maxLength: 500 } } } },
  }, async (request) => ({ ok: true, data: await decideApplication(request.actor!, request.params.id, request.body), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Params: { id: string }; Body: DisbursementBody }>('/api/v1/loans/:id/disburse', {
    preHandler: [auth, requirePermissions('loans.disburse')],
    schema: { body: { type: 'object', required: ['disbursementReference', 'idempotencyKey'], additionalProperties: false, properties: { disbursementReference: { type: 'string', minLength: 1, maxLength: 128 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 } } } },
  }, async (request) => ({ ok: true, data: await disburseLoan(request.actor!, request.params.id, request.body), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));

  app.post<{ Params: { id: string }; Body: TransitionBody }>('/api/v1/loans/:id/status', {
    preHandler: [auth, requireRoles(['admin', 'manager']), requirePermissions('loans.transition')],
    schema: { body: { type: 'object', required: ['status', 'reason'], additionalProperties: false, properties: { status: { type: 'string', enum: ['active', 'overdue', 'defaulted', 'written_off', 'completed'] }, reason: { type: 'string', minLength: 1, maxLength: 500 } } } },
  }, async (request) => ({ ok: true, data: await transitionLoan(request.actor!, request.params.id, request.body.status, request.body.reason), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));
}