import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, getQueueCounts, type QueueCounts } from '../services/api.js';

export interface QueueCountsState {
  counts: QueueCounts | null;
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
}

/** One call to GET /api/v1/queues/counts drives both nav badges and the Action Center. Rows are never counted client-side. */
export function useQueueCounts(getToken: () => Promise<string>, enabled: boolean, refreshMs = 60_000): QueueCountsState {
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await getQueueCounts(await tokenRef.current());
      setCounts(data);
      setError('');
    } catch (caught) {
      setError(caught instanceof ApiRequestError && caught.code === 'FORBIDDEN'
        ? 'Your role has no queue counts.'
        : 'Could not load queue counts. Pull to retry.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    void refresh();
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visible, refreshMs);
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [enabled, refresh, refreshMs]);

  return { counts, error, loading, refresh };
}
