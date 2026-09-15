import type { DbClient } from '../db.js';

export interface ProductTerms {
  annualRatePercent: number;
  installments: number;
  repaymentCycle: 'monthly' | 'biweekly';
}

export interface ScheduleRow {
  dueOn: string;
  principalDue: number;
  interestDue: number;
}

export async function loadProductTerms(client: DbClient, productId: string): Promise<ProductTerms> {
  const result = await client.query<{ annual_rate_percent: string; installments: number; repayment_cycle: 'monthly' | 'biweekly' }>(
    `SELECT annual_rate_percent, installments, repayment_cycle FROM loan_products WHERE id = $1`,
    [productId],
  );
  if (!result.rowCount) throw new Error('LOAN_PRODUCT_NOT_FOUND');
  const row = result.rows[0];
  return { annualRatePercent: Number(row.annual_rate_percent), installments: row.installments, repaymentCycle: row.repayment_cycle };
}

export function buildRepaymentSchedule(principal: number, terms: ProductTerms, anchorDate: Date): ScheduleRow[] {
  const cycleDays = terms.repaymentCycle === 'monthly' ? 30 : 14;
  const totalDays = cycleDays * terms.installments;
  const totalInterest = Math.round(principal * (terms.annualRatePercent / 100) * (totalDays / 365));
  const basePrincipal = Math.floor(principal / terms.installments);
  const baseInterest = Math.floor(totalInterest / terms.installments);

  const rows: ScheduleRow[] = [];
  let remainingPrincipal = principal;
  let remainingInterest = totalInterest;
  const dueDate = new Date(anchorDate);

  for (let i = 1; i <= terms.installments; i += 1) {
    if (terms.repaymentCycle === 'monthly') dueDate.setMonth(dueDate.getMonth() + 1);
    else dueDate.setDate(dueDate.getDate() + 14);
    const isLast = i === terms.installments;
    const principalDue = isLast ? remainingPrincipal : basePrincipal;
    const interestDue = isLast ? remainingInterest : baseInterest;
    remainingPrincipal -= principalDue;
    remainingInterest -= interestDue;
    rows.push({ dueOn: dueDate.toISOString().slice(0, 10), principalDue, interestDue });
  }
  return rows;
}

export async function persistRepaymentSchedule(client: DbClient, loanId: string, rows: ScheduleRow[]): Promise<void> {
  await client.query('DELETE FROM repayment_schedules WHERE loan_id = $1', [loanId]);
  for (const row of rows) {
    await client.query(
      `INSERT INTO repayment_schedules (loan_id, due_on, principal_due, charge_due, interest_due)
       VALUES ($1, $2, $3, 0, $4)`,
      [loanId, row.dueOn, row.principalDue, row.interestDue],
    );
  }
}