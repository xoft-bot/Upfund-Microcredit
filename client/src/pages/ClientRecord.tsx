import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { AuditPanel } from '../components/records/AuditPanel.js';
import { Card, Facts, LoadState, RecordFrame, useRecord } from '../components/records/RecordFrame.js';
import { canAccess, canViewAudit } from '../config/navConfig.js';
import { formatDateTime, str } from '../lib/format.js';
import { getClientRecord, type ListRow } from '../services/api.js';

export default function ClientRecord() {
  const { id = '' } = useParams();
  const { role, getToken } = useOutletContext<ShellOutletContext>();
  const record = useRecord<ListRow>(getToken, (token) => getClientRecord(id, token), `client:${id}`);
  const row = record.data;

  if (!row) return <RecordFrame title="Client" backTo="/clients" backLabel="Clients"><LoadState loading={record.loading} error={record.error} /></RecordFrame>;

  const ref = encodeURIComponent(str(row.externalRef));
  return (
    <RecordFrame title={str(row.displayName) || 'Client'} subtitle={str(row.externalRef)} backTo="/clients" backLabel="Clients">
      <div className="rec-grid">
        <Card title="Profile">
          <Facts items={[['Name', str(row.displayName)], ['Reference', str(row.externalRef)], ['Branch', str(row.branchId).slice(0, 8)], ['Added', formatDateTime(row.createdAt)]]} />
        </Card>
        <Card title="Related">
          <p className="note">Find this client's records by reference:</p>
          <ul className="rec-links">
            {canAccess(role, '/applications') && <li><Link to={`/applications?q=${ref}`}>Applications</Link></li>}
            {canAccess(role, '/loans') && <li><Link to={`/loans?q=${ref}`}>Loans</Link></li>}
          </ul>
        </Card>
        {canViewAudit(role) && <AuditPanel entityId={id} getToken={getToken} />}
      </div>
    </RecordFrame>
  );
}
