// Play out a repertoire: book replies while in theory, then Stockfish at a
// chosen strength; take-backs and hints while learning; a post-game review.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Lightbulb, Play, RotateCcw, Settings2, Square, Swords, Trophy, Undo2 } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { EngineStatus } from '@/components/EngineStatus';
import { MoveTree } from '@/activities/opening-trainer/MoveTree';
import { lineToSan, pathToNode, type Opening, type TreeNode } from '@/activities/opening-trainer/model';
import { loadOpenings } from '@/activities/opening-trainer/store';
import { inCheck, legalDests, turnOf } from '@/chess/position';
import { formatScore, getEngineSession, scoreValue } from '@/engine/session';
import { useEngineStatus } from '@/engine/useEngineStatus';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import {
  bookEndIndex,
  bookReplies,
  isUserTurn,
  newGame,
  pickBookReply,
  play,
  START_MODES,
  startPathFor,
  stop,
  STRENGTHS,
  undo,
  type GameState,
  type StartMode,
} from './game';
import { moveNumberOf, reviewGame, type Review } from './review';
import { getHistory, recordGame, summarise, type PlayRecord } from './stats';
import '@/activities/opening-trainer/opening-trainer.css';
import './repertoire-play.css';

type Phase = 'setup' | 'playing' | 'review';

const BOOK_REPLY_DELAY = 450;
const ENGINE_MOVE_MS = 700;

