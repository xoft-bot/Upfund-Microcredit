import { URL } from 'node:url';

export interface RuntimeConfig {
  isProduction: boolean;
  allowedOrigins: string[];
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const DEFAULT_SERVER_PORT = 10_000;
export const DEFAULT_PRODUCTION_CORS_ORIGINS = ['https://upfund-microcredit.web.app', 'https://upfund-microcredit.firebaseapp.com'];
export const SUPABASE_TRANSACTION_POOLER_PORT = 6543;

export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV?.trim() === 'production' || env.APP_ENV?.trim() === 'production';
}

function required(env: NodeJS.ProcessEnv, key: string, missing: string[]): string {
  const value = env[key]?.trim();
  if (!value) missing.push(key);
  return value ?? '';
}

export function getFirebasePrivateKey(env: NodeJS.ProcessEnv = process.env): string {
  const rawPrivateKey = env.FIREBASE_PRIVATE_KEY || '';
  return rawPrivateKey.replace(/\\n/g, '\n');
}

export function getFirebaseAuthMode(env: NodeJS.ProcessEnv = process.env): string {
  return (env.FIREBASE_AUTH_MODE?.trim() || env.FIREBASE_MODE?.trim() || '').toLowerCase();
}

export function getDatabaseConnectionString(env: NodeJS.ProcessEnv = process.env, missing: string[] = []): string {
  const value = env.DATABASE_POOLER_URL?.trim() || env.DATABASE_URL?.trim() || env.PGURI?.trim();
  if (!value) missing.push('DATABASE_URL');
  return value ?? '';
}

export function getDatabaseConnectionPort(env: NodeJS.ProcessEnv = process.env): number | null {
  const connectionString = getDatabaseConnectionString(env);
  if (!connectionString) return null;
  try {
    const parsed = new URL(connectionString);
    return parsed.port ? Number(parsed.port) : 5432;
  } catch {
    return null;
  }
}

export function getServerPort(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.PORT);
  return Number.isInteger(configured) && configured > 0 && configured <= 65_535 ? configured : DEFAULT_SERVER_PORT;
}

function parseProductionOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .map((origin) => {
      if (!origin || origin === '*') return undefined;
      try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.pathname !== '/' || parsed.search || parsed.hash) return undefined;
        return parsed.origin;
      } catch {
        return undefined;
      }
    })
    .filter((origin): origin is string => Boolean(origin));
  const uniqueOrigins = [...new Set(origins)];
  return uniqueOrigins.length > 0 ? uniqueOrigins : [...DEFAULT_PRODUCTION_CORS_ORIGINS];
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const production = isProductionRuntime(env);
  const missing: string[] = [];
  const databaseUrl = getDatabaseConnectionString(env, missing);
  if (production && databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error('DATABASE_URL_INVALID');
    }
    if (getDatabaseConnectionPort(env) !== SUPABASE_TRANSACTION_POOLER_PORT) throw new Error('DATABASE_POOLER_PORT_REQUIRED');
  }

  if (!production) return { isProduction: false, allowedOrigins: env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [] };

  if (getFirebaseAuthMode(env) !== 'live') throw new Error('PRODUCTION_FIREBASE_LIVE_REQUIRED');
  required(env, 'FIREBASE_PROJECT_ID', missing);
  required(env, 'FIREBASE_CLIENT_EMAIL', missing);
  required(env, 'FIREBASE_PRIVATE_KEY', missing);
  const origins = parseProductionOrigins(env.CORS_ORIGINS ?? '');
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