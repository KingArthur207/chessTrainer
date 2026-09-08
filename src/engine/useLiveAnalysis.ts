// Keep the engine analysing whatever position is shown. Changing the
// position (or MultiPV) stops the running search and starts a new one;
// disabling stops it.
import { useEffect, useRef, useState } from 'react';
import { getEngineSession, type Evaluation } from './session';

export function useLiveAnalysis(fen: string, options: { multiPv: number; enabled: boolean }): Evaluation | null {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const tokenRef = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    const session = getEngineSession();
    if (tokenRef.current) tokenRef.current.cancelled = true;
    session.stop();
    setEvaluation(null);
    if (!options.enabled) return;
    const token = { cancelled: false };
    tokenRef.current = token;
    session
      .analyse(fen, {
        infinite: true,
        multiPv: options.multiPv,
        token,
        onProgress: (partial) => {
          if (!token.cancelled) setEvaluation(partial);
        },
      })
      .then((final) => {
        if (!token.cancelled && final.lines.length > 0) setEvaluation(final);
      })
      .catch(() => undefined);
    return () => {
      token.cancelled = true;
      session.stop();
    };
  }, [fen, options.multiPv, options.enabled]);

  return evaluation;
}
