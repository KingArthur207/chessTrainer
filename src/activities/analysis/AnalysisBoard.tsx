// Engine analysis board: set up any position, play moves for either side,
// step through the history, and watch Stockfish's lines update live.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Chess } from 'chess.js';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Clipboard, ClipboardPaste, Cpu, Download, Play, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { Board, type DrawShape, type Key } from '@/board/Board';
import { EngineStatus } from '@/components/EngineStatus';
import { applyMove, gameOver, inCheck, legalDests, moveNumberPrefix, numberedLine, repetitionKey, START_FEN, turnOf, uciLineToSan } from '@/chess/position';
import { parsePgn } from '@/games/pgn';
import { formatScore, whiteShare } from '@/engine/session';
import { useEngineStatus } from '@/engine/useEngineStatus';
import { useLiveAnalysis } from '@/engine/useLiveAnalysis';
import { loadJson, saveJson } from '@/lib/storage';
import '@/activities/opening-trainer/opening-trainer.css';
import './analysis.css';

interface Ply {
  san: string;
  uci: string;
  fen: string;
}

const EMPTY_BOARD = '8/8/8/8/8/8/8/8';

function looksLikeFen(text: string): boolean {
  const parts = text.trim().split(/\s+/);
  return parts.length >= 2 && /^[pnbrqkPNBRQK1-8/]+$/.test(parts[0]) && parts[0].split('/').length === 8;
}

