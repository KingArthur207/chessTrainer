// Blindfold visualisation: read a move sequence, picture the resulting
// position, answer questions about it, then watch the moves play out.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Eye, EyeOff, Play, RotateCcw, Settings2, Trophy, X } from 'lucide-react';
import { Board, type Key, type Piece } from '@/board/Board';
import { PiecePalette } from '@/components/PiecePalette';
import { getSnapshot, isOnline, refreshPool, subscribe, visualisationRemaining } from '@/activities/board-memory/lichessPool';
import { LichessPoolPanel } from '@/activities/board-memory/LichessPoolPanel';
import { EMPTY_BOARD } from '@/activities/board-memory/positions';
import { loadOpenings } from '@/activities/opening-trainer/store';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import { DEPTHS, describeAnswer, describeGiven, isCorrect, type Answer, type Depth, type Exercise, type VisSource } from './exercise';
import { exerciseFromClassics, exerciseFromLichess, exerciseFromOpenings, openingsHaveSequences, VIS_SOURCES } from './sources';
import { getHistory, recordAttempt, summarise, type VisAttempt } from './stats';
import './visualisation.css';

type Phase = 'setup' | 'quiz' | 'reveal';

interface Given {
  answer: Answer;
  correct: boolean;
}

const HIDE_AFTER_SECONDS = 10;
const PLAYBACK_MS = 750;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function Visualisation() {
  const [source, setSource] = useState<VisSource>(() => loadJson<VisSource>('visualisation:source', 'lichess'));
  const [depth, setDepth] = useState<Depth>(() => loadJson<Depth>('visualisation:depth', 4));
  const [hidden, setHidden] = useState<boolean>(() => loadJson<boolean>('visualisation:hidden', false));
  const [phase, setPhase] = useState<Phase>('setup');
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [given, setGiven] = useState<Given[]>([]);
  const [feedback, setFeedback] = useState<Given | null>(null);
  const [boardHidden, setBoardHidden] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [history, setHistory] = useState<VisAttempt[]>(() => getHistory());
  const [notice, setNotice] = useState<string | null>(null);
  const [session, setSession] = useState({ correct: 0, total: 0 });
  const hideTimer = useRef<number | null>(null);
  const playTimer = useRef<number | null>(null);
  const pendingStartRef = useRef(false);

  const openings = useMemo(() => loadOpenings(), []);
  const openingsAvailable = useMemo(() => openingsHaveSequences(openings, depth), [openings, depth]);
  const lichess = useSyncExternalStore(subscribe, getSnapshot);
  const lichessRemaining = visualisationRemaining(depth);

  useEffect(() => saveJson('visualisation:source', source), [source]);
  useEffect(() => saveJson('visualisation:depth', depth), [depth]);
  useEffect(() => saveJson('visualisation:hidden', hidden), [hidden]);
  useEffect(() => {
    if (source === 'lichess' && lichess.summary.total === 0 && lichess.status.state === 'idle') void refreshPool();
  }, [source, lichess.summary.total, lichess.status.state]);

  const clearTimers = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    if (playTimer.current !== null) window.clearTimeout(playTimer.current);
    hideTimer.current = null;
    playTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const start = useCallback(() => {
    let ex: Exercise | null = null;
    if (source === 'lichess') {
      ex = exerciseFromLichess(depth);
      if (!ex) {
        const st = getSnapshot().status;
        if (st.state === 'fetching') {
          pendingStartRef.current = true;
          setNotice('Fetching games from Lichess. The exercise will start as soon as they arrive.');
        } else if (!isOnline()) {
          setNotice('You are offline and no unused Lichess sequences remain. Connect to fetch new games, or use another source.');
        } else {
          pendingStartRef.current = true;
          setNotice('No unused Lichess sequences left. Fetching new games…');
          void refreshPool(true);
        }
        return;
      }
    } else if (source === 'games') {
      ex = exerciseFromClassics(depth);
    } else {
      ex = exerciseFromOpenings(openings, depth);
      if (!ex) {
        setNotice(`Your openings have no lines of ${depth} plies yet. Add theory in the Opening Trainer, or pick a shorter depth.`);
        return;
      }
    }
    if (!ex) {
      setNotice('Could not build an exercise from that source.');
      return;
    }
    clearTimers();
    setNotice(null);
    setExercise(ex);
    setQIndex(0);
    setGiven([]);
    setFeedback(null);
    setBoardHidden(false);
    setPlayIndex(0);
    setPhase('quiz');
    if (hidden) hideTimer.current = window.setTimeout(() => setBoardHidden(true), HIDE_AFTER_SECONDS * 1000);
  }, [source, depth, hidden, openings]);

  useEffect(() => {
    if (!pendingStartRef.current || lichess.status.state === 'fetching') return;
    pendingStartRef.current = false;
    if (lichess.status.state === 'idle' && visualisationRemaining(depth) > 0) start();
    else if (lichess.status.state === 'error') setNotice(lichess.status.message);
  }, [lichess.status, depth, start]);

  const question = exercise?.questions[qIndex];

  const submit = useCallback(
    (answer: Answer) => {
      if (!exercise || !question || feedback) return;
      const correct = isCorrect(question, answer);
      const g = { answer, correct };
      setGiven((prev) => [...prev, g]);
      setFeedback(g);
      if (correct) sounds.success();
      else sounds.miss();
    },
    [exercise, question, feedback],
  );

  const reveal = useCallback(
    (all: Given[]) => {
      if (!exercise) return;
      const correct = all.filter((g) => g.correct).length;
      setHistory(
        recordAttempt({
          date: new Date().toISOString(),
          source: exercise.source,
          depth: exercise.moves.length,
          hidden,
          correct,
          total: all.length,
        }),
      );
      setSession((s) => ({ correct: s.correct + correct, total: s.total + all.length }));
      setBoardHidden(false);
      setPlayIndex(0);
      setPhase('reveal');
      if (correct === all.length) sounds.finish();
    },
    [exercise, hidden],
  );

  const next = useCallback(() => {
    if (!exercise || !feedback) return;
    setFeedback(null);
    if (qIndex + 1 < exercise.questions.length) setQIndex(qIndex + 1);
    else reveal(given);
  }, [exercise, feedback, qIndex, given, reveal]);

  // Playback of the sequence during the reveal.
  useEffect(() => {
    if (phase !== 'reveal' || !exercise) return;
    if (playIndex >= exercise.moves.length) return;
    playTimer.current = window.setTimeout(() => setPlayIndex((i) => i + 1), PLAYBACK_MS);
    return () => {
      if (playTimer.current !== null) window.clearTimeout(playTimer.current);
    };
  }, [phase, exercise, playIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (phase === 'setup' || phase === 'reveal') start();
        else if (phase === 'quiz' && feedback) next();
        else return;
      } else if (e.key === 'Escape') {
        if (phase !== 'setup') {
          clearTimers();
          setPhase('setup');
        } else return;
      } else if (phase === 'quiz' && !feedback && question && (question.type === 'check' || question.type === 'attacked')) {
        if (e.key === 'y' || e.key === 'Y') submit(true);
        else if (e.key === 'n' || e.key === 'N') submit(false);
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, feedback, question, start, next, submit]);

  const summary = useMemo(() => summarise(history), [history]);
  const sourceInfo = VIS_SOURCES.find((s) => s.id === source)!;

  // ---- Board -----------------------------------------------------------------
  let boardFen = EMPTY_BOARD;
  let lastMove: [Key, Key] | undefined;
  const highlights = new Map<Key, string>();
  if (exercise && phase === 'quiz') {
    boardFen = boardHidden ? EMPTY_BOARD : exercise.startFen;
    if (feedback && question?.type === 'locate' && !boardHidden) {
      highlights.set(question.answer, 'correct');
      if (!feedback.correct && typeof feedback.answer === 'string') highlights.set(feedback.answer as Key, 'wrong');
    }
  } else if (exercise && phase === 'reveal') {
    boardFen = playIndex === 0 ? exercise.startFen : exercise.moves[playIndex - 1].fenAfter;
    if (playIndex > 0) lastMove = [exercise.moves[playIndex - 1].from, exercise.moves[playIndex - 1].to];
    if (playIndex >= exercise.moves.length) {
      exercise.questions.forEach((q, i) => {
        const g = given[i];
        if (!g) return;
        if (q.type === 'piece-on') highlights.set(q.square, g.correct ? 'correct' : 'wrong');
        else if (q.type === 'locate') {
          highlights.set(q.answer, g.correct ? 'correct' : 'missing');
          if (!g.correct && typeof g.answer === 'string') highlights.set(g.answer as Key, 'wrong');
        } else if (q.type === 'attacked') highlights.set(q.square, 'hint');
      });
    }
  }

  const onSquare = (key: Key) => {
    if (phase === 'quiz' && question?.type === 'locate' && !feedback) submit(key);
  };

  const correctCount = given.filter((g) => g.correct).length;

  return (
    <div className="vis" data-start-fen={exercise?.startFen ?? ''} data-phase={phase}>
      <div className="vis__board">
        <Board
          fen={boardFen}
          interactive={false}
          lastMove={lastMove}
          highlights={highlights}
          animateChanges={phase === 'reveal'}
          onSquareSelect={onSquare}
          frameClassName={phase === 'quiz' && boardHidden ? 'is-locked' : ''}
        />
      </div>

      <aside className="vis__panel">
        {phase === 'setup' && (
          <>
            <h2 className="vis__heading">
              <Eye size={22} /> Blindfold Visualisation
            </h2>
            <p className="vis__lede">
              A position is shown, then a few moves are given in notation only. Picture the resulting position in your
              head and answer questions about it. This is the muscle calculation runs on.
            </p>
            <div className="vis__section">
              <div className="vis__label">Sequences from</div>
              <div className="vis__chips" role="radiogroup" aria-label="Source">
                {VIS_SOURCES.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={s.id === source}
                    className={`chip ${s.id === source ? 'is-active' : ''}`}
                    disabled={s.id === 'openings' && !openingsAvailable}
                    title={s.id === 'openings' && !openingsAvailable ? `Add repertoire lines of at least ${depth} plies first` : undefined}
                    onClick={() => setSource(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="vis__blurb">{sourceInfo.blurb}</div>
              {source === 'lichess' && (
                <LichessPoolPanel detail={`${lichessRemaining.toLocaleString()} unused ${depth}-ply sequences saved`} />
              )}
            </div>
            <div className="vis__section">
              <div className="vis__label">Moves to visualise</div>
              <div className="vis__chips vis__depths" role="radiogroup" aria-label="Depth">
                {DEPTHS.map((d) => (
                  <button
                    key={d}
                    role="radio"
                    aria-checked={d === depth}
                    className={`chip ${d === depth ? 'is-active' : ''}`}
                    onClick={() => setDepth(d)}
                  >
                    {d} plies
                  </button>
                ))}
              </div>
            </div>
            <div className="vis__section">
              <div className="vis__label">Board</div>
              <div className="seg vis__mode" role="radiogroup" aria-label="Board visibility">
                <button className={!hidden ? 'is-active' : ''} onClick={() => setHidden(false)}>
                  <Eye size={14} /> Stays visible
                </button>
                <button className={hidden ? 'is-active' : ''} onClick={() => setHidden(true)}>
                  <EyeOff size={14} /> Hidden after {HIDE_AFTER_SECONDS}s
                </button>
              </div>
              <div className="vis__blurb">
                {hidden
                  ? 'True blindfold: memorise the start position, then it disappears while you work through the moves.'
                  : 'The start position stays on the board (the pieces never move); you imagine the moves on top of it.'}
              </div>
            </div>
            <div className="vis__stats-line">
              <Trophy size={18} />
              <span>
                {summary.attempts === 0
                  ? 'No exercises yet'
                  : `${summary.attempts} ${summary.attempts === 1 ? 'exercise' : 'exercises'} · last 10 avg`}
              </span>
              {summary.attempts > 0 && <strong>{pct(summary.recent)}</strong>}
            </div>
            {notice && <div className="vis__notice">{notice}</div>}
            <div className="vis__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <Play size={18} /> Start
            </button>
            <div className="vis__hint">Space starts an exercise</div>
          </>
        )}

        {phase === 'quiz' && exercise && question && (
          <>
            <div className="vis__source">{exercise.label}</div>
            <div className="vis__label">Visualise these moves</div>
            <div className="vis__moves">{exercise.movesText}</div>
            {hidden && !boardHidden && (
              <>
                <div className="vis__timer" aria-hidden="true">
                  <div key={exercise.startFen} style={{ animationDuration: `${HIDE_AFTER_SECONDS}s` }} />
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    clearTimers();
                    setBoardHidden(true);
                  }}
                >
                  <EyeOff size={14} /> Hide the board now
                </button>
              </>
            )}

            <div
              className="vis__question"
              data-type={question.type}
              data-square={'square' in question ? question.square : ''}
              data-piece={'piece' in question ? `${question.piece.color} ${question.piece.role}` : ''}
              data-color={'color' in question ? question.color : ''}
            >
              <div className="vis__question-meta">
                Question {qIndex + 1} of {exercise.questions.length}
              </div>
              <div className="vis__prompt">{question.prompt}</div>
              {!feedback && question.type === 'piece-on' && (
                <>
                  <PiecePalette selected={null} onSelect={(p: Piece | null) => submit(p)} />
                  <button className="btn" onClick={() => submit(null)}>
                    Empty square
                  </button>
                </>
              )}
              {!feedback && question.type === 'locate' && (
                <div className="vis__answer-hint">Click the square on the board.</div>
              )}
              {!feedback && (question.type === 'check' || question.type === 'attacked') && (
                <div className="vis__yesno">
                  <button className="btn" onClick={() => submit(true)}>
                    Yes
                  </button>
                  <button className="btn" onClick={() => submit(false)}>
                    No
                  </button>
                </div>
              )}
              {feedback && (
                <div className={`vis__feedback ${feedback.correct ? 'is-correct' : 'is-wrong'}`}>
                  {feedback.correct
                    ? `Correct: ${describeAnswer(question)}.`
                    : `Wrong. You said ${describeGiven(question, feedback.answer)}; the answer is ${describeAnswer(question)}.`}
                </div>
              )}
            </div>
            <div className="vis__spacer" />
            {feedback ? (
              <button className="btn btn--primary btn--lg" onClick={next} autoFocus>
                {qIndex + 1 < exercise.questions.length ? 'Next question' : 'Show the moves'}
              </button>
            ) : (
              <div className="vis__hint">
                {question.type === 'check' || question.type === 'attacked' ? 'Y / N answer too' : 'Take your time; there is no clock.'}
              </div>
            )}
            <div className="vis__hint">Esc returns to settings</div>
          </>
        )}

        {phase === 'reveal' && exercise && (
          <>
            <div className="vis__source">{exercise.label}</div>
            <div className="vis__score">
              {correctCount} / {exercise.questions.length}
              <small>{playIndex < exercise.moves.length ? 'playing the moves…' : 'final position'}</small>
            </div>
            <div className="vis__moves">{exercise.movesText}</div>
            <ul className="vis__results">
              {exercise.questions.map((q, i) => (
                <li key={i} className={given[i]?.correct ? 'is-correct' : 'is-wrong'}>
                  {given[i]?.correct ? <Check size={16} /> : <X size={16} />}
                  <div>
                    <strong>{q.prompt}</strong>{' '}
                    <span>
                      {describeAnswer(q)}
                      {given[i] && !given[i].correct ? ` (you said ${describeGiven(q, given[i].answer)})` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="vis__stats-line">
              <Trophy size={18} />
              <span>Session · {session.total} questions</span>
              <strong>{pct(session.total ? session.correct / session.total : 0)}</strong>
            </div>
            <div className="vis__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
              <RotateCcw size={18} /> Next exercise
            </button>
            <div className="ot__actions" style={{ display: 'flex', gap: 6 }}>
              <button className="btn" onClick={() => setPlayIndex(0)} disabled={playIndex < exercise.moves.length}>
                <Play size={14} /> Replay
              </button>
              <button className="btn btn--ghost" onClick={() => setPhase('setup')}>
                <Settings2 size={14} /> Settings
              </button>
            </div>
            <div className="vis__hint">Space for the next one · Esc for settings</div>
          </>
        )}
      </aside>
    </div>
  );
}
