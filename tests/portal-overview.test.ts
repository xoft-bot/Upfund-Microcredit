import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { getPortalOverview } from '../server/src/services/lifecycle.js';
import type { Actor } from '../shared/contracts.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;

suite('getPortalOverview', () => {
  it('does not 500 for the client role — scopes the clients table by its own id, not client_id', async () => {
    // Regression test for a real production bug: scopeFor(actor, 'c') used
    // to default to clientColumn 'client_id', but the clients table's own
    // primary key is 'id' — client_id is only a foreign key on
    // loan_applications/loans. For a client-role actor this built
    // `WHERE c.client_id = $1` against a column that doesn't exist,
    // throwing a real Postgres error and 500ing the whole endpoint for
    // every client-role account (client@upfund.test in particular).
    const branchId = randomUUID();
    const clientId = randomUUID();
    const otherClientId = randomUUID();
    await pool!.query(`INSERT INTO branches (id, code, name) VALUES ($1, $2, 'Portal Overview Branch')`, [branchId, `POB-${randomUUID().slice(0, 8)}`]);
    await pool!.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Portal Overview Client')`, [clientId, branchId, `client-${clientId}`]);
    await pool!.query(`INSERT INTO clients (id, branch_id, external_ref, display_name) VALUES ($1, $2, $3, 'Other Client')`, [otherClientId, branchId, `client-${otherClientId}`]);

    const actor: Actor = { userId: randomUUID(), dbUserId: randomUUID(), firebaseUid: `client-${clientId}`, role: 'client', branchId: null, clientId };

    const overview = await getPortalOverview(actor);

    // Doesn't throw (the bug's actual symptom), and correctly scopes to
    // just this client's own row — not zero (scope broken to FALSE) and
    // not every client in the branch (scope broken to TRUE).
    expect(overview.metrics.clients).toBe(1);

    await pool!.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [[clientId, otherClientId]]);
    await pool!.query(`DELETE FROM branches WHERE id = $1`, [branchId]);
  });
});
