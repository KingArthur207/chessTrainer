// Board Memory: flash a position, hide it, rebuild it from a palette, score.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Check, Eraser, EyeOff, Play, RotateCcw, Settings2, Trash2, Trophy } from 'lucide-react';
import { Board, type BoardHandle, type Key, type Piece } from '@/board/Board';
import { PiecePalette } from '@/components/PiecePalette';
import { loadOpenings } from '@/activities/opening-trainer/store';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import {
  countPieces,
  EMPTY_BOARD,
  pickPosition,
  positionsFromOpenings,
  scorePosition,
  SOURCES,
  withPiece,
  type MemoryPosition,
  type Score,
  type SourceId,
} from './positions';
import { getHistory, recordAttempt, summarise, type MemoryAttempt } from './stats';
import { getSnapshot, isOnline, nextLichessPosition, refreshPool, subscribe } from './lichessPool';
import { LichessPoolPanel } from './LichessPoolPanel';
import './board-memory.css';

type Phase = 'setup' | 'memorise' | 'rebuild' | 'result';
type Brush = Piece | 'eraser' | null;

const TIMES = [3, 5, 10, 20] as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function BoardMemory() {
  const [source, setSource] = useState<SourceId>(() => loadJson<SourceId>('board-memory:source', 'lichess'));
  const [seconds, setSeconds] = useState<number>(() => loadJson<number>('board-memory:seconds', 5));
  const [phase, setPhase] = useState<Phase>('setup');
  const [target, setTarget] = useState<MemoryPosition | null>(null);
  const [answer, setAnswer] = useState(EMPTY_BOARD);
  const [brush, setBrush] = useState<Brush>(null);
  const [score, setScore] = useState<Score | null>(null);
  const [view, setView] = useState<'solution' | 'answer'>('solution');
  const [history, setHistory] = useState<MemoryAttempt[]>(() => getHistory());
  const [session, setSession] = useState({ count: 0, sum: 0 });
  const [notice, setNotice] = useState<string | null>(null);

  const boardRef = useRef<BoardHandle>(null);
  const timerRef = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  const brushRef = useRef(brush);
  phaseRef.current = phase;
  brushRef.current = brush;

  const openings = useMemo(() => loadOpenings(), []);
  const openingsAvailable = useMemo(() => positionsFromOpenings(openings).length > 0, [openings]);

  // Lichess pool: shared store, so progress from a background fetch shows up here.
  const lichess = useSyncExternalStore(subscribe, getSnapshot);
  const pendingStartRef = useRef(false);
  useEffect(() => {
    if (source === 'lichess' && lichess.summary.total === 0 && lichess.status.state === 'idle') void refreshPool();
  }, [source, lichess.summary.total, lichess.status.state]);

  useEffect(() => saveJson('board-memory:source', source), [source]);
  useEffect(() => saveJson('board-memory:seconds', seconds), [seconds]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const start = useCallback(() => {
    let pos: MemoryPosition | null;
    if (source === 'lichess') {
      const p = nextLichessPosition();
      pos = p ? { fen: p.fen, pieces: p.pieces, label: p.label, source: 'lichess' } : null;
      if (!pos) {
        const st = getSnapshot().status;
        if (st.state === 'fetching') {
          pendingStartRef.current = true;
          setNotice('Fetching games from Lichess. The position will appear as soon as they arrive.');
        } else if (!isOnline()) {
          setNotice('You are offline and every saved position has been seen. Connect to the internet to fetch 500 new games.');
        } else {
          pendingStartRef.current = true;
          setNotice('All saved positions seen. Fetching 500 new games from Lichess…');
          void refreshPool(true);
        }
        return;
      }
    } else {
      pos = pickPosition(source, openings, target?.fen);
    }
    if (!pos) {
      setNotice('No positions from that source yet. Add some opening theory first, or pick another source.');
      return;
    }
    clearTimer();
    setNotice(null);
    setTarget(pos);
    setAnswer(EMPTY_BOARD);
    setBrush(null);
    setScore(null);
    setView('solution');
    setPhase('memorise');
    timerRef.current = window.setTimeout(() => setPhase('rebuild'), seconds * 1000);
  }, [source, openings, target, seconds]);

  // A fetch that was started because the pool ran dry: begin as soon as it lands.
  useEffect(() => {
    if (!pendingStartRef.current || lichess.status.state === 'fetching') return;
    pendingStartRef.current = false;
    if (lichess.status.state === 'idle' && lichess.summary.unseen > 0) start();
    else if (lichess.status.state === 'error') setNotice(lichess.status.message);
  }, [lichess.status, lichess.summary.unseen, start]);

  const hide = useCallback(() => {
    clearTimer();
    setPhase('rebuild');
  }, []);

  const check = useCallback(() => {
    if (!target) return;
    const s = scorePosition(target.fen, answer);
    setScore(s);
    setPhase('result');
    setView('solution');
    setBrush(null);
    setHistory(
      recordAttempt({
        date: new Date().toISOString(),
        source: target.source,
        seconds,
        pieces: target.pieces,
        accuracy: s.accuracy,
      }),
    );
    setSession((prev) => ({ count: prev.count + 1, sum: prev.sum + s.accuracy }));
    if (s.accuracy >= 0.999) sounds.finish();
    else if (s.accuracy >= 0.7) sounds.success();
    else sounds.miss();
  }, [target, answer, seconds]);

  const stamp = useCallback((key: Key) => {
    const b = brushRef.current;
    if (phaseRef.current !== 'rebuild' || !b) return;
    setAnswer((prev) => withPiece(prev, key, b === 'eraser' ? null : b));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (phase === 'setup' || phase === 'result') start();
        else if (phase === 'memorise') hide();
        else return;
      } else if (e.key === 'Enter') {
        if (phase === 'rebuild') check();
        else return;
      } else if (e.key === 'Escape') {
        if (phase === 'rebuild') setBrush(null);
        else if (phase === 'result') setPhase('setup');
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, hide, check]);

  const summary = useMemo(() => summarise(history), [history]);
  const placed = useMemo(() => countPieces(answer), [answer]);
  const boardFen =
    phase === 'memorise' && target
      ? target.fen
      : phase === 'rebuild'
        ? answer
        : phase === 'result' && target
          ? view === 'solution'
            ? target.fen
            : answer
          : EMPTY_BOARD;
  const highlights = phase === 'result' && score ? (view === 'solution' ? score.solutionMarks : score.answerMarks) : undefined;
  const sourceInfo = SOURCES.find((s) => s.id === source)!;

  return (
    <div className="bm">
      <div className="bm__board">
        <Board
          ref={boardRef}
          fen={boardFen}
          interactive={phase === 'rebuild' && brush === null}
          deleteOnDropOff
          highlights={highlights}
          onSquareSelect={stamp}
          onChange={(fen) => {
            if (phaseRef.current === 'rebuild') setAnswer(fen);
          }}
          frameClassName={phase === 'memorise' ? 'is-flash' : ''}
        />
      </div>

      <aside className="bm__panel">
        {phase === 'setup' && (
          <>
            <h2 className="bm__heading">
              <Brain size={22} /> Board Memory
            </h2>
            <p className="bm__lede">
              A position flashes on the board, then vanishes. Rebuild it from memory. Strong players remember real
              positions as chunks, not squares; this drill trains exactly that.
            </p>
            <div className="bm__section">
              <div className="bm__label">Positions from</div>
              <div className="bm__chips" role="radiogroup" aria-label="Source">
                {SOURCES.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={s.id === source}
                    className={`chip ${s.id === source ? 'is-active' : ''}`}
                    disabled={s.id === 'openings' && !openingsAvailable}
                    title={s.id === 'openings' && !openingsAvailable ? 'Add lines of at least 8 plies in the Opening Trainer first' : undefined}
                    onClick={() => setSource(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="bm__blurb">{sourceInfo.blurb}</div>
              {source === 'lichess' && <LichessPoolPanel />}
            </div>
            <div className="bm__section">
              <div className="bm__label">Memorise for</div>
              <div className="bm__chips bm__times" role="radiogroup" aria-label="Time">
                {TIMES.map((t) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={t === seconds}
                    className={`chip ${t === seconds ? 'is-active' : ''}`}
                    onClick={() => setSeconds(t)}
                  >
                    {t}s
                  </button>
                ))}
              </div>
            </div>
            <div className="bm__stats-line">
              <Trophy size={18} />
              <span>
                {summary.attempts === 0
                  ? 'No attempts yet'
                  : `${summary.attempts} ${summary.attempts === 1 ? 'attempt' : 'attempts'} · last 10 avg`}
              </span>
              {summary.attempts > 0 && <strong>{pct(summary.recent)}</strong>}
            </div>
            {notice && <div className="bm__notice">{notice}</div>}
            <div className="bm__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <Play size={18} /> Show position
            </button>
            <div className="bm__hint">Space shows the next position</div>
          </>
        )}

        {phase === 'memorise' && target && (
          <>
            <div className="bm__status is-flash">Memorise the position</div>
            <div className="bm__timer" aria-hidden="true">
              <div key={target.fen} style={{ animationDuration: `${seconds}s` }} />
            </div>
            <div className="bm__count">
              <span>On the board</span>
              <strong>{target.pieces} pieces</strong>
            </div>
            <div className="bm__spacer" />
            <button className="btn btn--lg" onClick={hide}>
              <EyeOff size={18} /> Hide now
            </button>
            <div className="bm__hint">Space hides it early</div>
          </>
        )}

        {phase === 'rebuild' && target && (
          <>
            <div className="bm__status">Rebuild the position</div>
            <div className="bm__count">
              <span>Placed</span>
              <strong>
                {placed} of {target.pieces}
              </strong>
            </div>
            <PiecePalette
              className="bm__palette"
              selected={brush === 'eraser' ? null : brush}
              onSelect={setBrush}
              onDragStart={(p, e) => boardRef.current?.dragNewPiece(p, e.nativeEvent)}
              title={(p) => `${p.color} ${p.role}: click to stamp, or drag onto the board`}
            />
            <div className="bm__tools">
              <button
                className={`btn ${brush === 'eraser' ? 'is-active' : ''}`}
                onClick={() => setBrush((b) => (b === 'eraser' ? null : 'eraser'))}
                title="Click squares to remove pieces"
              >
                <Eraser size={14} /> Eraser
              </button>
              <button className="btn" onClick={() => setAnswer(EMPTY_BOARD)} disabled={placed === 0}>
                <Trash2 size={14} /> Clear
              </button>
            </div>
            <div className="bm__hint">
              {brush
                ? brush === 'eraser'
                  ? 'Click squares to erase. Esc to stop.'
                  : 'Click squares to stamp the piece. Esc to stop.'
                : 'Pick a piece and click squares, or drag pieces in. Drag a piece off the board to remove it.'}
            </div>
            <div className="bm__spacer" />
            <button className="btn btn--primary btn--lg" onClick={check}>
              <Check size={18} /> Check
            </button>
            <div className="bm__hint">Enter checks your answer</div>
          </>
        )}

        {phase === 'result' && target && score && (
          <>
            <div className="bm__status is-result">
              {score.accuracy >= 0.999 ? 'Perfect recall' : score.accuracy >= 0.7 ? 'Good recall' : 'Keep at it'}
            </div>
            <div className={`bm__accuracy ${score.accuracy >= 0.9 ? 'is-great' : score.accuracy < 0.5 ? 'is-poor' : ''}`}>
              {pct(score.accuracy)}
            </div>
            <div className="bm__result-grid">
              <div className="stat stat--good">
                <div className="stat__label">Correct</div>
                <div className="stat__value">{score.correct}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Missing</div>
                <div className="stat__value">{score.missing}</div>
              </div>
              <div className={`stat ${score.wrong ? 'stat--bad' : ''}`}>
                <div className="stat__label">Wrong</div>
                <div className="stat__value">{score.wrong}</div>
              </div>
              <div className={`stat ${score.extra ? 'stat--bad' : ''}`}>
                <div className="stat__label">Extra</div>
                <div className="stat__value">{score.extra}</div>
              </div>
            </div>
            <div className="seg bm__view" role="radiogroup" aria-label="View">
              <button className={view === 'solution' ? 'is-active' : ''} onClick={() => setView('solution')}>
                Solution
              </button>
              <button className={view === 'answer' ? 'is-active' : ''} onClick={() => setView('answer')}>
                Your answer
              </button>
            </div>
            <div className="bm__legend">
              <span>
                <i style={{ background: 'rgba(64,200,120,0.8)' }} /> correct
              </span>
              {view === 'solution' ? (
                <span>
                  <i style={{ background: 'rgba(255,200,60,0.9)' }} /> you missed
                </span>
              ) : (
                <span>
                  <i style={{ background: 'rgba(255,92,92,0.9)' }} /> wrong or extra
                </span>
              )}
            </div>
            <div className="bm__source-label">{target.label}</div>
            <div className="bm__stats-line">
              <Trophy size={18} />
              <span>Session avg · {session.count} {session.count === 1 ? 'position' : 'positions'}</span>
              <strong>{pct(session.count ? session.sum / session.count : 0)}</strong>
            </div>
            <div className="bm__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <RotateCcw size={18} /> Next position
            </button>
            <button className="btn btn--ghost" onClick={() => setPhase('setup')}>
              <Settings2 size={14} /> Change settings
            </button>
            <div className="bm__hint">Space for the next one · Esc for settings</div>
          </>
        )}
      </aside>
    </div>
  );
}
