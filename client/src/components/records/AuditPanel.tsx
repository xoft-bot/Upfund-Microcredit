import { getAuditTrail, type Paged } from '../../services/api.js';
import { formatDateTime, humanize, str } from '../../lib/format.js';
import { Card, useRecord } from './RecordFrame.js';

/** Read-only trail for one record. Metadata is deliberately not shown (may contain personal data). */
export function AuditPanel({ entityId, getToken }: { entityId: string; getToken: () => Promise<string> }) {
  const { data, error, loading } = useRecord<Paged>(getToken, (token) => getAuditTrail(token, { entityId, pageSize: 20 }), `audit:${entityId}`);
  return (
    <Card title="Audit trail" wide>
      {loading && <p className="note">Loading…</p>}
      {error && <p className="note">Audit trail unavailable for your role.</p>}
      {data && data.items.length === 0 && <p className="note">No audit events recorded for this record.</p>}
      {data && data.items.length > 0 && (
        <ul className="rec-timeline">
          {data.items.map((row) => (
            <li key={str(row.id)}>
              <strong>{humanize(row.action)}</strong>
              <span>{str(row.actorName) || 'System'} · {formatDateTime(row.createdAt)}</span>
              {str(row.correlationId) && <small>Ref {str(row.correlationId).slice(0, 8)}</small>}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > data.items.length && <p className="note">Showing the latest {data.items.length} of {data.total}.</p>}
    </Card>
  );
}
