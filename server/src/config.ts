import { URL } from 'node:url';

export interface RuntimeConfig {
  isProduction: boolean;
  allowedOrigins: string[];
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || env.APP_ENV === 'production';
}

export function isFlutterwaveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLUTTERWAVE_ENABLED === 'true';
}

function required(env: NodeJS.ProcessEnv, key: string, missing: string[]): string {
  const value = env[key]?.trim();
  if (!value) missing.push(key);
  return value ?? '';
}

function parseProductionOrigins(raw: string, missing: string[]): string[] {
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    missing.push('ALLOWED_ORIGINS');
    return [];
  }
  for (const origin of origins) {
    if (origin === '*') throw new Error('PRODUCTION_CORS_WILDCARD_FORBIDDEN');
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('PRODUCTION_CORS_ORIGIN_INVALID'); }
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('PRODUCTION_CORS_ORIGIN_MUST_BE_HTTPS_ORIGIN');
    }
  }
  return origins;
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const production = isProductionRuntime(env);
  const missing: string[] = [];
  const databaseUrl = required(env, 'DATABASE_URL', missing);
  if (production && databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error('DATABASE_URL_INVALID');
    }
  }

  if (!production) return { isProduction: false, allowedOrigins: env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [] };

  if (env.FIREBASE_MODE !== 'live') throw new Error('PRODUCTION_FIREBASE_LIVE_REQUIRED');
  required(env, 'FIREBASE_PROJECT_ID', missing);
  required(env, 'FIREBASE_CLIENT_EMAIL', missing);
  required(env, 'FIREBASE_PRIVATE_KEY', missing);
  const origins = parseProductionOrigins(env.ALLOWED_ORIGINS ?? '', missing);
  if (isFlutterwaveEnabled(env)) {
    required(env, 'FLUTTERWAVE_SECRET_HASH', missing);
    const webhookActorId = required(env, 'FLUTTERWAVE_ACTOR_USER_ID', missing);
    if (webhookActorId && !uuidPattern.test(webhookActorId)) throw new Error('FLUTTERWAVE_ACTOR_USER_ID_INVALID');
  }
  if (env.JWT_AUTH_ENABLED === 'true') required(env, 'JWT_SECRET', missing);
  if (env.RECONCILIATION_SCHEDULER_ENABLED === 'true') {
    const actorId = required(env, 'RECONCILIATION_SCHEDULER_ACTOR_USER_ID', missing);
    if (actorId && !uuidPattern.test(actorId)) throw new Error('RECONCILIATION_SCHEDULER_ACTOR_USER_ID_INVALID');
    const interval = Number(env.RECONCILIATION_SCHEDULER_INTERVAL_MS ?? 300_000);
    if (!Number.isInteger(interval) || interval < 60_000) throw new Error('RECONCILIATION_SCHEDULER_INTERVAL_INVALID');
  }
  if (missing.length) throw new Error(`PRODUCTION_CONFIG_MISSING:${missing.join(',')}`);
  return { isProduction: true, allowedOrigins: origins };
}