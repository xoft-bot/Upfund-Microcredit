import { pool, withTransaction, insertAuditEvent } from '../db.js';

/**
 * Read/update path for the PAR30/60/90 threshold windows used by reporting.ts's
 * readPortfolio(). Scaffolding for HANDOFF_6 §3: the table is seeded with the same
 * 30/60/90 values reporting.ts always hardcoded, so this alone changes no numbers —
 * only an explicit update (accountant/admin, via the route guard) does. Per HANDOFF
 * rule 5 ("no new PAR definition in the UI without accounting sign-off"), nothing in
 * this codebase writes a non-default value here on its own.
 */

export interface ParThresholdConfig {
  par30Days: number;
  par60Days: number;
  par90Days: number;
  updatedBy: string | null;
  updatedAt: string;
}

interface ParThresholdRow {
  par30_days: number;
  par60_days: number;
  par90_days: number;
  updated_by: string | null;
  updated_at: string;
}

function toConfig(row: ParThresholdRow): ParThresholdConfig {
  return {
    par30Days: row.par30_days,
    par60Days: row.par60_days,
    par90Days: row.par90_days,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export async function getParThresholdConfig(): Promise<ParThresholdConfig> {
  const result = await pool.query<ParThresholdRow>(
    `SELECT par30_days, par60_days, par90_days, updated_by, updated_at FROM par_threshold_config WHERE id = 1`,
  );
  if (!result.rowCount) throw new Error('PAR_THRESHOLD_CONFIG_MISSING');
  return toConfig(result.rows[0]);
}

export interface UpdateParThresholdInput {
  par30Days: number;
  par60Days: number;
  par90Days: number;
  actorUserId: string;
  correlationId: string;
}

export async function updateParThresholdConfig(input: UpdateParThresholdInput): Promise<ParThresholdConfig> {
  const { par30Days, par60Days, par90Days } = input;
  if (![par30Days, par60Days, par90Days].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('PAR_THRESHOLD_INVALID');
  }
  if (!(par30Days < par60Days && par60Days < par90Days)) {
    throw new Error('PAR_THRESHOLD_ORDER_INVALID');
  }
  return withTransaction(async (client) => {
    const result = await client.query<ParThresholdRow>(
      `UPDATE par_threshold_config
          SET par30_days = $1, par60_days = $2, par90_days = $3, updated_by = $4, updated_at = now()
        WHERE id = 1
        RETURNING par30_days, par60_days, par90_days, updated_by, updated_at`,
      [par30Days, par60Days, par90Days, input.actorUserId],
    );
    if (!result.rowCount) throw new Error('PAR_THRESHOLD_CONFIG_MISSING');
    await insertAuditEvent(client, {
      actorUserId: input.actorUserId,
      action: 'par_threshold_config.updated',
      entityType: 'par_threshold_config',
      // Singleton config row keyed by a smallint (id = 1), not a uuid — audit_events.entity_id
      // is uuid-typed (same gotcha as correlation_id, see HANDOFF_6 §1), so there's no valid
      // entity_id to pass here. entityType alone is enough to identify what changed.
      entityId: null,
      correlationId: input.correlationId,
      metadata: { par30Days, par60Days, par90Days },
    });
    return toConfig(result.rows[0]);
  });
}
