import type { ListParams } from '../services/api.js';

export type ListModule = 'applications' | 'loans' | 'clients';
export const PAGE_SIZE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePage(value: string | null): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** URL is the source of truth (deep links survive refresh): ?page=&q=&from=&to=&branchId= */
export function buildListParams(module: ListModule, queue: string | undefined, search: URLSearchParams): ListParams {
  const params: ListParams = { page: parsePage(search.get('page')), pageSize: PAGE_SIZE };
  const q = search.get('q')?.trim();
  if (q) params.q = q.slice(0, 100);
  if (queue && module !== 'clients') params.queue = queue;
  if (module === 'applications') {
    const from = search.get('from'); const to = search.get('to');
    if (from && ISO_DATE.test(from)) params.from = from;
    if (to && ISO_DATE.test(to)) params.to = to;
  }
  const branchId = search.get('branchId');
  if (branchId) params.branchId = branchId; // admin-only on the server; ignored for other roles' scope
  return params;
}
