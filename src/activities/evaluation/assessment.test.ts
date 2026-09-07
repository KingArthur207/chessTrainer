import { describe, expect, it } from 'vitest';
import { createOpening } from '@/activities/opening-trainer/model';
import { importPgn } from '@/activities/opening-trainer/pgn';
import { numberedLine, uciLineToSan } from '@/chess/position';
import { categoryOf, distance, pickEvalPosition, verdict } from './assessment';

describe('assessment scale', () => {
  it('maps scores to the seven categories', () => {
    expect(categoryOf(0, null)).toBe(3);
    expect(categoryOf(49, null)).toBe(3);
    expect(categoryOf(50, null)).toBe(2);
    expect(categoryOf(149, null)).toBe(2);
    expect(categoryOf(150, null)).toBe(1);
    expect(categoryOf(300, null)).toBe(0);
    expect(categoryOf(-50, null)).toBe(3);
    expect(categoryOf(-51, null)).toBe(4);
    expect(categoryOf(-200, null)).toBe(5);
    expect(categoryOf(-1000, null)).toBe(6);
    expect(categoryOf(null, 4)).toBe(0);
    expect(categoryOf(null, -1)).toBe(6);
  });

  it('describes distances', () => {
    expect(verdict(distance(3, 3))).toBe('Exact');
    expect(verdict(distance(2, 3))).toBe('Close, one step off');
    expect(verdict(distance(0, 6))).toBe('Off by 6 steps');
  });
});

describe('positions and lines', () => {
  it('draws positions from classics and openings', () => {
    const p = pickEvalPosition('games', [], undefined, () => 0.5);
    expect(p!.fen.split(' ')).toHaveLength(6);
    expect(p!.label).toMatch(/after \d+/);
    const op = createOpening('Test', 'white');
    importPgn(op, '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6');
    const o = pickEvalPosition('openings', [op], undefined, () => 0);
    expect(o!.label).toMatch(/^Test, after/);
    expect(pickEvalPosition('openings', [], undefined)).toBeNull();
  });

  it('converts UCI lines to numbered SAN', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const sans = uciLineToSan(fen, ['e2e4', 'c7c5', 'g1f3', 'zzzz']);
    expect(sans).toEqual(['e4', 'c5', 'Nf3']);
    expect(numberedLine(fen, sans)).toBe('1.e4 c5 2.Nf3');
    const black = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(numberedLine(black, ['c5', 'Nf3', 'd6'])).toBe('1...c5 2.Nf3 d6');
  });
});
