import { loadJson, saveJson } from '@/lib/storage';
import type { Side } from '@/activities/opening-trainer/model';
import type { GameResult } from './game';

export interface PlayRecord {
  date: string;
  openingId: string;
  openingName: string;
  color: Side;
  elo: number | null;
  result: GameResult | 'stopped';
  pliesInBook: number;
  plies: number;
  /** Final score from the user's point of view, centipawns. */
  finalCpForUser: number | null;
  mistakes: number;
  blunders: number;
}

const KEY = 'repertoire-play:history';
const LIMIT = 200;

export function getHistory(): PlayRecord[] {
  return loadJson<PlayRecord[]>(KEY, []);
}

export function recordGame(r: PlayRecord): PlayRecord[] {
  const history = [...getHistory(), r].slice(-LIMIT);
  saveJson(KEY, history);
  return history;
}

export function summarise(history: PlayRecord[]): { games: number; avgErrors: number; avgFinal: number | null } {
  if (history.length === 0) return { games: 0, avgErrors: 0, avgFinal: null };
  const last = history.slice(-20);
  const withFinal = last.filter((g) => g.finalCpForUser !== null);
  return {
    games: history.length,
    avgErrors: last.reduce((s, g) => s + g.mistakes + g.blunders, 0) / last.length,
    avgFinal: withFinal.length ? withFinal.reduce((s, g) => s + (g.finalCpForUser ?? 0), 0) / withFinal.length : null,
  };
}
