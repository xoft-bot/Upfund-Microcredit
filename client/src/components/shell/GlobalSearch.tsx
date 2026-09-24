import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchAll, type ListRow, type SearchResults } from '../../services/api.js';
import { canAccess, type Role } from '../../config/navConfig.js';

interface Props { role: Role; getToken: () => Promise<string> }
type Status = 'idle' | 'loading' | 'done' | 'error';

const GROUPS: Array<{ key: keyof SearchResults; title: string; href: (id: string) => string }> = [
  { key: 'clients', title: 'Clients', href: (id) => `/clients/${encodeURIComponent(id)}` },
  { key: 'loans', title: 'Loans', href: (id) => `/loans/record/${encodeURIComponent(id)}` },
  { key: 'applications', title: 'Applications', href: (id) => `/applications/record/${encodeURIComponent(id)}` },
  { key: 'receipts', title: 'Receipts', href: () => '/reconciliation' },
];

function text(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? String(value) : ''; }
function rowLabel(row: ListRow): string {
  return text(row.displayName) || text(row.name) || text(row.clientName) || text(row.receiptReference) || text(row.reference) || text(row.id) || 'Untitled';
}
function rowDetail(row: ListRow): string {
  return [text(row.clientName) && text(row.displayName) ? text(row.clientName) : '', text(row.status), text(row.productName)].filter(Boolean).join(' · ');
}

export function GlobalSearch({ role, getToken }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [open, setOpen] = useState(false);
  const sequence = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { sequence.current += 1; setResults(null); setStatus('idle'); return undefined; }
    const id = ++sequence.current;
    setStatus('loading');
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchAll(await getToken(), term);
        if (id !== sequence.current) return;
        setResults(data);
        setStatus('done');
      } catch {
        if (id === sequence.current) setStatus('error');
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, getToken]);

  const groups = GROUPS
    .map((group) => ({ ...group, rows: (results?.[group.key] ?? []).filter((row) => text(row.id) && canAccess(role, group.href(text(row.id)))) }))
    .filter((group) => group.rows.length > 0);
  const showPanel = open && query.trim().length >= 2;

  return (
    <div className="gs" ref={box} onBlur={(event) => { if (!box.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <input
        className="gs-input"
        type="search"
        inputMode="search"
        placeholder="Search clients, loans, receipts"
        aria-label="Search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); (event.target as HTMLInputElement).blur(); } }}
      />
      {showPanel && (
        <div className="gs-panel" role="region" aria-label="Search results" aria-live="polite">
          {status === 'loading' && <p className="gs-note">Searching…</p>}
          {status === 'error' && <p className="gs-note gs-error">Search failed. Check your connection and try again.</p>}
          {status === 'done' && groups.length === 0 && <p className="gs-note">No matches for "{query.trim()}".</p>}
          {groups.map((group) => (
            <section key={group.key}>
              <h3 className="gs-group">{group.title}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={text(row.id)}>
                    <Link to={group.href(text(row.id))} onClick={() => { setOpen(false); setQuery(''); }}>
                      <span>{rowLabel(row)}</span>
                      {rowDetail(row) && <small>{rowDetail(row)}</small>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
