import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { postLedgerTransaction } from '../server/src/services/ledger.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;
let roleId: string;
let userId: string;

suite('PostgreSQL Stage 1 certification', () => {
  beforeAll(async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const role = await client.query<{ id: string }>(`INSERT INTO roles (code, name) VALUES ($1, 'Stage 1 Manager') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [`stage1-manager-${randomUUID()}`]);
      roleId = role.rows[0].id;
      userId = randomUUID();
      await client.query(`INSERT INTO users (id, firebase_uid, display_name, role_id) VALUES ($1, $2, 'Stage 1 Test User', $3)`, [userId, `stage1-${userId}`, roleId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => { await pool!.end(); });

  it('rejects an unbalanced transaction at commit', async () => {
    const client = await pool!.connect();
    const transactionId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO ledger_transactions (id, source_type, source_id, idempotency_key, correlation_id, posted_by, description) VALUES ($1, 'test', $1, $2, $1, $3, 'unbalanced')`, [transactionId, `unbalanced-${transactionId}`, userId]);
      await client.query(`INSERT INTO ledger_entries (transaction_id, account_code, side, amount) VALUES ($1, 'cash', 'debit', 100)`, [transactionId]);
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('rejects updates and deletes on ledger history', async () => {
    const transactionId = randomUUID();
    const posted = await postLedgerTransaction({ actorUserId: userId, sourceType: 'test', sourceId: transactionId, idempotencyKey: `append-only-${transactionId}`, description: 'append-only test', lines: [{ accountCode: 'cash', side: 'debit', amount: 10 }, { accountCode: 'equity', side: 'credit', amount: 10 }] });
    await expect(pool!.query('UPDATE ledger_transactions SET description = $1 WHERE id = $2', ['tampered', posted.transactionId])).rejects.toThrow(/append-only/);
    await expect(pool!.query('DELETE FROM ledger_transactions WHERE id = $1', [posted.transactionId])).rejects.toThrow(/append-only/);
  });

  it('resolves concurrent duplicate idempotency submissions to one transaction', async () => {
    const key = `concurrent-${randomUUID()}`;
    const source = randomUUID();
    const input = { actorUserId: userId, sourceType: 'test', sourceId: source, idempotencyKey: key, description: 'concurrent idempotency test', lines: [{ accountCode: 'cash', side: 'debit' as const, amount: 25 }, { accountCode: 'equity', side: 'credit' as const, amount: 25 }] };
    const results = await Promise.all([postLedgerTransaction(input), postLedgerTransaction(input), postLedgerTransaction(input)]);
    expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const count = await pool!.query<{ count: string }>('SELECT count(*) FROM ledger_transactions WHERE idempotency_key = $1', [key]);
    expect(count.rows[0].count).toBe('1');
  });
});
