import { useState } from 'react';
import { ApiRequestError } from '../../services/api.js';

export function actionErrorText(error: unknown): string {
  if (error instanceof ApiRequestError) return `${error.message} (${error.code})`;
  return 'The action could not be completed. Check your connection and try again.';
}

/** One in-flight action at a time. On success the caller refetches the record. */
export function useAction(getToken: () => Promise<string>, onSuccess: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (operation: (token: string) => Promise<unknown>, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setError(''); setNotice('');
    try {
      await operation(await getToken());
      setNotice(success);
      onSuccess();
      return true;
    } catch (caught) {
      setError(actionErrorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, notice, run };
}
