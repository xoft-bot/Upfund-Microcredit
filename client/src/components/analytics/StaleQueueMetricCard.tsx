interface StaleQueueMetricCardProps {
  staleCount: number;
  totalPendingQueueCount?: number;
  isLoading?: boolean;
  error?: string;
  onNavigateToQueue: () => void;
}

export function StaleQueueMetricCard({
  staleCount,
  totalPendingQueueCount = 0,
  isLoading = false,
  error = '',
  onNavigateToQueue,
}: StaleQueueMetricCardProps) {
  if (isLoading) {
    return <div className="stale-queue-card stale-queue-card-loading" aria-label="Loading offline queue status" />;
  }

  if (error) {
    return (
      <article className="stale-queue-card" aria-labelledby="stale-queue-title">
        <div className="stale-queue-heading">
          <div>
            <p className="eyebrow">Offline queue</p>
            <h3 id="stale-queue-title">Status unavailable</h3>
          </div>
          <span className="stale-queue-icon is-stale" aria-hidden="true">!</span>
        </div>
        <p className="stale-queue-message is-stale" role="status">Queue counts could not be loaded. Retry from the shell before treating this as clear.</p>
        <button className="stale-queue-action" type="button" onClick={onNavigateToQueue}>
          Inspect offline queue
          <span aria-hidden="true">→</span>
        </button>
      </article>
    );
  }

  const hasStaleItems = staleCount > 0;
  return (
    <article className={`stale-queue-card${hasStaleItems ? ' is-stale' : ''}`} aria-labelledby="stale-queue-title">
      <div className="stale-queue-heading">
        <div>
          <p className="eyebrow">Offline queue</p>
          <h3 id="stale-queue-title">Stale sync records</h3>
        </div>
        <span className={`stale-queue-icon${hasStaleItems ? ' is-stale' : ''}`} aria-hidden="true">{hasStaleItems ? '!' : '✓'}</span>
      </div>
      <div className="stale-queue-metric">
        <strong>{staleCount}</strong>
        <span>{staleCount === 1 ? 'record' : 'records'} over 7 days</span>
      </div>
      <p className={hasStaleItems ? 'stale-queue-message is-stale' : 'stale-queue-message'}>
        {hasStaleItems ? 'Requires field officer sync before the audit cutoff.' : 'All pending queue records are within the 7-day threshold.'}
      </p>
      <button className="stale-queue-action" type="button" onClick={onNavigateToQueue}>
        Inspect offline queue{totalPendingQueueCount > 0 ? ` (${totalPendingQueueCount})` : ''}
        <span aria-hidden="true">→</span>
      </button>
    </article>
  );
}