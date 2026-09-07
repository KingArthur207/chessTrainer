// React hook: is the shared engine usable, and what is it called?
import { useEffect, useState } from 'react';
import { getEngineSession } from './session';

export type EngineStatus =
  | { state: 'starting' }
  | { state: 'ready'; name: string }
  | { state: 'missing'; message: string };

export function useEngineStatus(): EngineStatus {
  const [status, setStatus] = useState<EngineStatus>(() => {
    const s = getEngineSession();
    return s.ready && s.name ? { state: 'ready', name: s.name } : { state: 'starting' };
  });
  useEffect(() => {
    let mounted = true;
    getEngineSession()
      .init()
      .then((engine) => mounted && setStatus({ state: 'ready', name: engine.name }))
      .catch((err: unknown) => mounted && setStatus({ state: 'missing', message: err instanceof Error ? err.message : String(err) }));
    return () => {
      mounted = false;
    };
  }, []);
  return status;
}
