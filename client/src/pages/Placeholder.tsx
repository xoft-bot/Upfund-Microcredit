import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { QUEUES, canAccess, queueLabel, type CountModule } from '../config/navConfig.js';

interface Props { title: string; module?: CountModule; phase?: number }

/** Honest placeholder: no fake data. Validates :queue against the server's queue names. */
export default function Placeholder({ title, module, phase = 3 }: Props) {
  const { queue, id } = useParams();
  const { role } = useOutletContext<ShellOutletContext>();
  if (module && queue && !QUEUES[module].some((entry) => entry.id === queue)) {
    return <Navigate to={`/${module}`} replace />;
  }
  const detail = module && queue ? queueLabel(module, queue) : id ? `Record ${id}` : undefined;
  const hasClassic = canAccess(role, '/workspace');
  return (
    <section className="placeholder">
      <div className="page-head"><h1>{title}{detail ? `: ${detail}` : ''}</h1></div>
      <p className="empty-state">
        This screen is coming in Phase {phase}.
        {hasClassic && <> Until then, use the <Link to="/workspace">classic view</Link>.</>}
        {role === 'client' && <> You can start a request from <Link to="/apply">Apply</Link>.</>}
      </p>
    </section>
  );
}
