import { loadJson, saveJson } from '@/lib/storage';
import type { DurationSec } from './drill';

export interface BulletResult {
  durationSec: DurationSec;
  solved: number;
  misses: number;
  avgSolveMs: number | null;
  fastestMs: number | null;
  date: string;
}

interface BestEntry {
  solved: number;
  date: string;
}

type BestTable = Partial<Record<DurationSec, BestEntry>>;

const BEST_KEY = 'bullet:best';
const HISTORY_KEY = 'bullet:history';
const HISTORY_LIMIT = 200;

export function getBest(duration: DurationSec): BestEntry | null {
  return loadJson<BestTable>(BEST_KEY, {})[duration] ?? null;
}

export function getHistory(): BulletResult[] {
  return loadJson<BulletResult[]>(HISTORY_KEY, []);
}

/** Persist a finished session. Returns whether it set a new personal best. */
export function recordResult(result: BulletResult): { isNewBest: boolean; best: number } {
  const table = loadJson<BestTable>(BEST_KEY, {});
  const previous = table[result.durationSec];
  const isNewBest = result.solved > 0 && (!previous || result.solved > previous.solved);
  if (isNewBest) {
    table[result.durationSec] = { solved: result.solved, date: result.date };
    saveJson(BEST_KEY, table);
  }
  const history = getHistory();
  history.push(result);
  saveJson(HISTORY_KEY, history.slice(-HISTORY_LIMIT));
  return { isNewBest, best: table[result.durationSec]?.solved ?? result.solved };
}
