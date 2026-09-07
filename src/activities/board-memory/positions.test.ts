import { read } from 'chessground/fen';
import { describe, expect, it } from 'vitest';
import { positionsFromGames, randomPosition, scorePosition, withPiece, EMPTY_BOARD } from './positions';

describe('positions', () => {
  it('collects middlegame positions from the bundled games', () => {
    const all = positionsFromGames();
    expect(all.length).toBeGreaterThan(150);
    expect(all.every((p) => p.pieces >= 10)).toBe(true);
    expect(all[0].label).toMatch(/Morphy, Paul – Duke Karl \/ Count Isouard, 1858, after 6\.\.\.Nf6/);
  });

  it('random positions have two non-adjacent kings and no pawns on back ranks', () => {
    for (let i = 0; i < 50; i++) {
      const pos = randomPosition(20);
      const pieces = read(pos.fen);
      expect(pieces.size).toBe(20);
      const kings = [...pieces.entries()].filter(([, p]) => p.role === 'king');
      expect(kings).toHaveLength(2);
      expect(kings[0][1].color).not.toBe(kings[1][1].color);
      for (const [sq, p] of pieces) {
        if (p.role === 'pawn') expect(['1', '8']).not.toContain(sq[1]);
      }
    }
  });

  it('scores correct, missing, wrong and extra pieces', () => {
    const target = 'r3k3/8/8/8/8/8/8/4K2R';
    const answer = 'r3k3/8/8/8/8/8/8/4K1R1';
    const s = scorePosition(target, answer);
    expect(s).toMatchObject({ total: 4, correct: 3, missing: 1, wrong: 0, extra: 1 });
    expect(s.accuracy).toBeCloseTo(3 / 5);
    expect(s.solutionMarks.get('h1')).toBe('missing');
    expect(s.answerMarks.get('g1')).toBe('wrong');
    expect(s.answerMarks.get('a8')).toBe('correct');
    const wrongPiece = scorePosition(target, 'r3k3/8/8/8/8/8/8/4K2Q');
    expect(wrongPiece).toMatchObject({ correct: 3, wrong: 1, missing: 0, extra: 0 });
    expect(scorePosition(target, target).accuracy).toBe(1);
    expect(scorePosition(target, EMPTY_BOARD).accuracy).toBe(0);
  });

  it('stamps and erases pieces', () => {
    const fen = withPiece(EMPTY_BOARD, 'e4', { role: 'knight', color: 'white' });
    expect(fen).toBe('8/8/8/8/4N3/8/8/8');
    expect(withPiece(fen, 'e4', null)).toBe(EMPTY_BOARD);
  });
});
