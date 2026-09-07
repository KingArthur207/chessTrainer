// Game logic for playing out a repertoire: book replies while the position
// is in the tree, then the engine takes over. Pure functions; the component
// owns timing and engine calls.
import { Chess } from 'chess.js';
import { childByUci, leafLines, type Opening, type Side, type TreeNode } from '@/activities/opening-trainer/model';
import { applyMove, turnOf } from '@/chess/position';
import type { Key } from 'chessground/types';

export type StartMode = 'start' | 'leaf' | 'pick';

export const START_MODES: Array<{ id: StartMode; label: string; blurb: string }> = [
  { id: 'leaf', label: 'Where the book ends', blurb: 'Start at the end of a random line and play on from there.' },
  { id: 'start', label: 'From move one', blurb: 'The opponent follows your book while in theory; the engine takes over once either side leaves it.' },
  { id: 'pick', label: 'Pick a position', blurb: 'Choose any move in the tree as the starting point.' },
];

export interface Strength {
  id: string;
  label: string;
  /** null = full strength */
  elo: number | null;
}

export const STRENGTHS: Strength[] = [
  { id: 'beginner', label: 'Beginner · 1350', elo: 1350 },
  { id: 'club', label: 'Club · 1600', elo: 1600 },
  { id: 'strong', label: 'Strong club · 1900', elo: 1900 },
  { id: 'expert', label: 'Expert · 2200', elo: 2200 },
  { id: 'master', label: 'Master · 2500', elo: 2500 },
  { id: 'full', label: 'Full strength', elo: null },
];

export type MoveBy = 'user' | 'book' | 'engine';

export interface PlayedMove {
  san: string;
  uci: string;
  fenAfter: string;
  by: MoveBy;
  /** The move is in the repertoire tree. */
  inBook: boolean;
  /** Set on a user move that left the book: the SAN the book expected. */
  bookMove?: string;
}

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

export interface GameState {
  userColor: Side;
  startFen: string;
  /** Book path to the start position (root first). */
  startPath: TreeNode[];
  /** Current tree node while still in book, null once out of it. */
  node: TreeNode | null;
  fen: string;
  moves: PlayedMove[];
  status: 'playing' | 'over' | 'stopped';
  result: GameResult | null;
  reason: string | null;
}

export function startPathFor(opening: Opening, mode: StartMode, rng: () => number = Math.random): TreeNode[] {
  if (mode === 'leaf') {
    const lines = leafLines(opening.root);
    if (lines.length > 0) {
      const line = lines[Math.floor(rng() * lines.length)];
      return [opening.root, ...line.nodes];
    }
  }
  return [opening.root];
}

export function newGame(opening: Opening, startPath: TreeNode[]): GameState {
  const node = startPath[startPath.length - 1];
  return {
    userColor: opening.color,
    startFen: node.fen,
    startPath,
    node,
    fen: node.fen,
    moves: [],
    status: 'playing',
    result: null,
    reason: null,
  };
}

export function isUserTurn(state: GameState): boolean {
  return state.status === 'playing' && turnOf(state.fen) === state.userColor;
}

export function bookReplies(state: GameState): TreeNode[] {
  return state.node?.children ?? [];
}

/** All positions seen so far (for repetition), oldest first. */
function positionKeys(state: GameState): string[] {
  const key = (fen: string) => fen.split(' ').slice(0, 4).join(' ');
  return [key(state.startFen), ...state.moves.map((m) => key(m.fenAfter))];
}

export function gameOver(fen: string, seen: string[]): { result: GameResult; reason: string } | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'Checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'Stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'Insufficient material' };
  if (Number(fen.split(' ')[4]) >= 100) return { result: '1/2-1/2', reason: 'Fifty-move rule' };
  const current = fen.split(' ').slice(0, 4).join(' ');
  if (seen.filter((k) => k === current).length >= 3) return { result: '1/2-1/2', reason: 'Threefold repetition' };
  return null;
}

/** Apply a move (by anyone). Returns null if illegal. */
export function play(state: GameState, from: Key, to: Key, by: MoveBy): GameState | null {
  if (state.status !== 'playing') return null;
  const applied = applyMove(state.fen, from, to, 'q');
  if (!applied) return null;
  const child = state.node ? childByUci(state.node, applied.uci) : undefined;
  const expected = state.node?.children[0];
  const move: PlayedMove = {
    san: applied.san,
    uci: applied.uci,
    fenAfter: applied.fen,
    by,
    inBook: !!child,
    bookMove: by === 'user' && !child && expected ? expected.san : undefined,
  };
  const next: GameState = { ...state, node: child ?? null, fen: applied.fen, moves: [...state.moves, move] };
  const over = gameOver(applied.fen, positionKeys(next));
  if (over) return { ...next, status: 'over', result: over.result, reason: over.reason };
  return next;
}

/** Take back the last user move together with any reply that followed it. */
export function undo(state: GameState): GameState {
  const idx = state.moves.map((m) => m.by).lastIndexOf('user');
  if (idx < 0) return state;
  const moves = state.moves.slice(0, idx);
  let node: TreeNode | null = state.startPath[state.startPath.length - 1];
  for (const m of moves) node = node ? (childByUci(node, m.uci) ?? null) : null;
  return {
    ...state,
    moves,
    node,
    fen: moves.length ? moves[moves.length - 1].fenAfter : state.startFen,
    status: 'playing',
    result: null,
    reason: null,
  };
}

export function stop(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'stopped', reason: 'Stopped for review' } : state;
}

/** Index of the first move played outside the book (or -1 while all in book). */
export function bookEndIndex(state: GameState): number {
  return state.moves.findIndex((m) => !m.inBook);
}

export function pickBookReply(replies: TreeNode[], rng: () => number = Math.random): TreeNode {
  return replies[Math.floor(rng() * replies.length)];
}
