// A row of the twelve piece types drawn with the board's piece set. Click to
// select one (or clear the selection); optionally start a drag onto a board.
import type { MouseEvent, ReactNode } from 'react';
import type { Piece } from 'chessground/types';

const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'] as const;
export const PALETTE_PIECES: Piece[] = (['white', 'black'] as const).flatMap((color) => ROLES.map((role) => ({ role, color })));

export const samePiece = (a: Piece | null | undefined, b: Piece | null | undefined): boolean =>
  !!a && !!b && a.role === b.role && a.color === b.color;

interface PiecePaletteProps {
  selected: Piece | null;
  onSelect: (piece: Piece | null) => void;
  /** Called on mouse-down so the caller can start a drag (Board.dragNewPiece). */
  onDragStart?: (piece: Piece, event: MouseEvent<HTMLElement>) => void;
  className?: string;
  title?: (piece: Piece) => string;
  children?: ReactNode;
}

export function PiecePalette({ selected, onSelect, onDragStart, className = '', title, children }: PiecePaletteProps) {
  return (
    <div className={`piece-palette cg-wrap ${className}`}>
      {PALETTE_PIECES.map((p) => (
        <piece
          key={`${p.color}-${p.role}`}
          className={`${p.color} ${p.role} ${samePiece(selected, p) ? 'is-active' : ''}`}
          title={title ? title(p) : `${p.color} ${p.role}`}
          onMouseDown={(e) => {
            if (e.button === 0) onDragStart?.(p, e);
          }}
          onClick={() => onSelect(samePiece(selected, p) ? null : p)}
        />
      ))}
      {children}
    </div>
  );
}
