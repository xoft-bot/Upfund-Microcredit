import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError } from '../../services/api.js';
import { StatusPill } from '../lists/QueueList.js';

export function recordErrorText(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 404 || /NOT_FOUND$/.test(error.code)) return 'This record was not found, or it is outside your access.';
    if (error.code === 'FORBIDDEN' || error.status === 403) return 'Your role cannot view this record.';
    return `${error.message} (${error.code})`;
  }
  return 'Could not load this record. Check your connection and try again.';
}

export interface RecordState<T> { data: T | null; error: string; loading: boolean }

/**
 * Loads one record. Stale responses are dropped. Changing `key` (a different record) resets to loading;
 * bumping `version` (after an action) refetches silently and keeps the current data on screen.
 */
export function useRecord<T>(getToken: () => Promise<string>, load: (token: string) => Promise<T>, key: string, version = 0): RecordState<T> {
  const [state, setState] = useState<RecordState<T>>({ data: null, error: '', loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const lastKey = useRef(key);
  useEffect(() => {
    let active = true;
    const sameRecord = lastKey.current === key;
    lastKey.current = key;
    setState((previous) => (sameRecord && previous.data ? { ...previous, error: '' } : { data: null, error: '', loading: true }));
    void (async () => {
      try {
        const data = await loadRef.current(await getToken());
        if (active) setState({ data, error: '', loading: false });
      } catch (caught) {
        if (active) setState((previous) => ({ data: sameRecord ? previous.data : null, error: recordErrorText(caught), loading: false }));
      }
    })();
    return () => { active = false; };
  }, [key, version, getToken]);
  return state;
}

interface FrameProps { title: string; subtitle?: string; status?: unknown; backTo: string; backLabel: string; children: ReactNode }

export function RecordFrame({ title, subtitle, status, backTo, backLabel, children }: FrameProps) {
  return (
    <section className="rec">
      <Link className="rec-back" to={backTo}>← {backLabel}</Link>
      <div className="rec-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="rec-sub">{subtitle}</p>}
        </div>
        {status !== undefined && <StatusPill status={status} />}
      </div>
      {children}
    </section>
  );
}

export function LoadState({ loading, error }: { loading: boolean; error: string }) {
  if (loading) return <p className="empty-state" role="status">Loading…</p>;
  if (error) return <p className="form-error" role="alert">{error}</p>;
  return null;
}

export function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return <section className={`rec-card${wide ? ' is-wide' : ''}`}><h2>{title}</h2>{children}</section>;
}

export function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="rec-facts">
      {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === '' || value === null || value === undefined ? '–' : value}</dd></div>)}
    </dl>
  );
}
