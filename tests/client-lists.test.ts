import { describe, expect, it } from 'vitest';
import { buildListParams, pageCount, parsePage, PAGE_SIZE } from '../client/src/lib/listQuery.js';
import { formatAmount, formatDate, formatUgx, humanize, statusTone } from '../client/src/lib/format.js';

const sp = (query: string) => new URLSearchParams(query);

describe('buildListParams', () => {
  it('defaults to page 1 and the standard page size', () => {
    expect(buildListParams('loans', undefined, sp(''))).toEqual({ page: 1, pageSize: PAGE_SIZE });
  });
  it('maps queue, search and page from the URL', () => {
    expect(buildListParams('loans', 'overdue', sp('page=3&q=%20amina%20'))).toEqual({ page: 3, pageSize: PAGE_SIZE, q: 'amina', queue: 'overdue' });
  });
  it('never sends a queue for clients (server schema has none)', () => {
    expect(buildListParams('clients', 'overdue', sp(''))).not.toHaveProperty('queue');
  });
  it('only forwards valid ISO dates, and only for applications', () => {
    expect(buildListParams('applications', undefined, sp('from=2026-09-01&to=bad'))).toMatchObject({ from: '2026-09-01' });
    expect(buildListParams('applications', undefined, sp('from=2026-09-01&to=bad'))).not.toHaveProperty('to');
    expect(buildListParams('loans', undefined, sp('from=2026-09-01'))).not.toHaveProperty('from');
  });
  it('caps q at 100 chars to match the server schema', () => {
    expect(buildListParams('clients', undefined, sp(`q=${'a'.repeat(150)}`)).q).toHaveLength(100);
  });
  it('passes branchId through for admin deep links', () => {
    expect(buildListParams('loans', undefined, sp('branchId=b1'))).toMatchObject({ branchId: 'b1' });
  });
});

describe('paging', () => {
  it('parses bad page values to 1', () => {
    expect(parsePage('0')).toBe(1); expect(parsePage('-2')).toBe(1); expect(parsePage('x')).toBe(1); expect(parsePage(null)).toBe(1); expect(parsePage('4')).toBe(4);
  });
  it('computes page counts with a floor of 1', () => {
    expect(pageCount(0, 25)).toBe(1); expect(pageCount(25, 25)).toBe(1); expect(pageCount(26, 25)).toBe(2);
  });
});

describe('format helpers', () => {
  it('formats UGX and rejects non-numbers', () => {
    expect(formatUgx(1234567)).toMatch(/^1,234,567 UGX$/);
    expect(formatUgx(null)).toBe('–'); expect(formatUgx('abc')).toBe('–');
  });
  it('formats dates safely', () => {
    expect(formatDate('2026-09-24T10:00:00Z')).toMatch(/2026/);
    expect(formatDate('nope')).toBe('–'); expect(formatDate(undefined)).toBe('–');
  });
  it('formats plain amounts from numbers or numeric strings', () => {
    expect(formatAmount('12000.00')).toBe('12,000'); expect(formatAmount(undefined)).toBe('–');
  });
  it('humanizes statuses and picks tones', () => {
    expect(humanize('pending_reconciliation')).toBe('Pending reconciliation');
    expect(statusTone('overdue')).toBe('bad'); expect(statusTone('active')).toBe('ok'); expect(statusTone('submitted')).toBe('warn'); expect(statusTone('draft')).toBe('neutral');
  });
});
