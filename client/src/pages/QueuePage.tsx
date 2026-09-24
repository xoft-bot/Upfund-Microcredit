import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { COLUMNS, QueueList } from '../components/lists/QueueList.js';
import { QUEUES, countFor, queueLabel } from '../config/navConfig.js';
import { canCreateApplication, canCreateClient } from '../lib/lifecycle.js';
import { buildListParams, PAGE_SIZE, type ListModule } from '../lib/listQuery.js';
import { ApiRequestError, listClients, listLoanApplications, listLoans, type ListRow, type Paged } from '../services/api.js';

const TITLES: Record<ListModule, string> = { applications: 'Applications', loans: 'Loans', clients: 'Clients' };
const RECORD_PATH: Record<ListModule, (id: string) => string> = {
  applications: (id) => `/applications/record/${encodeURIComponent(id)}`,
  loans: (id) => `/loans/record/${encodeURIComponent(id)}`,
  clients: (id) => `/clients/${encodeURIComponent(id)}`,
};
const FETCH = { applications: listLoanApplications, loans: listLoans, clients: listClients } as const;

function errorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'FORBIDDEN') return 'Your role cannot view this list.';
    if (error.code === 'INVALID_APPLICATION_QUEUE' || error.code === 'INVALID_LOAN_QUEUE') return 'That queue does not exist.';
    return `${error.message} (${error.code})`;
  }
  return 'Could not load this list. Check your connection and try again.';
}

export default function QueuePage({ module }: { module: ListModule }) {
  const { queue } = useParams();
  const [search, setSearch] = useSearchParams();
  const { role, counts, getToken } = useOutletContext<ShellOutletContext>();
  const validQueue = module === 'clients' || !queue || QUEUES[module].some((entry) => entry.id === queue);

  const params = useMemo(() => buildListParams(module, queue, search), [module, queue, search]);
  const paramsKey = JSON.stringify(params);
  const [data, setData] = useState<Paged | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState(search.get('q') ?? '');
  const sequence = useRef(0);

  // Fetch whenever the URL-derived params change. Stale responses are dropped.
  useEffect(() => {
    if (!validQueue) return;
    const id = ++sequence.current;
    setLoading(true);
    void (async () => {
      try {
        const result = await FETCH[module](await getToken(), JSON.parse(paramsKey));
        if (id !== sequence.current) return;
        setData(result); setError('');
      } catch (caught) {
        if (id === sequence.current) { setError(errorText(caught)); setData(null); }
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    })();
  }, [module, paramsKey, validQueue, getToken]);

  // Reset the box when navigating between queues.
  useEffect(() => { setTerm(search.get('q') ?? ''); }, [module, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search -> URL (page resets to 1).
  useEffect(() => {
    const next = term.trim();
    if (next === (search.get('q') ?? '')) return undefined;
    const timer = window.setTimeout(() => {
      setSearch((current) => { const copy = new URLSearchParams(current); if (next) copy.set('q', next); else copy.delete('q'); copy.delete('page'); return copy; }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search, setSearch]);

  if (!validQueue) return <Navigate to={`/${module}`} replace />;

  const setParam = (key: string, value: string) => setSearch((current) => {
    const copy = new URLSearchParams(current);
    if (value) copy.set(key, value); else copy.delete(key);
    copy.delete('page');
    return copy;
  });
  const goToPage = (page: number) => setSearch((current) => { const copy = new URLSearchParams(current); if (page > 1) copy.set('page', String(page)); else copy.delete('page'); return copy; });

  const queueName = module !== 'clients' && queue ? queueLabel(module, queue) : undefined;
  const heading = role === 'client' ? `My ${TITLES[module].toLowerCase()}` : TITLES[module];
  const rows: ListRow[] = data?.items ?? [];

  return (
    <section className="queue-page">
      <div className="page-head">
        <h1>{heading}{queueName ? `: ${queueName}` : ''}</h1>
        {module === 'applications' && canCreateApplication(role) && <Link className="primary-button page-action" to="/applications/new">New application</Link>}
        {module === 'clients' && canCreateClient(role) && <Link className="primary-button page-action" to="/clients/new">Add client</Link>}
      </div>

      {module !== 'clients' && (
        <div className="ql-tabs" role="tablist" aria-label={`${TITLES[module]} queues`}>
          <Link role="tab" aria-selected={!queue} className={`ql-tab${!queue ? ' is-active' : ''}`} to={`/${module}`}>All</Link>
          {QUEUES[module].map((entry) => {
            const count = countFor(counts, { module, queue: entry.id });
            return (
              <Link key={entry.id} role="tab" aria-selected={queue === entry.id} className={`ql-tab${queue === entry.id ? ' is-active' : ''}`} to={`/${module}/${entry.id}`}>
                {entry.label}{count ? <span className="ql-tab-count">{count}</span> : null}
              </Link>
            );
          })}
        </div>
      )}

      <div className="ql-filters">
        <input className="ql-search" type="search" inputMode="search" aria-label={`Search ${TITLES[module].toLowerCase()}`} placeholder={module === 'clients' ? 'Name or reference' : 'Client name, reference or id'} value={term} onChange={(event) => setTerm(event.target.value)} maxLength={100} />
        {module === 'applications' && (
          <>
            <label className="ql-date">From<input type="date" value={search.get('from') ?? ''} onChange={(event) => setParam('from', event.target.value)} /></label>
            <label className="ql-date">To<input type="date" value={search.get('to') ?? ''} onChange={(event) => setParam('to', event.target.value)} /></label>
          </>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && (
        <QueueList
          columns={COLUMNS[module]}
          rows={rows}
          total={data?.total ?? 0}
          page={data?.page ?? params.page ?? 1}
          pageSize={data?.pageSize ?? PAGE_SIZE}
          loading={loading}
          emptyText={params.q || params.from || params.to ? 'No results match these filters. Clear the search or dates to see more.' : `Nothing in ${queueName ? queueName.toLowerCase() : TITLES[module].toLowerCase()} right now.`}
          recordPath={(row) => RECORD_PATH[module](String(row.id))}
          onPage={goToPage}
        />
      )}
    </section>
  );
}
