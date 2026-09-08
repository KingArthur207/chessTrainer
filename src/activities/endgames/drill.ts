// Endgame drill rules: the catalogue, and the verdict after each user move
// given the engine's evaluation.
import { read } from 'chessground/fen';
import type { Side } from '@/activities/opening-trainer/model';
import { formatScore } from '@/engine/session';
import type { GameResult } from '@/chess/position';
import catalogue from './catalogue.json';

export type Goal = 'win' | 'draw';
export type SuccessKind = 'mate' | 'promote' | 'bare-king' | 'hold';

export interface Endgame {
  id: string;
  category: string;
  name: string;
  fen: string;
  side: Side;
  goal: Goal;
  success: SuccessKind;
  hint: string;
  difficulty: number;
  /** Minimum centipawns (user's view) that still count as winning. */
  winCp?: number;
  /** Largest deficit (user's view) that still counts as holding. */
  drawCp?: number;
}

export const ENDGAMES: Endgame[] = catalogue as Endgame[];
export const CATEGORIES = [...new Set(ENDGAMES.map((e) => e.category))];

/** User moves to survive for a "hold" drill. */
export const HOLD_MOVES = 20;
const DEFAULT_WIN_CP = 150;
const DEFAULT_DRAW_CP = 150;

export type Verdict = 'ok' | 'slip' | 'success' | 'failed';

export interface Judgement {
  verdict: Verdict;
  message: string;
}

export function opponentHasOnlyKing(fen: string, userSide: Side): boolean {
  const opponent = userSide === 'white' ? 'black' : 'white';
  for (const piece of read(fen).values()) if (piece.color === opponent && piece.role !== 'king') return false;
  return true;
}

export function userWon(result: GameResult, side: Side): boolean {
  return (result === '1-0' && side === 'white') || (result === '0-1' && side === 'black');
}

/**
 * Judge the position after the user's move. `cp`/`mate` are from the user's
 * point of view; `over` is the game-over check on that position.
 */
export function judge(
  endgame: Endgame,
  input: { fenAfter: string; cp: number | null; mate: number | null; over: { result: GameResult; reason: string } | null; userMoves: number; lastSan: string },
): Judgement {
  const { over } = input;
  if (over) {
    if (over.result === '1/2-1/2') {
      return endgame.goal === 'draw' ? { verdict: 'success', message: `${over.reason}: held.` } : { verdict: 'failed', message: `${over.reason}: the win is gone.` };
    }
    return userWon(over.result, endgame.side)
      ? { verdict: 'success', message: `${over.reason}.` }
      : { verdict: 'failed', message: `${over.reason} against you.` };
  }
  const score = formatScore({ cp: input.cp, mate: input.mate });
  if (endgame.goal === 'win') {
    const winning = input.mate !== null ? input.mate > 0 : (input.cp ?? 0) >= (endgame.winCp ?? DEFAULT_WIN_CP);
    if (!winning) return { verdict: 'slip', message: `The win slipped: the engine now sees ${score}.` };
    if (endgame.success === 'promote' && /=/.test(input.lastSan)) return { verdict: 'success', message: 'Promoted. The rest is technique.' };
    if (endgame.success === 'bare-king' && opponentHasOnlyKing(input.fenAfter, endgame.side)) return { verdict: 'success', message: 'Only the king is left: the win is trivial from here.' };
    return { verdict: 'ok', message: `Still winning (${score}).` };
  }
  const holding = input.mate !== null ? input.mate > 0 : (input.cp ?? 0) >= -(endgame.drawCp ?? DEFAULT_DRAW_CP);
  if (!holding) return { verdict: 'slip', message: `The draw is gone: the engine now sees ${score}.` };
  if (input.userMoves >= HOLD_MOVES) return { verdict: 'success', message: `Held for ${HOLD_MOVES} moves.` };
  return { verdict: 'ok', message: `Holding (${score}), ${HOLD_MOVES - input.userMoves} to go.` };
}

/** Mistake count fed to the spaced-repetition scheduler. */
export function mistakesFor(slips: number, gaveUp: boolean): number {
  return gaveUp ? 3 : slips;
}

export function goalLabel(e: Endgame): string {
  return `${e.goal === 'win' ? 'Win' : 'Hold'} with ${e.side === 'white' ? 'White' : 'Black'}`;
}
