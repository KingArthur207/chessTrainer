import { describe, expect, it } from 'vitest';
import { knightPath, pawnAttacks, singlePieceDestinations, squareColor } from '@/chess/squares';
import { makeKnightPuzzle, knightAt } from './drills';

describe('square helpers', () => {
  it('knows square colours', () => {
    expect(squareColor('a1')).toBe('dark');
    expect(squareColor('h1')).toBe('light');
    expect(squareColor('f5')).toBe('light');
    expect(squareColor('e4')).toBe('light');
    expect(squareColor('d4')).toBe('dark');
  });

  it('computes pawn attacks', () => {
    expect(pawnAttacks('e5', 'black').sort()).toEqual(['d4', 'f4']);
    expect(pawnAttacks('a2', 'white')).toEqual(['b3']);
  });

  it('finds shortest knight routes and respects forbidden squares', () => {
    expect(knightPath('a1', 'b3')).toEqual(['a1', 'b3']);
    expect(knightPath('a1', 'h8')!.length - 1).toBe(6);
    expect(knightPath('a1', 'a1')).toEqual(['a1']);
    const direct = knightPath('g1', 'f3')!;
    expect(direct).toEqual(['g1', 'f3']);
    const detour = knightPath('g1', 'f3', new Set(['f3']));
    expect(detour).toBeNull(); // the target itself is forbidden
    const around = knightPath('g1', 'e2', new Set(['f3', 'd3' as const]))!;
    expect(around[0]).toBe('g1');
    expect(around[around.length - 1]).toBe('e2');
    expect(around).not.toContain('f3');
  });
});

describe('makeKnightPuzzle', () => {
  it('produces solvable puzzles with safe start and target', () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 30; i++) {
      const p = makeKnightPuzzle(3, rng);
      expect(p.pawns).toHaveLength(3);
      expect(p.forbidden).not.toContain(p.knight);
      expect(p.forbidden).not.toContain(p.target);
      expect(p.optimal).toBeGreaterThanOrEqual(2);
      expect(p.path[0]).toBe(p.knight);
      expect(p.path[p.path.length - 1]).toBe(p.target);
      for (let k = 1; k < p.path.length; k++) {
        expect(singlePieceDestinations({ role: 'knight', color: 'white' }, p.path[k - 1])).toContain(p.path[k]);
        expect(p.forbidden).not.toContain(p.path[k]);
      }
      expect(knightAt(p, p.target)).toMatch(/N/);
    }
  });
});
