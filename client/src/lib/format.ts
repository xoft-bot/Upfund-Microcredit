// Display helpers. Pure, no React.

export function str(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function formatUgx(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '–';
  return `${new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(n)} UGX`;
}

export function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** in_review -> "In review" */
export function humanize(value: unknown): string {
  const text = str(value).replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '–';
}

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';
const OK = new Set(['approved', 'active', 'disbursed', 'completed', 'posted', 'verified', 'kyc_verified']);
const BAD = new Set(['rejected', 'declined', 'defaulted', 'written_off', 'overdue', 'reversed']);
const WARN = new Set(['submitted', 'risk_assessed', 'pending_reconciliation', 'recorded', 'open']);
export function statusTone(status: unknown): Tone {
  const value = str(status);
  if (OK.has(value)) return 'ok';
  if (BAD.has(value)) return 'bad';
  if (WARN.has(value)) return 'warn';
  return 'neutral';
}

/** Plain grouped number, no currency suffix (used in dense "paid of due" cells). */
export function formatAmount(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 }).format(n);
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
