import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { parsePgn, splitPgnDatabase } from './pgn';
import { SAMPLE_PGN } from './registry';

describe('bundled classic games', () => {
  const games = splitPgnDatabase(SAMPLE_PGN);

  it('splits into five games', () => {
    expect(games).toHaveLength(5);
  });

  it('every game parses fully and mates where the score says so', () => {
    const expected: Array<[string, number, boolean]> = [
      ['Morphy, Paul', 33, true],
      ['Anderssen, Adolf', 45, true],
      ['Anderssen, Adolf', 47, true],
      ['Byrne, Donald', 82, true],
      ['Kasparov, Garry', 87, false],
    ];
    games.forEach((pgn, i) => {
      const parsed = parsePgn(pgn);
      expect(parsed.headers.White).toBe(expected[i][0]);
      expect(parsed.moves).toHaveLength(expected[i][1]);
      const last = parsed.moves[parsed.moves.length - 1];
      expect(new Chess(last.fenAfter).isCheckmate()).toBe(expected[i][2]);
    });
  });
});

describe('parsePgn on Lichess broadcast exports', () => {
  const broadcast = `[Event "IM VI Round Robin-Mramorak"]
[Site "idChess.com"]
[White "Velpula Sarayu"]
[Black "Zherebtsova, Alexandra"]
[Result "1-0"]
[WhiteElo "2324"]
[BroadcastName "Chess Club \\"Radnicki\\" Kovin | IM VI"]

1. e4 { [%eval 0.18] [%clk 1:30:29] } 1... e5 { [%eval 0.22] [%clk 1:30:23] } 2. Nf3 { [%eval 0.18] [%clk 1:30:20] } 2... Nc6 $1 (2... d6 3. d4) 3. Nc3 { [%eval 0.06] } 3... Nf6 1-0
`;

  it('keeps headers with escaped quotes, skips annotations and variations', () => {
    const g = parsePgn(broadcast);
    expect(g.headers.BroadcastName).toBe('Chess Club "Radnicki" Kovin | IM VI');
    expect(g.headers.WhiteElo).toBe('2324');
    expect(g.moves.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6']);
    expect(g.moves[5].fenAfter).toMatch(/ w /);
  });

  it('throws on an illegal main-line move', () => {
    expect(() => parsePgn('1. e4 e5 2. Ke2 Ke7 3. Kd3 Ke6 4. Kc4 Nf3')).toThrow(/Illegal move "Nf3"/);
  });
});
