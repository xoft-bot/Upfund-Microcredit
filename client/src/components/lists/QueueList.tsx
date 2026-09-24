import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ListRow } from '../../services/api.js';
import { formatDate, formatUgx, humanize, statusTone, str } from '../../lib/format.js';
import { pageCount } from '../../lib/listQuery.js';

export interface Column { key: string; label: string; numeric?: boolean; render: (row: ListRow) => ReactNode }

export function StatusPill({ status }: { status: unknown }) {
  return <span className={`pill pill-${statusTone(status)}`}>{humanize(status)}</span>;
}

function Person({ row }: { row: ListRow }) {
  return <span className="ql-person"><span>{str(row.clientName) || str(row.displayName) || '–'}</span>{(str(row.clientExternalRef) || str(row.externalRef)) && <small>{str(row.clientExternalRef) || str(row.externalRef)}</small>}</span>;
}

export const COLUMNS: Record<'applications' | 'loans' | 'clients', Column[]> = {
  applications: [
    { key: 'client', label: 'Client', render: (row) => <Person row={row} /> },
    { key: 'product', label: 'Product', render: (row) => str(row.productName) || '–' },
    { key: 'amount', label: 'Requested', numeric: true, render: (row) => formatUgx(row.requestedAmount) },
    { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
    { key: 'created', label: 'Created', render: (row) => formatDate(row.createdAt) },
  ],
  loans: [
    { key: 'client', label: 'Client', render: (row) => <Person row={row} /> },
    { key: 'principal', label: 'Principal', numeric: true, render: (row) => formatUgx(row.principalAmount) },
    { key: 'outstanding', label: 'Outstanding', numeric: true, render: (row) => formatUgx(row.outstandingPrincipal) },
    { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
    { key: 'created', label: 'Created', render: (row) => formatDate(row.createdAt) },
  ],
  clients: [
    { key: 'client', label: 'Client', render: (row) => <Person row={row} /> },
    { key: 'branch', label: 'Branch', render: (row) => str(row.branchId).slice(0, 8) || '–' },
    { key: 'created', label: 'Added', render: (row) => formatDate(row.createdAt) },
  ],
};

interface Props {
  columns: Column[];
  rows: ListRow[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  emptyText: string;
  recordPath: (row: ListRow) => string;
  onPage: (page: number) => void;
}

export function QueueList({ columns, rows, total, page, pageSize, loading, emptyText, recordPath, onPage }: Props) {
  const pages = pageCount(total, pageSize);
  return (
    <div className={`ql${loading ? ' is-loading' : ''}`} aria-busy={loading}>
      {rows.length === 0 && !loading ? <p className="empty-state">{emptyText}</p> : (
        <div className="ql-scroll">
          <table className="ql-table">
            <thead><tr>{columns.map((column) => <th key={column.key} className={column.numeric ? 'num' : undefined} scope="col">{column.label}</th>)}<th aria-label="Open" /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={str(row.id)}>
                  {columns.map((column) => <td key={column.key} data-label={column.label} className={column.numeric ? 'num' : undefined}>{column.render(row)}</td>)}
                  <td className="ql-open"><Link to={recordPath(row)}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ql-pager">
        <span>{total === 0 ? '0 results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
        <span className="ql-pager-btns">
          <button type="button" className="text-button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="text-button" disabled={page >= pages || loading} onClick={() => onPage(page + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}
