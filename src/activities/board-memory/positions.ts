// Position sources and scoring for the Board Memory drill.
import { read, write } from 'chessground/fen';
import type { Key, Piece } from 'chessground/types';
import { ALL_SQUARES, rankIndex, fileIndex, type Square } from '@/chess/squares';
import { metaFromHeaders, parsePgn, splitPgnDatabase } from '@/games/pgn';
import { SAMPLE_PGN } from '@/games/registry';
import type { Opening, TreeNode } from '@/activities/opening-trainer/model';

export type SourceId = 'lichess' | 'games' | 'openings' | 'random';

export const SOURCES: Array<{ id: SourceId; label: string; blurb: string }> = [
  {
    id: 'lichess',
    label: 'Lichess masters',
    blurb: 'Recent over-the-board master games from Lichess broadcasts. 500 games are fetched at a time, kept offline, and renewed once you have seen them.',
  },
  { id: 'games', label: 'Classic games', blurb: 'Middlegame positions from five famous games. Real structure helps you chunk.' },
  { id: 'openings', label: 'My openings', blurb: 'Positions from your own repertoire trees.' },
  { id: 'random', label: 'Random pieces', blurb: 'Randomly scattered pieces: no patterns to lean on.' },
];

export const EMPTY_BOARD = '8/8/8/8/8/8/8/8';

export interface MemoryPosition {
  /** FEN placement field (a full FEN is tolerated by every consumer). */
  fen: string;
  pieces: number;
  label: string;
  source: SourceId;
}

export function countPieces(fen: string): number {
  return read(fen).size;
}

// ---- Classic games -----------------------------------------------------------

let gamePositions: MemoryPosition[] | null = null;

/** Every middlegame position (from ply 12 on, at least 10 pieces) in the bundled games. */
export function positionsFromGames(): MemoryPosition[] {
  if (gamePositions) return gamePositions;
  const out: MemoryPosition[] = [];
  splitPgnDatabase(SAMPLE_PGN).forEach((pgn, g) => {
    const parsed = parsePgn(pgn);
    const meta = metaFromHeaders(`g${g}`, parsed.headers);
    const year = meta.date?.slice(0, 4) ?? '';
    parsed.moves.forEach((m, i) => {
      if (i < 11 || i >= parsed.moves.length - 1) return;
      const fen = m.fenAfter.split(' ')[0];
      const pieces = countPieces(fen);
      if (pieces < 10) return;
      const num = Math.floor(i / 2) + 1;
      const moveLabel = `${num}${m.color === 'w' ? '.' : '...'}${m.san}`;
      out.push({ fen, pieces, label: `${meta.white} – ${meta.black}, ${year}, after ${moveLabel}`, source: 'games' });
    });
  });
  gamePositions = out;
  return out;
}

// ---- User repertoire ---------------------------------------------------------

export function positionsFromOpenings(openings: Opening[]): MemoryPosition[] {
  const out: MemoryPosition[] = [];
  for (const op of openings) {
    const walk = (node: TreeNode, depth: number) => {
      if (depth >= 8) {
        const fen = node.fen.split(' ')[0];
        const num = Math.ceil(depth / 2);
        const white = depth % 2 === 1;
        out.push({
          fen,
          pieces: countPieces(fen),
          label: `${op.name}, after ${num}${white ? '.' : '...'}${node.san}`,
          source: 'openings',
        });
      }
      for (const c of node.children) walk(c, depth + 1);
    };
    walk(op.root, 0);
  }
  return out;
}

// ---- Random ------------------------------------------------------------------

const RANDOM_POOL: Array<Piece['role']> = [
  'queen', 'rook', 'rook', 'bishop', 'bishop', 'knight', 'knight',
  'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn',
];

function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function kingsAdjacent(a: Square, b: Square): boolean {
  return Math.abs(fileIndex(a) - fileIndex(b)) <= 1 && Math.abs(rankIndex(a) - rankIndex(b)) <= 1;
}

/** Both kings plus `pieceCount - 2` random pieces (pawns never on the back ranks). */
export function randomPosition(pieceCount = 12 + Math.floor(Math.random() * 13)): MemoryPosition {
  const total = Math.max(2, Math.min(32, pieceCount));
  let squares = shuffle(ALL_SQUARES);
  while (kingsAdjacent(squares[0], squares[1])) squares = shuffle(ALL_SQUARES);
  const pieces = new Map<Key, Piece>();
  pieces.set(squares[0], { role: 'king', color: 'white' });
  pieces.set(squares[1], { role: 'king', color: 'black' });
  const pools = { white: shuffle(RANDOM_POOL), black: shuffle(RANDOM_POOL) };
  let i = 2;
  while (pieces.size < total && i < squares.length) {
    const sq = squares[i++];
    const color: Piece['color'] = Math.random() < 0.5 ? 'white' : 'black';
    const pool = pools[color];
    if (pool.length === 0) continue;
    const rank = rankIndex(sq);
    const idx = rank === 0 || rank === 7 ? pool.findIndex((r) => r !== 'pawn') : 0;
    if (idx < 0) continue;
    const [role] = pool.splice(idx, 1);
    pieces.set(sq, { role, color });
  }
  const fen = write(pieces);
  return { fen, pieces: pieces.size, label: `Random position, ${pieces.size} pieces`, source: 'random' };
}

// ---- Picking -----------------------------------------------------------------

/** Sync sources only; the Lichess pool is handled by lichessPool.ts. */
export function pickPosition(source: SourceId, openings: Opening[], avoidFen?: string): MemoryPosition | null {
  if (source === 'random') return randomPosition();
  if (source === 'lichess') return null;
  const pool = source === 'games' ? positionsFromGames() : positionsFromOpenings(openings);
  const candidates = pool.length > 1 ? pool.filter((p) => p.fen !== avoidFen) : pool;
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---- Scoring -----------------------------------------------------------------

export interface Score {
  total: number;
  correct: number;
  missing: number;
  wrong: number;
  extra: number;
  /** 0..1 */
  accuracy: number;
  /** Marks for the solution view: correct / missing squares. */
  solutionMarks: Map<Key, string>;
  /** Marks for the answer view: correct / wrong (misplaced or extra) squares. */
  answerMarks: Map<Key, string>;
}

export function scorePosition(targetFen: string, answerFen: string): Score {
  const target = read(targetFen);
  const answer = read(answerFen);
  const solutionMarks = new Map<Key, string>();
  const answerMarks = new Map<Key, string>();
  let correct = 0;
  let missing = 0;
  let wrong = 0;
  let extra = 0;
  for (const sq of ALL_SQUARES) {
    const t = target.get(sq);
    const a = answer.get(sq);
    if (t && a && t.role === a.role && t.color === a.color) {
      correct++;
      solutionMarks.set(sq, 'correct');
      answerMarks.set(sq, 'correct');
    } else if (t && a) {
      wrong++;
      solutionMarks.set(sq, 'missing');
      answerMarks.set(sq, 'wrong');
    } else if (t) {
      missing++;
      solutionMarks.set(sq, 'missing');
    } else if (a) {
      extra++;
      answerMarks.set(sq, 'wrong');
    }
  }
  const total = target.size;
  const denominator = total + extra;
  return { total, correct, missing, wrong, extra, accuracy: denominator === 0 ? 1 : correct / denominator, solutionMarks, answerMarks };
}

/** Stamp or erase a piece on a placement FEN. */
export function withPiece(fen: string, key: Key, piece: Piece | null): string {
  const pieces = read(fen);
  if (piece) pieces.set(key, piece);
  else pieces.delete(key);
  return write(pieces);
}
