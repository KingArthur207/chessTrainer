// Master game guess-the-move: play one side of a game, guess each move, and
// score against the actual move and Stockfish's evaluation.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Chess } from 'chess.js';
import { ChevronLeft, Eye, Library, Play, RotateCcw, Settings2, Square, Trophy } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { EngineStatus } from '@/components/EngineStatus';
import { getSnapshot, isOnline, refreshPool, subscribe } from '@/activities/board-memory/lichessPool';
import { LichessPoolPanel } from '@/activities/board-memory/LichessPoolPanel';
import { applyMove, applySan, inCheck, legalDests, numberedLine, START_FEN, turnOf, uciLineToSan } from '@/chess/position';
import { formatScore, getEngineSession, type Evaluation } from '@/engine/session';
import { useEngineStatus } from '@/engine/useEngineStatus';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import { classicGames, GAME_SOURCES, gameFromPgn, lichessGame, lichessRemaining, winner, type GameSource, type MasterGame } from './games';
import { MAX_POINTS, scoreGuess, type GuessResult } from './scoring';
import { getHistory, recordSession, summarise, type SessionRecord } from './stats';
import './master-games.css';

type Phase = 'setup' | 'play' | 'summary';
type Status = 'user' | 'scoring' | 'feedback' | 'advancing';
type SideChoice = 'white' | 'black' | 'winner';

interface Guess {
  moveNumber: string;
  userSan: string;
  gameSan: string;
  bestSan: string | null;
  before: string;
  result: GuessResult;
}

const MAX_GUESSES = 20;
const TIMES = [
  { seconds: 1, label: 'Fast · 1s' },
  { seconds: 2, label: 'Normal · 2s' },
  { seconds: 4, label: 'Deep · 4s' },
];

function fenAfter(sans: string[], count: number): string {
  const chess = new Chess();
  for (let i = 0; i < count; i++) chess.move(sans[i]);
  return chess.fen();
}

