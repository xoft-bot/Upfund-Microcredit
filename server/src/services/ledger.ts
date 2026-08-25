import { randomUUID } from 'node:crypto';
import type { DbClient } from '../db.js';
import { insertAuditEvent, withTransaction } from '../db.js';

export interface LedgerLine {
  accountCode: string;
  side: 'debit' | 'credit';
  amount: number;
  currency?: string;
}

export interface PostLedgerInput {
  actorUserId: string;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  correlationId?: string;
  description: string;
  lines: LedgerLine[];
}

export function assertBalanced(lines: LedgerLine[]): void {
  if (lines.length < 2) throw new Error('LEDGER_REQUIRES_TWO_LINES');
  if (lines.some((line) => !Number.isSafeInteger(line.amount) || line.amount <= 0)) throw new Error('LEDGER_INVALID_AMOUNT');
  const debit = lines.filter((line) => line.side === 'debit').reduce((sum, line) => sum + line.amount, 0);
  const credit = lines.filter((line) => line.side === 'credit').reduce((sum, line) => sum + line.amount, 0);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit <= 0 || debit !== credit) throw new Error('LEDGER_UNBALANCED');
}

export async function postLedgerTransactionOnClient(client: DbClient, input: PostLedgerInput): Promise<{ transactionId: string; created: boolean }> {
  assertBalanced(input.lines);
  const correlationId = input.correlationId ?? randomUUID();
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM ledger_transactions WHERE idempotency_key = $1 FOR UPDATE',
    [input.idempotencyKey],
  );
  if (existing.rowCount) return { transactionId: existing.rows[0].id, created: false };

  const transaction = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions
      (source_type, source_id, idempotency_key, correlation_id, posted_by, description)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [input.sourceType, input.sourceId, input.idempotencyKey, correlationId, input.actorUserId, input.description],
  );
  const transactionId = transaction.rows[0].id;
  for (const line of input.lines) {
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_code, side, amount, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [transactionId, line.accountCode, line.side, line.amount, line.currency ?? 'UGX'],
    );
  }
  await insertAuditEvent(client, {
    actorUserId: input.actorUserId,
    action: 'ledger.transaction.posted',
    entityType: 'ledger_transaction',
    entityId: transactionId,
    correlationId,
    metadata: { sourceType: input.sourceType, sourceId: input.sourceId, idempotencyKey: input.idempotencyKey },
  });
  return { transactionId, created: true };
}

export async function postLedgerTransaction(input: PostLedgerInput): Promise<{ transactionId: string; created: boolean }> {
  return withTransaction((client) => postLedgerTransactionOnClient(client, input));
}
