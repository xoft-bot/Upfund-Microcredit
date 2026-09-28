/**
 * Phase 3b: keeps the manager/accountant dashboards from re-running their full set of aggregate
 * queries on every page load.
 *
 * Why a short-TTL cache and not a materialized view or a rollup table: the dashboard numbers are
 * not simple per-day sums. "Realized due" needs a payment date AND a due date inside the window,
 * collection buckets depend on a record's CURRENT status, and PAR depends on "as of now". Any
 * pre-aggregated per-day table would either return different numbers than today's queries or go
 * stale in ways that are hard to see. Caching the finished snapshot returns exactly what the
 * queries would have returned, at most REPORTING_CACHE_TTL_MS ago.
 *
 * Safety properties:
 *  - Authorization happens in the route BEFORE this is reached; the cache key includes the branch
 *    (null = all branches, admin only), so one branch's snapshot can never be served for another.
 *  - Errors are never cached.
 *  - Identical concurrent requests share one in-flight load (no thundering herd).
 *  - clearReportingCache() drops everything and also prevents a load that started before the
 *    clear from re-populating the cache with pre-clear data.
 *  - TTL 0 (the default under NODE_ENV=test) disables caching entirely.
 */

interface Entry { value: unknown; expiresAt: number; }

const MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 30_000;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

export function reportingCacheTtlMs(): number {
  const raw = process.env.REPORTING_CACHE_TTL_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return process.env.NODE_ENV === 'test' ? 0 : DEFAULT_TTL_MS;
}

export function clearReportingCache(): void {
  generation += 1;
  entries.clear();
  inflight.clear();
}

function evictIfFull(now: number): void {
  if (entries.size < MAX_ENTRIES) return;
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  while (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

export interface CachedReportOptions {
  /** Skip the read (a person pressed Refresh) but still store the result for everyone else. */
  fresh?: boolean;
  now?: () => number;
  ttlMs?: number;
}

export async function cachedReport<T>(namespace: string, key: unknown, loader: () => Promise<T>, options: CachedReportOptions = {}): Promise<T> {
  const ttl = options.ttlMs ?? reportingCacheTtlMs();
  if (ttl <= 0) return loader();

  const now = options.now ?? Date.now;
  const cacheKey = `${namespace}:${JSON.stringify(key)}`;

  if (!options.fresh) {
    const hit = entries.get(cacheKey);
    if (hit && hit.expiresAt > now()) return structuredClone(hit.value) as T;
    const pending = inflight.get(cacheKey);
    if (pending) return structuredClone(await pending) as T;
  }

  const startedIn = generation;
  const load = (async () => {
    const value = await loader();
    if (startedIn === generation) {
      evictIfFull(now());
      entries.set(cacheKey, { value, expiresAt: now() + ttl });
    }
    return value;
  })();

  inflight.set(cacheKey, load);
  try {
    return structuredClone(await load) as T;
  } finally {
    if (inflight.get(cacheKey) === load) inflight.delete(cacheKey);
  }
}