export default function MasterGames() {
  const [source, setSource] = useState<GameSource>(() => loadJson<GameSource>('master-games:source', 'games'));
  const [classicIndex, setClassicIndex] = useState<number>(() => loadJson<number>('master-games:classic', 0));
  const [sideChoice, setSideChoice] = useState<SideChoice>(() => loadJson<SideChoice>('master-games:side', 'winner'));
  const [startMove, setStartMove] = useState<number>(() => loadJson<number>('master-games:start', 8));
  const [seconds, setSeconds] = useState<number>(() => loadJson<number>('master-games:seconds', 2));
  const [pasteText, setPasteText] = useState('');
  const [phase, setPhase] = useState<Phase>('setup');
  const [game, setGame] = useState<MasterGame | null>(null);
  const [userSide, setUserSide] = useState<'white' | 'black'>('white');
  const [ply, setPly] = useState(0);
  const [fen, setFen] = useState(START_FEN);
  const [status, setStatus] = useState<Status>('user');
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [feedback, setFeedback] = useState<Guess | null>(null);
  const [analysis, setAnalysis] = useState<Evaluation | null>(null);
  const [history, setHistory] = useState<SessionRecord[]>(() => getHistory());
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useEngineStatus();
  const lichess = useSyncExternalStore(subscribe, getSnapshot);
  const requestRef = useRef(0);
  const analysisRef = useRef<Promise<Evaluation> | null>(null);
  const stateRef = useRef({ game, ply, fen, userSide, status, guesses });
  stateRef.current = { game, ply, fen, userSide, status, guesses };
  const pendingStartRef = useRef(false);

  const classics = useMemo(() => classicGames(), []);
  useEffect(() => saveJson('master-games:source', source), [source]);
  useEffect(() => saveJson('master-games:classic', classicIndex), [classicIndex]);
  useEffect(() => saveJson('master-games:side', sideChoice), [sideChoice]);
  useEffect(() => saveJson('master-games:start', startMove), [startMove]);
  useEffect(() => saveJson('master-games:seconds', seconds), [seconds]);
  useEffect(() => {
    if (source === 'lichess' && lichess.summary.total === 0 && lichess.status.state === 'idle') void refreshPool();
  }, [source, lichess.summary.total, lichess.status.state]);

  const analysePosition = useCallback(
    (position: string, ms: number) => {
      const id = ++requestRef.current;
      const p = getEngineSession().analyse(position, {
        moveTimeMs: ms,
        multiPv: 1,
        onProgress: (partial) => {
          if (id === requestRef.current) setAnalysis(partial);
        },
      });
      analysisRef.current = p;
      p.then((ev) => {
        if (id === requestRef.current) setAnalysis(ev);
      }).catch(() => undefined);
      return p;
    },
    [],
  );

  const finishSession = useCallback(
    (list: Guess[]) => {
      const g = stateRef.current.game;
      if (!g) return;
      requestRef.current++;
      getEngineSession().stop();
      const points = list.reduce((s, x) => s + x.result.points, 0);
      setHistory(
        recordSession({
          date: new Date().toISOString(),
          game: g.label,
          side: stateRef.current.userSide,
          guesses: list.length,
          points,
          max: list.length * MAX_POINTS,
          matched: list.filter((x) => x.result.matched).length,
        }),
      );
      setPhase('summary');
    },
    [],
  );

  /** Position the game at the user's next move from `fromPly`, or finish. */
  const seat = useCallback(
    (g: MasterGame, side: 'white' | 'black', fromPly: number, list: Guess[]) => {
      let p = fromPly;
      while (p < g.sans.length && (p % 2 === 0 ? 'white' : 'black') !== side) p++;
      if (p >= g.sans.length || list.length >= MAX_GUESSES) {
        setFen(fenAfter(g.sans, Math.min(p, g.sans.length)));
        setPly(Math.min(p, g.sans.length));
        finishSession(list);
        return;
      }
      const position = fenAfter(g.sans, p);
      setPly(p);
      setFen(position);
      setStatus('user');
      setFeedback(null);
      setAnalysis(null);
      void analysePosition(position, seconds * 1000);
    },
    [analysePosition, finishSession, seconds],
  );

  const start = useCallback(() => {
    if (engine.state !== 'ready') return;
    let g: MasterGame | null = null;
    try {
      if (source === 'games') g = classics[classicIndex] ?? classics[0];
      else if (source === 'paste') g = gameFromPgn(pasteText);
      else {
        g = lichessGame();
        if (!g) {
          const st = getSnapshot().status;
          if (st.state === 'fetching') {
            pendingStartRef.current = true;
            setNotice('Fetching games from Lichess; the game will start as soon as they arrive.');
          } else if (!isOnline()) setNotice('You are offline and no unplayed Lichess games are saved. Connect to fetch games, or pick another source.');
          else {
            pendingStartRef.current = true;
            setNotice('No unplayed Lichess games saved. Fetching…');
            void refreshPool(true);
          }
          return;
        }
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!g) return;
    const side: 'white' | 'black' = sideChoice === 'winner' ? (winner(g.result) ?? 'white') : sideChoice;
    getEngineSession().stop();
    setNotice(null);
    setGame(g);
    setUserSide(side);
    setGuesses([]);
    setFeedback(null);
    setPhase('play');
    const fromPly = Math.max(0, (Math.max(1, Math.min(startMove, 60)) - 1) * 2);
    seat(g, side, fromPly, []);
  }, [engine.state, source, classics, classicIndex, pasteText, sideChoice, startMove, seat]);

  useEffect(() => {
    if (!pendingStartRef.current || lichess.status.state === 'fetching') return;
    pendingStartRef.current = false;
    if (lichess.status.state === 'idle' && lichessRemaining() > 0) start();
    else if (lichess.status.state === 'error') setNotice(lichess.status.message);
  }, [lichess.status, start]);

  const scoreMove = useCallback(
    async (userSan: string, userFen: string | null) => {
      const s = stateRef.current;
      const g = s.game;
      if (!g) return;
      const gameSan = g.sans[s.ply];
      setStatus('scoring');
      const before = analysisRef.current ? await analysisRef.current : null;
      if (stateRef.current.game !== g) return;
      let result: GuessResult;
      if (userFen === null) {
        result = { points: 0, matched: false, lossUser: 0, lossGame: 0, verdict: `Revealed: the game went ${gameSan}.` };
      } else if (userSan === gameSan) {
        result = scoreGuess({ userSan, gameSan, side: s.userSide, before: before ?? { cp: 0, mate: null }, afterUser: before ?? { cp: 0, mate: null }, afterGame: before ?? { cp: 0, mate: null } });
      } else {
        const gameFen = applySan(s.fen, gameSan)?.fen ?? s.fen;
        const half = Math.max(400, (seconds * 1000) / 2);
        const [afterUser, afterGame] = await Promise.all([
          getEngineSession().analyse(userFen, { moveTimeMs: half }),
          getEngineSession().analyse(gameFen, { moveTimeMs: half }),
        ]);
        if (stateRef.current.game !== g) return;
        result = scoreGuess({ userSan, gameSan, side: s.userSide, before: before ?? { cp: 0, mate: null }, afterUser, afterGame });
      }
      const bestSan = before?.bestMove ? (uciLineToSan(s.fen, [before.bestMove])[0] ?? null) : null;
      const guess: Guess = {
        moveNumber: numberedLine(s.fen, [gameSan]).replace(gameSan, '').trim(),
        userSan,
        gameSan,
        bestSan,
        before: before ? formatScore(before) : '…',
        result,
      };
      setGuesses((prev) => [...prev, guess]);
      setFeedback(guess);
      setStatus('feedback');
      if (result.points === 3) sounds.finish();
      else if (result.points >= 1) sounds.success();
      else sounds.miss();
    },
    [seconds],
  );

  const onUserMove = useCallback(
    (orig: Key, dest: Key): boolean => {
      const s = stateRef.current;
      if (!s.game || s.status !== 'user') return false;
      const applied = applyMove(s.fen, orig, dest, 'q');
      if (!applied) return false;
      void scoreMove(applied.san, applied.fen);
      // The board stays on the position; the game's move is played on Continue.
      return false;
    },
    [scoreMove],
  );

  const reveal = useCallback(() => {
    if (stateRef.current.status !== 'user') return;
    void scoreMove('—', null);
  }, [scoreMove]);

  const advance = useCallback(() => {
    const s = stateRef.current;
    const g = s.game;
    if (!g || s.status !== 'feedback') return;
    setStatus('advancing');
    setFeedback(null);
    // Play the game move, then the opponent's reply, then seat the user again.
    const afterGame = fenAfter(g.sans, s.ply + 1);
    setFen(afterGame);
    setPly(s.ply + 1);
    window.setTimeout(() => {
      if (stateRef.current.game !== g) return;
      if (s.ply + 2 <= g.sans.length) {
        setFen(fenAfter(g.sans, s.ply + 2));
        setPly(s.ply + 2);
      }
      window.setTimeout(() => {
        if (stateRef.current.game !== g) return;
        seat(g, s.userSide, s.ply + 2, stateRef.current.guesses);
      }, 250);
    }, 500);
  }, [seat]);

  const endSession = useCallback(() => {
    finishSession(stateRef.current.guesses);
  }, [finishSession]);

  const backToSetup = useCallback(() => {
    requestRef.current++;
    getEngineSession().stop();
    setPhase('setup');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        if (phase === 'setup' || phase === 'summary') start();
        else if (phase === 'play' && status === 'feedback') advance();
        else return;
      } else if (e.key === 'Escape') {
        if (phase === 'setup') return;
        backToSetup();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, status, start, advance, backToSetup]);

  const summary = useMemo(() => summarise(history), [history]);
  const dests = useMemo(() => (phase === 'play' && status === 'user' ? legalDests(fen) : undefined), [phase, status, fen]);
  const points = guesses.reduce((s, g) => s + g.result.points, 0);
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    if (!game || ply === 0 || phase !== 'play') return undefined;
    const m = applySan(fenAfter(game.sans, ply - 1), game.sans[ply - 1]);
    return m ? [m.from, m.to] : undefined;
  }, [game, ply, phase]);
  const shapes = useMemo<DrawShape[]>(() => {
    if (phase !== 'play' || status !== 'feedback' || !feedback || !game) return [];
    const arrow = (san: string, brush: string): DrawShape | null => {
      const m = applySan(fen, san);
      return m ? { orig: m.from, dest: m.to, brush } : null;
    };
    const out: DrawShape[] = [];
    const gameArrow = arrow(feedback.gameSan, 'green');
    if (gameArrow) out.push(gameArrow);
    if (!feedback.result.matched && feedback.userSan !== '—') {
      const u = arrow(feedback.userSan, feedback.result.points === 0 ? 'red' : 'blue');
      if (u) out.push(u);
    }
    if (feedback.bestSan && feedback.bestSan !== feedback.gameSan && feedback.bestSan !== feedback.userSan) {
      const b = arrow(feedback.bestSan, 'yellow');
      if (b) out.push(b);
    }
    return out;
  }, [phase, status, feedback, game, fen]);
  const movesSoFar = game ? numberedLine(START_FEN, game.sans.slice(0, ply)).split(' ').filter(Boolean) : [];

  return (
    <div className="mg" data-phase={phase} data-status={status} data-ply={ply} data-fen={fen} data-points={points} data-guesses={guesses.length}>
      <div className="mg__board">
        <Board
          fen={fen}
          orientation={userSide}
          interactive={phase === 'play' && status === 'user'}
          dests={dests}
          showDests
          lastMove={lastMove}
          turnColor={turnOf(fen)}
          check={inCheck(fen)}
          shapes={shapes}
          animateChanges
          onUserMove={onUserMove}
        />
      </div>

      <aside className="mg__panel">
        {phase === 'setup' && (
          <>
            <h2 className="mg__heading">
              <Library size={22} /> Master Games
            </h2>
            <p className="mg__lede">
              Play one side of a master game and guess every move. Each guess scores 3 for the game move, 2 for a move
              the engine likes just as much, 1 for a playable one, 0 for a mistake. The opponent's replies follow the game.
            </p>
            <EngineStatus status={engine} />
            <div className="mg__section">
              <div className="mg__label">Game from</div>
              <div className="mg__chips mg__sources" role="radiogroup" aria-label="Source">
                {GAME_SOURCES.map((s) => (
                  <button key={s.id} role="radio" aria-checked={s.id === source} className={`chip ${s.id === source ? 'is-active' : ''}`} onClick={() => setSource(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="mg__blurb">{GAME_SOURCES.find((s) => s.id === source)!.blurb}</div>
              {source === 'games' && (
                <select className="mg__select" value={classicIndex} onChange={(e) => setClassicIndex(Number(e.target.value))}>
                  {classics.map((g, i) => (
                    <option key={g.id} value={i}>
                      {g.label} · {g.result}
                    </option>
                  ))}
                </select>
              )}
              {source === 'lichess' && <LichessPoolPanel detail={`${lichessRemaining()} unplayed games saved`} />}
              {source === 'paste' && <textarea className="mg__paste" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'[White "…"]\n[Black "…"]\n\n1. e4 e5 2. Nf3 …'} />}
            </div>
            <div className="mg__row">
              <div className="mg__section">
                <div className="mg__label">You play</div>
                <div className="mg__chips mg__sides" role="radiogroup" aria-label="Side">
                  {(['winner', 'white', 'black'] as SideChoice[]).map((c) => (
                    <button key={c} role="radio" aria-checked={c === sideChoice} className={`chip ${c === sideChoice ? 'is-active' : ''}`} onClick={() => setSideChoice(c)}>
                      {c === 'winner' ? 'Winner' : c === 'white' ? '♔ White' : '♚ Black'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mg__section">
                <div className="mg__label">Start at move</div>
                <input className="mg__input" type="number" min={1} max={60} value={startMove} onChange={(e) => setStartMove(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
              </div>
            </div>
            <div className="mg__section">
              <div className="mg__label">Engine thinking time</div>
              <div className="mg__chips mg__times" role="radiogroup" aria-label="Analysis time">
                {TIMES.map((t) => (
                  <button key={t.seconds} role="radio" aria-checked={t.seconds === seconds} className={`chip ${t.seconds === seconds ? 'is-active' : ''}`} onClick={() => setSeconds(t.seconds)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mg__stats-line">
              <Trophy size={18} />
              <span>{summary.sessions === 0 ? 'No sessions yet' : `${summary.sessions} sessions · accuracy`}</span>
              {summary.sessions > 0 && <strong>{Math.round(summary.accuracy * 100)}% · {Math.round(summary.matched * 100)}% matched</strong>}
            </div>
            {notice && <div className="mg__notice">{notice}</div>}
            <div className="mg__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} disabled={engine.state !== 'ready' || (source === 'paste' && !pasteText.trim())} autoFocus>
              <Play size={18} /> Start
            </button>
            <div className="mg__hint">Space starts · up to {MAX_GUESSES} guesses per session</div>
          </>
        )}

        {phase === 'play' && game && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn btn--icon" title="Settings" onClick={backToSetup}>
                <ChevronLeft size={18} />
              </button>
              <div className="mg__game">
                {game.label}
                {game.result !== '*' ? ` · ${game.result}` : ''}
                <br />
                You are {userSide}.
              </div>
            </div>
            <div className="mg__score">
              <strong>{points}</strong>
              <span>
                / {guesses.length * MAX_POINTS} points · guess {Math.min(guesses.length + 1, MAX_GUESSES)} of {MAX_GUESSES}
              </span>
            </div>
            <div className={`mg__status ${status === 'user' ? 'is-user' : 'is-busy'}`} aria-live="polite">
              {status === 'user' && `Your move as ${userSide}: what did ${userSide === 'white' ? game.white : game.black} play?`}
              {status === 'scoring' && 'Scoring your move…'}
              {status === 'feedback' && 'Compare, then continue.'}
              {status === 'advancing' && 'Playing on…'}
            </div>
            {status === 'user' && analysis && <div className="mg__hint">Engine ready at depth {analysis.depth}</div>}
            {status === 'feedback' && feedback && (
              <div className={`mg__feedback p${feedback.result.points}`} data-points={feedback.result.points}>
                <div className="mg__points">
                  +{feedback.result.points}
                  <small>/ {MAX_POINTS}</small>
                </div>
                <div className="mg__verdict">{feedback.result.verdict}</div>
                <div className="mg__detail">
                  <span>Game</span>
                  <b>
                    {feedback.moveNumber}
                    {feedback.gameSan}
                  </b>
                  <span>{feedback.result.lossGame ? `−${(feedback.result.lossGame / 100).toFixed(1)}` : ''}</span>
                  {feedback.userSan !== '—' && !feedback.result.matched && (
                    <>
                      <span>You</span>
                      <b>{feedback.userSan}</b>
                      <span>{feedback.result.lossUser ? `−${(feedback.result.lossUser / 100).toFixed(1)}` : ''}</span>
                    </>
                  )}
                  {feedback.bestSan && (
                    <>
                      <span>Engine</span>
                      <b>{feedback.bestSan}</b>
                      <span>{feedback.before}</span>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="mg__moves">
              {movesSoFar.length === 0 ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Start position</span> : movesSoFar.map((t, i) => <span key={i} className={i === movesSoFar.length - 1 ? 'is-last' : ''}>{t}</span>)}
            </div>
            <div className="mg__spacer" />
            {status === 'feedback' ? (
              <button className="btn btn--primary btn--lg" onClick={advance} autoFocus>
                <Play size={18} /> Continue
              </button>
            ) : (
              <div className="mg__actions">
                <button className="btn" onClick={reveal} disabled={status !== 'user'}>
                  <Eye size={14} /> Show me (0 points)
                </button>
                <button className="btn btn--ghost" onClick={endSession} disabled={guesses.length === 0}>
                  <Square size={14} /> End session
                </button>
              </div>
            )}
            <div className="mg__hint">{status === 'feedback' ? 'Space continues' : 'Play the move you think was played'}</div>
          </>
        )}

        {phase === 'summary' && game && (
          <>
            <div className="mg__game">{game.label}</div>
            <div className="mg__score">
              <strong>{points}</strong>
              <span>/ {guesses.length * MAX_POINTS} points</span>
            </div>
            <div className="mg__summary-grid">
              <div className="stat stat--good">
                <div className="stat__label">Accuracy</div>
                <div className="stat__value">{guesses.length ? Math.round((points / (guesses.length * MAX_POINTS)) * 100) : 0}%</div>
              </div>
              <div className="stat">
                <div className="stat__label">Game moves</div>
                <div className="stat__value">{guesses.filter((g) => g.result.matched).length}</div>
              </div>
              <div className="stat">
                <div className="stat__label">Guesses</div>
                <div className="stat__value">{guesses.length}</div>
              </div>
            </div>
            <ul className="mg__list">
              {guesses.map((g, i) => (
                <li key={i} className={`p${g.result.points}`}>
                  <span>{g.moveNumber}</span>
                  <span>{g.userSan === '—' ? 'revealed' : g.userSan}</span>
                  <span style={{ color: 'var(--muted)' }}>{g.gameSan}</span>
                  <span className="pts">+{g.result.points}</span>
                </li>
              ))}
            </ul>
            <div className="mg__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <RotateCcw size={18} /> Play again
            </button>
            <button className="btn btn--ghost" onClick={backToSetup}>
              <Settings2 size={14} /> Settings
            </button>
            <div className="mg__hint">Space plays again · Esc for settings</div>
          </>
        )}
      </aside>
    </div>
  );
}
