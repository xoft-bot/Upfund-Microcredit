import { useCallback, useEffect, useState } from 'react';
import {
  getAssignmentWorkspace, createCollectorAssignment, endCollectorAssignment,
  ApiRequestError, type AssignmentWorkspace, type AssignmentRow,
} from '../../services/api.js';

interface AssignmentManagerProps {
  branchId: string | null;
  getToken: () => Promise<string>;
  apiBaseUrl?: string;
}

const EMPTY_WORKSPACE: AssignmentWorkspace = { assignments: [], unassignedClients: [], collectors: [] };

/**
 * Manager/admin Collections screen. Replaces the `Placeholder phase={4}`
 * that previously rendered for every non-collector role on this route —
 * see the routing note in routes.tsx. This is the first UI on top of the
 * collector-assignments write endpoints (server/src/routes/collectorAssignments.ts):
 * before this, the only way to put a client on a collector's route was a
 * direct SQL insert.
 */
export function AssignmentManager({ branchId, getToken, apiBaseUrl = '' }: AssignmentManagerProps) {
  const [workspace, setWorkspace] = useState<AssignmentWorkspace>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assigningClientId, setAssigningClientId] = useState<string | null>(null);
  const [officerId, setOfficerId] = useState('');
  const [routeCode, setRouteCode] = useState('');
  const [formError, setFormError] = useState('');

  const reload = useCallback(async () => {
    if (!branchId) { setWorkspace(EMPTY_WORKSPACE); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const next = await getAssignmentWorkspace(token, { branchId, apiBaseUrl });
      setWorkspace(next);
    } catch (loadError) {
      setError(loadError instanceof ApiRequestError ? loadError.message : 'Could not load assignments. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [branchId, getToken, apiBaseUrl]);

  useEffect(() => { void reload(); }, [reload]);

  const startAssign = (clientId: string) => {
    setAssigningClientId(clientId);
    setOfficerId(workspace.collectors[0]?.officerId ?? '');
    setRouteCode('');
    setFormError('');
  };

  const submitAssign = async () => {
    if (!assigningClientId || !branchId) return;
    if (!officerId) { setFormError('Choose a collector.'); return; }
    if (!routeCode.trim()) { setFormError('Enter a route code.'); return; }
    setBusyId(assigningClientId);
    setFormError('');
    try {
      const token = await getToken();
      await createCollectorAssignment({ branchId, officerId, clientId: assigningClientId, routeCode: routeCode.trim() }, token, apiBaseUrl);
      setAssigningClientId(null);
      await reload();
    } catch (assignError) {
      setFormError(assignError instanceof ApiRequestError ? assignError.message : 'Could not create this assignment.');
    } finally {
      setBusyId(null);
    }
  };

  const unassign = async (assignment: AssignmentRow) => {
    if (!window.confirm(`Unassign ${assignment.officerName} from ${assignment.clientName}?`)) return;
    setBusyId(assignment.id);
    setError('');
    try {
      const token = await getToken();
      await endCollectorAssignment(assignment.id, token, { apiBaseUrl });
      await reload();
    } catch (unassignError) {
      setError(unassignError instanceof ApiRequestError ? unassignError.message : 'Could not unassign this collector.');
    } finally {
      setBusyId(null);
    }
  };

  if (!branchId) return <section className="field-card manager-dashboard"><p className="empty-state">No branch is assigned to this account, so collections cannot be managed here.</p></section>;

  return (
    <section className="field-card manager-dashboard" aria-labelledby="assignment-manager-title">
      <p className="eyebrow">Collections</p>
      <h2 id="assignment-manager-title">Collector assignments</h2>
      <p className="note">Branch {branchId}. Assign a collector or officer to a client before field collection can begin for them.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading ? <p className="empty-state" role="status">Loading assignments…</p> : <>
        <h3>Unassigned clients ({workspace.unassignedClients.length})</h3>
        {workspace.unassignedClients.length === 0 ? <p className="empty-state">Every client in this branch currently has an active collector.</p> : <div className="variance-list">
          {workspace.unassignedClients.map((client) => <div className="variance-row" key={client.clientId} style={{ cursor: 'default' }}>
            <span><strong>{client.clientName}</strong></span>
            {assigningClientId === client.clientId ? null : <button className="secondary-button" type="button" disabled={busyId === client.clientId || workspace.collectors.length === 0} onClick={() => startAssign(client.clientId)}>Assign</button>}
          </div>)}
        </div>}

        {assigningClientId && <div className="variance-detail" aria-live="polite">
          <div className="field-card-heading"><h3>Assign a collector</h3><button className="text-button" type="button" onClick={() => setAssigningClientId(null)}>Close</button></div>
          {workspace.collectors.length === 0 ? <p className="empty-state">No active collector or officer is registered in this branch yet.</p> : <>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <label>Collector<select value={officerId} onChange={(event) => setOfficerId(event.target.value)}>
              {workspace.collectors.map((collector) => <option key={collector.officerId} value={collector.officerId}>{collector.officerName} ({collector.role})</option>)}
            </select></label>
            <label>Route code<input type="text" value={routeCode} onChange={(event) => setRouteCode(event.target.value)} maxLength={80} placeholder="e.g. NORTH-04" /></label>
            <div className="action-row">
              <button className="primary-button" type="button" disabled={busyId === assigningClientId} onClick={() => void submitAssign()}>Confirm assignment</button>
            </div>
          </>}
        </div>}

        <h3>Active assignments ({workspace.assignments.length})</h3>
        {workspace.assignments.length === 0 ? <p className="empty-state">No collector is currently assigned in this branch.</p> : <div className="variance-list">
          {workspace.assignments.map((assignment) => <div className="variance-row" key={assignment.id} style={{ cursor: 'default' }}>
            <span><strong>{assignment.clientName}</strong><small>{assignment.officerName} · route {assignment.routeCode} · since {assignment.effectiveFrom}</small></span>
            <button className="text-button" type="button" disabled={busyId === assignment.id} onClick={() => void unassign(assignment)}>Unassign</button>
          </div>)}
        </div>}
      </>}
    </section>
  );
}
