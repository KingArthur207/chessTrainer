import { describe, expect, it } from 'vitest';
import { createOpening } from '@/activities/opening-trainer/model';
import { importPgn } from '@/activities/opening-trainer/pgn';
import { bookEndIndex, bookReplies, gameOver, isUserTurn, newGame, play, startPathFor, undo } from './game';
import { moveNumberOf, reviewGame, severityOf } from './review';

function dragon() {
  const op = createOpening('Dragon', 'black');
  importPgn(op, '1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) 3. d4 cxd4 4. Nxd4 Nf6');
  return op;
}

describe('repertoire game', () => {
  it('follows the book, notes deviations and hands over to the engine', () => {
    const op = dragon();
    let g = newGame(op, startPathFor(op, 'start'));
    expect(isUserTurn(g)).toBe(false); // White (the book) moves first
    expect(bookReplies(g).map((n) => n.san)).toEqual(['e4']);
    g = play(g, 'e2', 'e4', 'book')!;
    expect(isUserTurn(g)).toBe(true);
    g = play(g, 'c7', 'c5', 'user')!;
    expect(g.moves[1]).toMatchObject({ san: 'c5', by: 'user', inBook: true });
    g = play(g, 'g1', 'f3', 'book')!;
    // Leaving the book: Nc6 is a sideline in this tree, so still in book...
    g = play(g, 'b8', 'c6', 'user')!;
    expect(g.moves[3]).toMatchObject({ san: 'Nc6', inBook: true, bookMove: undefined });
    // ...but 3.d4 e5 is not.
    g = play(g, 'd2', 'd4', 'book')!;
    g = play(g, 'e7', 'e5', 'user')!;
    expect(g.moves[5]).toMatchObject({ san: 'e5', inBook: false });
    expect(g.node).toBeNull();
    expect(bookReplies(g)).toEqual([]);
    expect(bookEndIndex(g)).toBe(5);
  });

  it('records the expected book move on a deviation', () => {
    const op = dragon();
    let g = newGame(op, startPathFor(op, 'start'));
    g = play(g, 'e2', 'e4', 'book')!;
    g = play(g, 'e7', 'e5', 'user')!;
    expect(g.moves[1]).toMatchObject({ san: 'e5', inBook: false, bookMove: 'c5' });
    expect(bookEndIndex(g)).toBe(1);
  });

  it('starts at the end of a line and undoes user moves with their replies', () => {
    const op = dragon();
    const path = startPathFor(op, 'leaf', () => 0);
    expect(path.map((n) => n.san).slice(1)).toEqual(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6']);
    let g = newGame(op, path);
    expect(isUserTurn(g)).toBe(false);
    g = play(g, 'b1', 'c3', 'engine')!;
    g = play(g, 'g7', 'g6', 'user')!;
    g = play(g, 'c1', 'e3', 'engine')!;
    expect(g.moves).toHaveLength(3);
    g = undo(g);
    expect(g.moves.map((m) => m.san)).toEqual(['Nc3']);
    expect(g.fen).toBe(g.moves[0].fenAfter);
    expect(isUserTurn(g)).toBe(true);
    expect(play(g, 'a7', 'a5', 'user')).not.toBeNull();
    expect(play(g, 'a7', 'a4', 'user')).toBeNull();
  });

  it('detects game over', () => {
    expect(gameOver('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', [])).toEqual({ result: '0-1', reason: 'Checkmate' });
    expect(gameOver('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', [])).toEqual({ result: '1/2-1/2', reason: 'Stalemate' });
    expect(gameOver('8/8/8/8/8/4k3/8/4K3 w - - 0 1', [])).toEqual({ result: '1/2-1/2', reason: 'Insufficient material' });
    const k = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    expect(gameOver('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [k, k, k])).toEqual({ result: '1/2-1/2', reason: 'Threefold repetition' });
    expect(gameOver('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [k])).toBeNull();
  });
});

describe('review', () => {
  it('grades user moves by centipawn loss and numbers them from the start position', () => {
    expect(severityOf(20)).toBe('ok');
    expect(severityOf(60)).toBe('inaccuracy');
    expect(severityOf(150)).toBe('mistake');
    expect(severityOf(400)).toBe('blunder');
    const startBlack = 'rnbqkbnr/pppppppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(moveNumberOf(startBlack, 0)).toBe('1...');
    expect(moveNumberOf(startBlack, 1)).toBe('2.');
    expect(moveNumberOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 2)).toBe('2.');
  });

  it('computes loss from the user\'s perspective', async () => {
    const op = dragon();
    let g = newGame(op, startPathFor(op, 'start'));
    g = play(g, 'e2', 'e4', 'book')!;
    g = play(g, 'c7', 'c5', 'user')!;
    g = play(g, 'g1', 'f3', 'book')!;
    g = play(g, 'a7', 'a6', 'user')!;
    // Scripted evals (White's view): the second user move drops from +0.3 to +1.6 for White = 130 lost for Black.
    const script: Record<number, { cp: number; best: string }> = { 0: { cp: 20, best: 'e2e4' }, 1: { cp: 30, best: 'c7c5' }, 2: { cp: 30, best: 'g1f3' }, 3: { cp: 30, best: 'd7d6' }, 4: { cp: 160, best: 'd2d4' } };
    const fens = [g.startFen, ...g.moves.map((m) => m.fenAfter)];
    const progress: number[] = [];
    const r = await reviewGame(g.startFen, g.moves, 'black', async (fen) => ({ ...script[fens.indexOf(fen)], mate: null, bestMove: script[fens.indexOf(fen)].best }), (d) => progress.push(d));
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(r.entries.map((e) => [e.san, e.loss, e.severity, e.best])).toEqual([
      ['c5', 0, 'ok', 'c5'],
      ['a6', 130, 'mistake', 'd6'],
    ]);
    expect(r.entries[1].moveNumber).toBe('2...');
    expect(r.mistakes).toBe(1);
    expect(r.finalCp).toBe(160);
  });
});
