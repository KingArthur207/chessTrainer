// The seven-step assessment scale, scoring, and position sources for the
// evaluation trainer.
import { getSnapshot } from '@/activities/board-memory/lichessPool';
import type { Opening, TreeNode } from '@/activities/opening-trainer/model';
import { metaFromHeaders, parsePgn, splitPgnDatabase } from '@/games/pgn';
import { SAMPLE_PGN } from '@/games/registry';

export type EvalSource = 'lichess' | 'games' | 'openings';

export const EVAL_SOURCES: Array<{ id: EvalSource; label: string; blurb: string }> = [
  { id: 'lichess', label: 'Lichess masters', blurb: 'Middlegame positions from the local Lichess pool; games are fetched here when it is empty.' },
  { id: 'games', label: 'Classic games', blurb: 'Positions from the five bundled classics.' },
  { id: 'openings', label: 'My openings', blurb: 'Positions from your repertoire: do you know who stands better after the theory ends?' },
];

export interface Category {
  id: number;
  label: string;
  symbol: string;
  /** Lower bound in centipawns (White's view), inclusive. */
  min: number;
}

export const CATEGORIES: Category[] = [
  { id: 0, label: 'White is winning', symbol: '+−', min: 300 },
  { id: 1, label: 'White is clearly better', symbol: '±', min: 150 },
  { id: 2, label: 'White is slightly better', symbol: '⩲', min: 50 },
  { id: 3, label: 'Equal', symbol: '=', min: -50 },
  { id: 4, label: 'Black is slightly better', symbol: '⩱', min: -150 },
  { id: 5, label: 'Black is clearly better', symbol: '∓', min: -300 },
  { id: 6, label: 'Black is winning', symbol: '−+', min: -Infinity },
];

export function categoryOf(cp: number | null, mate: number | null): number {
  if (mate !== null) return mate > 0 ? 0 : 6;
  const v = cp ?? 0;
  return CATEGORIES.find((c) => v >= c.min)!.id;
}

/** 0 = exact, 1 = one step off, … */
export function distance(guess: number, actual: number): number {
  return Math.abs(guess - actual);
}

export function verdict(d: number): string {
  if (d === 0) return 'Exact';
  if (d === 1) return 'Close, one step off';
  return `Off by ${d} steps`;
}

export interface EvalPosition {
  fen: string;
  label: string;
  source: EvalSource;
}

const MIN_PLY = 10;
let classics: EvalPosition[] | null = null;

function classicPositions(): EvalPosition[] {
  if (!classics) {
    classics = [];
    splitPgnDatabase(SAMPLE_PGN).forEach((pgn, g) => {
      const game = parsePgn(pgn);
      const meta = metaFromHeaders(`c${g}`, game.headers);
      game.moves.forEach((m, i) => {
        if (i < MIN_PLY || i >= game.moves.length - 2) return;
        const num = Math.floor(i / 2) + 1;
        classics!.push({
          fen: m.fenAfter,
          label: `${meta.white} – ${meta.black}, ${meta.date?.slice(0, 4) ?? ''}, after ${num}${m.color === 'w' ? '.' : '...'}${m.san}`,
          source: 'games',
        });
      });
    });
  }
  return classics;
}

function openingPositions(openings: Opening[]): EvalPosition[] {
  const out: EvalPosition[] = [];
  for (const op of openings) {
    const walk = (node: TreeNode, depth: number) => {
      if (depth >= 6) out.push({ fen: node.fen, label: `${op.name}, after ${node.san}`, source: 'openings' });
      for (const c of node.children) walk(c, depth + 1);
    };
    walk(op.root, 0);
  }
  return out;
}

/** Positions in the local Lichess pool usable for evaluation (full FEN). */
export function lichessUsableCount(): number {
  return getSnapshot().pool.positions.filter((p) => p.fen.includes(' ')).length;
}

export function openingsAvailable(openings: Opening[]): boolean {
  return openingPositions(openings).length > 0;
}

export function pickEvalPosition(source: EvalSource, openings: Opening[], avoidFen?: string, rng: () => number = Math.random): EvalPosition | null {
  let pool: EvalPosition[];
  if (source === 'lichess') {
    pool = getSnapshot()
      .pool.positions.filter((p) => p.fen.includes(' '))
      .map((p) => ({ fen: p.fen, label: p.label, source: 'lichess' as const }));
  } else if (source === 'games') pool = classicPositions();
  else pool = openingPositions(openings);
  const candidates = pool.length > 1 ? pool.filter((p) => p.fen !== avoidFen) : pool;
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}
