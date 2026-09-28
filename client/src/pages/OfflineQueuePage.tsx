import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, listFieldCollectionRecords, type FieldCollectionRecordList } from '../services/api.js';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import './OfflineQueuePage.css';

type StatusFilter = 'all' | 'recorded' | 'pending_reconciliation' | 'verified' | 'posted' | 'reversed';

const PAGE_SIZE = 20;
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'recorded', label: 'Recorded' },
  { value: 'pending_reconciliation', label: 'Pending reconciliation' },
  { value: 'verified', label: 'Verified' },
  { value: 'posted', label: 'Posted' },
  { value: 'reversed', label: 'Reversed' },
];

function formatMoney(amount: number): string {
  return `${Number(amount || 0).toLocaleString()} UGX`;
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Not synced';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatStatus(status: string): string {
  return status
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase().replace(/[-\s]+/g, '_');
  if (normalized === 'posted' || normalized === 'synced') return 'is-positive';
  if (normalized === 'reversed' || normalized === 'rejected') return 'is-critical';
  if (normalized === 'pending' || normalized === 'pending_reconciliation' || normalized === 'queued') return 'is-warning';
  return 'is-neutral';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === 'FORBIDDEN') return 'Your role cannot inspect the offline collection queue.';
  if (error instanceof Error && error.message) return error.message;
  return 'Could not load the offline collection queue. Check your connection and try again.';
}

