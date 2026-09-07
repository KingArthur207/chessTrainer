import { describe, expect, it } from 'vitest';
import { compare, describeComparison, rankingFrom } from './drill';
import { pickPosition } from '@/activities/shared/positionSources';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('candidate drill', () => {
  const evaluation = {
    fen: START,
    depth: 12,
    final: true,
    bestMove: 'e2e4',
    cp: 30,
    mate: null,
    lines: [
      { multiPv: 2, depth: 12, cp: 25, mate: null, pv: ['d2d4', 'g8f6', 'c2c4'] },
      { multiPv: 1, depth: 12, cp: 30, mate: null, pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6'] },
      { multiPv: 3, depth: 12, cp: 15, mate: null, pv: ['g1f3'] },
    ],
  };

  it('builds a ranked list with SAN and numbered lines', () => {
    const r = rankingFrom(evaluation, START);
    expect(r.map((c) => c.san)).toEqual(['e4', 'd4', 'Nf3']);
    expect(r[0].line).toBe('1.e4 e5 2.Nf3 Nc6');
    expect(r[1]).toMatchObject({ rank: 2, uci: 'd2d4', cp: 25 });
  });

  it('compares user candidates against the ranking', () => {
    const r = rankingFrom(evaluation, START);
    const c = compare([{ uci: 'g1f3', san: 'Nf3' }, { uci: 'e2e4', san: 'e4' }, { uci: 'c2c4', san: 'c4' }], r);
    expect(c).toEqual({ foundBest: true, overlap: 2, ranks: [3, 1, null] });
    expect(describeComparison(c, 3)).toMatch(/found the best move; 2 of your 3/);
    const none = compare([{ uci: 'a2a3', san: 'a3' }], r);
    expect(none).toEqual({ foundBest: false, overlap: 0, ranks: [null] });
    expect(describeComparison(none, 1)).toMatch(/None/);
    const all = compare([{ uci: 'e2e4', san: 'e4' }, { uci: 'd2d4', san: 'd4' }, { uci: 'g1f3', san: 'Nf3' }], r);
    expect(describeComparison(all, 3)).toMatch(/All three/);
  });

  it('shared position picker honours the acceptance filter', () => {
    const onlyWhite = pickPosition('games', [], undefined, () => 0.3, (fen) => fen.split(' ')[1] === 'w');
    expect(onlyWhite!.fen.split(' ')[1]).toBe('w');
    expect(pickPosition('games', [], undefined, () => 0.3, () => false)).toBeNull();
  });
});
