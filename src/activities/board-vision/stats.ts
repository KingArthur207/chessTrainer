import { loadJson, saveJson } from '@/lib/storage';
import type { VisionMode } from './drills';

interface VisionStats {
  /** Best score per timed drill, keyed "mode:seconds". */
  best: Record<string, number>;
  knight: { solved: number; optimal: number; extraMoves: number };
}

const KEY = 'board-vision:stats';

export function loadStats(): VisionStats {
  return { best: {}, knight: { solved: 0, optimal: 0, extraMoves: 0 }, ...loadJson<Partial<VisionStats>>(KEY, {}) };
}

export function recordTimed(mode: VisionMode, seconds: number, score: number): { best: number; isNewBest: boolean } {
  const stats = loadStats();
  const key = `${mode}:${seconds}`;
  const previous = stats.best[key] ?? 0;
  const isNewBest = score > previous;
  if (isNewBest) stats.best[key] = score;
  saveJson(KEY, stats);
  return { best: Math.max(previous, score), isNewBest };
}

export function recordKnight(moves: number, optimal: number): void {
  const stats = loadStats();
  stats.knight.solved += 1;
  if (moves === optimal) stats.knight.optimal += 1;
  stats.knight.extraMoves += Math.max(0, moves - optimal);
  saveJson(KEY, stats);
}

export function bestFor(mode: VisionMode, seconds: number): number {
  return loadStats().best[`${mode}:${seconds}`] ?? 0;
}

export function summary(): string | null {
  const s = loadStats();
  const parts: string[] = [];
  const squares = Math.max(s.best['squares:30'] ?? 0, s.best['squares:60'] ?? 0);
  const colours = Math.max(s.best['colours:30'] ?? 0, s.best['colours:60'] ?? 0);
  if (squares) parts.push(`Squares ${squares}`);
  if (colours) parts.push(`Colours ${colours}`);
  if (s.knight.solved) parts.push(`${s.knight.solved} routes`);
  return parts.length ? parts.join(' · ') : null;
}
