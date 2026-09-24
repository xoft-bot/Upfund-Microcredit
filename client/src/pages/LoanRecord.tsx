import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { StatusPill } from '../components/lists/QueueList.js';
import { AuditPanel } from '../components/records/AuditPanel.js';
import { LoanActions } from '../components/records/LoanActions.js';
import { Card, Facts, LoadState, RecordFrame, useRecord } from '../components/records/RecordFrame.js';
import { canAccess, canViewAudit } from '../config/navConfig.js';
import { formatAmount, formatDate, formatDateTime, formatUgx, str } from '../lib/format.js';
import { getLoanRecord, type ListRow } from '../services/api.js';

const asRows = (value: unknown): ListRow[] => (Array.isArray(value) ? (value as ListRow[]) : []);
const Pair = ({ paid, due }: { paid: unknown; due: unknown }) => <>{formatAmount(paid)} <small>of {formatAmount(due)}</small></>;

export default function LoanRecord() {
  const { id = '' } = useParams();
  const { role, getToken } = useOutletContext<ShellOutletContext>();
  const [version, setVersion] = useState(0);
  const record = useRecord<ListRow>(getToken, (token) => getLoanRecord(id, token), `loan:${id}`, version);
  const row = record.data;

  if (!row) return <RecordFrame title="Loan" backTo="/loans" backLabel="Loans"><LoadState loading={record.loading} error={record.error} /></RecordFrame>;

  const schedule = asRows(row.schedule);
  const payments = asRows(row.payments);
  const clientLink = canAccess(role, '/clients') && str(row.clientId) ? <Link to={`/clients/${encodeURIComponent(str(row.clientId))}`}>{str(row.clientName) || str(row.clientId)}</Link> : (str(row.clientName) || '–');
  const applicationLink = canAccess(role, '/applications') && str(row.applicationId) ? <Link to={`/applications/record/${encodeURIComponent(str(row.applicationId))}`}>Open application</Link> : '';

  return (
    <RecordFrame title={`${str(row.clientName) || 'Loan'}: ${formatUgx(row.outstandingPrincipal)} outstanding`} subtitle={`Principal ${formatUgx(row.principalAmount)}`} status={row.status} backTo="/loans" backLabel="Loans">
      <div className="rec-grid">
        <Card title="Loan">
          <Facts items={[
            ['Client', clientLink],
            ['Client reference', str(row.clientExternalRef)],
            ['Principal', formatUgx(row.principalAmount)],
            ['Outstanding principal', formatUgx(row.outstandingPrincipal)],
            ['Branch', str(row.branchId).slice(0, 8)],
            ['Created', formatDateTime(row.createdAt)],
            ['Application', applicationLink],
          ]} />
        </Card>

        <LoanActions id={id} role={role} status={str(row.status)} getToken={getToken} onDone={() => setVersion((current) => current + 1)} />

        <Card title={`Repayment schedule (${schedule.length})`} wide>
          {schedule.length === 0 ? <p className="note">No schedule yet. It is generated at disbursement.</p> : (
            <div className="ql-scroll"><table className="ql-table">
              <thead><tr><th scope="col">Due</th><th scope="col" className="num">Principal</th><th scope="col" className="num">Interest</th><th scope="col" className="num">Penalty</th><th scope="col" className="num">Charges</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {schedule.map((item) => (
                  <tr key={str(item.id)}>
                    <td data-label="Due">{formatDate(item.dueOn)}</td>
                    <td data-label="Principal" className="num"><Pair paid={item.principalPaid} due={item.principalDue} /></td>
                    <td data-label="Interest" className="num"><Pair paid={item.interestPaid} due={item.interestDue} /></td>
                    <td data-label="Penalty" className="num"><Pair paid={item.penaltyPaid} due={item.penaltyDue} /></td>
                    <td data-label="Charges" className="num"><Pair paid={item.chargePaid} due={item.chargeDue} /></td>
                    <td data-label="Status"><StatusPill status={item.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="note">Amounts show paid of due, in UGX.</p>
        </Card>

        <Card title={`Payments (${payments.length})`} wide>
          {payments.length === 0 ? <p className="note">No payments recorded.</p> : (
            <div className="ql-scroll"><table className="ql-table">
              <thead><tr><th scope="col">Receipt</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Recorded</th></tr></thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={str(payment.id)}>
                    <td data-label="Receipt">{str(payment.receiptReference) || '–'}</td>
                    <td data-label="Amount" className="num">{formatUgx(payment.amount)}</td>
                    <td data-label="Status"><StatusPill status={payment.status} /></td>
                    <td data-label="Recorded">{formatDateTime(payment.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>

        {canViewAudit(role) && <AuditPanel entityId={id} getToken={getToken} version={version} />}
      </div>
    </RecordFrame>
  );
}
