import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from '../server/src/config.js';

const productionEnv = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  DATABASE_URL: 'postgresql://pilot:password@example.test:5432/pilot',
  FIREBASE_MODE: 'live',
  FIREBASE_PROJECT_ID: 'pilot-project',
  FIREBASE_CLIENT_EMAIL: 'firebase-adminsdk@example.test',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\npilot\\n-----END PRIVATE KEY-----',
  ALLOWED_ORIGINS: 'https://pilot.example.com,https://admin.example.com',
  FLUTTERWAVE_ENABLED: 'true',
  FLUTTERWAVE_SECRET_HASH: 'configured',
  FLUTTERWAVE_ACTOR_USER_ID: '00000000-0000-4000-8000-000000000001',
} as NodeJS.ProcessEnv;

describe('production runtime guardrails', () => {
  it('fails closed when required production configuration is missing', () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: 'production', APP_ENV: 'production' })).toThrow('PRODUCTION_FIREBASE_LIVE_REQUIRED');
  });

  it('accepts live Firebase, database, webhook, and HTTPS CORS configuration', () => {
    expect(validateRuntimeConfig(productionEnv)).toMatchObject({ isProduction: true, allowedOrigins: ['https://pilot.example.com', 'https://admin.example.com'] });
  });

  it('does not require Flutterwave configuration when the integration is disabled', () => {
    const withoutFlutterwave = { ...productionEnv };
    delete withoutFlutterwave.FLUTTERWAVE_ENABLED;
    delete withoutFlutterwave.FLUTTERWAVE_SECRET_HASH;
    delete withoutFlutterwave.FLUTTERWAVE_ACTOR_USER_ID;
    expect(validateRuntimeConfig(withoutFlutterwave)).toMatchObject({ isProduction: true });
  });

  it('requires the signing hash and actor only when Flutterwave is enabled', () => {
    expect(() => validateRuntimeConfig({ ...productionEnv, FLUTTERWAVE_SECRET_HASH: undefined })).toThrow('PRODUCTION_CONFIG_MISSING:FLUTTERWAVE_SECRET_HASH');
    expect(() => validateRuntimeConfig({ ...productionEnv, FLUTTERWAVE_ACTOR_USER_ID: undefined })).toThrow('PRODUCTION_CONFIG_MISSING:FLUTTERWAVE_ACTOR_USER_ID');
  });

  it('rejects wildcard production CORS and only requires JWT_SECRET for JWT mode', () => {
    expect(() => validateRuntimeConfig({ ...productionEnv, ALLOWED_ORIGINS: '*' })).toThrow('PRODUCTION_CORS_WILDCARD_FORBIDDEN');
    expect(() => validateRuntimeConfig({ ...productionEnv, JWT_AUTH_ENABLED: 'true' })).toThrow('PRODUCTION_CONFIG_MISSING:JWT_SECRET');
    expect(validateRuntimeConfig({ ...productionEnv, JWT_AUTH_ENABLED: 'true', JWT_SECRET: 'configured' }).isProduction).toBe(true);
  });
});