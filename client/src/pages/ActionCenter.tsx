import { Link, useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from '../components/shell/AppShell.js';
import { HOME_TITLE, cardsFor, countFor } from '../config/navConfig.js';

export default function ActionCenter() {
  const { role, counts, error, loading, refresh, countsEnabled } = useOutletContext<ShellOutletContext>();
  const cards = cardsFor(role);

  return (
    <section className="action-center">
      <div className="page-head">
        <h1>{HOME_TITLE[role]}</h1>
        {countsEnabled && <button className="text-button" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      </div>

      {!countsEnabled && (
        <p className="empty-state">Your role sees product reach only. Open <Link to="/reports">Reports</Link> for the figures.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {cards.length > 0 && (
        <ul className="ac-grid">
          {cards.map((card) => {
            const value = countFor(counts, card.ref);
            return (
              <li key={card.id}>
                <Link className={`ac-card${value ? ' has-work' : ''}`} to={card.path}>
                  <span className="ac-count" aria-label={value === undefined ? 'Count unavailable' : `${value}`}>{value ?? (loading ? '…' : '–')}</span>
                  <span className="ac-label">{card.label}</span>
                  <span className="ac-hint">{card.hint}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {cards.length > 0 && !loading && !error && counts && cards.every((card) => countFor(counts, card.ref) === 0) && (
        <p className="empty-state">Nothing is waiting on you right now.</p>
      )}
    </section>
  );
}
