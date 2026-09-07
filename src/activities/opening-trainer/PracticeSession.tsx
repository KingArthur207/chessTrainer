// Spaced-repetition drill: the app plays the other side from the tree and
// quizzes the user on every move of their side until the end of each line.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Lightbulb, RotateCcw, SkipForward, Square } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { applyMove, inCheck, legalDests, turnOf } from '@/chess/position';
import { sounds } from '@/lib/sound';
import { childByUci, lastMoveOf, leafLines, lineKey, lineToSan, type Line, type Opening, type TreeNode } from './model';
import { describeDue, isDue, schedule, type LineProgress } from './srs';

interface PracticeSessionProps {
  opening: Opening;
  progress: Record<string, LineProgress>;
  mode: 'due' | 'all';
  onProgress: (lineKey: string, progress: LineProgress) => void;
  onExit: () => void;
  onEdit: () => void;
}

type Status = 'user' | 'wrong' | 'opponent' | 'line-done' | 'session-done';

interface SessionState {
  queue: Line[];
  index: number;
  path: TreeNode[];
  mistakes: number;
  hintLevel: number;
  status: Status;
  done: number;
  totalMistakes: number;
  message: string;
  lastResult: { mistakes: number; progress: LineProgress } | null;
}

const OPPONENT_DELAY = 420;
const NEXT_LINE_DELAY = 1700;

function buildQueue(opening: Opening, progress: Record<string, LineProgress>, mode: 'due' | 'all'): Line[] {
  const items = leafLines(opening.root).map((line) => ({ line, p: progress[line.key] }));
  const byDue = (a: { p?: LineProgress }, b: { p?: LineProgress }) => (a.p?.due ?? 0) - (b.p?.due ?? 0);
  const due = items.filter((i) => isDue(i.p)).sort(byDue);
  const rest = items.filter((i) => !isDue(i.p)).sort(byDue);
  const chosen = mode === 'all' || due.length === 0 ? [...due, ...rest] : due;
  return chosen.map((i) => i.line);
}

function isOnTarget(path: TreeNode[], target: Line): boolean {
  return path.slice(1).every((n, i) => target.nodes[i]?.id === n.id);
}

