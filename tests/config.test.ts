import { describe, expect, it } from 'vitest';
import { getFirebaseAuthMode, getFirebasePrivateKey, validateRuntimeConfig } from '../server/src/config.js';

const productionEnv = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://pilot:password@example.test:5432/pilot',
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

  it('accepts live Firebase, database, and HTTPS CORS configuration', () => {
    expect(validateRuntimeConfig(productionEnv)).toMatchObject({ isProduction: true, allowedOrigins: ['https://pilot.example.com', 'https://admin.example.com'] });
  });

  it('accepts the canonical auth mode with surrounding whitespace', () => {
    expect(getFirebaseAuthMode({ FIREBASE_AUTH_MODE: '  live  ', FIREBASE_MODE: 'mock' })).toBe('live');
    expect(getFirebaseAuthMode({ FIREBASE_AUTH_MODE: '   ', FIREBASE_MODE: ' live ' })).toBe('live');
    expect(validateRuntimeConfig({ ...productionEnv, FIREBASE_MODE: undefined, FIREBASE_AUTH_MODE: '  live  ' })).toMatchObject({ isProduction: true });
  });

  it('normalizes escaped private-key newlines', () => {
    expect(getFirebasePrivateKey({ FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----' })).toBe('-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----');
  });

  it('rejects wildcard production CORS and only requires JWT_SECRET for JWT mode', () => {
    expect(() => validateRuntimeConfig({ ...productionEnv, CORS_ORIGINS: '*' })).toThrow('PRODUCTION_CORS_WILDCARD_FORBIDDEN');
    expect(() => validateRuntimeConfig({ ...productionEnv, JWT_AUTH_ENABLED: 'true' })).toThrow('PRODUCTION_CONFIG_MISSING:JWT_SECRET');
    expect(validateRuntimeConfig({ ...productionEnv, JWT_AUTH_ENABLED: 'true', JWT_SECRET: 'configured' }).isProduction).toBe(true);
  });
});