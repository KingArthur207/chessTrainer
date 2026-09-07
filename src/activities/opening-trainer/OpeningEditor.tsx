// Theory editor: play moves on the board to grow the tree, jump around the
// move list, annotate moves, and import/export PGN.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpToLine,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  Play,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Board, type Key } from '@/board/Board';
import { applyMove, inCheck, legalDests, turnOf } from '@/chess/position';
import { MoveTree } from './MoveTree';
import {
  addChild,
  childByUci,
  countMoves,
  lastMoveOf,
  leafLines,
  pathToNode,
  promoteChild,
  removeChild,
  type Opening,
  type TreeNode,
} from './model';
import { exportPgn, importPgn, type ImportResult } from './pgn';

interface OpeningEditorProps {
  opening: Opening;
  onChange: (opening: Opening) => void;
  onBack: () => void;
  onPractice: () => void;
}

export function OpeningEditor({ opening, onChange, onBack, onPractice }: OpeningEditorProps) {
  const root = opening.root;
  const [path, setPath] = useState<TreeNode[]>([root]);
  const [flipped, setFlipped] = useState(false);
  const [modal, setModal] = useState<'import' | 'export' | null>(null);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(opening.name);

  useEffect(() => {
    setPath([opening.root]);
  }, [opening.id, opening.root]);

  const node = path[path.length - 1];
  const fen = node.fen;
  const dests = useMemo(() => legalDests(fen), [fen]);
  const lastMove = useMemo(() => lastMoveOf(path), [path]);
  const check = useMemo(() => inCheck(fen), [fen]);
  const turnColor = turnOf(fen);
  const orientation = flipped ? (opening.color === 'white' ? 'black' : 'white') : opening.color;
  const stats = useMemo(
    () => ({ lines: leafLines(root).length, moves: countMoves(root) }),
    // updatedAt changes on every edit; the tree is mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [root, opening.updatedAt],
  );

  const commit = useCallback(
    (patch: Partial<Opening> = {}) => onChange({ ...opening, ...patch, updatedAt: new Date().toISOString() }),
    [onChange, opening],
  );

  const handleUserMove = useCallback(
    (orig: Key, dest: Key): boolean => {
      const applied = applyMove(fen, orig, dest, 'q');
      if (!applied) return false;
      let child = childByUci(node, applied.uci);
      if (!child) {
        child = addChild(node, applied);
        commit();
      }
      setPath([...path, child]);
      return true;
    },
    [fen, node, path, commit],
  );

  const goBack = useCallback(() => setPath((p) => (p.length > 1 ? p.slice(0, -1) : p)), []);
  const goForward = useCallback(
    () => setPath((p) => (p[p.length - 1].children[0] ? [...p, p[p.length - 1].children[0]] : p)),
    [],
  );
  const goStart = useCallback(() => setPath([root]), [root]);
  const goEnd = useCallback(
    () =>
      setPath((p) => {
        let out = p;
        let n = p[p.length - 1];
        while (n.children[0]) {
          n = n.children[0];
          out = [...out, n];
        }
        return out;
      }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (modal) return;
      if (e.key === 'ArrowLeft') goBack();
      else if (e.key === 'ArrowRight') goForward();
      else if (e.key === 'ArrowUp') goStart();
      else if (e.key === 'ArrowDown') goEnd();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward, goStart, goEnd, modal]);

  const select = (n: TreeNode) => {
    const p = pathToNode(root, n.id);
    if (p) setPath(p);
  };

  const parent = path.length >= 2 ? path[path.length - 2] : null;
  const canPromote = !!parent && parent.children[0] !== node;

  const deleteHere = () => {
    if (parent) {
      removeChild(parent, node.id);
      setPath(path.slice(0, -1));
    } else {
      root.children = [];
    }
    commit();
    setConfirmDelete(false);
  };

  const promote = () => {
    if (!parent) return;
    promoteChild(parent, node.id);
    commit();
  };

  const runImport = () => {
    const result = importPgn(opening, importText);
    commit();
    setImportResult(result);
    if (result.errors.length === 0 && result.parsed > 0) setImportText('');
  };

  const exportText = useMemo(() => exportPgn(opening), [opening]);

  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>('.modal textarea');
      ta?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const saveName = () => {
    const name = nameDraft.trim();
    if (name && name !== opening.name) commit({ name });
    else setNameDraft(opening.name);
    setRenaming(false);
  };

  return (
    <div className="ot">
      <div className="ot__board">
        <Board
          fen={fen}
          orientation={orientation}
          dests={dests}
          showDests
          lastMove={lastMove}
          turnColor={turnColor}
          check={check}
          onUserMove={handleUserMove}
        />
      </div>

      <aside className="ot__panel">
        <div className="ot__head">
          <button className="btn btn--icon" title="Back to openings" onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
          {renaming ? (
            <input
              className="ot__title-input"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') {
                  setNameDraft(opening.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <button className="ot__title-btn" title="Rename" onClick={() => setRenaming(true)}>
              <h2 className="ot__title">{opening.name}</h2>
            </button>
          )}
          <span className={`side-badge side-badge--${opening.color}`}>{opening.color}</span>
        </div>
        <div className="ot__meta">
          {stats.lines} {stats.lines === 1 ? 'line' : 'lines'} · {stats.moves} moves · {turnColor} to move
        </div>

        <div className="ot__toolbar">
          <button className="btn" onClick={() => { setImportResult(null); setModal('import'); }}>
            <Upload size={14} /> Import PGN
          </button>
          <button className="btn" onClick={() => setModal('export')}>
            <Download size={14} /> Export PGN
          </button>
          <button className="btn" onClick={() => setFlipped((f) => !f)}>
            <RefreshCw size={14} /> Flip
          </button>
          <button className="btn btn--primary" disabled={stats.lines === 0} onClick={onPractice}>
            <Play size={14} /> Practise
          </button>
        </div>

        <MoveTree root={root} currentId={node.id} onSelect={select} />

        <div className="ot__nav">
          <button className="btn" title="Start (↑)" onClick={goStart} disabled={path.length === 1}>
            <ChevronFirst size={16} />
          </button>
          <button className="btn" title="Back (←)" onClick={goBack} disabled={path.length === 1}>
            <ChevronLeft size={16} />
          </button>
          <button className="btn" title="Forward (→)" onClick={goForward} disabled={node.children.length === 0}>
            <ChevronRight size={16} />
          </button>
          <button className="btn" title="End of main line (↓)" onClick={goEnd} disabled={node.children.length === 0}>
            <ChevronLast size={16} />
          </button>
        </div>

        <textarea
          className="ot__comment"
          placeholder={parent ? `Note for ${node.san} (shown during practice)` : 'Select a move to annotate it'}
          value={node.comment ?? ''}
          disabled={!parent}
          onChange={(e) => {
            node.comment = e.target.value || undefined;
            commit();
          }}
        />

        <div className="ot__actions">
          {canPromote && (
            <button className="btn" onClick={promote} title="Make this the main line">
              <ArrowUpToLine size={14} /> Main line
            </button>
          )}
          {confirmDelete ? (
            <>
              <button className="btn btn--danger" onClick={deleteHere}>
                {parent ? `Delete ${node.san} and everything after` : 'Delete all moves'}
              </button>
              <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn"
              disabled={root.children.length === 0}
              onClick={() => setConfirmDelete(true)}
              title={parent ? 'Delete this move and its continuations' : 'Delete every move'}
            >
              <Trash2 size={14} /> {parent ? 'Delete from here' : 'Clear all'}
            </button>
          )}
        </div>
        <div className="ot__hint">Moves you play on the board are added to the tree. Arrow keys navigate.</div>
      </aside>

      {modal === 'import' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Import PGN</h3>
            <p>
              Paste one or more lines starting from the initial position, Chessable or Lichess-study style. Variations in
              ( ), comments in {'{ }'}, move numbers optional. A blank line or a fresh "1." starts another line; lines
              sharing the same moves are merged into the tree.
            </p>
            <textarea
              value={importText}
              autoFocus
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 { The Dragon }\n1. e4 c5 2. Nf3 Nc6 (2... e6 3. d4) 3. d4'}
            />
            {importResult && (
              <div className="modal__result">
                Added {importResult.added} new {importResult.added === 1 ? 'move' : 'moves'} from {importResult.lines}{' '}
                {importResult.lines === 1 ? 'line' : 'lines'} ({importResult.parsed} moves parsed).
                {importResult.errors.length > 0 && (
                  <ul className="modal__errors">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="modal__actions">
              <button className="btn btn--ghost" onClick={() => setModal(null)}>
                Close
              </button>
              <button className="btn btn--primary" disabled={!importText.trim()} onClick={runImport}>
                <Upload size={14} /> Import
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'export' && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Export PGN</h3>
            <p>
              The whole tree as one PGN with nested variations. Paste it back into Import (here or in another opening)
              to recreate the exact tree.
            </p>
            <textarea readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
            <div className="modal__actions">
              <span className="grow">
                {stats.lines} lines · {stats.moves} moves
              </span>
              <button className="btn btn--ghost" onClick={() => setModal(null)}>
                Close
              </button>
              <button className="btn btn--primary" onClick={copyExport}>
                <Clipboard size={14} /> {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