export default function RepertoirePlay() {
  const openings = useMemo(() => loadOpenings().filter((o) => o.root.children.length > 0), []);
  const [openingId, setOpeningId] = useState<string>(() => loadJson<string>('repertoire-play:opening', openings[0]?.id ?? ''));
  const [mode, setMode] = useState<StartMode>(() => loadJson<StartMode>('repertoire-play:mode', 'leaf'));
  const [strengthId, setStrengthId] = useState<string>(() => loadJson<string>('repertoire-play:strength', 'club'));
  const [picked, setPicked] = useState<TreeNode | null>(null);
  const [phase, setPhase] = useState<Phase>('setup');
  const [game, setGame] = useState<GameState | null>(null);
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<DrawShape[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewProgress, setReviewProgress] = useState<[number, number] | null>(null);
  const [history, setHistory] = useState<PlayRecord[]>(() => getHistory());
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useEngineStatus();
  const gameRef = useRef<GameState | null>(null);
  const requestRef = useRef(0);
  const movesEndRef = useRef<HTMLDivElement>(null);

  const opening = openings.find((o) => o.id === openingId) ?? openings[0] ?? null;
  const strength = STRENGTHS.find((s) => s.id === strengthId) ?? STRENGTHS[1];

  useEffect(() => saveJson('repertoire-play:opening', openingId), [openingId]);
  useEffect(() => saveJson('repertoire-play:mode', mode), [mode]);
  useEffect(() => saveJson('repertoire-play:strength', strengthId), [strengthId]);
  useEffect(() => {
    movesEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [game?.moves.length]);

  const commit = (g: GameState) => {
    gameRef.current = g;
    setGame(g);
  };

  const finishGame = useCallback(
    (g: GameState, op: Opening) => {
      requestRef.current++;
      getEngineSession().stop();
      setThinking(false);
      setHint([]);
      commit(g);
      setPhase('review');
      setReview(null);
      setReviewProgress([0, 1]);
      const id = requestRef.current;
      void reviewGame(
        g.startFen,
        g.moves,
        g.userColor,
        async (fen) => {
          const ev = await getEngineSession().analyse(fen, { depth: 14 });
          return { cp: ev.cp, mate: ev.mate, bestMove: ev.bestMove };
        },
        (done, total) => {
          if (id === requestRef.current) setReviewProgress([done, total]);
        },
      ).then((r) => {
        if (id !== requestRef.current) return;
        setReview(r);
        setReviewProgress(null);
        const sign = g.userColor === 'white' ? 1 : -1;
        const finalForUser = r.finalCp === null && r.finalMate === null ? null : sign * Math.max(-1000, Math.min(1000, scoreValue({ cp: r.finalCp, mate: r.finalMate })));
        const inBook = bookEndIndex(g);
        setHistory(
          recordGame({
            date: new Date().toISOString(),
            openingId: op.id,
            openingName: op.name,
            color: g.userColor,
            elo: strength.elo,
            result: g.result ?? 'stopped',
            pliesInBook: inBook < 0 ? g.moves.length : inBook,
            plies: g.moves.length,
            finalCpForUser: finalForUser,
            mistakes: r.mistakes,
            blunders: r.blunders,
          }),
        );
      });
    },
    [strength.elo],
  );

  /** Let the book or the engine answer when it is not the user's turn. */
  const maybeReply = useCallback(
    (op: Opening) => {
      const g = gameRef.current;
      if (!g || g.status !== 'playing' || isUserTurn(g)) return;
      const id = ++requestRef.current;
      const replies = bookReplies(g);
      const apply = (uci: string, by: 'book' | 'engine') => {
        const current = gameRef.current;
        if (id !== requestRef.current || !current) return;
        const next = play(current, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, by);
        if (!next) return;
        sounds.success();
        if (next.status === 'over') finishGame(next, op);
        else commit(next);
      };
      if (replies.length > 0) {
        window.setTimeout(() => apply(pickBookReply(replies).uci, 'book'), BOOK_REPLY_DELAY);
        return;
      }
      setThinking(true);
      getEngineSession()
        .playMove(g.fen, { elo: strength.elo, moveTimeMs: ENGINE_MOVE_MS })
        .then((uci) => {
          if (uci) apply(uci, 'engine');
        })
        .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          if (id === requestRef.current) setThinking(false);
        });
    },
    [finishGame, strength.elo],
  );

  const start = useCallback(() => {
    if (!opening || engine.state !== 'ready') return;
    const path = mode === 'pick' && picked ? (pathToNode(opening.root, picked.id) ?? [opening.root]) : startPathFor(opening, mode);
    const g = newGame(opening, path);
    requestRef.current++;
    getEngineSession().stop();
    setNotice(null);
    setReview(null);
    setReviewProgress(null);
    setHint([]);
    setThinking(false);
    commit(g);
    setPhase('playing');
    window.setTimeout(() => maybeReply(opening), 0);
  }, [opening, engine.state, mode, picked, maybeReply]);

  const onUserMove = useCallback(
    (orig: Key, dest: Key): boolean => {
      const g = gameRef.current;
      if (!g || !opening || !isUserTurn(g) || thinking) return false;
      const next = play(g, orig, dest, 'user');
      if (!next) return false;
      setHint([]);
      if (next.status === 'over') {
        finishGame(next, opening);
        return true;
      }
      commit(next);
      if (next.moves[next.moves.length - 1].bookMove) sounds.miss();
      window.setTimeout(() => maybeReply(opening), 0);
      return true;
    },
    [opening, thinking, finishGame, maybeReply],
  );

  const takeBack = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    requestRef.current++;
    getEngineSession().stop();
    setThinking(false);
    setHint([]);
    commit(undo(g));
  }, []);

  const showHint = useCallback(() => {
    const g = gameRef.current;
    if (!g || !isUserTurn(g)) return;
    const expected = bookReplies(g)[0];
    if (!expected) return;
    setHint([{ orig: expected.uci.slice(0, 2) as Key, dest: expected.uci.slice(2, 4) as Key, brush: 'yellow' }]);
  }, []);

  const stopAndReview = useCallback(() => {
    const g = gameRef.current;
    if (!g || !opening) return;
    finishGame(stop(g), opening);
  }, [opening, finishGame]);

  const backToSetup = useCallback(() => {
    requestRef.current++;
    getEngineSession().stop();
    setThinking(false);
    setPhase('setup');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'INPUT') return;
      if (e.code === 'Space') {
        if (phase === 'setup' || phase === 'review') start();
        else return;
      } else if (e.key === 'Escape') {
        if (phase === 'setup') return;
        backToSetup();
      } else if (e.key === 'z' && phase === 'playing') takeBack();
      else if (e.key === 'h' && phase === 'playing') showHint();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, start, backToSetup, takeBack, showHint]);

  const summary = useMemo(() => summarise(history), [history]);
  const userTurn = !!game && isUserTurn(game);
  const dests = useMemo(() => (game && phase === 'playing' && userTurn && !thinking ? legalDests(game.fen) : undefined), [game, phase, userTurn, thinking]);
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const m = game?.moves[game.moves.length - 1];
    return m ? [m.uci.slice(0, 2) as Key, m.uci.slice(2, 4) as Key] : undefined;
  }, [game]);
  const inBook = !!game?.node;
  const bookEnd = game ? bookEndIndex(game) : -1;
  const startContext = game && game.startPath.length > 1 ? `Starting after ${lineToSan(game.startPath.slice(1)).split(' ').slice(-3).join(' ')}` : 'Starting from move one';

  const moveList = (): ReactNode[] => {
    if (!game) return [];
    const out: ReactNode[] = [];
    game.moves.forEach((m, i) => {
      if (i === bookEnd) out.push(<span key="end" className="rp__book-end">Book ends</span>);
      const num = moveNumberOf(game.startFen, i);
      const showNum = num.endsWith('.') && !num.endsWith('...') ? true : i === 0 || i === bookEnd;
      out.push(
        <span key={i}>
          {showNum && <span className="rp__num">{num}</span>}
          <span className={`rp__move ${m.inBook ? 'is-book' : ''} ${i === game.moves.length - 1 ? 'is-last' : ''}`} data-by={m.by} data-book={m.inBook ? '1' : '0'}>
            {m.san}
          </span>
          {m.bookMove && <span className="rp__deviation">(book: {m.bookMove})</span>}
        </span>,
      );
    });
    return out;
  };

  const status = () => {
    if (!game) return '';
    if (game.status === 'over') return `${game.reason}: ${game.result}`;
    if (game.status === 'stopped') return 'Stopped for review';
    if (thinking) return 'Stockfish is thinking…';
    if (!userTurn) return inBook ? 'Book reply…' : 'Opponent to move…';
    return inBook ? 'Your move (still in your book)' : `Your move · out of book${bookEnd >= 0 ? ` since ${moveNumberOf(game.startFen, bookEnd)}` : ''}`;
  };

  return (
    <div
      className="rp"
      data-phase={phase}
      data-fen={game?.fen ?? ''}
      data-turn={game ? turnOf(game.fen) : ''}
      data-user={game?.userColor ?? ''}
      data-in-book={inBook ? '1' : '0'}
      data-thinking={thinking ? '1' : '0'}
      data-moves={game?.moves.length ?? 0}
    >
      <div className="rp__board">
        <Board
          fen={game?.fen ?? opening?.root.fen ?? '8/8/8/8/8/8/8/8'}
          orientation={opening?.color ?? 'white'}
          interactive={phase === 'playing' && userTurn && !thinking}
          dests={dests}
          showDests
          lastMove={lastMove}
          turnColor={game ? turnOf(game.fen) : undefined}
          check={game ? inCheck(game.fen) : false}
          shapes={hint}
          animateChanges
          onUserMove={onUserMove}
        />
      </div>

      <aside className="rp__panel">
        {phase === 'setup' && (
          <>
            <h2 className="rp__heading">
              <Swords size={22} /> Play the Opening
            </h2>
            <p className="rp__lede">
              Knowing the theory is half the job. Play your repertoire out against Stockfish and find out what you do
              once the book ends. Take-backs and book hints are allowed; a review grades every move afterwards.
            </p>
            <EngineStatus status={engine} />
            {openings.length === 0 ? (
              <div className="rp__notice">No openings with moves yet. Add theory in the Opening Trainer first.</div>
            ) : (
              <>
                <div className="rp__section">
                  <div className="rp__label">Opening</div>
                  <select className="rp__select" value={opening?.id ?? ''} onChange={(e) => { setOpeningId(e.target.value); setPicked(null); }}>
                    {openings.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · you play {o.color}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rp__section">
                  <div className="rp__label">Start</div>
                  <div className="rp__chips rp__modes" role="radiogroup" aria-label="Start mode">
                    {START_MODES.map((m) => (
                      <button key={m.id} role="radio" aria-checked={m.id === mode} className={`chip ${m.id === mode ? 'is-active' : ''}`} onClick={() => setMode(m.id)}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="rp__blurb">{START_MODES.find((m) => m.id === mode)!.blurb}</div>
                  {mode === 'pick' && opening && (
                    <div className="rp__picker">
                      <MoveTree root={opening.root} currentId={picked?.id ?? opening.root.id} onSelect={setPicked} />
                      <div className="rp__blurb">{picked ? `Start after ${picked.san}` : 'Click a move to start after it.'}</div>
                    </div>
                  )}
                </div>
                <div className="rp__section">
                  <div className="rp__label">Engine strength</div>
                  <div className="rp__chips rp__strengths" role="radiogroup" aria-label="Strength">
                    {STRENGTHS.map((s) => (
                      <button key={s.id} role="radio" aria-checked={s.id === strengthId} className={`chip ${s.id === strengthId ? 'is-active' : ''}`} onClick={() => setStrengthId(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <div className="rp__stats-line">
              <Trophy size={18} />
              <span>{summary.games === 0 ? 'No games yet' : `${summary.games} ${summary.games === 1 ? 'game' : 'games'} · avg errors`}</span>
              {summary.games > 0 && <strong>{summary.avgErrors.toFixed(1)}</strong>}
            </div>
            {notice && <div className="rp__notice">{notice}</div>}
            <div className="rp__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} disabled={!opening || engine.state !== 'ready'} autoFocus>
              <Play size={18} /> Play
            </button>
            <div className="rp__hint">Space starts · Z takes back · H shows the book move</div>
          </>
        )}

        {phase !== 'setup' && game && opening && (
          <>
            <div className="rp__head">
              <button className="btn btn--icon" title="Settings" onClick={backToSetup}>
                <ChevronLeft size={18} />
              </button>
              <h2 className="rp__title">{opening.name}</h2>
              <span className={`side-badge side-badge--${game.userColor}`}>{game.userColor}</span>
            </div>
            <div className="rp__context">
              {startContext} · vs {strength.label}
            </div>
            <div className={`rp__status ${game.status !== 'playing' ? 'is-over' : thinking ? 'is-thinking' : userTurn ? (inBook ? 'is-book' : 'is-user') : ''}`} aria-live="polite">
              {status()}
            </div>
            <div className="rp__moves">{game.moves.length === 0 ? <span className="rp__num">No moves yet</span> : moveList()}<div ref={movesEndRef} /></div>

            {phase === 'playing' && (
              <>
                <div className="rp__actions">
                  <button className="btn" onClick={showHint} disabled={!userTurn || !inBook} title="Show the book move (H)">
                    <Lightbulb size={14} /> Book hint
                  </button>
                  <button className="btn" onClick={takeBack} disabled={!game.moves.some((m) => m.by === 'user')} title="Take back your last move (Z)">
                    <Undo2 size={14} /> Take back
                  </button>
                  <button className="btn" onClick={stopAndReview} disabled={game.moves.length === 0}>
                    <Square size={14} /> Stop & review
                  </button>
                </div>
                <div className="rp__spacer" />
                <div className="rp__hint">{inBook ? 'Gold moves are from your book.' : 'The engine is on its own now, and so are you.'}</div>
              </>
            )}

            {phase === 'review' && (
              <>
                {reviewProgress && (
                  <>
                    <div className="rp__progress">
                      <div style={{ width: `${(reviewProgress[0] / Math.max(1, reviewProgress[1])) * 100}%` }} />
                    </div>
                    <div className="rp__hint">Reviewing {reviewProgress[0]} of {reviewProgress[1]} positions…</div>
                  </>
                )}
                {review && (
                  <div className="rp__review-done">
                    <div className="rp__result">
                      <div className="rp__score">
                        {formatScore({ cp: review.finalCp, mate: review.finalMate })}
                        <small>final position, White's view · you are {game.userColor}</small>
                      </div>
                    </div>
                    <div className="rp__summary" style={{ marginTop: 10 }}>
                      <div className="stat">
                        <div className="stat__label">Moves</div>
                        <div className="stat__value">{review.reviewed}</div>
                      </div>
                      <div className={`stat ${review.mistakes ? 'stat--bad' : ''}`}>
                        <div className="stat__label">Mistakes</div>
                        <div className="stat__value">{review.mistakes}</div>
                      </div>
                      <div className={`stat ${review.blunders ? 'stat--bad' : ''}`}>
                        <div className="stat__label">Blunders</div>
                        <div className="stat__value">{review.blunders}</div>
                      </div>
                    </div>
                    {review.entries.some((e) => e.severity !== 'ok') ? (
                      <ul className="rp__errors" style={{ marginTop: 10 }}>
                        {review.entries
                          .filter((e) => e.severity !== 'ok')
                          .map((e) => (
                            <li key={e.index} className={`is-${e.severity}`}>
                              <span className="move">
                                {e.moveNumber}
                                {e.san}
                              </span>
                              <span className="best">{e.best ? `best was ${e.best}` : e.severity}</span>
                              <span className="loss">−{(e.loss / 100).toFixed(1)}</span>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <div className="rp__hint" style={{ marginTop: 10 }}>No mistakes among the reviewed moves.</div>
                    )}
                  </div>
                )}
                <div className="rp__spacer" />
                <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
                  <RotateCcw size={18} /> Play again
                </button>
                <button className="btn btn--ghost" onClick={backToSetup}>
                  <Settings2 size={14} /> Settings
                </button>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
