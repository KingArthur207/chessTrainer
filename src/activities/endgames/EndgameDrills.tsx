// Endgame drills: play theoretical endgames against Stockfish at full
// strength; the engine checks after every move that the win (or draw) is
// still there; each endgame is scheduled with spaced repetition.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Crown, Flag, Lightbulb, Play, RotateCcw, Trophy, Undo2 } from 'lucide-react';
import { Board, type Key } from '@/board/Board';
import { EngineStatus } from '@/components/EngineStatus';
import { describeDue, isDue, type LineProgress } from '@/activities/opening-trainer/srs';
import { applyMove, gameOver, inCheck, legalDests, numberedLine, repetitionKey, turnOf } from '@/chess/position';
import { getEngineSession } from '@/engine/session';
import { useEngineStatus } from '@/engine/useEngineStatus';
import { sounds } from '@/lib/sound';
import { CATEGORIES, ENDGAMES, goalLabel, HOLD_MOVES, judge, mistakesFor, type Endgame, type Judgement } from './drill';
import { dueEndgames, loadProgress, loadStats, recordResult, type ProgressMap, type StatsMap } from './stats';
import './endgames.css';

type Phase = 'list' | 'play';
type Status = 'user' | 'verifying' | 'engine' | 'slipped' | 'done';

interface PlayedMove {
  san: string;
  uci: string;
  fenAfter: string;
  by: 'user' | 'engine';
}

interface Outcome {
  success: boolean;
  message: string;
  slips: number;
  gaveUp: boolean;
  next: LineProgress;
}

const ENGINE_MOVE_MS = 450;
const VERIFY_DEPTH = 18;

function pill(progress: LineProgress | undefined): { text: string; cls: string } {
  if (!progress || progress.reps === 0) return { text: 'New', cls: 'is-new' };
  if (isDue(progress)) return { text: 'Due', cls: 'is-due' };
  return { text: describeDue(progress), cls: 'is-ok' };
}

