// Puzzle generation for the bullet trainer: one random piece on an empty
// board plus one random destination it can legally reach.
import type { Key } from 'chessground/types';
import {
  ALL_SQUARES,
  rankIndex,
  singlePieceDestinations,
  singlePieceFen,
  type Color,
  type Piece,
  type Role,
  type Square,
} from '@/chess/squares';

export const DURATIONS = [30, 45, 60] as const;
export type DurationSec = (typeof DURATIONS)[number];

export interface Puzzle {
  piece: Piece;
  from: Square;
  to: Square;
  fen: string;
  /** Highlight map for the Board (target square). */
  highlights: Map<Key, string>;
}

// Knights and sliders make for more interesting drills than pawns.
const ROLE_WEIGHTS: Array<[Role, number]> = [
  ['knight', 4],
  ['bishop', 3],
  ['rook', 3],
  ['queen', 3],
  ['king', 2],
  ['pawn', 1],
];
const TOTAL_WEIGHT = ROLE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomRole(): Role {
  let n = Math.random() * TOTAL_WEIGHT;
  for (const [role, weight] of ROLE_WEIGHTS) {
    n -= weight;
    if (n < 0) return role;
  }
  return 'knight';
}

function randomStartSquare(piece: Piece): Square {
  if (piece.role !== 'pawn') return pick(ALL_SQUARES);
  // Keep pawns off their last two ranks so the drill never needs promotion.
  const ok = ALL_SQUARES.filter((sq) => {
    const r = rankIndex(sq);
    return piece.color === 'white' ? r >= 1 && r <= 5 : r >= 2 && r <= 6;
  });
  return pick(ok);
}

/** Generate the next puzzle, avoiding a piece that spawns where the last one ended. */
export function nextPuzzle(previous?: Puzzle): Puzzle {
  for (let attempt = 0; attempt < 20; attempt++) {
    const color: Color = Math.random() < 0.5 ? 'white' : 'black';
    const piece: Piece = { role: randomRole(), color };
    const from = randomStartSquare(piece);
    if (previous && from === previous.to) continue;
    const dests = singlePieceDestinations(piece, from);
    if (dests.length === 0) continue;
    const to = pick(dests);
    return {
      piece,
      from,
      to,
      fen: singlePieceFen(piece, from),
      highlights: new Map<Key, string>([[to, 'target']]),
    };
  }
  // Practically unreachable; a knight in the centre always has moves.
  const piece: Piece = { role: 'knight', color: 'white' };
  return {
    piece,
    from: 'e4',
    to: 'f6',
    fen: singlePieceFen(piece, 'e4'),
    highlights: new Map<Key, string>([['f6', 'target']]),
  };
}
