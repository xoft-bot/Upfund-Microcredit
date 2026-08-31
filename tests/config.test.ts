import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCTION_CORS_ORIGINS, getDatabaseConnectionPort, getDatabaseConnectionString, getFirebaseAuthMode, getFirebasePrivateKey, SUPABASE_TRANSACTION_POOLER_PORT, validateRuntimeConfig } from '../server/src/config.js';

const productionEnv = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://pilot:password@example.test:6543/pilot',
  FIREBASE_MODE: 'live',
  FIREBASE_PROJECT_ID: 'pilot-project',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@example.test',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\npilot\\n-----END PRIVATE KEY-----',
  CORS_ORIGINS: 'https://pilot.example.com,https://admin.example.com',
} as NodeJS.ProcessEnv;

describe('production runtime guardrails', () => {
  it('fails closed when required production configuration is missing', () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: 'production', APP_ENV: 'production' })).toThrow('PRODUCTION_FIREBASE_LIVE_REQUIRED');
  });

  it('accepts live Firebase and normalizes production CORS origins', () => {
    expect(validateRuntimeConfig({ ...productionEnv, CORS_ORIGINS: ' https://pilot.example.com///, http://admin.example.com/ ' })).toMatchObject({ isProduction: true, allowedOrigins: ['https://pilot.example.com', 'http://admin.example.com'] });
  });

  it('prefers the Supabase transaction pooler URL and exposes its port', () => {
    const env = { ...productionEnv, DATABASE_POOLER_URL: 'postgresql://pooler.example.test:6543/pilot', DATABASE_URL: 'postgresql://direct.example.test:5432/pilot' };
    expect(getDatabaseConnectionString(env)).toBe(env.DATABASE_POOLER_URL);
    expect(getDatabaseConnectionPort(env)).toBe(SUPABASE_TRANSACTION_POOLER_PORT);
    expect(validateRuntimeConfig(env)).toMatchObject({ isProduction: true });
  });

  it('rejects direct PostgreSQL port 5432 in production', () => {
    expect(() => validateRuntimeConfig({ ...productionEnv, DATABASE_URL: 'postgresql://direct.example.test:5432/pilot' })).toThrow('DATABASE_POOLER_PORT_REQUIRED');
  });

  it('accepts the canonical auth mode with surrounding whitespace', () => {
    expect(getFirebaseAuthMode({ FIREBASE_AUTH_MODE: '  live  ', FIREBASE_MODE: 'mock' })).toBe('live');
    expect(getFirebaseAuthMode({ FIREBASE_AUTH_MODE: '   ', FIREBASE_MODE: ' live ' })).toBe('live');
    expect(validateRuntimeConfig({ ...productionEnv, FIREBASE_MODE: undefined, FIREBASE_AUTH_MODE: '  live  ' })).toMatchObject({ isProduction: true });
  });

  it('normalizes escaped private-key newlines', () => {
    expect(getFirebasePrivateKey({ FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----' })).toBe('-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----');
  });

  it('uses finite defaults for blank, wildcard, or unusable CORS input', () => {
    expect(validateRuntimeConfig({ ...productionEnv, CORS_ORIGINS: '' }).allowedOrigins).toEqual(DEFAULT_PRODUCTION_CORS_ORIGINS);
    expect(validateRuntimeConfig({ ...productionEnv, CORS_ORIGINS: '  *  ' }).allowedOrigins).toEqual(DEFAULT_PRODUCTION_CORS_ORIGINS);
    expect(validateRuntimeConfig({ ...productionEnv, CORS_ORIGINS: 'not-a-url, *' }).allowedOrigins).toEqual(DEFAULT_PRODUCTION_CORS_ORIGINS);
  });

  it('keeps valid origins from a mixed CORS list', () => {
    expect(validateRuntimeConfig({ ...productionEnv, CORS_ORIGINS: '*, https://pilot.example.com/, invalid-origin' }).allowedOrigins).toEqual(['https://pilot.example.com']);
  });

  it('only requires JWT_SECRET for JWT mode', () => {
    expect(() => validateRuntimeConfig({ ...productionEnv, JWT_AUTH_ENABLED: 'true' })).toThrow('PRODUCTION_CONFIG_MISSING:JWT_SECRET');
    expect(validateRuntimeConfig({ ...productionEnv, JWT_AUTH_ENABLED: 'true', JWT_SECRET: 'configured' }).isProduction).toBe(true);
  });
});