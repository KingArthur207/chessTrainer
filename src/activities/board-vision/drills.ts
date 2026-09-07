// Board-vision drills: naming squares, square colours and knight routes.
import { write } from 'chessground/fen';
import type { Key, Piece } from 'chessground/types';
import { ALL_SQUARES, knightPath, pawnAttacks, rankIndex, squareColor, type Square } from '@/chess/squares';

export type VisionMode = 'squares' | 'colours' | 'knight';

export const MODES: Array<{ id: VisionMode; label: string; blurb: string }> = [
  { id: 'squares', label: 'Find the square', blurb: 'A square name appears; click it on a board without coordinates. Try it from Black\'s side too.' },
  { id: 'colours', label: 'Square colour', blurb: 'No board at all: is the named square light or dark? Answer with the buttons or the L and D keys.' },
  { id: 'knight', label: 'Knight route', blurb: 'Bring the knight to the target in the fewest moves without landing on a square the pawns attack.' },
];

export const TIMES = [30, 60] as const;
export type Perspective = 'white' | 'black' | 'random';

export function randomSquare(exclude?: Square, rng: () => number = Math.random): Square {
  const pool = exclude ? ALL_SQUARES.filter((s) => s !== exclude) : ALL_SQUARES;
  return pool[Math.floor(rng() * pool.length)];
}

export { squareColor };

export interface KnightPuzzle {
  knight: Square;
  target: Square;
  pawns: Square[];
  /** Pawn squares plus every square they attack. */
  forbidden: Square[];
  /** Fewest knight moves needed. */
  optimal: number;
  /** One optimal route, including both ends. */
  path: Square[];
  fen: string;
}

/** A knight, a target and some black pawns whose attacked squares are off limits. */
export function makeKnightPuzzle(pawnCount: number, rng: () => number = Math.random): KnightPuzzle {
  for (let attempt = 0; attempt < 200; attempt++) {
    const knight = randomSquare(undefined, rng);
    const target = randomSquare(knight, rng);
    const pawns: Square[] = [];
    const candidates = ALL_SQUARES.filter((s) => s !== knight && s !== target && rankIndex(s) >= 1 && rankIndex(s) <= 6);
    while (pawns.length < pawnCount && candidates.length) {
      const i = Math.floor(rng() * candidates.length);
      const [sq] = candidates.splice(i, 1);
      pawns.push(sq);
    }
    const forbidden = new Set<Square>(pawns);
    for (const p of pawns) for (const a of pawnAttacks(p, 'black')) forbidden.add(a);
    if (forbidden.has(knight) || forbidden.has(target)) continue;
    const path = knightPath(knight, target, forbidden);
    if (!path || path.length < 3) continue;
    const pieces = new Map<Key, Piece>();
    pieces.set(knight, { role: 'knight', color: 'white' });
    for (const p of pawns) pieces.set(p, { role: 'pawn', color: 'black' });
    return { knight, target, pawns, forbidden: [...forbidden], optimal: path.length - 1, path, fen: write(pieces) };
  }
  // Fallback that always works.
  const pieces = new Map<Key, Piece>([['b1', { role: 'knight', color: 'white' }]]);
  return { knight: 'b1', target: 'g8', pawns: [], forbidden: [], optimal: 5, path: knightPath('b1', 'g8')!, fen: write(pieces) };
}

/** Placement with the knight moved to `square`. */
export function knightAt(puzzle: KnightPuzzle, square: Square): string {
  const pieces = new Map<Key, Piece>();
  pieces.set(square, { role: 'knight', color: 'white' });
  for (const p of puzzle.pawns) pieces.set(p, { role: 'pawn', color: 'black' });
  return write(pieces);
}
