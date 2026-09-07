// Evaluation trainer: assess a position on a seven-step scale, then compare
// with Stockfish's verdict, best move and line.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Gauge, Play, RotateCcw, Settings2, Trophy } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { EngineStatus } from '@/components/EngineStatus';
import { getSnapshot, isOnline, refreshPool, subscribe } from '@/activities/board-memory/lichessPool';
import { LichessPoolPanel } from '@/activities/board-memory/LichessPoolPanel';
import { loadOpenings } from '@/activities/opening-trainer/store';
import { inCheck, numberedLine, turnOf, uciLineToSan } from '@/chess/position';
import { formatScore, getEngineSession, whiteShare, type Evaluation } from '@/engine/session';
import { useEngineStatus } from '@/engine/useEngineStatus';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import { CATEGORIES, categoryOf, distance, EVAL_SOURCES, lichessUsableCount, openingsAvailable, pickEvalPosition, verdict, type EvalPosition, type EvalSource } from './assessment';
import { getHistory, recordAttempt, summarise, type EvalAttempt } from './stats';
import './evaluation.css';

type Phase = 'setup' | 'quiz' | 'reveal';

const TIMES: Array<{ seconds: number; label: string }> = [
  { seconds: 1, label: 'Fast · 1s' },
  { seconds: 3, label: 'Normal · 3s' },
  { seconds: 6, label: 'Deep · 6s' },
];
const EMPTY_BOARD = '8/8/8/8/8/8/8/8';
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function EvaluationTrainer() {
  const [source, setSource] = useState<EvalSource>(() => loadJson<EvalSource>('evaluation:source', 'lichess'));
  const [seconds, setSeconds] = useState<number>(() => loadJson<number>('evaluation:seconds', 3));
  const [phase, setPhase] = useState<Phase>('setup');
  const [position, setPosition] = useState<EvalPosition | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [guess, setGuess] = useState<number | null>(null);
  const [history, setHistory] = useState<EvalAttempt[]>(() => getHistory());
  const [session, setSession] = useState({ exact: 0, close: 0, total: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useEngineStatus();
  const requestRef = useRef(0);
  const guessRef = useRef<number | null>(null);
  const evalRef = useRef<Evaluation | null>(null);
  const positionRef = useRef<EvalPosition | null>(null);

  const openings = useMemo(() => loadOpenings(), []);
  const lichess = useSyncExternalStore(subscribe, getSnapshot);
  const lichessUsable = lichessUsableCount();
  const sourceOk = useMemo(
    () => ({ lichess: true, games: true, openings: openingsAvailable(openings) }),
    [openings],
  );
  const pendingStartRef = useRef(false);

  useEffect(() => saveJson('evaluation:source', source), [source]);
  useEffect(() => saveJson('evaluation:seconds', seconds), [seconds]);
  useEffect(() => {
    if (source === 'lichess' && lichess.summary.total === 0 && lichess.status.state === 'idle') void refreshPool();
  }, [source, lichess.summary.total, lichess.status.state]);

  const reveal = useCallback(
    (g: number, ev: Evaluation) => {
      const pos = positionRef.current;
      if (!pos) return;
      const actual = categoryOf(ev.cp, ev.mate);
      const d = distance(g, actual);
      setHistory(recordAttempt({ date: new Date().toISOString(), source: pos.source, seconds, guess: g, actual, cp: ev.cp, mate: ev.mate }));
      setSession((s) => ({ exact: s.exact + (d === 0 ? 1 : 0), close: s.close + (d <= 1 ? 1 : 0), total: s.total + 1 }));
      setPhase('reveal');
      if (d === 0) sounds.finish();
      else if (d === 1) sounds.success();
      else sounds.miss();
    },
    [seconds],
  );

  const start = useCallback(() => {
    if (engine.state !== 'ready') return;
    const pos = pickEvalPosition(source, openings, position?.fen);
    if (!pos) {
      if (source === 'lichess') {
        const st = getSnapshot().status;
        if (st.state === 'fetching') {
          pendingStartRef.current = true;
          setNotice('Fetching games from Lichess. The first position will appear as soon as they arrive.');
        } else if (!isOnline()) {
          setNotice('You are offline and no Lichess positions are saved. Connect to fetch games, or pick another source.');
        } else {
          pendingStartRef.current = true;
          setNotice('No Lichess positions saved yet. Fetching games…');
          void refreshPool(true);
        }
      } else {
        setNotice('No positions available from that source yet.');
      }
      return;
    }
    getEngineSession().stop();
    const id = ++requestRef.current;
    setNotice(null);
    positionRef.current = pos;
    setPosition(pos);
    setEvaluation(null);
    evalRef.current = null;
    setGuess(null);
    guessRef.current = null;
    setPhase('quiz');
    getEngineSession()
      .analyse(pos.fen, {
        moveTimeMs: seconds * 1000,
        multiPv: 1,
        onProgress: (partial) => {
          if (id !== requestRef.current) return;
          evalRef.current = partial;
          setEvaluation(partial);
        },
      })
      .then((final) => {
        if (id !== requestRef.current) return;
        evalRef.current = final;
        setEvaluation(final);
        if (guessRef.current !== null) reveal(guessRef.current, final);
      })
      .catch((err: unknown) => {
        if (id !== requestRef.current) return;
        setNotice(err instanceof Error ? err.message : String(err));
        setPhase('setup');
      });
  }, [engine.state, source, openings, position, seconds, reveal]);

  // A fetch started because the pool was empty: begin as soon as it lands.
  useEffect(() => {
    if (!pendingStartRef.current || lichess.status.state === 'fetching') return;
    pendingStartRef.current = false;
    if (lichess.status.state === 'idle' && lichessUsableCount() > 0) start();
    else if (lichess.status.state === 'error') setNotice(lichess.status.message);
  }, [lichess.status, start]);

  const choose = useCallback(
    (category: number) => {
      if (phase !== 'quiz' || guessRef.current !== null) return;
      guessRef.current = category;
      setGuess(category);
      const ev = evalRef.current;
      if (ev?.final) reveal(category, ev);
    },
    [phase, reveal],
  );

  const backToSetup = useCallback(() => {
    requestRef.current++;
    getEngineSession().stop();
    setPhase('setup');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (phase === 'setup' || phase === 'reveal') start();
        else return;
      } else if (e.key === 'Escape') {
        if (phase === 'setup') return;
        backToSetup();
      } else if (phase === 'quiz' && /^[1-7]$/.test(e.key)) {
        choose(Number(e.key) - 1);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, backToSetup, choose]);

  const summary = useMemo(() => summarise(history), [history]);
  const actual = evaluation && phase === 'reveal' ? categoryOf(evaluation.cp, evaluation.mate) : null;
  const d = guess !== null && actual !== null ? distance(guess, actual) : null;
  const fen = position?.fen ?? EMPTY_BOARD;
  const turn = position ? turnOf(position.fen) : 'white';
  const bestLine = useMemo(() => {
    if (phase !== 'reveal' || !evaluation || !position || evaluation.lines.length === 0) return '';
    return numberedLine(position.fen, uciLineToSan(position.fen, evaluation.lines[0].pv.slice(0, 8)));
  }, [phase, evaluation, position]);
  const shapes = useMemo<DrawShape[]>(() => {
    if (phase !== 'reveal' || !evaluation?.bestMove) return [];
    return [{ orig: evaluation.bestMove.slice(0, 2) as Key, dest: evaluation.bestMove.slice(2, 4) as Key, brush: 'green' }];
  }, [phase, evaluation]);
  const waitingForEngine = phase === 'quiz' && guess !== null && !evaluation?.final;
  const sourceInfo = EVAL_SOURCES.find((s) => s.id === source)!;

  return (
    <div className="ev" data-phase={phase} data-fen={position?.fen ?? ''}>
      <div className="ev__board">
        <Board fen={fen} interactive={false} turnColor={turn} check={position ? inCheck(position.fen) : false} shapes={shapes} />
      </div>

      <aside className="ev__panel">
        {phase === 'setup' && (
          <>
            <h2 className="ev__heading">
              <Gauge size={22} /> Evaluation Trainer
            </h2>
            <p className="ev__lede">
              Who stands better, and by how much? Assess the position on a seven-step scale, then see Stockfish's score,
              best move and main line. Assessment is a skill most players never train on purpose.
            </p>
            <EngineStatus status={engine} />
            <div className="ev__section">
              <div className="ev__label">Positions from</div>
              <div className="ev__chips ev__sources" role="radiogroup" aria-label="Source">
                {EVAL_SOURCES.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={s.id === source}
                    className={`chip ${s.id === source ? 'is-active' : ''}`}
                    disabled={!sourceOk[s.id]}
                    title={!sourceOk[s.id] ? 'Add repertoire lines of at least 6 plies first' : undefined}
                    onClick={() => setSource(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="ev__blurb">{sourceInfo.blurb}</div>
              {source === 'lichess' && <LichessPoolPanel detail={`${lichessUsable.toLocaleString()} positions usable for evaluation`} />}
            </div>
            <div className="ev__section">
              <div className="ev__label">Engine thinking time</div>
              <div className="ev__chips ev__times" role="radiogroup" aria-label="Analysis time">
                {TIMES.map((t) => (
                  <button key={t.seconds} role="radio" aria-checked={t.seconds === seconds} className={`chip ${t.seconds === seconds ? 'is-active' : ''}`} onClick={() => setSeconds(t.seconds)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ev__stats-line">
              <Trophy size={18} />
              <span>{summary.attempts === 0 ? 'No positions yet' : `${summary.attempts} positions · exact ${pct(summary.exact)} · within one`}</span>
              {summary.attempts > 0 && <strong>{pct(summary.close)}</strong>}
            </div>
            {notice && <div className="ev__notice">{notice}</div>}
            <div className="ev__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} disabled={engine.state !== 'ready' || !sourceOk[source]} autoFocus>
              <Play size={18} /> Start
            </button>
            <div className="ev__hint">Space starts · keys 1–7 answer</div>
          </>
        )}

        {phase !== 'setup' && position && (
          <>
            <div className="ev__source">{position.label}</div>
            <span className="ev__turn">
              <i style={{ background: turn === 'white' ? '#f0f0f0' : '#1d1d1d' }} /> {turn === 'white' ? 'White' : 'Black'} to move
            </span>
            {phase === 'quiz' && (
              <div className="ev__analysing" aria-live="polite">
                <i /> {evaluation?.final ? 'Engine ready' : `Engine analysing… depth ${evaluation?.depth ?? 0}`}
                {waitingForEngine ? ' · finishing before the reveal' : ''}
              </div>
            )}
            <div className="ev__label">{phase === 'quiz' ? 'Your assessment' : 'Assessment'}</div>
            <div className="ev__scale" role="radiogroup" aria-label="Assessment">
              {CATEGORIES.map((c) => {
                const cls = [
                  guess === c.id ? 'is-guess' : '',
                  actual === c.id ? 'is-engine' : '',
                  phase === 'reveal' && guess === c.id && actual !== c.id ? 'is-wrong' : '',
                ].join(' ');
                return (
                  <button key={c.id} className={cls} disabled={phase !== 'quiz' || guess !== null} onClick={() => choose(c.id)} aria-pressed={guess === c.id}>
                    <span className="sym">{c.symbol}</span>
                    {c.label}
                    <span className="key">{c.id + 1}</span>
                  </button>
                );
              })}
            </div>
            {phase === 'reveal' && evaluation && d !== null && (
              <div className={`ev__reveal ${d === 0 ? 'is-exact' : d === 1 ? 'is-close' : 'is-off'}`}>
                <div className="ev__reveal-top">
                  <div className="ev__score">{formatScore(evaluation)}</div>
                  <div className="ev__verdict">
                    {verdict(d)}
                    <small>
                      Stockfish: {CATEGORIES[actual!].label} · depth {evaluation.depth}
                    </small>
                  </div>
                </div>
                <div className="ev__bar" title="White's share">
                  <div style={{ width: `${whiteShare(evaluation) * 100}%` }} />
                </div>
                {bestLine && (
                  <div className="ev__line">
                    <span>Best line</span>
                    {bestLine}
                  </div>
                )}
              </div>
            )}
            <div className="ev__stats-line">
              <Trophy size={18} />
              <span>Session · {session.total} {session.total === 1 ? 'position' : 'positions'}</span>
              <strong>{session.total ? `${session.exact} exact · ${session.close} close` : '–'}</strong>
            </div>
            <div className="ev__spacer" />
            {phase === 'reveal' ? (
              <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
                <RotateCcw size={18} /> Next position
              </button>
            ) : (
              <div className="ev__hint">Pick the assessment you believe in; the engine's verdict appears after you answer.</div>
            )}
            <button className="btn btn--ghost" onClick={backToSetup}>
              <Settings2 size={14} /> Settings
            </button>
            <div className="ev__hint">Space for the next one · Esc for settings</div>
          </>
        )}
      </aside>
    </div>
  );
}
