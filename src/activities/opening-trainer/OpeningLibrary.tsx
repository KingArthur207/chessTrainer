import { useMemo, useState } from 'react';
import { BookOpen, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { PieceIcon } from '@/components/PieceIcon';
import { countMoves, leafLines, type Opening, type Side } from './model';
import { isDue } from './srs';
import type { ProgressTable } from './store';

interface OpeningLibraryProps {
  openings: Opening[];
  progress: ProgressTable;
  onCreate: (name: string, color: Side) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onPractice: (id: string, mode: 'due' | 'all') => void;
}

function SideBadge({ side }: { side: Side }) {
  return (
    <span className={`side-badge side-badge--${side}`}>
      <PieceIcon color={side} role="king" /> {side}
    </span>
  );
}

function OpeningCard({
  opening,
  progress,
  onDelete,
  onEdit,
  onPractice,
}: {
  opening: Opening;
  progress: Record<string, import('./srs').LineProgress> | undefined;
  onDelete: () => void;
  onEdit: () => void;
  onPractice: (mode: 'due' | 'all') => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const stats = useMemo(() => {
    const lines = leafLines(opening.root);
    const due = lines.filter((l) => isDue(progress?.[l.key])).length;
    const practiced = Object.values(progress ?? {}).map((p) => p.lastPracticed ?? 0);
    const last = practiced.length ? Math.max(...practiced) : 0;
    return { lines: lines.length, moves: countMoves(opening.root), due, last };
  }, [opening, progress]);

  return (
    <div className="op-card">
      <div className="op-card__top">
        <h3 className="op-card__name" title={opening.name}>
          {opening.name}
        </h3>
        <SideBadge side={opening.color} />
      </div>
      <div className="op-card__stats">
        <span>
          <strong>{stats.lines}</strong> {stats.lines === 1 ? 'line' : 'lines'}
        </span>
        <span>
          <strong>{stats.moves}</strong> moves
        </span>
        {stats.lines > 0 && (
          <span className={stats.due > 0 ? 'op-card__due' : ''}>
            <strong>{stats.due}</strong> due
          </span>
        )}
        {stats.last > 0 && <span>practised {formatAgo(stats.last)}</span>}
      </div>
      <div className="op-card__actions">
        <button className="btn btn--primary" disabled={stats.lines === 0} onClick={() => onPractice(stats.due > 0 ? 'due' : 'all')}>
          <Play size={16} /> {stats.due > 0 ? `Practise ${stats.due} due` : 'Practise all'}
        </button>
        {stats.due > 0 && stats.due < stats.lines && (
          <button className="btn" title="Practise every line" onClick={() => onPractice('all')}>
            All
          </button>
        )}
        <button className="btn btn--icon" title="Edit theory" onClick={onEdit}>
          <Pencil size={16} />
        </button>
        {confirming ? (
          <>
            <button className="btn btn--danger" onClick={onDelete}>
              Delete
            </button>
            <button className="btn btn--ghost" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn btn--icon" title="Delete opening" onClick={() => setConfirming(true)}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function formatAgo(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function OpeningLibrary({ openings, progress, onCreate, onDelete, onEdit, onPractice }: OpeningLibraryProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<Side>('white');

  const submit = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), color);
    setName('');
  };

  return (
    <div className="ot-lib">
      <div className="ot-lib__head">
        <div>
          <h2 className="ot-lib__title">Opening Trainer</h2>
          <p className="ot-lib__sub">
            Build a repertoire per opening, then drill it with spaced repetition. The app plays the other side from your
            theory and quizzes you on every move.
          </p>
        </div>
        <form
          className="ot-lib__create"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New opening, e.g. Nimzo-Indian"
            aria-label="Opening name"
          />
          <div className="seg" role="radiogroup" aria-label="Side you play">
            <button type="button" className={color === 'white' ? 'is-active' : ''} onClick={() => setColor('white')}>
              <PieceIcon color="white" role="king" /> White
            </button>
            <button type="button" className={color === 'black' ? 'is-active' : ''} onClick={() => setColor('black')}>
              <PieceIcon color="black" role="king" /> Black
            </button>
          </div>
          <button type="submit" className="btn btn--primary" disabled={!name.trim()}>
            <Plus size={16} /> Create
          </button>
        </form>
      </div>

      {openings.length === 0 ? (
        <div className="ot-lib__empty">
          <BookOpen size={28} />
          <p>No openings yet. Name one above, pick the side you play, and add your theory.</p>
        </div>
      ) : (
        <div className="ot-lib__grid">
          {openings.map((op) => (
            <OpeningCard
              key={op.id}
              opening={op}
              progress={progress[op.id]}
              onDelete={() => onDelete(op.id)}
              onEdit={() => onEdit(op.id)}
              onPractice={(mode) => onPractice(op.id, mode)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
