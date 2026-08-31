import { describe, expect, it } from 'vitest';
import { getDatabasePoolSettings, summarizeDatabaseError } from '../server/src/db.js';

describe('database connection settings', () => {
  it('uses bounded pool settings and relaxed TLS verification in production', () => {
    expect(getDatabasePoolSettings({
      NODE_ENV: 'production',
      DATABASE_POOLER_URL: 'postgresql://pooler.example.test:6543/pilot',
      DATABASE_POOL_MAX: '8',
    })).toMatchObject({
      max: 8,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false },
    });
  });

  it('falls back to five connections for unsafe pool values', () => {
    expect(getDatabasePoolSettings({ DATABASE_POOL_MAX: '100' }).max).toBe(5);
    expect(getDatabasePoolSettings({ DATABASE_POOL_MAX: '2' }).max).toBe(5);
  });

  it('redacts connection strings from diagnostic messages', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED postgresql://user:secret@example.test:6543/pilot?password=secret'), {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: 'example.test',
      port: 6543,
    });
    expect(summarizeDatabaseError(error)).toEqual({
      name: 'Error',
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED postgresql://<redacted>',
      syscall: 'connect',
      address: 'example.test',
      port: 6543,
    });
  });
});