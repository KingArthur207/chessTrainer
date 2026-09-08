// Scoring a guess against the game move and the engine.
import { scoreValue } from '@/engine/session';

export interface Score {
  cp: number | null;
  mate: number | null;
}

export interface GuessResult {
  /** 0–3 */
  points: number;
  matched: boolean;
  /** Centipawns the user's move lost against the position before (user's view). */
  lossUser: number;
  /** Same for the game's move. */
  lossGame: number;
  verdict: string;
}

export const MAX_POINTS = 3;
const clamp = (v: number) => Math.max(-1000, Math.min(1000, v));

/**
 * `before`, `afterUser`, `afterGame` are White-perspective scores. A move
 * that matches the game scores 3; otherwise a move at least as good as the
 * game's (within 30 cp) scores 2, one within 100 cp scores 1.
 */
export function scoreGuess(input: { userSan: string; gameSan: string; side: 'white' | 'black'; before: Score; afterUser: Score; afterGame: Score }): GuessResult {
  const sign = input.side === 'white' ? 1 : -1;
  const b = clamp(scoreValue(input.before)) * sign;
  const u = clamp(scoreValue(input.afterUser)) * sign;
  const g = clamp(scoreValue(input.afterGame)) * sign;
  const lossUser = Math.max(0, b - u);
  const lossGame = Math.max(0, b - g);
  if (input.userSan === input.gameSan) return { points: 3, matched: true, lossUser, lossGame, verdict: 'The game move.' };
  const worseThanGame = u < g - 30;
  if (!worseThanGame && lossUser <= 30) return { points: 2, matched: false, lossUser, lossGame, verdict: `Not the game move, but just as good (${input.gameSan} was played).` };
  if (lossUser <= 100) return { points: 1, matched: false, lossUser, lossGame, verdict: `Playable, but ${input.gameSan} was stronger.` };
  return { points: 0, matched: false, lossUser, lossGame, verdict: `That loses ${(lossUser / 100).toFixed(1)}; the game went ${input.gameSan}.` };
}
