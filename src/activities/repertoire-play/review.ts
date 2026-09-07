// Post-game review: evaluate every position the user played from, flag the
// moves that lost the most, and report the final assessment.
import { uciLineToSan } from '@/chess/position';
import { scoreValue } from '@/engine/session';
import type { Side } from '@/activities/opening-trainer/model';
import type { PlayedMove } from './game';

export interface PositionEval {
  cp: number | null;
  mate: number | null;
  bestMove: string | null;
}

export type Severity = 'ok' | 'inaccuracy' | 'mistake' | 'blunder';

export interface ReviewEntry {
  /** 0-based index into moves. */
  index: number;
  moveNumber: string;
  san: string;
  /** Centipawn loss from the user's point of view (positive = lost). */
  loss: number;
  severity: Severity;
  cpBefore: number;
  cpAfter: number;
  /** Engine's preferred move in the position before, as SAN. */
  best: string | null;
}

export interface Review {
  entries: ReviewEntry[];
  mistakes: number;
  blunders: number;
  finalCp: number | null;
  finalMate: number | null;
  /** Total user moves reviewed. */
  reviewed: number;
}

export const REVIEW_PLIES = 40;

export function severityOf(loss: number): Severity {
  if (loss >= 300) return 'blunder';
  if (loss >= 100) return 'mistake';
  if (loss >= 50) return 'inaccuracy';
  return 'ok';
}

const clampScore = (v: number) => Math.max(-1000, Math.min(1000, v));

export function moveNumberOf(startFen: string, index: number): string {
  const startWhite = startFen.split(' ')[1] !== 'b';
  const startNum = Number(startFen.split(' ')[5] ?? 1);
  const plyFromWhite = startWhite ? index : index + 1;
  const num = startNum + Math.floor(plyFromWhite / 2);
  return plyFromWhite % 2 === 0 ? `${num}.` : `${num}...`;
}

/**
 * Evaluate the last REVIEW_PLIES positions and grade the user's moves among
 * them. `analyse` is injected so tests can script it.
 */
export async function reviewGame(
  startFen: string,
  moves: PlayedMove[],
  userColor: Side,
  analyse: (fen: string) => Promise<PositionEval>,
  onProgress?: (done: number, total: number) => void,
): Promise<Review> {
  const fens = [startFen, ...moves.map((m) => m.fenAfter)];
  const first = Math.max(0, fens.length - 1 - REVIEW_PLIES);
  const evals = new Map<number, PositionEval>();
  const total = fens.length - first;
  for (let i = first; i < fens.length; i++) {
    evals.set(i, await analyse(fens[i]));
    onProgress?.(i - first + 1, total);
  }
  const sign = userColor === 'white' ? 1 : -1;
  const entries: ReviewEntry[] = [];
  moves.forEach((m, index) => {
    if (m.by !== 'user' || index < first) return;
    const before = evals.get(index);
    const after = evals.get(index + 1);
    if (!before || !after) return;
    const cpBefore = clampScore(scoreValue(before));
    const cpAfter = clampScore(scoreValue(after));
    const loss = Math.max(0, sign * (cpBefore - cpAfter));
    entries.push({
      index,
      moveNumber: moveNumberOf(startFen, index),
      san: m.san,
      loss,
      severity: severityOf(loss),
      cpBefore,
      cpAfter,
      best: before.bestMove ? (uciLineToSan(fens[index], [before.bestMove])[0] ?? before.bestMove) : null,
    });
  });
  const last = evals.get(fens.length - 1) ?? null;
  return {
    entries,
    mistakes: entries.filter((e) => e.severity === 'mistake').length,
    blunders: entries.filter((e) => e.severity === 'blunder').length,
    finalCp: last?.cp ?? null,
    finalMate: last?.mate ?? null,
    reviewed: entries.length,
  };
}
