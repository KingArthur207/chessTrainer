import { Chess, type Square } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { createOpening } from '@/activities/opening-trainer/model';
import { importPgn } from '@/activities/opening-trainer/pgn';
import { START_FEN } from '@/chess/position';
import { buildExercise, describeAnswer, isCorrect } from './exercise';
import { exerciseFromClassics, exerciseFromOpenings, openingsHaveSequences } from './sources';

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('buildExercise', () => {
  it('labels moves, replays them and asks three answerable questions', () => {
    const ex = buildExercise(START_FEN, ['e4', 'e5', 'Nf3', 'Nc6'], 'test', 'games', seq([0, 0, 0.9, 0]));
    expect(ex).not.toBeNull();
    expect(ex!.movesText).toBe('1.e4 e5 2.Nf3 Nc6');
    const replay = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) replay.move(san);
    expect(ex!.moves[3].fenAfter).toBe(replay.fen());
    expect(ex!.finalFen).toBe(replay.fen());
    expect(ex!.questions).toHaveLength(3);
    const [q1, q2, q3] = ex!.questions;
    expect(q1.type).toBe('piece-on');
    expect(q2.type).toBe('locate');
    expect(['check', 'attacked']).toContain(q3.type);
    // Every question is consistent with the final position.
    const final = new Chess(ex!.finalFen);
    if (q1.type === 'piece-on') {
      const p = final.get(q1.square as Square);
      expect(q1.answer === null ? p === undefined : p?.type === q1.answer.role[0] || (q1.answer.role === 'knight' && p?.type === 'n')).toBe(true);
    }
    if (q2.type === 'locate') expect(isCorrect(q2, q2.answer)).toBe(true);
    if (q3.type === 'check') expect(q3.answer).toBe(final.isCheck());
  });

  it('starts black moves with "..." and rejects illegal sequences', () => {
    const afterE4 = new Chess();
    afterE4.move('e4');
    const ex = buildExercise(afterE4.fen(), ['c5', 'Nf3'], 'x', 'games');
    expect(ex!.movesText).toBe('1...c5 2.Nf3');
    expect(buildExercise(START_FEN, ['e4', 'e4'], 'x', 'games')).toBeNull();
    expect(buildExercise(START_FEN, [], 'x', 'games')).toBeNull();
  });

  it('marks answers correct or wrong and describes the right answer', () => {
    const ex = buildExercise(START_FEN, ['e4', 'd5', 'exd5', 'Qxd5'], 'x', 'games', seq([0.5]))!;
    const q1 = ex.questions[0];
    expect(q1.type).toBe('piece-on');
    if (q1.type === 'piece-on') {
      expect(isCorrect(q1, q1.answer)).toBe(true);
      expect(isCorrect(q1, { role: 'king', color: 'white' })).toBe(false);
      expect(isCorrect(q1, 'e4')).toBe(false);
      expect(describeAnswer(q1)).toMatch(/^(a (white|black) \w+|an empty square)$/);
    }
    const q3 = ex.questions[2];
    expect(isCorrect(q3, !q3.answer)).toBe(false);
  });
});

describe('sources', () => {
  it('draws sequences from the classic games at every depth', () => {
    for (const depth of [2, 4, 6, 8]) {
      const ex = exerciseFromClassics(depth, seq([0.3, 0.7, 0.2, 0.4]));
      expect(ex).not.toBeNull();
      expect(ex!.moves).toHaveLength(depth);
      expect(ex!.label).toMatch(/, \d{4}, after \d+/);
    }
  });

  it('draws main-line sequences from opening trees', () => {
    const op = createOpening('Test', 'white');
    importPgn(op, '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6');
    expect(openingsHaveSequences([op], 8)).toBe(true);
    expect(openingsHaveSequences([op], 6)).toBe(true);
    const ex = exerciseFromOpenings([op], 8, () => 0);
    expect(ex!.movesText).toBe('1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6');
    expect(ex!.label).toBe('Test, from the start');
    expect(exerciseFromOpenings([createOpening('Empty', 'black')], 2)).toBeNull();
  });
});
