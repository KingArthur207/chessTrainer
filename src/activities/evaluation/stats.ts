import { loadJson, saveJson } from '@/lib/storage';
import type { EvalSource } from './assessment';

export interface EvalAttempt {
  date: string;
  source: EvalSource;
  seconds: number;
  guess: number;
  actual: number;
  cp: number | null;
  mate: number | null;
}

const KEY = 'evaluation:history';
const LIMIT = 300;

export function getHistory(): EvalAttempt[] {
  return loadJson<EvalAttempt[]>(KEY, []);
}

export function recordAttempt(a: EvalAttempt): EvalAttempt[] {
  const history = [...getHistory(), a].slice(-LIMIT);
  saveJson(KEY, history);
  return history;
}

export function summarise(history: EvalAttempt[]): { attempts: number; exact: number; close: number } {
  if (history.length === 0) return { attempts: 0, exact: 0, close: 0 };
  const last = history.slice(-20);
  const exact = last.filter((a) => a.guess === a.actual).length / last.length;
  const close = last.filter((a) => Math.abs(a.guess - a.actual) <= 1).length / last.length;
  return { attempts: history.length, exact, close };
}
