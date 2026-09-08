import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { gameOver } from '@/chess/position';
import { CATEGORIES, ENDGAMES, HOLD_MOVES, judge, mistakesFor, opponentHasOnlyKing } from './drill';

describe('endgame catalogue', () => {
  it('has legal, well-formed positions with the drill side able to move or wait', () => {
    expect(ENDGAMES.length).toBeGreaterThanOrEqual(12);
    expect(CATEGORIES).toContain('Rook endgames');
    for (const e of ENDGAMES) {
      const chess = new Chess(e.fen);
      expect(chess.isGameOver()).toBe(false);
      expect(['white', 'black']).toContain(e.side);
      expect(new Set(ENDGAMES.map((x) => x.id)).size).toBe(ENDGAMES.length);
    }
  });
});

describe('judge', () => {
  const win = ENDGAMES.find((e) => e.id === 'kq-vs-k')!;
  const promote = ENDGAMES.find((e) => e.id === 'lucena')!;
  const bare = ENDGAMES.find((e) => e.id === 'q-vs-r')!;
  const hold = ENDGAMES.find((e) => e.id === 'philidor')!;
  const base = { fenAfter: '8/8/8/8/8/8/8/8 w - - 0 1', over: null, userMoves: 1, lastSan: 'Kd2' };

  it('keeps a winning drill going while the engine still sees a win', () => {
    expect(judge(win, { ...base, cp: 900, mate: null }).verdict).toBe('ok');
    expect(judge(win, { ...base, cp: null, mate: 4 }).verdict).toBe('ok');
    expect(judge(win, { ...base, cp: 40, mate: null })).toMatchObject({ verdict: 'slip' });
    expect(judge(win, { ...base, cp: 0, mate: null }).message).toMatch(/win slipped/);
  });

  it('ends on checkmate, promotion or a bare king as configured', () => {
    expect(judge(win, { ...base, cp: null, mate: null, over: { result: '1-0', reason: 'Checkmate' } })).toMatchObject({ verdict: 'success' });
    expect(judge(win, { ...base, cp: 0, mate: null, over: { result: '1/2-1/2', reason: 'Stalemate' } })).toMatchObject({ verdict: 'failed' });
    expect(judge(promote, { ...base, cp: 900, mate: null, lastSan: 'b8=Q+' }).verdict).toBe('success');
    expect(judge(promote, { ...base, cp: 900, mate: null, lastSan: 'Rc4' }).verdict).toBe('ok');
    expect(opponentHasOnlyKing('3k4/8/8/8/8/8/8/2Q1K3 w - - 0 1', 'white')).toBe(true);
    expect(opponentHasOnlyKing('3k4/8/1r6/8/8/8/8/2Q1K3 w - - 0 1', 'white')).toBe(false);
    expect(judge(bare, { ...base, fenAfter: '3k4/8/8/8/8/8/8/2Q1K3 b - - 0 1', cp: null, mate: 9 }).verdict).toBe('success');
  });

  it('holds a draw drill until the move count or a drawn game', () => {
    expect(judge(hold, { ...base, cp: -60, mate: null, userMoves: 3 }).verdict).toBe('ok');
    expect(judge(hold, { ...base, cp: -400, mate: null, userMoves: 3 })).toMatchObject({ verdict: 'slip' });
    expect(judge(hold, { ...base, cp: -20, mate: null, userMoves: HOLD_MOVES }).verdict).toBe('success');
    expect(judge(hold, { ...base, cp: 0, mate: null, over: { result: '1/2-1/2', reason: 'Threefold repetition' } }).verdict).toBe('success');
    expect(judge(hold, { ...base, cp: null, mate: -3, over: { result: '1-0', reason: 'Checkmate' } }).verdict).toBe('failed');
  });

  it('scores attempts for the scheduler', () => {
    expect(mistakesFor(0, false)).toBe(0);
    expect(mistakesFor(2, false)).toBe(2);
    expect(mistakesFor(0, true)).toBe(3);
  });

  it('shares the game-over rules with Play the Opening', () => {
    expect(gameOver('R5k1/8/6K1/8/8/8/8/8 b - - 0 1', [])).toEqual({ result: '1-0', reason: 'Checkmate' });
  });
});
