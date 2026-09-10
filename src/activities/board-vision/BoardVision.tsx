// Board Vision: three quick drills for seeing the board (square names, square
// colours, knight routes).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Eye, Lightbulb, Play, RotateCcw, Square as StopIcon, Trophy } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { PieceIcon } from '@/components/PieceIcon';
import { singlePieceDestinations, squareColor, type Square } from '@/chess/squares';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import { useCountdown } from '@/lib/useCountdown';
import { knightAt, makeKnightPuzzle, MODES, randomSquare, TIMES, type KnightPuzzle, type Perspective, type VisionMode } from './drills';
import { bestFor, recordKnight, recordTimed } from './stats';
import './board-vision.css';

type Phase = 'setup' | 'running' | 'finished';

const EMPTY_BOARD = '8/8/8/8/8/8/8/8';
const FLASH_MS = 260;

function formatClock(ms: number): string {
  const tenths = Math.ceil(ms / 100);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export default function BoardVision() {
  const [mode, setMode] = useState<VisionMode>(() => loadJson<VisionMode>('board-vision:mode', 'squares'));
  const [seconds, setSeconds] = useState<number>(() => loadJson<number>('board-vision:seconds', 30));
  const [perspective, setPerspective] = useState<Perspective>(() => loadJson<Perspective>('board-vision:perspective', 'white'));
  const [pawnCount, setPawnCount] = useState<number>(() => loadJson<number>('board-vision:pawns', 3));
  const [showForbidden, setShowForbidden] = useState<boolean>(() => loadJson<boolean>('board-vision:show-forbidden', true));
  const [phase, setPhase] = useState<Phase>('setup');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [prompt, setPrompt] = useState<Square>('e4');
  const [count, setCount] = useState(0);
  const [misses, setMisses] = useState(0);
  const [flash, setFlash] = useState<Map<Key, string> | null>(null);
  const [panelMiss, setPanelMiss] = useState(false);
  const [result, setResult] = useState<{ score: number; misses: number; best: number; isNewBest: boolean } | null>(null);
  const [best, setBest] = useState(0);
  // Knight route state.
  const [puzzle, setPuzzle] = useState<KnightPuzzle | null>(null);
  const [knightSquare, setKnightSquare] = useState<Square>('b1');
  const [movesMade, setMovesMade] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [knightSession, setKnightSession] = useState({ solved: 0, optimal: 0 });

  const countersRef = useRef({ count: 0, misses: 0 });
  const phaseRef = useRef(phase);
  const promptRef = useRef(prompt);
  const knightRef = useRef(knightSquare);
  const puzzleRef = useRef(puzzle);
  const flashTimer = useRef<number | null>(null);
  phaseRef.current = phase;
  promptRef.current = prompt;
  knightRef.current = knightSquare;
  puzzleRef.current = puzzle;

  useEffect(() => saveJson('board-vision:mode', mode), [mode]);
  useEffect(() => saveJson('board-vision:seconds', seconds), [seconds]);
  useEffect(() => saveJson('board-vision:perspective', perspective), [perspective]);
  useEffect(() => saveJson('board-vision:pawns', pawnCount), [pawnCount]);
  useEffect(() => saveJson('board-vision:show-forbidden', showForbidden), [showForbidden]);
  useEffect(() => setBest(bestFor(mode, seconds)), [mode, seconds]);
  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  const timed = mode !== 'knight';

  const finish = useCallback(() => {
    if (phaseRef.current !== 'running') return;
    const { count, misses } = countersRef.current;
    const r = recordTimed(mode, seconds, count);
    setResult({ score: count, misses, best: r.best, isNewBest: r.isNewBest });
    setBest(r.best);
    setPhase('finished');
    sounds.finish();
  }, [mode, seconds]);

  const { remainingMs, start: startTimer, stop: stopTimer } = useCountdown(finish);

  const flashSquare = (key: Key, cls = 'wrong') => {
    setFlash(new Map([[key, cls]]));
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };
  const shakePanel = () => {
    setPanelMiss(true);
    window.setTimeout(() => setPanelMiss(false), FLASH_MS);
  };

  const start = useCallback(() => {
    countersRef.current = { count: 0, misses: 0 };
    setCount(0);
    setMisses(0);
    setResult(null);
    setFlash(null);
    if (mode === 'knight') {
      const p = makeKnightPuzzle(pawnCount);
      puzzleRef.current = p;
      setPuzzle(p);
      setKnightSquare(p.knight);
      knightRef.current = p.knight;
      setMovesMade(0);
      setRevealed(false);
      setPhase('running');
      return;
    }
    const o = perspective === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : perspective;
    setOrientation(o);
    const first = randomSquare();
    promptRef.current = first;
    setPrompt(first);
    setPhase('running');
    startTimer(seconds * 1000);
    sounds.start();
  }, [mode, pawnCount, perspective, seconds, startTimer]);

  const endEarly = useCallback(() => {
    stopTimer();
    finish();
  }, [stopTimer, finish]);

  const backToSetup = useCallback(() => {
    stopTimer();
    setResult(null);
    setPhase('setup');
  }, [stopTimer]);

  const hit = () => {
    countersRef.current.count += 1;
    setCount(countersRef.current.count);
    sounds.success();
    const next = randomSquare(promptRef.current);
    promptRef.current = next;
    setPrompt(next);
  };
  const miss = () => {
    countersRef.current.misses += 1;
    setMisses(countersRef.current.misses);
    sounds.miss();
  };

  // Find the square: click.
  const onSquare = useCallback((key: Key) => {
    if (phaseRef.current !== 'running' || mode !== 'squares') return;
    if (key === promptRef.current) hit();
    else {
      miss();
      flashSquare(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Square colour: buttons / keys.
  const answerColour = useCallback((c: 'light' | 'dark') => {
    if (phaseRef.current !== 'running' || mode !== 'colours') return;
    if (squareColor(promptRef.current) === c) hit();
    else {
      miss();
      shakePanel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Knight route: moves.
  const onKnightMove = useCallback((orig: Key, dest: Key): boolean => {
    const p = puzzleRef.current;
    if (phaseRef.current !== 'running' || !p || orig !== knightRef.current) return false;
    if (p.forbidden.includes(dest as Square)) {
      miss();
      flashSquare(dest);
      return false;
    }
    knightRef.current = dest as Square;
    setKnightSquare(dest as Square);
    setMovesMade((m) => {
      const made = m + 1;
      if (dest === p.target) {
        recordKnight(made, p.optimal);
        setKnightSession((s) => ({ solved: s.solved + 1, optimal: s.optimal + (made === p.optimal ? 1 : 0) }));
        setPhase('finished');
        if (made === p.optimal) sounds.finish();
        else sounds.success();
      } else sounds.success();
      return made;
    });
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        if (phase !== 'running') start();
        else return;
      } else if (e.key === 'Escape') {
        if (phase === 'running') {
          if (timed) endEarly();
          else backToSetup();
        } else if (phase === 'finished') backToSetup();
        else return;
      } else if (mode === 'colours' && phase === 'running') {
        if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowLeft') answerColour('light');
        else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') answerColour('dark');
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, mode, timed, start, endEarly, backToSetup, answerColour]);

  // ---- Board props -----------------------------------------------------------
  const running = phase === 'running';
  const knightFen = puzzle ? knightAt(puzzle, knightSquare) : EMPTY_BOARD;
  const boardFen = mode === 'knight' ? knightFen : EMPTY_BOARD;
  const dests = useMemo(() => {
    if (mode !== 'knight' || !running) return undefined;
    return new Map<Key, Key[]>([[knightSquare, singlePieceDestinations({ role: 'knight', color: 'white' }, knightSquare)]]);
  }, [mode, running, knightSquare]);
  const highlights = useMemo(() => {
    const map = new Map<Key, string>();
    if (mode === 'knight' && puzzle) {
      if (showForbidden) for (const sq of puzzle.forbidden) map.set(sq, 'forbidden');
      map.set(puzzle.target, 'target');
    }
    if (flash) for (const [k, v] of flash) map.set(k, v);
    return map;
  }, [mode, puzzle, showForbidden, flash]);
  const shapes = useMemo<DrawShape[]>(() => {
    if (mode !== 'knight' || !puzzle || !(phase === 'finished' || revealed)) return [];
    return puzzle.path.slice(1).map((sq, i) => ({ orig: puzzle.path[i], dest: sq, brush: 'green' }));
  }, [mode, puzzle, phase, revealed]);

  const totalMs = seconds * 1000;
  const isLow = running && timed && remainingMs <= 5000;
  const attempts = count + misses;
  const accuracy = attempts === 0 ? 100 : Math.round((count / attempts) * 100);
  const modeInfo = MODES.find((m) => m.id === mode)!;

  return (
    <div
      className="bv"
      data-mode={mode}
      data-phase={phase}
      data-orientation={orientation}
      data-prompt={running && timed ? prompt : ''}
      data-knight={puzzle?.knight ?? ''}
      data-target={puzzle?.target ?? ''}
      data-forbidden={puzzle?.forbidden.join(' ') ?? ''}
    >
      <div className="bv__board">
        {mode === 'colours' ? (
          <div className="bv__mental">
            <div>
              <div className="bv__mental-square">{running ? prompt : '?'}</div>
              <div className="bv__mental-hint">{running ? 'Light or dark?' : 'No board here: picture it.'}</div>
            </div>
          </div>
        ) : (
          <Board
            fen={boardFen}
            orientation={orientation}
            coordinates={mode !== 'squares'}
            interactive={mode === 'knight' && running}
            dests={dests}
            highlights={highlights}
            shapes={shapes}
            onSquareSelect={onSquare}
            onUserMove={onKnightMove}
            frameClassName={mode === 'squares' && !running ? 'is-locked' : ''}
          />
        )}
      </div>

      <aside className={`bv__panel ${panelMiss ? 'is-miss' : ''}`}>
        {phase === 'setup' && (
          <>
            <h2 className="bv__heading">
              <Compass size={22} /> Board Vision
            </h2>
            <p className="bv__lede">Fast drills for knowing the board cold: names, colours and knight geometry.</p>
            <div className="bv__section">
              <div className="bv__label">Drill</div>
              <div className="bv__chips bv__modes" role="radiogroup" aria-label="Drill">
                {MODES.map((m) => (
                  <button key={m.id} role="radio" aria-checked={m.id === mode} className={`chip ${m.id === mode ? 'is-active' : ''}`} onClick={() => setMode(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="bv__blurb">{modeInfo.blurb}</div>
            </div>
            {timed && (
              <div className="bv__section">
                <div className="bv__label">Time</div>
                <div className="bv__chips bv__times" role="radiogroup" aria-label="Time">
                  {TIMES.map((t) => (
                    <button key={t} role="radio" aria-checked={t === seconds} className={`chip ${t === seconds ? 'is-active' : ''}`} onClick={() => setSeconds(t)}>
                      {t}s
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mode === 'squares' && (
              <div className="bv__section">
                <div className="bv__label">Perspective</div>
                <div className="bv__chips bv__perspectives" role="radiogroup" aria-label="Perspective">
                  {(['white', 'black', 'random'] as const).map((p) => (
                    <button key={p} role="radio" aria-checked={p === perspective} className={`chip ${p === perspective ? 'is-active' : ''}`} onClick={() => setPerspective(p)}>
                      {p === 'random' ? 'Random' : <><PieceIcon color={p} role="king" /> {p === 'white' ? 'White' : 'Black'}</>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {mode === 'knight' && (
              <>
                <div className="bv__section">
                  <div className="bv__label">Enemy pawns</div>
                  <div className="bv__chips bv__pawns" role="radiogroup" aria-label="Pawns">
                    {[2, 3, 4, 5].map((n) => (
                      <button key={n} role="radio" aria-checked={n === pawnCount} className={`chip ${n === pawnCount ? 'is-active' : ''}`} onClick={() => setPawnCount(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bv__section">
                  <div className="seg" role="radiogroup" aria-label="Forbidden squares">
                    <button className={showForbidden ? 'is-active' : ''} onClick={() => setShowForbidden(true)}>
                      <Eye size={14} /> Show attacked squares
                    </button>
                    <button className={!showForbidden ? 'is-active' : ''} onClick={() => setShowForbidden(false)}>
                      Hide them
                    </button>
                  </div>
                </div>
              </>
            )}
            {timed ? (
              <div className="bv__best">
                <Trophy size={18} />
                <span>Personal best · {seconds}s</span>
                <strong>{best}</strong>
              </div>
            ) : (
              <div className="bv__best">
                <Trophy size={18} />
                <span>This session</span>
                <strong>
                  {knightSession.optimal} / {knightSession.solved} optimal
                </strong>
              </div>
            )}
            <div className="bv__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <Play size={18} /> Start
            </button>
            <div className="bv__hint">Space starts</div>
          </>
        )}

        {phase !== 'setup' && timed && (
          <>
            <div className={`bv__clock ${isLow ? 'is-low' : ''}`}>{formatClock(remainingMs)}</div>
            <div className="bv__progress">
              <div style={{ width: `${(remainingMs / totalMs) * 100}%` }} />
            </div>
            {mode === 'squares' && (
              <span className="bv__orientation">
                <PieceIcon color={orientation} role="king" /> {orientation === 'white' ? 'White' : 'Black'} at the bottom
              </span>
            )}
            <div className="bv__prompt-card">
              <small>{mode === 'squares' ? 'Click this square' : 'Light or dark?'}</small>
              <div className="bv__prompt">{running ? prompt : '–'}</div>
            </div>
            {mode === 'colours' && (
              <div className="bv__answers">
                <button className="btn btn--light" onClick={() => answerColour('light')}>
                  Light (L)
                </button>
                <button className="btn btn--dark" onClick={() => answerColour('dark')}>
                  Dark (D)
                </button>
              </div>
            )}
            <div className="bv__stats">
              <div className="stat stat--good">
                <div className="stat__label">Correct</div>
                <div className="stat__value">{count}</div>
              </div>
              <div className={`stat ${misses ? 'stat--bad' : ''}`}>
                <div className="stat__label">Misses</div>
                <div className="stat__value">{misses}</div>
              </div>
            </div>
            <div className="bv__spacer" />
            <button className="btn btn--ghost" onClick={endEarly} disabled={!running}>
              <StopIcon size={16} /> End run
            </button>
            <div className="bv__hint">Esc ends the run early</div>
          </>
        )}

        {phase !== 'setup' && mode === 'knight' && puzzle && (
          <>
            <div className={`bv__knight-status ${phase === 'finished' ? 'is-solved' : ''} ${phase === 'finished' && movesMade > puzzle.optimal ? 'is-suboptimal' : ''}`}>
              {phase === 'finished'
                ? movesMade === puzzle.optimal
                  ? `Solved in ${movesMade} moves: optimal.`
                  : `Solved in ${movesMade} moves; optimal is ${puzzle.optimal}.`
                : `Bring the knight from ${puzzle.knight} to ${puzzle.target}. Fewest moves: ${revealed ? puzzle.optimal : '?'}`}
            </div>
            <div className="bv__stats">
              <div className="stat">
                <div className="stat__label">Moves</div>
                <div className="stat__value">{movesMade}</div>
              </div>
              <div className={`stat ${misses ? 'stat--bad' : ''}`}>
                <div className="stat__label">Unsafe attempts</div>
                <div className="stat__value">{misses}</div>
              </div>
            </div>
            <div className="bv__best">
              <Trophy size={18} />
              <span>This session</span>
              <strong>
                {knightSession.optimal} / {knightSession.solved} optimal
              </strong>
            </div>
            <div className="bv__spacer" />
            {phase === 'finished' ? (
              <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
                <RotateCcw size={18} /> Next puzzle
              </button>
            ) : (
              <button className="btn" onClick={() => setRevealed(true)} disabled={revealed}>
                <Lightbulb size={16} /> Show the optimal route
              </button>
            )}
            <button className="btn btn--ghost" onClick={backToSetup}>
              Settings
            </button>
            <div className="bv__hint">{phase === 'finished' ? 'Space for the next puzzle' : 'Esc returns to settings'}</div>
          </>
        )}
      </aside>

      {phase === 'finished' && timed && result && (
        <div className="bv__overlay" onClick={backToSetup}>
          <div className="bv__results" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>Time's up</h2>
            <div className="bv__results-score">{result.score}</div>
            <div className="bv__results-caption">
              {mode === 'squares' ? 'squares found' : 'colours named'} in {seconds} seconds
            </div>
            <div className="bv__results-badge" style={result.isNewBest ? undefined : { background: 'rgba(255,255,255,0.06)', color: 'var(--muted)' }}>
              <Trophy size={14} /> {result.isNewBest ? 'New personal best' : `Best: ${result.best}`}
            </div>
            <div className="bv__results-grid">
              <div className={`stat ${result.misses ? 'stat--bad' : ''}`}>
                <div className="stat__label">Misses</div>
                <div className="stat__value">{result.misses}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Accuracy</div>
                <div className="stat__value">{accuracy}%</div>
              </div>
              <div className="stat">
                <div className="stat__label">Per minute</div>
                <div className="stat__value">{Math.round((result.score * 60) / seconds)}</div>
              </div>
            </div>
            <div className="bv__results-actions">
              <button className="btn btn--primary" onClick={start} autoFocus>
                <RotateCcw size={16} /> Again
              </button>
              <button className="btn btn--ghost" onClick={backToSetup}>
                Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
