// Shared mutation runner: toast on success and failure, optional follow-up.
import { useCallback, useRef, useState } from 'react';
import { showToast } from '../state/toast';

export interface SaveOptions<T> {
  action: () => Promise<T>;
  successMsg: string | ((result: T) => string);
  onDone?: (result: T) => void;
}

export function useSaveAction() {
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const run = useCallback(async <T,>(opts: SaveOptions<T>): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setSaving(true);
    try {
      const result = await opts.action();
      showToast(typeof opts.successMsg === 'function' ? opts.successMsg(result) : opts.successMsg, 'success');
      opts.onDone?.(result);
      return result;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Something went wrong.', 'danger');
      return undefined;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, []);
  return { run, saving };
}
