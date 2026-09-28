import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedReport, clearReportingCache, reportingCacheTtlMs } from '../server/src/services/reporting-cache.js';

const TTL = 10_000;

beforeEach(() => { clearReportingCache(); });
afterEach(() => { vi.unstubAllEnvs(); });

function loader() {
  let calls = 0;
  const fn = vi.fn(async () => ({ n: ++calls }));
  return fn;
}

describe('reporting cache', () => {
  it('serves a cached snapshot inside the TTL and recomputes after it expires', async () => {
    let clock = 1_000;
    const load = loader();
    const opts = { ttlMs: TTL, now: () => clock };
    expect((await cachedReport('manager', { b: 'a' }, load, opts)).n).toBe(1);
    clock += TTL - 1;
    expect((await cachedReport('manager', { b: 'a' }, load, opts)).n).toBe(1);
    clock += 2;
    expect((await cachedReport('manager', { b: 'a' }, load, opts)).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never serves one branch\'s snapshot for another branch, or one report type for another', async () => {
    const load = loader();
    const opts = { ttlMs: TTL };
    await cachedReport('manager', { branchId: 'branch-a' }, load, opts);
    const other = await cachedReport('manager', { branchId: 'branch-b' }, load, opts);
    const allBranches = await cachedReport('manager', { branchId: null }, load, opts);
    const accountant = await cachedReport('accountant', { branchId: 'branch-a' }, load, opts);
    expect([other.n, allBranches.n, accountant.n]).toEqual([2, 3, 4]);
  });

  it('shares one in-flight load between identical concurrent requests', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const load = vi.fn(async () => { await gate; return { ok: true }; });
    const pending = Promise.all([1, 2, 3].map(() => cachedReport('manager', { b: 1 }, load, { ttlMs: TTL })));
    release();
    await pending;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache errors', async () => {
    const load = vi.fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ ok: true });
    await expect(cachedReport('manager', { b: 1 }, load, { ttlMs: TTL })).rejects.toThrow('db down');
    await expect(cachedReport('manager', { b: 1 }, load, { ttlMs: TTL })).resolves.toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('fresh bypasses the read but stores the new result for everyone else', async () => {
    const load = loader();
    const opts = { ttlMs: TTL };
    await cachedReport('manager', { b: 1 }, load, opts);
    expect((await cachedReport('manager', { b: 1 }, load, { ...opts, fresh: true })).n).toBe(2);
    expect((await cachedReport('manager', { b: 1 }, load, opts)).n).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('clearReportingCache drops entries, and a load that started before the clear cannot repopulate it', async () => {
    const load = loader();
    const opts = { ttlMs: TTL };
    await cachedReport('manager', { b: 1 }, load, opts);
    clearReportingCache();
    expect((await cachedReport('manager', { b: 1 }, load, opts)).n).toBe(2);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = vi.fn(async () => { await gate; return { stale: true }; });
    const inFlight = cachedReport('manager', { b: 2 }, slow, opts);
    clearReportingCache(); // e.g. PAR windows changed while the old-window load was still running
    release();
    await inFlight;
    const fresh = vi.fn(async () => ({ stale: false }));
    expect(await cachedReport('manager', { b: 2 }, fresh, opts)).toEqual({ stale: false });
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('returns copies so a caller cannot corrupt the cached snapshot', async () => {
    const opts = { ttlMs: TTL };
    const first = await cachedReport('manager', { b: 1 }, async () => ({ rows: [1, 2, 3] }), opts);
    first.rows.push(99);
    const second = await cachedReport('manager', { b: 1 }, async () => ({ rows: ['recomputed'] }), opts);
    expect(second.rows).toEqual([1, 2, 3]);
  });

  it('ttl 0 disables caching entirely; env override and test default behave as documented', async () => {
    const load = loader();
    await cachedReport('manager', { b: 1 }, load, { ttlMs: 0 });
    await cachedReport('manager', { b: 1 }, load, { ttlMs: 0 });
    expect(load).toHaveBeenCalledTimes(2);

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('REPORTING_CACHE_TTL_MS', '');
    expect(reportingCacheTtlMs()).toBe(0);
    vi.stubEnv('NODE_ENV', 'production');
    expect(reportingCacheTtlMs()).toBe(30_000);
    vi.stubEnv('REPORTING_CACHE_TTL_MS', '5000');
    expect(reportingCacheTtlMs()).toBe(5_000);
    vi.stubEnv('REPORTING_CACHE_TTL_MS', 'garbage');
    expect(reportingCacheTtlMs()).toBe(30_000);
    vi.stubEnv('REPORTING_CACHE_TTL_MS', '0');
    expect(reportingCacheTtlMs()).toBe(0);
  });
});