export default function EndgameDrills() {
  const [phase, setPhase] = useState<Phase>('list');
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [stats, setStats] = useState<StatsMap>(() => loadStats());
  const [endgame, setEndgame] = useState<Endgame | null>(null);
  const [fen, setFen] = useState('');
  const [moves, setMoves] = useState<PlayedMove[]>([]);
  const [status, setStatus] = useState<Status>('user');
  const [message, setMessage] = useState('');
  /** Last engine verdict on the position after your move; stays visible while the engine replies. */
  const [verdict, setVerdict] = useState('');
  const [slips, setSlips] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useEngineStatus();
  const stateRef = useRef({ fen: '', moves: [] as PlayedMove[], status: 'user' as Status, slips: 0, endgame: null as Endgame | null });
  const requestRef = useRef(0);
  stateRef.current = { fen, moves, status, slips, endgame };

  const due = useMemo(() => dueEndgames(progress), [progress]);

  const seenKeys = (startFen: string, list: PlayedMove[]) => [repetitionKey(startFen), ...list.map((m) => repetitionKey(m.fenAfter))];

  const finish = useCallback((e: Endgame, success: boolean, msg: string, slipCount: number, gaveUp: boolean) => {
    requestRef.current++;
    getEngineSession().stop();
    const r = recordResult(e.id, success, mistakesFor(slipCount, gaveUp));
    setProgress(r.progress);
    setStats(r.stats);
    setOutcome({ success, message: msg, slips: slipCount, gaveUp, next: r.next });
    setStatus('done');
    setMessage(msg);
    if (success) sounds.finish();
    else sounds.miss();
  }, []);

  const engineReply = useCallback(
    (e: Endgame, current: string, list: PlayedMove[]) => {
      const id = ++requestRef.current;
      setStatus('engine');
      setMessage('Stockfish replies…');
      getEngineSession()
        .playMove(current, { moveTimeMs: ENGINE_MOVE_MS })
        .then((uci) => {
          if (id !== requestRef.current || !uci) return;
          const applied = applyMove(current, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, (uci.slice(4, 5) || 'q') as 'q' | 'r' | 'b' | 'n');
          if (!applied) return;
          const next = [...list, { san: applied.san, uci: applied.uci, fenAfter: applied.fen, by: 'engine' as const }];
          setFen(applied.fen);
          setMoves(next);
          sounds.success();
          const over = gameOver(applied.fen, seenKeys(e.fen, next));
          if (over) {
            const j = judge(e, { fenAfter: applied.fen, cp: null, mate: null, over, userMoves: next.filter((m) => m.by === 'user').length, lastSan: applied.san });
            finish(e, j.verdict === 'success', j.message, stateRef.current.slips, false);
            return;
          }
          setStatus('user');
          setMessage('Your move.');
        })
        .catch((err: unknown) => {
          if (id === requestRef.current) setNotice(err instanceof Error ? err.message : String(err));
        });
    },
    [finish],
  );

  const start = useCallback(
    (e: Endgame) => {
      if (engine.state !== 'ready') return;
      requestRef.current++;
      getEngineSession().stop();
      setEndgame(e);
      setFen(e.fen);
      setMoves([]);
      setSlips(0);
      setVerdict('');
      setOutcome(null);
      setNotice(null);
      setShowHint(false);
      setPhase('play');
      if (turnOf(e.fen) === e.side) {
        setStatus('user');
        setMessage('Your move.');
      } else {
        window.setTimeout(() => engineReply(e, e.fen, []), 0);
      }
    },
    [engine.state, engineReply],
  );

  const onUserMove = useCallback(
    (orig: Key, dest: Key): boolean => {
      const s = stateRef.current;
      const e = s.endgame;
      if (!e || (s.status !== 'user' && s.status !== 'slipped')) return false;
      const applied = applyMove(s.fen, orig, dest, 'q');
      if (!applied) return false;
      const next = [...s.moves, { san: applied.san, uci: applied.uci, fenAfter: applied.fen, by: 'user' as const }];
      setFen(applied.fen);
      setMoves(next);
      const userMoves = next.filter((m) => m.by === 'user').length;
      const over = gameOver(applied.fen, seenKeys(e.fen, next));
      const decide = (j: Judgement) => {
        setMessage(j.message);
        setVerdict(j.verdict === 'ok' || j.verdict === 'slip' ? j.message : '');
        if (j.verdict === 'success') finish(e, true, j.message, s.slips, false);
        else if (j.verdict === 'failed') finish(e, false, j.message, s.slips, false);
        else if (j.verdict === 'slip') {
          setSlips(s.slips + 1);
          setStatus('slipped');
          sounds.miss();
        } else engineReply(e, applied.fen, next);
      };
      if (over) {
        decide(judge(e, { fenAfter: applied.fen, cp: null, mate: null, over, userMoves, lastSan: applied.san }));
        return true;
      }
      const id = ++requestRef.current;
      setStatus('verifying');
      setMessage('Checking with the engine…');
      getEngineSession()
        .analyse(applied.fen, { depth: VERIFY_DEPTH })
        .then((ev) => {
          if (id !== requestRef.current) return;
          const sign = e.side === 'white' ? 1 : -1;
          const cp = ev.cp === null ? null : sign * ev.cp;
          const mate = ev.mate === null ? null : sign * ev.mate;
          decide(judge(e, { fenAfter: applied.fen, cp, mate, over: null, userMoves, lastSan: applied.san }));
        })
        .catch((err: unknown) => {
          if (id === requestRef.current) setNotice(err instanceof Error ? err.message : String(err));
        });
      return true;
    },
    [engineReply, finish],
  );

  const takeBack = useCallback(() => {
    const s = stateRef.current;
    if (!s.endgame || s.status === 'done') return;
    const idx = s.moves.map((m) => m.by).lastIndexOf('user');
    if (idx < 0) return;
    requestRef.current++;
    getEngineSession().stop();
    const list = s.moves.slice(0, idx);
    setMoves(list);
    setFen(list.length ? list[list.length - 1].fenAfter : s.endgame.fen);
    setStatus('user');
    setMessage('Your move.');
    setVerdict('');
  }, []);

  const giveUp = useCallback(() => {
    const s = stateRef.current;
    if (!s.endgame || s.status === 'done') return;
    finish(s.endgame, false, 'Given up.', s.slips, true);
  }, [finish]);

  const backToList = useCallback(() => {
    requestRef.current++;
    getEngineSession().stop();
    setPhase('list');
  }, []);

  const nextDue = useCallback(() => {
    const ids = dueEndgames(loadProgress()).filter((id) => id !== stateRef.current.endgame?.id);
    const pick = ENDGAMES.find((e) => e.id === (ids[0] ?? dueEndgames(loadProgress())[0]));
    if (pick) start(pick);
    else backToList();
  }, [start, backToList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (phase === 'play') backToList();
        else return;
      } else if (e.key === 'z' && phase === 'play' && status !== 'done') takeBack();
      else if (e.code === 'Space' && phase === 'play' && status === 'done') {
        if (outcome?.success) nextDue();
        else if (endgame) start(endgame);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, status, outcome, endgame, backToList, takeBack, nextDue, start]);

  const userTurn = phase === 'play' && (status === 'user' || status === 'slipped');
  const dests = useMemo(() => (userTurn && fen ? legalDests(fen) : undefined), [userTurn, fen]);
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const m = moves[moves.length - 1];
    return m ? [m.uci.slice(0, 2) as Key, m.uci.slice(2, 4) as Key] : undefined;
  }, [moves]);
  const userMoves = moves.filter((m) => m.by === 'user').length;
  const moveTokens = endgame ? numberedLine(endgame.fen, moves.map((m) => m.san)).split(' ').filter(Boolean) : [];

  return (
    <div className="eg" data-phase={phase} data-status={status} data-fen={fen} data-moves={moves.length} data-slips={slips} data-endgame={endgame?.id ?? ''}>
      <div className="eg__board">
        <Board
          fen={fen || '8/8/8/8/8/8/8/8'}
          orientation={endgame?.side ?? 'white'}
          interactive={userTurn}
          dests={dests}
          showDests
          lastMove={lastMove}
          turnColor={fen ? turnOf(fen) : undefined}
          check={fen ? inCheck(fen) : false}
          animateChanges
          onUserMove={onUserMove}
          frameClassName={status === 'slipped' ? 'is-miss' : ''}
        />
      </div>

      <aside className="eg__panel">
        {phase === 'list' && (
          <>
            <h2 className="eg__heading">
              <Crown size={22} /> Endgame Drills
            </h2>
            <p className="eg__lede">
              Theoretical endgames against Stockfish at full strength. After every move the engine checks that your win
              (or draw) is still there; each ending is scheduled like a repertoire line.
            </p>
            <EngineStatus status={engine} />
            <div className="eg__stats-line">
              <Trophy size={18} />
              <span>{due.length === 0 ? 'Nothing due' : `${due.length} due of ${ENDGAMES.length}`}</span>
              {due.length > 0 && (
                <button className="btn btn--primary" style={{ marginLeft: 'auto', padding: '6px 10px' }} disabled={engine.state !== 'ready'} onClick={() => start(ENDGAMES.find((e) => e.id === due[0])!)}>
                  <Play size={14} /> Practise next due
                </button>
              )}
            </div>
            {CATEGORIES.map((cat) => (
              <div key={cat}>
                <div className="eg__label">{cat}</div>
                <div className="eg__list">
                  {ENDGAMES.filter((e) => e.category === cat).map((e) => {
                    const p = pill(progress[e.id]);
                    const st = stats[e.id];
                    return (
                      <button key={e.id} className={`eg__item ${isDue(progress[e.id]) && progress[e.id] ? 'is-due' : ''}`} data-id={e.id} onClick={() => start(e)} disabled={engine.state !== 'ready'}>
                        <span className="eg__item-name">
                          {e.name}
                          <span className="eg__dots" title={`Difficulty ${e.difficulty} of 5`}>
                            {[1, 2, 3, 4, 5].map((d) => (
                              <i key={d} className={d <= e.difficulty ? 'is-on' : ''} />
                            ))}
                          </span>
                        </span>
                        <span className={`eg__pill ${p.cls}`}>{p.text}</span>
                        <span className="eg__item-goal">
                          {goalLabel(e)}
                          {st ? ` · ${st.successes}/${st.attempts} solved` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="eg__hint">Click an ending to start</div>
          </>
        )}

        {phase === 'play' && endgame && (
          <>
            <div className="eg__head">
              <button className="btn btn--icon" title="Back to the list" onClick={backToList}>
                <ChevronLeft size={18} />
              </button>
              <h2 className="eg__title">{endgame.name}</h2>
            </div>
            <span className="eg__objective">
              <Crown size={14} /> {goalLabel(endgame)}
              {endgame.goal === 'draw' ? ` · ${HOLD_MOVES} moves` : ''}
            </span>
            <div className={`eg__status is-${status === 'done' ? (outcome?.success ? 'success' : 'failed') : status === 'slipped' ? 'slip' : status === 'user' ? 'user' : 'busy'}`} aria-live="polite">
              {message}
            </div>
            {verdict && status !== 'done' && status !== 'slipped' && (
              <div className="eg__verdict">Engine check: {verdict}</div>
            )}
            {showHint && <div className="eg__technique">{endgame.hint}</div>}
            <div className="eg__moves">
              {moveTokens.length === 0 ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>No moves yet</span> : moveTokens.map((t, i) => <span key={i} className={i === moveTokens.length - 1 ? 'is-last' : ''}>{t}</span>)}
            </div>
            <div className="eg__counters">
              <div className="stat">
                <div className="stat__label">Your moves</div>
                <div className="stat__value">{userMoves}</div>
              </div>
              <div className={`stat ${slips ? 'stat--bad' : ''}`}>
                <div className="stat__label">Slips</div>
                <div className="stat__value">{slips}</div>
              </div>
            </div>
            {notice && <div className="eg__status is-failed">{notice}</div>}

            {status !== 'done' ? (
              <>
                <div className="eg__actions">
                  <button className="btn" onClick={() => setShowHint((h) => !h)}>
                    <Lightbulb size={14} /> {showHint ? 'Hide technique' : 'Technique'}
                  </button>
                  <button className="btn" onClick={takeBack} disabled={!moves.some((m) => m.by === 'user') || status === 'verifying' || status === 'engine'} title="Take back (Z)">
                    <Undo2 size={14} /> Take back
                  </button>
                  <button className="btn btn--ghost" onClick={giveUp}>
                    <Flag size={14} /> Give up
                  </button>
                </div>
                <div className="eg__spacer" />
                <div className="eg__hint">{status === 'slipped' ? 'Take back to try again, or play on and see.' : 'Stockfish defends at full strength. Z takes back.'}</div>
              </>
            ) : (
              outcome && (
                <>
                  <div className="eg__result">
                    <strong>{outcome.success ? (outcome.slips === 0 ? 'Solved, flawless' : `Solved with ${outcome.slips} ${outcome.slips === 1 ? 'slip' : 'slips'}`) : outcome.gaveUp ? 'Given up' : 'Not this time'}</strong>
                    <span>Next review {describeDue(outcome.next)}.</span>
                  </div>
                  <div className="eg__spacer" />
                  {outcome.success ? (
                    <button className="btn btn--primary btn--lg" onClick={nextDue} autoFocus>
                      <Play size={18} /> Next due ending
                    </button>
                  ) : (
                    <button className="btn btn--primary btn--lg" onClick={() => start(endgame)} autoFocus>
                      <RotateCcw size={18} /> Try again
                    </button>
                  )}
                  <button className="btn btn--ghost" onClick={backToList}>
                    Back to the list
                  </button>
                  <div className="eg__hint">Space continues · Esc for the list</div>
                </>
              )
            )}
          </>
        )}
      </aside>
    </div>
  );
}
