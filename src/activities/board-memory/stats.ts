import { loadJson, saveJson } from '@/lib/storage';
import type { SourceId } from './positions';

export interface MemoryAttempt {
  date: string;
  source: SourceId;
  seconds: number;
  pieces: number;
  /** 0..1 */
  accuracy: number;
}

const HISTORY_KEY = 'board-memory:history';
const LIMIT = 200;

export function getHistory(): MemoryAttempt[] {
  return loadJson<MemoryAttempt[]>(HISTORY_KEY, []);
}

export function recordAttempt(attempt: MemoryAttempt): MemoryAttempt[] {
  const history = [...getHistory(), attempt].slice(-LIMIT);
  saveJson(HISTORY_KEY, history);
  return history;
}

export function summarise(history: MemoryAttempt[]): { attempts: number; average: number; recent: number } {
  if (history.length === 0) return { attempts: 0, average: 0, recent: 0 };
  const mean = (list: MemoryAttempt[]) => list.reduce((s, a) => s + a.accuracy, 0) / list.length;
  return { attempts: history.length, average: mean(history), recent: mean(history.slice(-10)) };
}
