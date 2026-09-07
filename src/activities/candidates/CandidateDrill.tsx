// Candidate-move drill: name up to three candidate moves on the board before
// seeing Stockfish's top three (MultiPV).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ListOrdered, Play, RotateCcw, Settings2, Trophy, X } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { EngineStatus } from '@/components/EngineStatus';
import { getSnapshot, isOnline, refreshPool, subscribe } from '@/activities/board-memory/lichessPool';
import { LichessPoolPanel } from '@/activities/board-memory/LichessPoolPanel';
import { loadOpenings } from '@/activities/opening-trainer/store';
import { lichessUsableCount, openingsAvailable, pickPosition, POSITION_SOURCES, type PositionSource, type SourcedPosition } from '@/activities/shared/positionSources';
import { applyMove, inCheck, legalDests, turnOf } from '@/chess/position';
import { formatScore, getEngineSession, type Evaluation } from '@/engine/session';
import { useEngineStatus } from '@/engine/useEngineStatus';
import { sounds } from '@/lib/sound';
import { loadJson, saveJson } from '@/lib/storage';
import { compare, describeComparison, MAX_CANDIDATES, rankingFrom, type Comparison, type EngineCandidate, type UserCandidate } from './drill';
import { getHistory, recordAttempt, summarise, type CandidateAttempt } from './stats';
import './candidates.css';

type Phase = 'setup' | 'quiz' | 'reveal';

const TIMES: Array<{ seconds: number; label: string }> = [
  { seconds: 2, label: 'Fast · 2s' },
  { seconds: 4, label: 'Normal · 4s' },
  { seconds: 8, label: 'Deep · 8s' },
];
const EMPTY_BOARD = '8/8/8/8/8/8/8/8';
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Skip positions with too few options to make a choice interesting. */
const enoughChoice = (fen: string) => legalDests(fen).size >= 4;

