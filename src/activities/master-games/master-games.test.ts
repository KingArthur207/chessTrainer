import { describe, expect, it } from 'vitest';
import { classicGames, gameFromPgn, labelFor, winner } from './games';
import { scoreGuess } from './scoring';

describe('guess-the-move games', () => {
  it('loads the classics with labels and move lists', () => {
    const games = classicGames();
    expect(games).toHaveLength(5);
    expect(games[0].label).toBe('Morphy, Paul – Duke Karl / Count Isouard, Paris 1858');
    expect(games[0].sans.slice(0, 4)).toEqual(['e4', 'e5', 'Nf3', 'd6']);
    expect(winner(games[3].result)).toBe('black');
    expect(labelFor({ white: 'A', black: 'B', whiteElo: 2500 })).toBe('A (2500) – B');
  });

  it('parses a pasted game and rejects short ones', () => {
    const g = gameFromPgn('[White "X"]\n[Black "Y"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 *');
    expect(g.white).toBe('X');
    expect(g.sans).toHaveLength(12);
    expect(() => gameFromPgn('1. e4 e5')).toThrow(/too short/);
    expect(() => gameFromPgn('')).toThrow(/No moves/);
  });
});

describe('scoreGuess', () => {
  const before = { cp: 50, mate: null };
  it('scores the game move, equivalent moves, playable moves and blunders', () => {
    expect(scoreGuess({ userSan: 'Nf3', gameSan: 'Nf3', side: 'white', before, afterUser: before, afterGame: before }).points).toBe(3);
    const asGood = scoreGuess({ userSan: 'Nc3', gameSan: 'Nf3', side: 'white', before, afterUser: { cp: 40, mate: null }, afterGame: { cp: 45, mate: null } });
    expect(asGood.points).toBe(2);
    expect(asGood.verdict).toMatch(/just as good/);
    const playable = scoreGuess({ userSan: 'a3', gameSan: 'Nf3', side: 'white', before, afterUser: { cp: -20, mate: null }, afterGame: { cp: 45, mate: null } });
    expect(playable).toMatchObject({ points: 1, lossUser: 70 });
    const blunder = scoreGuess({ userSan: 'Qh5', gameSan: 'Nf3', side: 'white', before, afterUser: { cp: -300, mate: null }, afterGame: before });
    expect(blunder.points).toBe(0);
    expect(blunder.verdict).toMatch(/loses 3\.5/);
  });

  it('uses the user\'s perspective for Black and handles mates', () => {
    const black = scoreGuess({ userSan: 'Qh4#', gameSan: 'Nc6', side: 'black', before: { cp: -30, mate: null }, afterUser: { cp: null, mate: -1 }, afterGame: { cp: -40, mate: null } });
    expect(black.points).toBe(2);
    expect(black.lossUser).toBe(0);
    const worse = scoreGuess({ userSan: 'Ke7', gameSan: 'Nc6', side: 'black', before: { cp: -30, mate: null }, afterUser: { cp: 200, mate: null }, afterGame: { cp: -40, mate: null } });
    expect(worse.points).toBe(0);
  });
});
