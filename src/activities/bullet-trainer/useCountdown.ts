import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A drift-free countdown driven by performance.now(). `onExpire` is read
 * through a ref so callers can pass a fresh closure on every render.
 */
export function useCountdown(onExpire: () => void) {
  const [remainingMs, setRemainingMs] = useState(0);
  const [running, setRunning] = useState(false);
  const endAtRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const clear = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const start = useCallback(
    (durationMs: number) => {
      clear();
      endAtRef.current = performance.now() + durationMs;
      setRemainingMs(durationMs);
      setRunning(true);
      intervalRef.current = window.setInterval(() => {
        const left = endAtRef.current - performance.now();
        if (left <= 0) {
          clear();
          setRemainingMs(0);
          setRunning(false);
          onExpireRef.current();
        } else {
          setRemainingMs(left);
        }
      }, 50);
    },
    [clear],
  );

  const stop = useCallback(() => {
    clear();
    setRunning(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { remainingMs, running, start, stop };
}
