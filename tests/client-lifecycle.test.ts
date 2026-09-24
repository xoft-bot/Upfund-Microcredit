import { describe, expect, it } from 'vitest';
import { APPROVE_REASON, applicationActions, canCreateApplication, canCreateClient, canDisburse, disbursePayload, validateNewApplication, validateNewClient, validateRisk } from '../client/src/lib/lifecycle.js';

describe('applicationActions', () => {
  it('offers exactly one action per status when the permission is held', () => {
    expect(applicationActions('draft', ['applications.submit'])).toEqual(['submit']);
    expect(applicationActions('submitted', ['kyc.review'])).toEqual(['kyc']);
    expect(applicationActions('kyc_verified', ['risk.assess'])).toEqual(['risk']);
    expect(applicationActions('risk_assessed', ['loans.approve'])).toEqual(['approve']);
  });
  it('offers nothing without the matching permission', () => {
    expect(applicationActions('draft', [])).toEqual([]);
    expect(applicationActions('submitted', ['applications.submit'])).toEqual([]);
    expect(applicationActions('risk_assessed', ['risk.assess', 'kyc.review'])).toEqual([]);
  });
  it('offers nothing on terminal or in-between statuses', () => {
    for (const status of ['approved', 'rejected', 'declined', 'kyc_rejected', '']) expect(applicationActions(status, ['applications.submit', 'kyc.review', 'risk.assess', 'loans.approve'])).toEqual([]);
  });
});

describe('disbursement', () => {
  it('is for admin and manager on approved loans only', () => {
    expect(canDisburse('admin', 'approved')).toBe(true);
    expect(canDisburse('manager', 'approved')).toBe(true);
    for (const role of ['officer', 'collector', 'accountant', 'client', 'marketing']) expect(canDisburse(role, 'approved')).toBe(false);
    for (const status of ['active', 'disbursed', 'completed', 'overdue']) expect(canDisburse('admin', status)).toBe(false);
  });
  it('keeps the classic reference and a stable idempotency key', () => {
    expect(disbursePayload('0123456789abcdef')).toEqual({ disbursementReference: 'DSB-01234567', idempotencyKey: 'disburse-0123456789abcdef' });
    expect(disbursePayload('abc')).toEqual(disbursePayload('abc'));
  });
});

describe('validateRisk', () => {
  const ok = { score: '72', grade: 'B', policy: 'v3', rationale: 'Stable income.' };
  it('accepts a complete assessment', () => { expect(validateRisk(ok)).toBeNull(); });
  it('rejects bad scores', () => {
    for (const score of ['', '-1', '101', '7.5', 'abc']) expect(validateRisk({ ...ok, score })).not.toBeNull();
    expect(validateRisk({ ...ok, score: '0' })).toBeNull(); expect(validateRisk({ ...ok, score: '100' })).toBeNull();
  });
  it('requires grade, policy and rationale within server limits', () => {
    expect(validateRisk({ ...ok, grade: ' ' })).not.toBeNull();
    expect(validateRisk({ ...ok, grade: 'x'.repeat(21) })).not.toBeNull();
    expect(validateRisk({ ...ok, policy: 'p'.repeat(65) })).not.toBeNull();
    expect(validateRisk({ ...ok, rationale: '  ' })).not.toBeNull();
  });
  it('has a non-empty default approval reason', () => { expect(APPROVE_REASON.length).toBeGreaterThan(10); });
});

describe('creation flows', () => {
  it('only officers and clients draft applications; only officers add clients', () => {
    for (const role of ['officer', 'client']) expect(canCreateApplication(role)).toBe(true);
    for (const role of ['admin', 'manager', 'collector', 'accountant', 'marketing']) expect(canCreateApplication(role)).toBe(false);
    expect(canCreateClient('officer')).toBe(true);
    for (const role of ['admin', 'manager', 'collector', 'accountant', 'marketing', 'client']) expect(canCreateClient(role)).toBe(false);
  });
  it('validates a new application like the classic form', () => {
    expect(validateNewApplication({ productId: 'p1', clientId: 'c1', amount: '500000' })).toBeNull();
    for (const amount of ['', '0', '-5', '1.5', 'abc', '9'.repeat(20)]) expect(validateNewApplication({ productId: 'p1', clientId: 'c1', amount })).not.toBeNull();
    expect(validateNewApplication({ productId: '', clientId: 'c1', amount: '10' })).not.toBeNull();
    expect(validateNewApplication({ productId: 'p1', clientId: null, amount: '10' })).toMatch(/client/i);
  });
  it('validates a new client and requires a branch', () => {
    expect(validateNewClient({ name: 'Amina', reference: 'C-001', branchId: 'b1' })).toBeNull();
    expect(validateNewClient({ name: 'Amina', reference: 'C-001', branchId: null })).toMatch(/branch/i);
    expect(validateNewClient({ name: ' ', reference: 'C-001', branchId: 'b1' })).not.toBeNull();
    expect(validateNewClient({ name: 'Amina', reference: '', branchId: 'b1' })).not.toBeNull();
  });
});
