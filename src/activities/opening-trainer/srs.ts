// Spaced repetition for repertoire lines. Each leaf line is an item; finishing
// it in practice grades the item and schedules the next review.

export interface LineProgress {
  /** Index into INTERVALS. */
  step: number;
  /** Next review time (ms since epoch). 0 = due now. */
  due: number;
  reps: number;
  lapses: number;
  lastPracticed: number | null;
  lastMistakes: number | null;
}

/** Days until the next review, by step. */
export const INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 120, 240] as const;
const DAY = 24 * 60 * 60 * 1000;
/** A failed line comes back within the same session. */
const AGAIN_DELAY = 10 * 60 * 1000;

export type Grade = 'good' | 'hard' | 'again';

export function gradeFor(mistakes: number): Grade {
  if (mistakes === 0) return 'good';
  if (mistakes <= 2) return 'hard';
  return 'again';
}

export function freshProgress(): LineProgress {
  return { step: 0, due: 0, reps: 0, lapses: 0, lastPracticed: null, lastMistakes: null };
}

export function schedule(prev: LineProgress | undefined, mistakes: number, now = Date.now()): LineProgress {
  const p = prev ?? freshProgress();
  const grade = gradeFor(mistakes);
  const reps = p.reps + 1;
  if (grade === 'again') {
    return { step: 0, due: now + AGAIN_DELAY, reps, lapses: p.lapses + 1, lastPracticed: now, lastMistakes: mistakes };
  }
  // First success (or success after a lapse) starts at step 0 = 1 day.
  const restarting = p.reps === 0 || (p.lastMistakes !== null && p.lastMistakes > 2);
  const step = restarting ? 0 : grade === 'good' ? Math.min(p.step + 1, INTERVALS_DAYS.length - 1) : p.step;
  const due = now + INTERVALS_DAYS[step] * DAY;
  return { step, due, reps, lapses: p.lapses, lastPracticed: now, lastMistakes: mistakes };
}

export function isDue(p: LineProgress | undefined, now = Date.now()): boolean {
  return !p || p.due <= now;
}

export function describeDue(p: LineProgress | undefined, now = Date.now()): string {
  if (!p || p.reps === 0) return 'new';
  const diff = p.due - now;
  if (diff <= 0) return 'due';
  const days = Math.round(diff / DAY);
  if (days === 0) return 'later today';
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}
