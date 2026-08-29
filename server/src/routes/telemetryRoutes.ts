import type { FastifyInstance } from 'fastify';
import { authMiddleware, type TokenVerifier, type UserResolver } from '../middleware/auth.js';
import { requireRoles } from '../middleware/authorization.js';
import { SYSTEM_VERSION } from '../../../shared/version.js';
import { getDatabasePoolStats, getQueueDepth, getSystemHealth, streamAuditEvents } from '../services/telemetryStream.js';

interface AuditQuery { after?: string; limit?: number; correlationId?: string; }

export function registerTelemetryRoutes(app: FastifyInstance, verifier?: TokenVerifier, resolveUser?: UserResolver): void {
  const protectedTelemetry = [authMiddleware(verifier, resolveUser), requireRoles(['admin', 'manager', 'accountant'])];
  app.get('/api/v1/telemetry/health', { preHandler: protectedTelemetry }, async (request) => ({ ok: true, data: await getSystemHealth(), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));
  app.get('/api/v1/telemetry/pool', { preHandler: protectedTelemetry }, async (request) => ({ ok: true, data: getDatabasePoolStats(), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));
  app.get('/api/v1/telemetry/queues', { preHandler: protectedTelemetry }, async (request) => ({ ok: true, data: await getQueueDepth(), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));
  app.get<{ Querystring: AuditQuery }>('/api/v1/telemetry/audit-stream', { preHandler: protectedTelemetry, schema: { querystring: { type: 'object', additionalProperties: false, properties: { after: { type: 'string', format: 'date-time' }, limit: { type: 'integer', minimum: 1, maximum: 500 }, correlationId: { type: 'string', format: 'uuid' } } } } }, async (request) => ({ ok: true, data: await streamAuditEvents(request.query), correlationId: request.headers['x-correlation-id'], version: SYSTEM_VERSION }));
}
