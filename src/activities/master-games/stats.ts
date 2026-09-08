import { loadJson, saveJson } from '@/lib/storage';

export interface SessionRecord {
  date: string;
  game: string;
  side: 'white' | 'black';
  guesses: number;
  points: number;
  max: number;
  matched: number;
}

const KEY = 'master-games:history';
const LIMIT = 200;

export function getHistory(): SessionRecord[] {
  return loadJson<SessionRecord[]>(KEY, []);
}

export function recordSession(r: SessionRecord): SessionRecord[] {
  const history = [...getHistory(), r].slice(-LIMIT);
  saveJson(KEY, history);
  return history;
}

export function summarise(history: SessionRecord[]): { sessions: number; accuracy: number; matched: number } {
  if (history.length === 0) return { sessions: 0, accuracy: 0, matched: 0 };
  const last = history.slice(-10);
  const points = last.reduce((s, r) => s + r.points, 0);
  const max = last.reduce((s, r) => s + r.max, 0);
  const guesses = last.reduce((s, r) => s + r.guesses, 0);
  const matched = last.reduce((s, r) => s + r.matched, 0);
  return { sessions: history.length, accuracy: max ? points / max : 0, matched: guesses ? matched / guesses : 0 };
}