export default function CandidateDrill() {
  const [source, setSource] = useState<PositionSource>(() => loadJson<PositionSource>('candidates:source', 'lichess'));
  const [seconds, setSeconds] = useState<number>(() => loadJson<number>('candidates:seconds', 4));
  const [phase, setPhase] = useState<Phase>('setup');
  const [position, setPosition] = useState<SourcedPosition | null>(null);
  const [candidates, setCandidates] = useState<UserCandidate[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [ranking, setRanking] = useState<EngineCandidate[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [ownScores, setOwnScores] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<CandidateAttempt[]>(() => getHistory());
  const [session, setSession] = useState({ best: 0, overlap: 0, total: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useEngineStatus();
  const requestRef = useRef(0);
  const positionRef = useRef<SourcedPosition | null>(null);
  const candidatesRef = useRef<UserCandidate[]>([]);
  const evalRef = useRef<Evaluation | null>(null);
  const revealRequested = useRef(false);
  const pendingStartRef = useRef(false);

  const openings = useMemo(() => loadOpenings(), []);
  const lichess = useSyncExternalStore(subscribe, getSnapshot);
  const lichessUsable = lichessUsableCount();
  const openingsOk = useMemo(() => openingsAvailable(openings), [openings]);

  useEffect(() => saveJson('candidates:source', source), [source]);
  useEffect(() => saveJson('candidates:seconds', seconds), [seconds]);
  useEffect(() => {
    if (source === 'lichess' && lichess.summary.total === 0 && lichess.status.state === 'idle') void refreshPool();
  }, [source, lichess.summary.total, lichess.status.state]);

  const reveal = useCallback(
    (ev: Evaluation) => {
      const pos = positionRef.current;
      if (!pos) return;
      const list = candidatesRef.current;
      const ranked = rankingFrom(ev, pos.fen);
      const cmp = compare(list, ranked);
      setRanking(ranked);
      setComparison(cmp);
      setPhase('reveal');
      setHistory(recordAttempt({ date: new Date().toISOString(), source: pos.source, seconds, candidates: list.length, foundBest: cmp.foundBest, overlap: cmp.overlap }));
      setSession((s) => ({ best: s.best + (cmp.foundBest ? 1 : 0), overlap: s.overlap + cmp.overlap, total: s.total + 1 }));
      if (cmp.foundBest) sounds.finish();
      else if (cmp.overlap > 0) sounds.success();
      else sounds.miss();
      // Score the user's candidates the engine did not rank, briefly.
      const id = requestRef.current;
      const missing = list.filter((c) => !ranked.some((r) => r.uci === c.uci));
      void (async () => {
        for (const c of missing) {
          const after = applyMove(pos.fen, c.uci.slice(0, 2) as Key, c.uci.slice(2, 4) as Key, (c.uci.slice(4, 5) || 'q') as 'q' | 'r' | 'b' | 'n');
          if (!after) continue;
          try {
            const r = await getEngineSession().analyse(after.fen, { moveTimeMs: Math.min(1500, seconds * 400), multiPv: 1 });
            if (id !== requestRef.current) return;
            setOwnScores((prev) => ({ ...prev, [c.uci]: formatScore(r) }));
          } catch {
            return;
          }
        }
      })();
    },
    [seconds],
  );

  const start = useCallback(() => {
    if (engine.state !== 'ready') return;
    const pos = pickPosition(source, openings, position?.fen, Math.random, enoughChoice);
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
      } else setNotice('No positions available from that source yet.');
      return;
    }
    getEngineSession().stop();
    const id = ++requestRef.current;
    setNotice(null);
    positionRef.current = pos;
    setPosition(pos);
    candidatesRef.current = [];
    setCandidates([]);
    setEvaluation(null);
    evalRef.current = null;
    setRanking([]);
    setComparison(null);
    setOwnScores({});
    revealRequested.current = false;
    setPhase('quiz');
    getEngineSession()
      .analyse(pos.fen, {
        moveTimeMs: seconds * 1000,
        multiPv: MAX_CANDIDATES,
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
        if (revealRequested.current) reveal(final);
      })
      .catch((err: unknown) => {
        if (id !== requestRef.current) return;
        setNotice(err instanceof Error ? err.message : String(err));
        setPhase('setup');
      });
  }, [engine.state, source, openings, position, seconds, reveal]);

  useEffect(() => {
    if (!pendingStartRef.current || lichess.status.state === 'fetching') return;
    pendingStartRef.current = false;
    if (lichess.status.state === 'idle' && lichessUsableCount() > 0) start();
    else if (lichess.status.state === 'error') setNotice(lichess.status.message);
  }, [lichess.status, start]);

  const requestReveal = useCallback(() => {
    if (phase !== 'quiz' || candidatesRef.current.length === 0 || revealRequested.current) return;
    revealRequested.current = true;
    const ev = evalRef.current;
    if (ev?.final) reveal(ev);
  }, [phase, reveal]);

  const addCandidate = useCallback(
    (orig: Key, dest: Key): boolean => {
      const pos = positionRef.current;
      if (!pos || phase !== 'quiz' || revealRequested.current) return false;
      const applied = applyMove(pos.fen, orig, dest, 'q');
      if (!applied) return false;
      const list = candidatesRef.current;
      if (list.length >= MAX_CANDIDATES || list.some((c) => c.uci === applied.uci)) return false;
      const next = [...list, { uci: applied.uci, san: applied.san }];
      candidatesRef.current = next;
      setCandidates(next);
      sounds.success();
      if (next.length === MAX_CANDIDATES) window.setTimeout(requestReveal, 350);
      // Snap back: the board keeps showing the position under review.
      return false;
    },
    [phase, requestReveal],
  );

  const removeCandidate = (uci: string) => {
    if (phase !== 'quiz' || revealRequested.current) return;
    const next = candidatesRef.current.filter((c) => c.uci !== uci);
    candidatesRef.current = next;
    setCandidates(next);
  };

  const backToSetup = useCallback(() => {
    requestRef.current++;
    getEngineSession().stop();
    setPhase('setup');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (phase === 'setup' || phase === 'reveal') start();
        else if (phase === 'quiz') requestReveal();
        else return;
      } else if (e.key === 'Escape') {
        if (phase === 'setup') return;
        backToSetup();
      } else if (e.key === 'Backspace' && phase === 'quiz') {
        const last = candidatesRef.current[candidatesRef.current.length - 1];
        if (last) removeCandidate(last.uci);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, start, requestReveal, backToSetup]);

  const summary = useMemo(() => summarise(history), [history]);
  const fen = position?.fen ?? EMPTY_BOARD;
  const turn = position ? turnOf(position.fen) : 'white';
  const dests = useMemo(() => (phase === 'quiz' && position ? legalDests(position.fen) : undefined), [phase, position]);
  const shapes = useMemo<DrawShape[]>(() => {
    const arrow = (uci: string, brush: string): DrawShape => ({ orig: uci.slice(0, 2) as Key, dest: uci.slice(2, 4) as Key, brush });
    if (phase === 'quiz') return candidates.map((c) => arrow(c.uci, 'blue'));
    if (phase === 'reveal') {
      const own = new Set(candidates.map((c) => c.uci));
      return [
        ...ranking.map((r) => arrow(r.uci, own.has(r.uci) ? 'green' : 'paleGreen')),
        ...candidates.filter((c) => !ranking.some((r) => r.uci === c.uci)).map((c) => arrow(c.uci, 'red')),
      ];
    }
    return [];
  }, [phase, candidates, ranking]);
  const waiting = phase === 'quiz' && revealRequested.current && !evaluation?.final;
  const sourceInfo = POSITION_SOURCES.find((s) => s.id === source)!;
  const sourceOk: Record<PositionSource, boolean> = { lichess: true, games: true, openings: openingsOk };

  return (
    <div className="cm" data-phase={phase} data-fen={position?.fen ?? ''}>
      <div className="cm__board">
        <Board
          fen={fen}
          orientation={turn}
          interactive={phase === 'quiz' && !revealRequested.current}
          dests={dests}
          showDests
          turnColor={turn}
          check={position ? inCheck(position.fen) : false}
          shapes={shapes}
          onUserMove={addCandidate}
        />
      </div>

      <aside className="cm__panel">
        {phase === 'setup' && (
          <>
            <h2 className="cm__heading">
              <ListOrdered size={22} /> Candidate Moves
            </h2>
            <p className="cm__lede">
              Before you look for the best move, list the moves worth considering. Name up to three candidates on the
              board, then see Stockfish's top three. The habit of enumerating options beats grabbing the first idea.
            </p>
            <EngineStatus status={engine} />
            <div className="cm__section">
              <div className="cm__label">Positions from</div>
              <div className="cm__chips cm__sources" role="radiogroup" aria-label="Source">
                {POSITION_SOURCES.map((s) => (
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
              <div className="cm__blurb">{sourceInfo.blurb}</div>
              {source === 'lichess' && <LichessPoolPanel detail={`${lichessUsable.toLocaleString()} positions usable`} />}
            </div>
            <div className="cm__section">
              <div className="cm__label">Engine thinking time</div>
              <div className="cm__chips cm__times" role="radiogroup" aria-label="Analysis time">
                {TIMES.map((t) => (
                  <button key={t.seconds} role="radio" aria-checked={t.seconds === seconds} className={`chip ${t.seconds === seconds ? 'is-active' : ''}`} onClick={() => setSeconds(t.seconds)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="cm__stats-line">
              <Trophy size={18} />
              <span>{summary.attempts === 0 ? 'No positions yet' : `${summary.attempts} positions · best move found`}</span>
              {summary.attempts > 0 && <strong>{pct(summary.bestRate)} · {summary.avgOverlap.toFixed(1)}/3</strong>}
            </div>
            {notice && <div className="cm__notice">{notice}</div>}
            <div className="cm__spacer" />
            <button className="btn btn--primary btn--lg" onClick={start} disabled={engine.state !== 'ready' || !sourceOk[source]} autoFocus>
              <Play size={18} /> Start
            </button>
            <div className="cm__hint">Space starts</div>
          </>
        )}

        {phase !== 'setup' && position && (
          <>
            <div className="cm__source">{position.label}</div>
            <span className="cm__turn">
              <i style={{ background: turn === 'white' ? '#f0f0f0' : '#1d1d1d' }} /> {turn === 'white' ? 'White' : 'Black'} to move: your side
            </span>
            <div className="cm__label">{phase === 'quiz' ? 'Your candidates' : 'Your candidates vs the engine'}</div>
            <div className="cm__slots">
              {Array.from({ length: MAX_CANDIDATES }, (_, i) => {
                const c = candidates[i];
                const rank = comparison?.ranks[i] ?? null;
                const cls = ['cm__slot', c ? 'is-filled' : '', phase === 'reveal' && c ? (rank !== null ? 'is-hit' : 'is-miss') : ''].join(' ');
                return (
                  <div key={i} className={cls} data-uci={c?.uci ?? ''}>
                    {c ? (
                      <>
                        <span className="san">{c.san}</span>
                        {phase === 'quiz' ? (
                          <button onClick={() => removeCandidate(c.uci)} title="Remove">
                            <X size={14} />
                          </button>
                        ) : (
                          <span className="meta">{rank !== null ? `engine #${rank}` : ownScores[c.uci] ?? '…'}</span>
                        )}
                      </>
                    ) : (
                      <span>{`Candidate ${i + 1}`}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {phase === 'quiz' && (
              <>
                <div className="cm__analysing" aria-live="polite">
                  <i /> {evaluation?.final ? 'Engine ready' : `Engine analysing… depth ${evaluation?.depth ?? 0}`}
                  {waiting ? ' · finishing before the reveal' : ''}
                </div>
                <div className="cm__spacer" />
                <button className="btn btn--primary btn--lg" onClick={requestReveal} disabled={candidates.length === 0 || revealRequested.current}>
                  Reveal the engine's top {MAX_CANDIDATES}
                </button>
                <div className="cm__hint">Play a move to add a candidate (it snaps back). Backspace removes the last. Space reveals.</div>
              </>
            )}

            {phase === 'reveal' && comparison && (
              <>
                <div className={`cm__verdict ${comparison.foundBest ? 'is-great' : comparison.overlap > 0 ? 'is-ok' : 'is-poor'}`}>
                  {describeComparison(comparison, candidates.length)}
                </div>
                <div className="cm__label">Stockfish's top {ranking.length} · depth {evaluation?.depth ?? 0}</div>
                <ol className="cm__engine">
                  {ranking.map((r) => (
                    <li key={r.uci} className={candidates.some((c) => c.uci === r.uci) ? 'is-yours' : ''} data-uci={r.uci}>
                      <span className="rank">{r.rank}</span>
                      <span className="san">{r.san}</span>
                      <span className="score">{formatScore(r)}</span>
                      <span className="line" title={r.line}>
                        {r.line}
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="cm__legend">
                  <span>
                    <i style={{ background: 'rgba(21,140,60,0.9)' }} /> your hit
                  </span>
                  <span>
                    <i style={{ background: 'rgba(21,140,60,0.4)' }} /> engine only
                  </span>
                  <span>
                    <i style={{ background: 'rgba(200,40,40,0.8)' }} /> yours, not top 3
                  </span>
                </div>
                <div className="cm__stats-line">
                  <Trophy size={18} />
                  <span>Session · {session.total} {session.total === 1 ? 'position' : 'positions'}</span>
                  <strong>
                    {session.best} best · {session.overlap} hits
                  </strong>
                </div>
                <div className="cm__spacer" />
                <button className="btn btn--primary btn--lg" onClick={start} autoFocus>
                  <RotateCcw size={18} /> Next position
                </button>
              </>
            )}
            <button className="btn btn--ghost" onClick={backToSetup}>
              <Settings2 size={14} /> Settings
            </button>
            <div className="cm__hint">Esc for settings</div>
          </>
        )}
      </aside>
    </div>
  );
}