export default function AnalysisBoard() {
  const [startFen, setStartFen] = useState<string>(() => loadJson<string>('analysis:start', START_FEN));
  const [history, setHistory] = useState<Ply[]>(() => loadJson<Ply[]>('analysis:history', []));
  const [cursor, setCursor] = useState<number>(() => loadJson<number>('analysis:cursor', 0));
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [multiPv, setMultiPv] = useState<number>(() => loadJson<number>('analysis:multipv', 1));
  const [engineOn, setEngineOn] = useState(true);
  const [modal, setModal] = useState<'paste' | 'export' | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const engine = useEngineStatus();

  const safeCursor = Math.min(cursor, history.length);
  const fen = safeCursor === 0 ? startFen : history[safeCursor - 1].fen;
  const seen = useMemo(() => [repetitionKey(startFen), ...history.slice(0, safeCursor).map((p) => repetitionKey(p.fen))], [startFen, history, safeCursor]);
  const over = useMemo(() => gameOver(fen, seen), [fen, seen]);
  const evaluation = useLiveAnalysis(fen, { multiPv, enabled: engineOn && engine.state === 'ready' && !over });

  useEffect(() => saveJson('analysis:start', startFen), [startFen]);
  useEffect(() => saveJson('analysis:history', history), [history]);
  useEffect(() => saveJson('analysis:cursor', safeCursor), [safeCursor]);
  useEffect(() => saveJson('analysis:multipv', multiPv), [multiPv]);

  const playUci = useCallback(
    (uci: string): boolean => {
      const applied = applyMove(fen, uci.slice(0, 2) as Key, uci.slice(2, 4) as Key, (uci.slice(4, 5) || 'q') as 'q' | 'r' | 'b' | 'n');
      if (!applied) return false;
      setHistory((h) => [...h.slice(0, safeCursor), { san: applied.san, uci: applied.uci, fen: applied.fen }]);
      setCursor(safeCursor + 1);
      return true;
    },
    [fen, safeCursor],
  );

  const onUserMove = useCallback((orig: Key, dest: Key) => playUci(`${orig}${dest}`), [playUci]);

  const reset = useCallback((newStart: string = START_FEN) => {
    setStartFen(newStart);
    setHistory([]);
    setCursor(0);
  }, []);

  const importText = useCallback(() => {
    const text = pasteText.trim();
    try {
      if (looksLikeFen(text)) {
        const parts = text.split(/\s+/);
        const full = [parts[0], parts[1] ?? 'w', parts[2] ?? '-', parts[3] ?? '-', parts[4] ?? '0', parts[5] ?? '1'].join(' ');
        new Chess(full); // validates
        reset(full);
      } else {
        const parsed = parsePgn(text);
        if (parsed.moves.length === 0) throw new Error('No moves found.');
        setStartFen(parsed.startFen);
        setHistory(parsed.moves.map((m) => ({ san: m.san, uci: m.uci, fen: m.fenAfter })));
        setCursor(parsed.moves.length);
      }
      setModal(null);
      setPasteText('');
      setPasteError(null);
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err));
    }
  }, [pasteText, reset]);

  const pgn = useMemo(() => {
    const headers = startFen === START_FEN ? '' : `[SetUp "1"]\n[FEN "${startFen}"]\n\n`;
    return `${headers}${numberedLine(startFen, history.map((p) => p.san)).replace(/(\d+)\.(?=\S)/g, '$1. ')} *`;
  }, [startFen, history]);

  const copy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1200);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || modal) return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(0, Math.min(c, history.length) - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(history.length, c + 1));
      else if (e.key === 'ArrowUp' || e.key === 'Home') setCursor(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') setCursor(history.length);
      else if (e.key === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.length, modal]);

  const dests = useMemo(() => (over ? undefined : legalDests(fen)), [fen, over]);
  const lastMove = useMemo<[Key, Key] | undefined>(() => {
    const p = safeCursor > 0 ? history[safeCursor - 1] : undefined;
    return p ? [p.uci.slice(0, 2) as Key, p.uci.slice(2, 4) as Key] : undefined;
  }, [history, safeCursor]);
  const shapes = useMemo<DrawShape[]>(() => {
    if (!evaluation) return [];
    return evaluation.lines.slice(0, 3).map((l, i) => ({ orig: l.pv[0].slice(0, 2) as Key, dest: l.pv[0].slice(2, 4) as Key, brush: i === 0 ? 'green' : 'paleGreen' }));
  }, [evaluation]);
  const best = evaluation?.lines[0];

  const moveList = (): ReactNode[] => {
    const out: ReactNode[] = [];
    let before = startFen;
    history.forEach((p, i) => {
      const prefix = moveNumberPrefix(before, i === 0);
      out.push(
        <span key={i}>
          {prefix && <span className="an__num">{prefix}</span>}
          <button className={`an__move ${i + 1 === safeCursor ? 'is-current' : ''}`} onClick={() => setCursor(i + 1)}>
            {p.san}
          </button>
        </span>,
      );
      before = p.fen;
    });
    return out;
  };

  return (
    <div className="an" data-fen={fen} data-cursor={safeCursor} data-moves={history.length} data-depth={evaluation?.depth ?? 0}>
      <div className="an__board">
        <Board
          fen={fen || EMPTY_BOARD}
          orientation={orientation}
          interactive={!over}
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

      <aside className="an__panel">
        <div className="an__head">
          <h2 className="an__title">
            <Cpu size={20} /> Engine Analysis
          </h2>
          <button className={`btn ${engineOn ? 'is-active' : ''}`} onClick={() => setEngineOn((v) => !v)} title="Toggle the engine">
            {engineOn ? 'Engine on' : 'Engine off'}
          </button>
        </div>
        {engine.state !== 'ready' && <EngineStatus status={engine} />}

        <div className="an__bar">
          <div className="an__score">{over ? (over.result === '1/2-1/2' ? '½–½' : over.result) : evaluation ? formatScore(evaluation) : '…'}</div>
          <div className="an__track" title="White's share">
            <div style={{ width: `${over ? (over.result === '1-0' ? 100 : over.result === '0-1' ? 0 : 50) : evaluation ? whiteShare(evaluation) * 100 : 50}%` }} />
          </div>
          <div className="an__depth">{over ? over.reason : evaluation ? `depth ${evaluation.depth}` : engineOn ? 'thinking…' : 'engine off'}</div>
        </div>

        <div className="an__controls">
          <div className="seg" role="radiogroup" aria-label="Lines">
            {[1, 2, 3].map((n) => (
              <button key={n} className={n === multiPv ? 'is-active' : ''} onClick={() => setMultiPv(n)}>
                {n} {n === 1 ? 'line' : 'lines'}
              </button>
            ))}
          </div>
          <button className="btn" disabled={!best || !!over} onClick={() => best && playUci(best.pv[0])} title="Play the engine's first choice">
            <Sparkles size={14} /> Play best move
          </button>
        </div>

        {over ? (
          <div className="an__status is-over">
            {over.reason}: {over.result}
          </div>
        ) : (
          <ol className="an__lines">
            {(evaluation?.lines ?? []).map((l) => {
              const sans = uciLineToSan(fen, l.pv.slice(0, 10));
              const line = numberedLine(fen, sans);
              const firstToken = line.split(' ')[0];
              const rest = line.slice(firstToken.length);
              return (
                <li key={l.multiPv} className="an__line" data-uci={l.pv[0]}>
                  <span className="score">{formatScore(l)}</span>
                  <span className="pv" title={line}>
                    <button onClick={() => playUci(l.pv[0])}>{firstToken}</button>
                    {rest}
                  </span>
                </li>
              );
            })}
            {engineOn && !evaluation && engine.state === 'ready' && <li className="an__line"><span className="score">…</span><span className="pv">analysing</span></li>}
          </ol>
        )}

        <div className="an__moves">{history.length === 0 ? <span className="an__num">{startFen === START_FEN ? 'Start position. Play moves for either side.' : 'Custom position.'}</span> : moveList()}</div>

        <div className="an__nav">
          <button className="btn" title="Start (↑)" onClick={() => setCursor(0)} disabled={safeCursor === 0}>
            <ChevronFirst size={16} />
          </button>
          <button className="btn" title="Back (←)" onClick={() => setCursor(Math.max(0, safeCursor - 1))} disabled={safeCursor === 0}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn" title="Forward (→)" onClick={() => setCursor(Math.min(history.length, safeCursor + 1))} disabled={safeCursor >= history.length}>
            <ChevronRight size={16} />
          </button>
          <button className="btn" title="End (↓)" onClick={() => setCursor(history.length)} disabled={safeCursor >= history.length}>
            <ChevronLast size={16} />
          </button>
        </div>
        <div className="an__tools">
          <button className="btn" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <RefreshCw size={14} /> Flip
          </button>
          <button className="btn" onClick={() => reset()}>
            <RotateCcw size={14} /> Start position
          </button>
          <button className="btn" onClick={() => { setPasteError(null); setModal('paste'); }}>
            <ClipboardPaste size={14} /> Paste FEN / PGN
          </button>
          <button className="btn" onClick={() => void copy('FEN', fen)}>
            <Clipboard size={14} /> {copied === 'FEN' ? 'Copied' : 'Copy FEN'}
          </button>
          <button className="btn" data-action="export" onClick={() => setModal('export')} disabled={history.length === 0}>
            <Download size={14} /> Export PGN
          </button>
        </div>
        <div className="an__hint">Arrow keys step through moves · F flips · click a line's move to play it</div>
      </aside>

      {modal === 'paste' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Paste a FEN or a PGN</h3>
            <p>A FEN sets up that position; a PGN loads the whole game so you can step through it.</p>
            <textarea value={pasteText} autoFocus onChange={(e) => setPasteText(e.target.value)} placeholder={'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3\n\nor\n\n1. e4 e5 2. Nf3 Nc6 …'} />
            {pasteError && <ul className="modal__errors"><li>{pasteError}</li></ul>}
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setModal(null)}>
                Close
              </button>
              <button className="btn btn--primary" disabled={!pasteText.trim()} onClick={importText}>
                <Play size={14} /> Load
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'export' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>PGN</h3>
            <textarea readOnly value={pgn} onFocus={(e) => e.currentTarget.select()} />
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setModal(null)}>
                Close
              </button>
              <button className="btn btn--primary" onClick={() => void copy('PGN', pgn)}>
                <Clipboard size={14} /> {copied === 'PGN' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
