import { loadJson, saveJson } from '@/lib/storage';
import type { VisSource } from './exercise';

export interface VisAttempt {
  date: string;
  source: VisSource;
  depth: number;
  hidden: boolean;
  correct: number;
  total: number;
}

const KEY = 'visualisation:history';
const LIMIT = 300;

export function getHistory(): VisAttempt[] {
  return loadJson<VisAttempt[]>(KEY, []);
}

export function recordAttempt(a: VisAttempt): VisAttempt[] {
  const history = [...getHistory(), a].slice(-LIMIT);
  saveJson(KEY, history);
  return history;
}

export function summarise(history: VisAttempt[]): { attempts: number; recent: number } {
  if (history.length === 0) return { attempts: 0, recent: 0 };
  const last = history.slice(-10);
  const correct = last.reduce((s, a) => s + a.correct, 0);
  const total = last.reduce((s, a) => s + a.total, 0);
  return { attempts: history.length, recent: total ? correct / total : 0 };
}