export function PracticeSession({ opening, progress, mode, onProgress, onExit, onEdit }: PracticeSessionProps) {
  const root = opening.root;
  const userSide = opening.color;
  const userToMove = useCallback((fen: string) => turnOf(fen) === userSide, [userSide]);

  const initial = useMemo<SessionState>(() => {
    const queue = buildQueue(opening, progress, mode);
    return {
      queue,
      index: 0,
      path: [root],
      mistakes: 0,
      hintLevel: 0,
      status: queue.length === 0 ? 'session-done' : userToMove(root.fen) ? 'user' : 'opponent',
      done: 0,
      totalMistakes: 0,
      message: '',
      lastResult: null,
    };
    // Build once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [state, setState] = useState<SessionState>(initial);
  const stateRef = useRef(state);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const timerRef = useRef<number | null>(null);
  const [missFlash, setMissFlash] = useState(false);

  const update = useCallback((patch: Partial<SessionState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const later = (fn: () => void, ms: number) => {
    clearTimer();
    timerRef.current = window.setTimeout(fn, ms);
  };

  const target = state.queue[state.index];
  const node = state.path[state.path.length - 1];
  const fen = node.fen;
  const expected = useMemo<TreeNode | undefined>(() => {
    if (!target) return undefined;
    return isOnTarget(state.path, target) ? target.nodes[state.path.length - 1] : node.children[0];
  }, [state.path, target, node]);

  const nextLine = useCallback(() => {
    clearTimer();
    const s = stateRef.current;
    if (s.index + 1 >= s.queue.length) {
      update({ status: 'session-done', message: '' });
      return;
    }
    const index = s.index + 1;
    const opponentFirst = !userToMove(root.fen);
    update({
      index,
      path: [root],
      mistakes: 0,
      hintLevel: 0,
      lastResult: null,
      status: opponentFirst ? 'opponent' : 'user',
      message: opponentFirst ? 'Book move…' : 'Your move',
    });
    if (opponentFirst) later(playOpponent, OPPONENT_DELAY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, update, userToMove]);

  const finishLine = useCallback(
    (path: TreeNode[], mistakes: number) => {
      const key = lineKey(path.slice(1));
      const next = schedule(progressRef.current[key], mistakes);
      onProgress(key, next);
      const s = stateRef.current;
      update({
        path,
        status: 'line-done',
        done: s.done + 1,
        totalMistakes: s.totalMistakes + mistakes,
        lastResult: { mistakes, progress: next },
        message: mistakes === 0 ? 'Line complete, flawless.' : `Line complete with ${mistakes} ${mistakes === 1 ? 'mistake' : 'mistakes'}.`,
      });
      sounds.start();
      later(nextLine, NEXT_LINE_DELAY);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onProgress, update, nextLine],
  );

  function playOpponent() {
    const s = stateRef.current;
    if (s.status !== 'opponent') return;
    const current = s.path[s.path.length - 1];
    const line = s.queue[s.index];
    const onTarget = isOnTarget(s.path, line);
    const reply = onTarget
      ? line.nodes[s.path.length - 1]
      : current.children[Math.floor(Math.random() * current.children.length)];
    if (!reply) {
      finishLine(s.path, s.mistakes);
      return;
    }
    const path = [...s.path, reply];
    if (reply.children.length === 0) finishLine(path, s.mistakes);
    else update({ path, status: 'user', message: 'Your move' });
  }

  // Kick off the first line.
  useEffect(() => {
    if (initial.status === 'opponent') later(playOpponent, OPPONENT_DELAY);
    else if (initial.status === 'user') update({ message: 'Your move' });
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUserMove = useCallback(
    (orig: Key, dest: Key): boolean => {
      const s = stateRef.current;
      if (s.status !== 'user' && s.status !== 'wrong') return false;
      const current = s.path[s.path.length - 1];
      const applied = applyMove(current.fen, orig, dest, 'q');
      if (!applied) return false;
      const child = childByUci(current, applied.uci);
      if (child) {
        sounds.success();
        const path = [...s.path, child];
        if (child.children.length === 0) {
          finishLine(path, s.mistakes);
        } else {
          update({ path, status: 'opponent', hintLevel: 0, message: 'Book move…' });
          later(playOpponent, OPPONENT_DELAY);
        }
        return true;
      }
      const mistakes = s.mistakes + 1;
      const hintLevel = s.hintLevel + 1;
      sounds.miss();
      setMissFlash(true);
      window.setTimeout(() => setMissFlash(false), 260);
      update({
        mistakes,
        hintLevel,
        status: 'wrong',
        message:
          hintLevel === 1
            ? `${applied.san} is not in your repertoire. Try again.`
            : hintLevel === 2
              ? 'Hint: move the highlighted piece.'
              : 'The book move is shown. Play it to continue.',
      });
      return false;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishLine, update],
  );

  const showHint = () => {
    const s = stateRef.current;
    if (s.status !== 'user' && s.status !== 'wrong') return;
    const hintLevel = Math.max(s.hintLevel + 1, 2);
    update({ hintLevel, message: hintLevel === 2 ? 'Hint: move the highlighted piece.' : 'The book move is shown. Play it to continue.' });
  };

  const skipLine = () => {
    const s = stateRef.current;
    if (s.status === 'session-done') return;
    nextLine();
  };

  const restartAll = () => {
    clearTimer();
    const queue = buildQueue(opening, progressRef.current, 'all');
    const opponentFirst = !userToMove(root.fen);
    update({
      queue,
      index: 0,
      path: [root],
      mistakes: 0,
      hintLevel: 0,
      done: 0,
      totalMistakes: 0,
      lastResult: null,
      status: queue.length === 0 ? 'session-done' : opponentFirst ? 'opponent' : 'user',
      message: opponentFirst ? 'Book move…' : 'Your move',
    });
    if (queue.length > 0 && opponentFirst) later(playOpponent, OPPONENT_DELAY);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && stateRef.current.status === 'line-done') {
        e.preventDefault();
        nextLine();
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextLine, onExit]);

  // ---- Derived board props ----------------------------------------------------
  const interactive = state.status === 'user' || state.status === 'wrong';
  const dests = useMemo(() => (interactive ? legalDests(fen) : undefined), [fen, interactive]);
  const lastMove = useMemo(() => lastMoveOf(state.path), [state.path]);
  const check = useMemo(() => inCheck(fen), [fen]);
  const highlights = useMemo(() => {
    if (!expected || !interactive || state.hintLevel < 2) return undefined;
    return new Map<Key, string>([[expected.uci.slice(0, 2) as Key, 'hint']]);
  }, [expected, interactive, state.hintLevel]);
  const shapes = useMemo<DrawShape[]>(() => {
    if (!expected || !interactive || state.hintLevel < 3) return [];
    return [{ orig: expected.uci.slice(0, 2) as Key, dest: expected.uci.slice(2, 4) as Key, brush: 'green' }];
  }, [expected, interactive, state.hintLevel]);

  const movesSoFar = lineToSan(state.path.slice(1), root.fen).split(' ').filter(Boolean);
  const note = node.comment;
  const total = state.queue.length;
  const statusClass =
    state.status === 'wrong' ? 'is-wrong' : state.status === 'line-done' ? 'is-done' : state.status === 'user' ? 'is-user' : '';

  return (
    <div className="ot">
      <div className="ot__board">
        <Board
          fen={fen}
          orientation={userSide}
          interactive={interactive}
          dests={dests}
          lastMove={lastMove}
          turnColor={turnOf(fen)}
          check={check}
          highlights={highlights}
          shapes={shapes}
          animateChanges
          onUserMove={handleUserMove}
          frameClassName={missFlash ? 'is-miss' : ''}
        />
      </div>

      <aside className="ot__panel">
        <div className="ot__head">
          <button className="btn btn--icon" title="Back to openings" onClick={onExit}>
            <ChevronLeft size={18} />
          </button>
          <h2 className="ot__title">{opening.name}</h2>
          <span className={`side-badge side-badge--${userSide}`}>{userSide}</span>
        </div>

        {state.status === 'session-done' ? (
          <>
            <div className="pr__status is-done">
              {total === 0 ? 'Nothing to practise yet. Add some theory first.' : 'Session complete.'}
            </div>
            {total > 0 && (
              <div className="pr__summary">
                <div className="stat stat--good">
                  <div className="stat__label">Lines completed</div>
                  <div className="stat__value">{state.done}</div>
                </div>
                <div className={`stat ${state.totalMistakes ? 'stat--bad' : ''}`}>
                  <div className="stat__label">Mistakes</div>
                  <div className="stat__value">{state.totalMistakes}</div>
                </div>
              </div>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn--primary btn--lg" onClick={restartAll}>
              <RotateCcw size={16} /> Practise all lines again
            </button>
            <button className="btn" onClick={onEdit}>
              Edit theory
            </button>
            <button className="btn btn--ghost" onClick={onExit}>
              Back to openings
            </button>
          </>
        ) : (
          <>
            <div className="ot__meta">
              Line {Math.min(state.index + 1, total)} of {total} · {mode === 'due' ? 'due lines' : 'all lines'}
            </div>
            <div className="pr__progress">
              <div style={{ width: `${(state.done / Math.max(total, 1)) * 100}%` }} />
            </div>

            <div className={`pr__status ${statusClass}`} aria-live="polite">
              {state.message || (state.status === 'opponent' ? 'Book move…' : 'Your move')}
              {state.status === 'line-done' && state.lastResult && (
                <div className="ot__hint" style={{ marginTop: 4 }}>
                  Next review {describeDue(state.lastResult.progress)}. Space for the next line.
                </div>
              )}
            </div>

            <div className="ot__label">Moves</div>
            <div className="pr__moves">
              {movesSoFar.length === 0 ? (
                <span className="mt-empty">Start position</span>
              ) : (
                movesSoFar.map((tok, i) => (
                  <span key={i} className={i === movesSoFar.length - 1 ? 'is-last' : ''}>
                    {tok}
                  </span>
                ))
              )}
            </div>

            {note && <div className="pr__note">{note}</div>}

            <div className="pr__stats">
              <div className={`stat ${state.mistakes ? 'stat--bad' : ''}`}>
                <div className="stat__label">Mistakes this line</div>
                <div className="stat__value">{state.mistakes}</div>
              </div>
              <div className="stat stat--good">
                <div className="stat__label">Lines done</div>
                <div className="stat__value">{state.done}</div>
              </div>
            </div>

            <div style={{ flex: 1 }} />
            <div className="ot__actions">
              <button className="btn" onClick={showHint} disabled={!interactive}>
                <Lightbulb size={14} /> Hint
              </button>
              <button className="btn" onClick={skipLine}>
                <SkipForward size={14} /> Skip line
              </button>
              <button className="btn btn--ghost" onClick={onExit}>
                <Square size={14} /> End
              </button>
            </div>
            <div className="ot__hint">Any move from your repertoire is accepted. Esc ends the session.</div>
          </>
        )}
      </aside>
    </div>
  );
}
