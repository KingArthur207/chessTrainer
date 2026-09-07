import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, Square, Target, Timer, Trophy, Volume2, VolumeX, XCircle, Zap } from 'lucide-react';
import { Board, type Key } from '@/board/Board';
import { PIECE_GLYPH } from '@/chess/squares';
import { isMuted, setMuted, sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import { DURATIONS, nextPuzzle, type DurationSec, type Puzzle } from './drill';
import { getBest, recordResult, type BulletResult } from './stats';
import { useCountdown } from './useCountdown';
import './bullet-trainer.css';

type Phase = 'idle' | 'running' | 'finished';

interface Outcome {
  result: BulletResult;
  isNewBest: boolean;
  best: number;
}

const DURATION_KEY = 'bullet:duration';

function formatClock(ms: number): string {
  const tenths = Math.ceil(ms / 100);
  const s = Math.floor(tenths / 10);
  const t = tenths % 10;
  return `${s}.${t}`;
}

function formatMs(ms: number | null): string {
  return ms === null ? '–' : `${(ms / 1000).toFixed(2)}s`;
}

export default function BulletTrainer() {
  const [duration, setDuration] = useState<DurationSec>(() => {
    const saved = loadJson<number>(DURATION_KEY, 60);
    return (DURATIONS as readonly number[]).includes(saved) ? (saved as DurationSec) : 60;
  });
  const [phase, setPhase] = useState<Phase>('idle');
  const [puzzle, setPuzzle] = useState<Puzzle>(() => nextPuzzle());
  const [solved, setSolved] = useState(0);
  const [misses, setMisses] = useState(0);
  const [missFlash, setMissFlash] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [best, setBest] = useState(() => getBest(duration)?.solved ?? 0);

  // Live counters live in refs so the timer-expiry callback never sees stale values.
  const countersRef = useRef({ solved: 0, misses: 0 });
  const solveTimesRef = useRef<number[]>([]);
  const puzzleStartRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const puzzleRef = useRef(puzzle);
  const flashTimerRef = useRef<number | null>(null);
  phaseRef.current = phase;
  puzzleRef.current = puzzle;

  useEffect(() => {
    saveJson(DURATION_KEY, duration);
    setBest(getBest(duration)?.solved ?? 0);
  }, [duration]);

  const finish = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    const { solved, misses } = countersRef.current;
    const times = solveTimesRef.current;
    const result: BulletResult = {
      durationSec: duration,
      solved,
      misses,
      avgSolveMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      fastestMs: times.length ? Math.min(...times) : null,
      date: new Date().toISOString(),
    };
    const { isNewBest, best } = recordResult(result);
    setOutcome({ result, isNewBest, best });
    setBest(best);
    setPhase('finished');
    sounds.finish();
  }, [duration]);

  const { remainingMs, start: startTimer, stop: stopTimer } = useCountdown(finish);

  const start = useCallback(() => {
    countersRef.current = { solved: 0, misses: 0 };
    solveTimesRef.current = [];
    setSolved(0);
    setMisses(0);
    setOutcome(null);
    const first = nextPuzzle();
    puzzleRef.current = first;
    setPuzzle(first);
    puzzleStartRef.current = performance.now();
    setPhase('running');
    startTimer(duration * 1000);
    sounds.start();
  }, [duration, startTimer]);

  const endEarly = useCallback(() => {
    stopTimer();
    finish();
  }, [stopTimer, finish]);

  const backToSetup = useCallback(() => {
    stopTimer();
    setOutcome(null);
    setPhase('idle');
  }, [stopTimer]);

  const flashMiss = useCallback(() => {
    setMissFlash(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setMissFlash(false), 260);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const handleUserMove = useCallback(
    (orig: Key, dest: Key): boolean => {
      if (phaseRef.current !== 'running') return false;
      const current = puzzleRef.current;
      if (orig === current.from && dest === current.to) {
        const now = performance.now();
        solveTimesRef.current.push(now - puzzleStartRef.current);
        puzzleStartRef.current = now;
        countersRef.current.solved += 1;
        setSolved(countersRef.current.solved);
        sounds.success();
        const next = nextPuzzle(current);
        puzzleRef.current = next;
        setPuzzle(next);
        return true;
      }
      countersRef.current.misses += 1;
      setMisses(countersRef.current.misses);
      sounds.miss();
      flashMiss();
      return false;
    },
    [flashMiss],
  );

  const toggleMute = useCallback(() => {
    const next = !isMuted();
    setMuted(next);
    setMutedState(next);
  }, []);

  // Keyboard: Space/Enter starts, Escape ends the run or returns to setup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        if (phase !== 'running') {
          e.preventDefault();
          start();
        }
      } else if (e.key === 'Escape') {
        if (phase === 'running') endEarly();
        else if (phase === 'finished') backToSetup();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, endEarly, backToSetup]);

  const running = phase === 'running';
  const totalMs = duration * 1000;
  const isLow = running && remainingMs <= 10_000;
  const attempts = solved + misses;
  const accuracy = attempts === 0 ? 100 : Math.round((solved / attempts) * 100);
  const glyph = PIECE_GLYPH[puzzle.piece.color][puzzle.piece.role];
  const highlights = useMemo(() => (running ? puzzle.highlights : undefined), [running, puzzle]);

  const frameClass = [missFlash ? 'is-miss' : '', running ? '' : 'is-locked'].join(' ');

  return (
    <div className="bullet">
      <div className="bullet__board">
        <Board
          fen={puzzle.fen}
          interactive={running}
          highlights={highlights}
          onUserMove={handleUserMove}
          frameClassName={frameClass}
        />
      </div>

      <aside className="bullet__panel">
        {running ? (
          <>
            <div className={`bullet__clock ${isLow ? 'is-low' : ''}`} aria-live="off">
              {formatClock(remainingMs)}
            </div>
            <div className={`bullet__progress ${isLow ? 'is-low' : ''}`}>
              <div style={{ width: `${(remainingMs / totalMs) * 100}%` }} />
            </div>

            <div className="bullet__task">
              <div className={`bullet__task-glyph is-${puzzle.piece.color}`}>{glyph}</div>
              <div className="bullet__task-text">
                <small>Move the {puzzle.piece.color} {puzzle.piece.role}</small>
                <strong>
                  {puzzle.from} → <em>{puzzle.to}</em>
                </strong>
              </div>
            </div>

            <div className="bullet__stats">
              <div className="stat stat--good">
                <div className="stat__label">
                  <Target size={14} /> Solved
                </div>
                <div className="stat__value">{solved}</div>
              </div>
              <div className="stat stat--bad">
                <div className="stat__label">
                  <XCircle size={14} /> Misses
                </div>
                <div className="stat__value">{misses}</div>
              </div>
            </div>

            <div className="bullet__spacer" />
            <button className="btn btn--ghost" onClick={endEarly}>
              <Square size={16} /> End run
            </button>
            <div className="bullet__hint">Esc ends the run early</div>
          </>
        ) : (
          <>
            <h2 className="bullet__heading">
              <Zap size={22} /> Bullet Trainer
            </h2>
            <p className="bullet__lede">
              A piece appears with a glowing target square. Drag it or click-click it there as fast as
              you can. Wrong squares snap back and count as a miss.
            </p>

            <div className="bullet__section">
              <div className="bullet__label">Time</div>
              <div className="bullet__durations" role="radiogroup" aria-label="Duration">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={d === duration}
                    className={`chip ${d === duration ? 'is-active' : ''}`}
                    onClick={() => setDuration(d)}
                  >
                    {d === 60 ? '1 min' : `${d}s`}
                  </button>
                ))}
              </div>
            </div>

            <div className="bullet__best">
              <Trophy size={18} />
              <span>Personal best · {duration === 60 ? '1 min' : `${duration}s`}</span>
              <strong>{best}</strong>
            </div>

            <div className="bullet__spacer" />

            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <Play size={18} /> Start
            </button>
            <div className="bullet__hint">Press Space to start</div>

            <div className="bullet__footer">
              <button className="btn btn--icon" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <span className="bullet__hint">
                <Timer size={12} style={{ verticalAlign: '-2px' }} /> Legal-move targets · counts misses
              </span>
            </div>
          </>
        )}
      </aside>

      {phase === 'finished' && outcome && (
        <div className="bullet__overlay" onClick={backToSetup}>
          <div className="results" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="results__title">Time's up</h2>
            <div className="results__score">{outcome.result.solved}</div>
            <div className="results__caption">
              pieces moved in {duration === 60 ? '1 minute' : `${duration} seconds`}
            </div>
            {outcome.isNewBest ? (
              <div className="results__badge">
                <Trophy size={14} /> New personal best
              </div>
            ) : (
              <div className="results__badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--muted)' }}>
                <Trophy size={14} /> Best: {outcome.best}
              </div>
            )}

            <div className="results__grid">
              <div className="stat stat--bad">
                <div className="stat__label">Misses</div>
                <div className="stat__value">{outcome.result.misses}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Accuracy</div>
                <div className="stat__value">{accuracy}%</div>
              </div>
              <div className="stat">
                <div className="stat__label">Avg / move</div>
                <div className="stat__value">{formatMs(outcome.result.avgSolveMs)}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Fastest</div>
                <div className="stat__value">{formatMs(outcome.result.fastestMs)}</div>
              </div>
            </div>

            <div className="results__actions">
              <button className="btn btn--primary" onClick={start} autoFocus>
                <RotateCcw size={16} /> Play again
              </button>
              <button className="btn btn--ghost" onClick={backToSetup}>
                Change time
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
