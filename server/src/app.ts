import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { pool, withTransaction, insertAuditEvent } from './db.js';
import { authMiddleware, type TokenVerifier, type UserResolver } from './middleware/auth.js';
import { requireBranchScope, requireRoles } from './middleware/authorization.js';
import { postLedgerTransactionOnClient } from './services/ledger.js';
import { SYSTEM_VERSION } from '../../shared/version.js';
import { registerPaymentRoutes } from './routes/payments.js';
import { registerReconciliationRoutes } from './routes/reconciliations.js';
import { registerWebhookRoutes } from './routes/webhookRoutes.js';
import { registerTelemetryRoutes } from './routes/telemetryRoutes.js';
import { registerCollectionQueryRoutes } from './routes/collectionQueries.js';
import { registerLifecycleRoutes } from './routes/lifecycle.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerReportingRoutes } from './routes/reporting.js';
import { registerAccountantReportingRoutes } from './routes/accountantReporting.js';
import { registerCollectorReportingRoutes } from './routes/collectorReporting.js';

export function buildApp(options: { tokenVerifier?: TokenVerifier; userResolver?: UserResolver } = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? false });
  app.register(helmet);
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  app.addHook('onRequest', async (request, reply) => {
    request.headers['x-correlation-id'] ??= randomUUID();
    reply.header('x-correlation-id', request.headers['x-correlation-id']);
    reply.header('x-system-version', SYSTEM_VERSION);
  });

  app.get('/health', async (request) => {
    const result = await pool.query('SELECT 1 AS ok');
    return { ok: true, data: { service: 'upfund-microcredit-api', database: result.rows[0].ok === 1 ? 'up' : 'unknown' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });

  registerPaymentRoutes(app, options.tokenVerifier, options.userResolver);
  registerReconciliationRoutes(app, options.tokenVerifier, options.userResolver);
  registerWebhookRoutes(app);
  registerTelemetryRoutes(app, options.tokenVerifier, options.userResolver);
  registerCollectionQueryRoutes(app, options.tokenVerifier, options.userResolver);
  registerLifecycleRoutes(app, options.tokenVerifier, options.userResolver);
  registerSessionRoutes(app, options.tokenVerifier, options.userResolver);
  registerReportingRoutes(app, options.tokenVerifier, options.userResolver);
  registerAccountantReportingRoutes(app, options.tokenVerifier, options.userResolver);
  registerCollectorReportingRoutes(app, options.tokenVerifier, options.userResolver);
  const auth = authMiddleware(options.tokenVerifier, options.userResolver);
  app.post('/api/stage1/commands/audit-ledger', {
    preHandler: [auth, requireRoles(['admin', 'manager']), requireBranchScope((request) => request.body && typeof request.body === 'object' ? (request.body as { branchId?: string }).branchId : undefined)],
    schema: {
      body: {
        type: 'object', required: ['branchId', 'idempotencyKey'], additionalProperties: false,
        properties: { branchId: { type: 'string', minLength: 1 }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 }, amount: { type: 'integer', minimum: 1 } },
      },
    },
  }, async (request, reply) => {
    const body = request.body as { branchId: string; idempotencyKey: string; amount?: number };
    const actor = request.actor!;
    const amount = body.amount ?? 1;
    const sourceId = randomUUID();
    const result = await withTransaction(async (client) => {
      const branch = await client.query<{ id: string }>('SELECT id FROM branches WHERE id = $1 FOR UPDATE', [body.branchId]);
      if (!branch.rowCount) return null;
      const ledger = await postLedgerTransactionOnClient(client, { actorUserId: actor.userId, sourceType: 'stage1_command', sourceId, idempotencyKey: body.idempotencyKey, correlationId: String(request.headers['x-correlation-id']), description: 'Stage 1 synthetic ledger command', lines: [{ accountCode: 'stage1.debit', side: 'debit', amount }, { accountCode: 'stage1.credit', side: 'credit', amount }] });
      await insertAuditEvent(client, { actorUserId: actor.userId, action: 'stage1.command.completed', entityType: 'branch', entityId: body.branchId, correlationId: String(request.headers['x-correlation-id']), metadata: { transactionId: ledger.transactionId } });
      return ledger;
    });
    if (!result) return reply.code(404).send({ ok: false, error: { code: 'BRANCH_NOT_FOUND', message: 'Branch not found' }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
    return { ok: true, data: result, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION };
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, correlationId: request.headers['x-correlation-id'] }, 'request failed');
    const candidate = error as { statusCode?: number; code?: string; message?: string };
    const status = candidate.statusCode && candidate.statusCode >= 400 ? candidate.statusCode : 500;
    const message = status === 500 ? 'Internal server error' : (candidate.message ?? 'Request failed');
    reply.code(status).send({ ok: false, error: { code: status === 500 ? 'INTERNAL_ERROR' : (candidate.code ?? 'REQUEST_ERROR'), message }, correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION });
  });
  return app;
}