function MetricCard({ label, value, hint, tone }: { label: string; value: number | string; hint: string; tone?: 'warning' | 'critical' }) {
  return (
    <article className={`offline-queue-metric${tone ? ` is-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function TableSkeleton() {
  return (
    <div className="offline-queue-table-wrap is-loading" aria-label="Loading records">
      <table className="offline-queue-table">
        <tbody>
          {Array.from({ length: 5 }, (_, index) => (
            <tr key={index}>
              {Array.from({ length: 7 }, (_, cellIndex) => <td key={cellIndex}><span className="offline-queue-skeleton-line" /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OfflineQueuePage() {
  const { role, branchId, branches, selectedBranchId, getToken } = useOutletContext<ShellOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [staleOnly, setStaleOnly] = useState(searchParams.get('staleOnly') !== 'false');
  const [page, setPage] = useState(Number(searchParams.get('page') ?? 1) || 1);
  const [branchFilter, setBranchFilter] = useState(role === 'admin' ? selectedBranchId ?? '' : branchId ?? '');
  const [result, setResult] = useState<FieldCollectionRecordList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [branchFilter, branchId, status, staleOnly]);

  const queryKey = useMemo(() => JSON.stringify({
    branchId: role === 'admin' ? branchFilter : branchId ?? '',
    q: appliedSearch,
    status: status === 'all' ? '' : status,
    staleOnly,
    page,
    pageSize: PAGE_SIZE,
  }), [appliedSearch, branchFilter, branchId, page, role, staleOnly, status]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');

    const query = JSON.parse(queryKey) as {
      branchId: string;
      q: string;
      status: string;
      staleOnly: boolean;
      page: number;
      pageSize: number;
    };
    try {
      const token = await getToken();
      const next = await listFieldCollectionRecords(token, {
        page: query.page,
        pageSize: query.pageSize,
        staleOnly: query.staleOnly,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.status ? { status: query.status } : {}),
      });
      if (sequence === requestSequence.current) setResult(next);
    } catch (caught) {
      if (sequence === requestSequence.current) {
        setResult(null);
        setError(errorMessage(caught));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [getToken, queryKey]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const total = result?.total ?? 0;
  const pageSize = result?.pageSize || PAGE_SIZE;
  const currentPage = result?.page || page;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rows = result?.items ?? [];
  const hasFilters = Boolean(appliedSearch || status !== 'all' || staleOnly);

  const goToPage = (nextPage: number) => {
    setPage(Math.min(Math.max(nextPage, 1), pageCount));
  };
  const updateStaleOnly = (next: boolean) => {
    setStaleOnly(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('staleOnly', 'true'); else params.delete('staleOnly');
    params.delete('page');
    setSearchParams(params, { replace: true });
  };
  const updateBranch = (next: string) => {
    setBranchFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('branchId', next); else params.delete('branchId');
    params.delete('page');
    setSearchParams(params, { replace: true });
  };

  return (
    <main className="offline-queue-page" aria-labelledby="offline-queue-title">
      <header className="offline-queue-heading">
        <div>
          <p className="eyebrow">Field collections · read-only inspection</p>
          <h1 id="offline-queue-title">Offline collection queue</h1>
          <p className="note">Review captured collections that are still waiting for server sync. This workspace does not change queue records.</p>
        </div>
        <span className="offline-queue-access">Manager / admin view</span>
      </header>

      <section className="offline-queue-metrics" aria-label="Queue summary">
        {loading && !result ? (
          <>
            <div className="offline-queue-metric offline-queue-metric-skeleton" />
            <div className="offline-queue-metric offline-queue-metric-skeleton" />
            <div className="offline-queue-metric offline-queue-metric-skeleton" />
          </>
        ) : (
          <>
            <MetricCard label="Records in view" value={total.toLocaleString()} hint={hasFilters ? 'Matching current filters' : 'Across this branch'} />
            <MetricCard label="Pending sync" value={(result?.summary.pending ?? 0).toLocaleString()} hint="Awaiting server confirmation" tone="warning" />
            <MetricCard label="Stale records" value={(result?.summary.stale ?? 0).toLocaleString()} hint="Past the configured freshness window" tone="critical" />
          </>
        )}
      </section>

      <section className="portal-card offline-queue-panel" aria-labelledby="offline-queue-records-title">
        <div className="offline-queue-panel-heading">
          <div>
            <p className="eyebrow">Queue records</p>
            <h2 id="offline-queue-records-title">Captured collection evidence</h2>
          </div>
          {loading && result ? <span className="offline-queue-loading-label" role="status">Updating results…</span> : null}
        </div>

        <div className="offline-queue-filters" role="search" aria-label="Filter offline collection records">
          <label className="offline-queue-search">
            <span>Search records</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Client name or local ID"
              maxLength={100}
            />
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {role === 'admin' && <label>
            <span>Branch</span>
            <select value={branchFilter} onChange={(event) => updateBranch(event.target.value)}>
              <option value="">All branches</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          </label>}
          <label className="offline-queue-toggle">
            <input type="checkbox" checked={staleOnly} onChange={(event) => updateStaleOnly(event.target.checked)} />
            <span>Stale only</span>
          </label>
        </div>

        {error ? (
          <div className="offline-queue-state is-error" role="alert">
            <strong>Queue unavailable</strong>
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button>
          </div>
        ) : loading && !result ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <div className="offline-queue-state is-empty" role="status">
            <span className="offline-queue-state-mark" aria-hidden="true">—</span>
            <strong>{hasFilters ? 'No records match these filters' : 'No offline records to inspect'}</strong>
            <p>{hasFilters ? 'Clear a filter or search a different client, collector, or reference.' : 'Captured collections will appear here when the server receives them from field devices.'}</p>
          </div>
        ) : (
          <div className={`offline-queue-table-wrap${loading ? ' is-refreshing' : ''}`}>
            <table className="offline-queue-table">
              <caption className="sr-only">Offline collection records</caption>
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Client</th>
                  <th scope="col">Collector</th>
                  <th scope="col">Captured</th>
                  <th scope="col" className="is-numeric">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">Server sync</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id || row.localId}>
                    <td data-label="Record">
                      <div className="offline-queue-primary-cell">
                        <strong>{row.localId || row.id}</strong>
                        <small>{row.receiptReference ?? 'No receipt reference'}</small>
                      </div>
                    </td>
                    <td data-label="Client">
                      <div className="offline-queue-primary-cell">
                        <strong>{row.clientName || 'Unknown client'}</strong>
                        <small>{row.clientId}</small>
                      </div>
                    </td>
                    <td data-label="Collector">
                      <div className="offline-queue-primary-cell">
                        <strong>{row.collectorName || 'Unknown collector'}</strong>
                        <small>{row.collectorId}</small>
                      </div>
                    </td>
                    <td data-label="Captured">
                      <div className="offline-queue-primary-cell">
                        <strong>{formatDateTime(row.capturedAt)}</strong>
                        <small className={row.ageDays > 0 ? 'is-aging' : ''}>{row.ageDays} {row.ageDays === 1 ? 'day' : 'days'} old</small>
                      </div>
                    </td>
                    <td data-label="Amount" className="is-numeric"><strong>{formatMoney(row.amount)}</strong></td>
                    <td data-label="Status"><span className={`offline-queue-status ${statusClass(row.status)}`}>{formatStatus(row.status)}</span></td>
                    <td data-label="Server sync">
                      <div className="offline-queue-primary-cell">
                        <strong>{row.syncedAt ? 'Synced' : 'Awaiting sync'}</strong>
                        <small>{formatDateTime(row.syncedAt)}</small>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && rows.length > 0 ? (
          <nav className="offline-queue-pagination" aria-label="Offline queue pages">
            <span>Showing {((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, total)} of {total.toLocaleString()}</span>
            <div>
              <button className="text-button" type="button" disabled={currentPage <= 1 || loading} onClick={() => goToPage(currentPage - 1)}>Previous</button>
              <span aria-live="polite">Page {currentPage} of {pageCount}</span>
              <button className="text-button" type="button" disabled={currentPage >= pageCount || loading} onClick={() => goToPage(currentPage + 1)}>Next</button>
            </div>
          </nav>
        ) : null}
      </section>
    </main>
  );
}