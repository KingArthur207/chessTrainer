import { loadJson, saveJson } from '@/lib/storage';
import { isDue, schedule, type LineProgress } from '@/activities/opening-trainer/srs';
import { ENDGAMES } from './drill';

export interface EndgameStat {
  attempts: number;
  successes: number;
  lastResult: 'success' | 'failed' | null;
  lastDate: string | null;
}

const PROGRESS_KEY = 'endgames:progress';
const STATS_KEY = 'endgames:stats';

export type ProgressMap = Record<string, LineProgress>;
export type StatsMap = Record<string, EndgameStat>;

export function loadProgress(): ProgressMap {
  return loadJson<ProgressMap>(PROGRESS_KEY, {});
}

export function loadStats(): StatsMap {
  return loadJson<StatsMap>(STATS_KEY, {});
}

export function recordResult(id: string, success: boolean, mistakes: number): { progress: ProgressMap; stats: StatsMap; next: LineProgress } {
  const progress = loadProgress();
  const next = schedule(progress[id], success ? mistakes : Math.max(3, mistakes));
  progress[id] = next;
  saveJson(PROGRESS_KEY, progress);
  const stats = loadStats();
  const prev = stats[id] ?? { attempts: 0, successes: 0, lastResult: null, lastDate: null };
  stats[id] = { attempts: prev.attempts + 1, successes: prev.successes + (success ? 1 : 0), lastResult: success ? 'success' : 'failed', lastDate: new Date().toISOString() };
  saveJson(STATS_KEY, stats);
  return { progress, stats, next };
}

export function dueEndgames(progress: ProgressMap = loadProgress()): string[] {
  return ENDGAMES.filter((e) => isDue(progress[e.id])).map((e) => e.id);
}

export function summary(): string | null {
  const progress = loadProgress();
  const stats = loadStats();
  const practised = Object.keys(stats).length;
  if (practised === 0) return null;
  const due = dueEndgames(progress).length;
  return `${due} of ${ENDGAMES.length} due · ${practised} practised`;
}
