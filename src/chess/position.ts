// Thin helpers over chess.js for full-position work (legal moves, applying
// moves, turn/move-number from a FEN). Used by activities that play real chess
// positions rather than the single-piece drills.
import { Chess, type Square as CjSquare } from 'chess.js';
import type { Key } from 'chessground/types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

export interface AppliedMove {
  san: string;
  uci: string;
  from: Key;
  to: Key;
  fen: string;
  check: boolean;
}

export function turnOf(fen: string): 'white' | 'black' {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

export function fullmoveOf(fen: string): number {
  return Number(fen.split(' ')[5] ?? 1);
}

export function inCheck(fen: string): boolean {
  return new Chess(fen).inCheck();
}

/** Map of origin square -> legal destination squares, for chessground. */
export function legalDests(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const list = dests.get(m.from as Key) ?? [];
    list.push(m.to as Key);
    dests.set(m.from as Key, list);
  }
  return dests;
}

/** Whether moving from -> to would be a pawn promotion in this position. */
export function isPromotion(fen: string, from: Key, to: Key): boolean {
  const piece = new Chess(fen).get(from as CjSquare);
  if (!piece || piece.type !== 'p') return false;
  const rank = to[1];
  return (piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1');
}

/** Apply a move by squares. Returns null if illegal. */
export function applyMove(fen: string, from: Key, to: Key, promotion: PromotionPiece = 'q'): AppliedMove | null {
  const chess = new Chess(fen);
  try {
    const m = chess.move({ from, to, promotion: isPromotion(fen, from, to) ? promotion : undefined });
    return {
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      from: m.from as Key,
      to: m.to as Key,
      fen: chess.fen(),
      check: chess.inCheck(),
    };
  } catch {
    return null;
  }
}

/** Apply a move given in SAN. Returns null if illegal or unparseable. */
export function applySan(fen: string, san: string): AppliedMove | null {
  const chess = new Chess(fen);
  try {
    const m = chess.move(san);
    return {
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      from: m.from as Key,
      to: m.to as Key,
      fen: chess.fen(),
      check: chess.inCheck(),
    };
  } catch {
    return null;
  }
}

/** "1." for white to move, "1..." for black, based on the FEN before the move. */
export function moveNumberPrefix(fenBefore: string, forceBlack = false): string {
  const n = fullmoveOf(fenBefore);
  if (turnOf(fenBefore) === 'white') return `${n}.`;
  return forceBlack ? `${n}...` : '';
}

/** Convert a UCI move list (from `fen`) to SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, uci: string[]): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const m of uci) {
    try {
      const move = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.slice(4, 5) || undefined });
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out;
}

/** "23.Nf3 Bxe4 24.Qxe4" style text for a SAN line starting from `fen`. */
export function numberedLine(fen: string, sans: string[]): string {
  const parts: string[] = [];
  let white = turnOf(fen) === 'white';
  let num = fullmoveOf(fen);
  sans.forEach((san, i) => {
    if (white) parts.push(`${num}.${san}`);
    else {
      parts.push(i === 0 ? `${num}...${san}` : san);
      num++;
    }
    white = !white;
  });
  return parts.join(' ');
}
