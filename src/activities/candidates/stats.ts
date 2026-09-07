import { loadJson, saveJson } from '@/lib/storage';
import type { PositionSource } from '@/activities/shared/positionSources';

export interface CandidateAttempt {
  date: string;
  source: PositionSource;
  seconds: number;
  candidates: number;
  foundBest: boolean;
  overlap: number;
}

const KEY = 'candidates:history';
const LIMIT = 300;

export function getHistory(): CandidateAttempt[] {
  return loadJson<CandidateAttempt[]>(KEY, []);
}

export function recordAttempt(a: CandidateAttempt): CandidateAttempt[] {
  const history = [...getHistory(), a].slice(-LIMIT);
  saveJson(KEY, history);
  return history;
}

export function summarise(history: CandidateAttempt[]): { attempts: number; bestRate: number; avgOverlap: number } {
  if (history.length === 0) return { attempts: 0, bestRate: 0, avgOverlap: 0 };
  const last = history.slice(-20);
  return {
    attempts: history.length,
    bestRate: last.filter((a) => a.foundBest).length / last.length,
    avgOverlap: last.reduce((s, a) => s + a.overlap, 0) / last.length,
  };
}
