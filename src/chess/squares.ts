// Board geometry helpers and a move generator for a single piece on an
// otherwise empty board. Full-position legality (checks, pins, castling…)
// belongs to chess.js; this module is deliberately tiny and dependency-free
// because the bullet drill only ever has one piece on the board.

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export type File = (typeof FILES)[number];
export type Rank = (typeof RANKS)[number];
export type Square = `${File}${Rank}`;
export type Color = 'white' | 'black';
export type Role = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export interface Piece {
  role: Role;
  color: Color;
}

export const ALL_SQUARES: Square[] = RANKS.flatMap((r) => FILES.map((f) => `${f}${r}` as Square));

export const ROLE_TO_FEN: Record<Role, string> = {
  king: 'k',
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: 'p',
};

export const PIECE_GLYPH: Record<Color, Record<Role, string>> = {
  white: { king: '♔', queen: '♕', rook: '♖', bishop: '♗', knight: '♘', pawn: '♙' },
  black: { king: '♚', queen: '♛', rook: '♜', bishop: '♝', knight: '♞', pawn: '♟' },
};

export function fileIndex(sq: Square): number {
  return sq.charCodeAt(0) - 97;
}

export function rankIndex(sq: Square): number {
  return sq.charCodeAt(1) - 49;
}

/** 0-based file/rank to square, or null when off the board. */
export function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${RANKS[rank]}` as Square;
}

const ORTHOGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAGONAL: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const KNIGHT: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

function slide(from: Square, dirs: ReadonlyArray<readonly [number, number]>): Square[] {
  const out: Square[] = [];
  const f0 = fileIndex(from);
  const r0 = rankIndex(from);
  for (const [df, dr] of dirs) {
    let f = f0 + df;
    let r = r0 + dr;
    let sq = squareAt(f, r);
    while (sq) {
      out.push(sq);
      f += df;
      r += dr;
      sq = squareAt(f, r);
    }
  }
  return out;
}

function step(from: Square, dirs: ReadonlyArray<readonly [number, number]>): Square[] {
  const f0 = fileIndex(from);
  const r0 = rankIndex(from);
  return dirs
    .map(([df, dr]) => squareAt(f0 + df, r0 + dr))
    .filter((sq): sq is Square => sq !== null);
}

/**
 * Squares a lone piece can move to from `from` on an empty board.
 * Pawns move straight ahead (one step, or two from their starting rank);
 * captures and promotions are not modelled here.
 */
export function singlePieceDestinations(piece: Piece, from: Square): Square[] {
  switch (piece.role) {
    case 'rook':
      return slide(from, ORTHOGONAL);
    case 'bishop':
      return slide(from, DIAGONAL);
    case 'queen':
      return slide(from, [...ORTHOGONAL, ...DIAGONAL]);
    case 'king':
      return step(from, [...ORTHOGONAL, ...DIAGONAL]);
    case 'knight':
      return step(from, KNIGHT);
    case 'pawn': {
      const dir = piece.color === 'white' ? 1 : -1;
      const startRank = piece.color === 'white' ? 1 : 6;
      const f = fileIndex(from);
      const r = rankIndex(from);
      const out: Square[] = [];
      const one = squareAt(f, r + dir);
      if (one) out.push(one);
      if (r === startRank) {
        const two = squareAt(f, r + 2 * dir);
        if (two) out.push(two);
      }
      return out;
    }
  }
}

/** FEN piece-placement field for an empty board holding one piece. */
export function singlePieceFen(piece: Piece, square: Square): string {
  const letter = ROLE_TO_FEN[piece.role];
  const symbol = piece.color === 'white' ? letter.toUpperCase() : letter;
  const f = fileIndex(square);
  const r = rankIndex(square);
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    if (rank !== r) {
      rows.push('8');
      continue;
    }
    let row = '';
    if (f > 0) row += String(f);
    row += symbol;
    if (f < 7) row += String(7 - f);
    rows.push(row);
  }
  return rows.join('/');
}

/** Colour of a square: a1 is dark. */
export function squareColor(sq: Square): 'light' | 'dark' {
  return (fileIndex(sq) + rankIndex(sq)) % 2 === 0 ? 'dark' : 'light';
}

/** Squares attacked by a pawn of `color` standing on `sq`. */
export function pawnAttacks(sq: Square, color: Color): Square[] {
  const dir = color === 'white' ? 1 : -1;
  const f = fileIndex(sq);
  const r = rankIndex(sq);
  return [squareAt(f - 1, r + dir), squareAt(f + 1, r + dir)].filter((x): x is Square => x !== null);
}

/**
 * Shortest knight route from `from` to `to` that never lands on a forbidden
 * square (breadth-first search). Returns the squares visited including both
 * ends, or null when unreachable.
 */
export function knightPath(from: Square, to: Square, forbidden: ReadonlySet<Square> = new Set()): Square[] | null {
  if (from === to) return [from];
  const prev = new Map<Square, Square | null>([[from, null]]);
  const queue: Square[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of singlePieceDestinations({ role: 'knight', color: 'white' }, cur)) {
      if (prev.has(next) || forbidden.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path: Square[] = [];
        for (let s: Square | null = to; s !== null; s = prev.get(s) ?? null) path.unshift(s);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
