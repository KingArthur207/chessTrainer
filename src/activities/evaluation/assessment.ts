// The seven-step assessment scale and scoring for the evaluation trainer.
import {
  lichessUsableCount,
  openingsAvailable,
  pickPosition,
  POSITION_SOURCES,
  type PositionSource,
  type SourcedPosition,
} from '@/activities/shared/positionSources';

export type EvalSource = PositionSource;
export type EvalPosition = SourcedPosition;
export const EVAL_SOURCES = POSITION_SOURCES;
export { lichessUsableCount, openingsAvailable };
export const pickEvalPosition = pickPosition;

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
