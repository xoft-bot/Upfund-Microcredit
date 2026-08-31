import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl } from '../client/src/services/api.js';
import { buildApp } from '../server/src/app.js';
import { getDatabaseConnectionString, getServerPort, DEFAULT_SERVER_PORT, validateRuntimeConfig } from '../server/src/config.js';
import { pool } from '../server/src/db.js';

afterEach(() => vi.restoreAllMocks());

describe('Render runtime boundary', () => {
  it('uses the configured Render port', () => {
    expect(getServerPort({ PORT: '10000' })).toBe(10000);
  });

  it('falls back to the safe server port for invalid values', () => {
    expect(getServerPort({ PORT: 'not-a-port' })).toBe(DEFAULT_SERVER_PORT);
    expect(getServerPort({ PORT: '70000' })).toBe(DEFAULT_SERVER_PORT);
  });

  it('accepts PGURI when DATABASE_URL is absent', () => {
    expect(getDatabaseConnectionString({ PGURI: 'postgresql://supabase.example.test/db' })).toBe('postgresql://supabase.example.test/db');
    expect(validateRuntimeConfig({ NODE_ENV: 'development', PGURI: 'postgresql://supabase.example.test/db' })).toMatchObject({ isProduction: false });
  });

  it('requires exact production CORS origins', () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://db.example.test/app',
      FIREBASE_MODE: 'live',
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'admin@example.test',
      FIREBASE_PRIVATE_KEY: 'key',
    })).toThrow('PRODUCTION_CONFIG_MISSING:CORS_ORIGINS');
    expect(() => validateRuntimeConfig({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      DATABASE_URL: 'postgresql://db.example.test/app',
      FIREBASE_MODE: 'live',
      FIREBASE_PROJECT_ID: 'project',
      FIREBASE_CLIENT_EMAIL: 'admin@example.test',
      FIREBASE_PRIVATE_KEY: 'key',
      CORS_ORIGINS: 'http://frontend.example.test',
    })).toThrow('PRODUCTION_CORS_ORIGIN_MUST_BE_HTTPS_ORIGIN');
  });

  it('uses VITE_API_BASE_URL for absolute API calls and relative paths by default', () => {
    expect(apiUrl('/api/v1/session', 'https://api.example.test/')).toBe('https://api.example.test/api/v1/session');
    expect(apiUrl('/api/v1/session')).toBe('/api/v1/session');
  });

  it('returns 200 and database up when the health query succeeds', async () => {
    vi.spyOn(pool, 'query').mockResolvedValue({ rows: [{ ok: 1 }], rowCount: 1 } as never);
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.database).toBe('up');
    await app.close();
  });

  it('returns 503 and database down when the health query fails', async () => {
    vi.spyOn(pool, 'query').mockRejectedValue(new Error('database unavailable'));
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json().data.database).toBe('down');
    await app.close();
  });
});