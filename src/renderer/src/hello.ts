import { useEffect, useState } from 'react';
import { codedFrom } from '../../shared/errors';
import type { HelloStatus } from '../../shared/ipc';

/** A canceled Windows Hello prompt: the password form simply stays, without a message. */
export const isHelloCancel = (error: unknown): boolean => codedFrom(error, 'core.unknown').code === 'core.helloCanceled';

/** Both conditions for offering the Hello button. */
export const helloReady = (status: HelloStatus | null): boolean => status !== null && status.available && status.enrolled;

/** Windows Hello state of one vault path; null while loading, without a path or after a failed query. refresh() asks again and keeps the old value meanwhile. */
export function useHelloStatus(filePath: string | null | undefined): [HelloStatus | null, () => void] {
  const [state, setState] = useState<{ filePath: string; status: HelloStatus } | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!filePath) return;
    let current = true;
    void window.desktopApi.helloStatus(filePath).then(
      status => { if (current) setState({ filePath, status }); },
      () => { if (current) setState(null); });
    return () => { current = false; };
  }, [filePath, epoch]);
  return [filePath && state?.filePath === filePath ? state.status : null, () => setEpoch(value => value + 1)];
}
