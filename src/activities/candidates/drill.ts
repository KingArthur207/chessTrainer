// Candidate-move drill: compare the user's candidates with the engine's top
// lines.
import { numberedLine, uciLineToSan } from '@/chess/position';
import type { Evaluation } from '@/engine/session';

export const MAX_CANDIDATES = 3;

export interface EngineCandidate {
  rank: number;
  uci: string;
  san: string;
  cp: number | null;
  mate: number | null;
  /** Numbered SAN of the first few plies. */
  line: string;
}

export interface UserCandidate {
  uci: string;
  san: string;
}

export function rankingFrom(evaluation: Evaluation, fen: string, plies = 6): EngineCandidate[] {
  return evaluation.lines
    .filter((l) => l.pv.length > 0)
    .map((l) => {
      const sans = uciLineToSan(fen, l.pv.slice(0, plies));
      return { rank: l.multiPv, uci: l.pv[0], san: sans[0] ?? l.pv[0], cp: l.cp, mate: l.mate, line: numberedLine(fen, sans) };
    })
    .sort((a, b) => a.rank - b.rank);
}

export interface Comparison {
  /** The engine's best move is among the user's candidates. */
  foundBest: boolean;
  /** How many user candidates appear in the engine's top list. */
  overlap: number;
  /** Per user candidate: its engine rank (1-based) or null. */
  ranks: Array<number | null>;
}

export function compare(user: UserCandidate[], ranking: EngineCandidate[]): Comparison {
  const ranks = user.map((c) => ranking.find((e) => e.uci === c.uci)?.rank ?? null);
  return {
    foundBest: ranks.includes(1),
    overlap: ranks.filter((r) => r !== null).length,
    ranks,
  };
}

export function describeComparison(c: Comparison, count: number): string {
  if (c.foundBest && c.overlap === count && count === MAX_CANDIDATES) return 'All three candidates are in the engine\'s top three, best move included.';
  if (c.foundBest) return `You found the best move; ${c.overlap} of your ${count} ${count === 1 ? 'candidate is' : 'candidates are'} in the top three.`;
  if (c.overlap > 0) return `The best move was missing, but ${c.overlap} of your ${count} ${count === 1 ? 'candidate is' : 'candidates are'} in the top three.`;
  return 'None of your candidates made the engine\'s top three.';
}
