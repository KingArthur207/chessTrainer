// A single piece drawn with the board's piece set, for use inline in text.
import type { Piece } from 'chessground/types';

interface PieceIconProps {
  color: Piece['color'];
  role: Piece['role'];
  size?: 'sm' | 'lg';
  className?: string;
}

export function PieceIcon({ color, role, size = 'sm', className = '' }: PieceIconProps) {
  return (
    <span className={`piece-icon cg-wrap ${size === 'lg' ? 'piece-icon--lg' : ''} ${className}`} aria-hidden="true">
      <piece className={`${color} ${role}`} />
    </span>
  );
}
