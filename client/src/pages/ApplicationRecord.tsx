import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { ApplicationActions } from '../components/records/ApplicationActions.js';
import { AuditPanel } from '../components/records/AuditPanel.js';
import { Card, Facts, LoadState, RecordFrame, useRecord } from '../components/records/RecordFrame.js';
import { canAccess, canViewAudit } from '../config/navConfig.js';
import { formatDateTime, formatUgx, humanize, str } from '../lib/format.js';
import { getApplicationTimeline, getLoanApplicationRecord, type ApplicationTimelineEntry, type ListRow } from '../services/api.js';

export default function ApplicationRecord() {
  const { id = '' } = useParams();
  const { role, getToken, permissions } = useOutletContext<ShellOutletContext>();
  const [version, setVersion] = useState(0);
  const record = useRecord<ListRow>(getToken, (token) => getLoanApplicationRecord(id, token), `app:${id}`, version);
  const timeline = useRecord<ApplicationTimelineEntry[]>(getToken, (token) => getApplicationTimeline(id, token), `timeline:${id}`, version);
  const row = record.data;

  if (!row) return <RecordFrame title="Application" backTo="/applications" backLabel="Applications"><LoadState loading={record.loading} error={record.error} /></RecordFrame>;

  const clientLink = canAccess(role, '/clients') && str(row.clientId) ? <Link to={`/clients/${encodeURIComponent(str(row.clientId))}`}>{str(row.clientName) || str(row.clientId)}</Link> : (str(row.clientName) || '–');
  return (
    <RecordFrame title={`${str(row.clientName) || 'Application'}: ${formatUgx(row.requestedAmount)}`} subtitle={str(row.productName)} status={row.status} backTo="/applications" backLabel="Applications">
      <div className="rec-grid">
        <Card title="Application">
          <Facts items={[
            ['Client', clientLink],
            ['Client reference', str(row.clientExternalRef)],
            ['Product', str(row.productName)],
            ['Requested', formatUgx(row.requestedAmount)],
            ['Branch', str(row.branchId).slice(0, 8)],
            ['Created', formatDateTime(row.createdAt)],
            ['Submitted', row.submittedAt ? formatDateTime(row.submittedAt) : 'Not yet'],
          ]} />
        </Card>
        <Card title="KYC">
          {str(row.kycId) ? <Facts items={[['Status', humanize(row.kycStatus)], ['Method', str(row.verificationMethod) || str(row.kycVerificationMethod)], ['Evidence notes', str(row.kycEvidenceNotes)]]} /> : <p className="note">No KYC review recorded yet.</p>}
        </Card>
        <Card title="Risk assessment">
          {str(row.riskId) ? <Facts items={[['Outcome', humanize(row.riskStatus)], ['Grade', str(row.riskGrade)], ['Score', str(row.riskScore)], ['Policy version', str(row.riskPolicyVersion)], ['Rationale', str(row.riskRationale)]]} /> : <p className="note">No risk assessment recorded yet.</p>}
        </Card>
        <Card title="Timeline" wide>
          <LoadState loading={timeline.loading} error={timeline.error} />
          {timeline.data && timeline.data.length === 0 && <p className="note">No transitions recorded yet.</p>}
          {timeline.data && timeline.data.length > 0 && (
            <ul className="rec-timeline">
              {timeline.data.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.fromState ? `${humanize(entry.fromState)} → ${humanize(entry.toState)}` : humanize(entry.toState)}</strong>
                  <span>{formatDateTime(entry.createdAt)}</span>
                  {entry.reason && <small>{entry.reason}</small>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canViewAudit(role) && <AuditPanel entityId={id} getToken={getToken} version={version} />}
        <Card title="Actions" wide>
          <ApplicationActions id={id} status={str(row.status)} permissions={permissions} getToken={getToken} onDone={() => setVersion((current) => current + 1)} />
        </Card>
      </div>
    </RecordFrame>
  );
}
