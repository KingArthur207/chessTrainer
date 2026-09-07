// Blindfold visualisation exercise: a start position, a short sequence of
// moves given only in notation, and questions about the resulting position.
import { Chess, type Square as CjSquare } from 'chess.js';
import type { Key, Piece } from 'chessground/types';
import { fullmoveOf, turnOf } from '@/chess/position';

export const DEPTHS = [2, 4, 6, 8] as const;
export type Depth = (typeof DEPTHS)[number];
export type VisSource = 'lichess' | 'games' | 'openings';

export interface SequenceMove {
  san: string;
  from: Key;
  to: Key;
  fenAfter: string;
  /** "23.Nf3", "23...Bxe4" for a first black move, else plain SAN. */
  label: string;
}

export type Question =
  | { type: 'piece-on'; prompt: string; square: Key; answer: Piece | null }
  | { type: 'locate'; prompt: string; piece: Piece; answer: Key }
  | { type: 'check'; prompt: string; color: Piece['color']; answer: boolean }
  | { type: 'attacked'; prompt: string; square: Key; piece: Piece; answer: boolean };

export type Answer = Piece | null | Key | boolean;

export interface Exercise {
  startFen: string;
  label: string;
  source: VisSource;
  moves: SequenceMove[];
  finalFen: string;
  movesText: string;
  questions: Question[];
}

const ROLE_OF: Record<string, Piece['role']> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export function pieceAt(chess: Chess, square: Key): Piece | null {
  const p = chess.get(square as CjSquare);
  return p ? { role: ROLE_OF[p.type], color: p.color === 'w' ? 'white' : 'black' } : null;
}

export const samePiece = (a: Piece | null, b: Piece | null): boolean =>
  (a === null && b === null) || (!!a && !!b && a.role === b.role && a.color === b.color);

export function describePiece(p: Piece | null): string {
  return p ? `${p.color} ${p.role}` : 'nothing';
}

const allPieces = (chess: Chess): Array<{ square: Key; piece: Piece }> =>
  chess
    .board()
    .flat()
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .map((c) => ({ square: c.square as Key, piece: { role: ROLE_OF[c.type], color: c.color === 'w' ? 'white' : 'black' } }));

/** Replay `sans` from `startFen`; null if any move is illegal or the list is empty. */
export function buildExercise(
  startFen: string,
  sans: string[],
  label: string,
  source: VisSource,
  rng: () => number = Math.random,
): Exercise | null {
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return null;
  }
  const start = new Chess(startFen);
  const moves: SequenceMove[] = [];
  for (const san of sans) {
    const fenBefore = chess.fen();
    const white = turnOf(fenBefore) === 'white';
    const num = fullmoveOf(fenBefore);
    let m;
    try {
      m = chess.move(san);
    } catch {
      return null;
    }
    moves.push({
      san: m.san,
      from: m.from as Key,
      to: m.to as Key,
      fenAfter: chess.fen(),
      label: white ? `${num}.${m.san}` : moves.length === 0 ? `${num}...${m.san}` : m.san,
    });
  }
  if (moves.length === 0) return null;
  return {
    startFen,
    label,
    source,
    moves,
    finalFen: chess.fen(),
    movesText: moves.map((m) => m.label).join(' '),
    questions: generateQuestions(start, chess, moves, rng),
  };
}

export function generateQuestions(start: Chess, final: Chess, moves: SequenceMove[], rng: () => number): Question[] {
  const pick = <T>(items: T[]): T => items[Math.floor(rng() * items.length)];
  const touched = [...new Set(moves.flatMap((m) => [m.from, m.to]))];
  const questions: Question[] = [];

  // 1. What is on a square whose content changed?
  const changed = touched.filter((sq) => !samePiece(pieceAt(start, sq), pieceAt(final, sq)));
  const sq = pick(changed.length ? changed : touched);
  questions.push({ type: 'piece-on', prompt: `What is on ${sq}?`, square: sq, answer: pieceAt(final, sq) });

  // 2. Where is a piece that moved (and is the only one of its kind)?
  const pieces = allPieces(final);
  const countOf = (p: Piece) => pieces.filter((x) => samePiece(x.piece, p)).length;
  const destinations = [...new Set(moves.map((m) => m.to))].reverse();
  const movedUnique = destinations
    .map((square) => ({ square, piece: pieceAt(final, square) }))
    .filter((x): x is { square: Key; piece: Piece } => x.piece !== null && countOf(x.piece) === 1);
  const target = movedUnique[0] ?? pick(pieces.filter((x) => x.piece.role === 'king'));
  questions.push({
    type: 'locate',
    prompt: `Where is the ${describePiece(target.piece)}?`,
    piece: target.piece,
    answer: target.square,
  });

  // 3. Check, or is a moved piece attacked?
  const toMove = turnOf(final.fen());
  const movedPieces = destinations
    .map((square) => ({ square, piece: pieceAt(final, square) }))
    .filter((x): x is { square: Key; piece: Piece } => x.piece !== null && x.piece.role !== 'king');
  if (final.isCheck() || movedPieces.length === 0 || rng() < 0.25) {
    questions.push({ type: 'check', prompt: `Is ${toMove} in check?`, color: toMove, answer: final.isCheck() });
  } else {
    const { square, piece } = pick(movedPieces);
    const attacked = final.isAttacked(square as CjSquare, piece.color === 'white' ? 'b' : 'w');
    questions.push({
      type: 'attacked',
      prompt: `Is the ${describePiece(piece)} on ${square} attacked?`,
      square,
      piece,
      answer: attacked,
    });
  }
  return questions;
}

export function isCorrect(q: Question, answer: Answer): boolean {
  switch (q.type) {
    case 'piece-on':
      return typeof answer !== 'string' && typeof answer !== 'boolean' && samePiece(q.answer, answer);
    case 'locate':
      return answer === q.answer;
    case 'check':
    case 'attacked':
      return answer === q.answer;
  }
}

export function describeAnswer(q: Question): string {
  switch (q.type) {
    case 'piece-on':
      return q.answer ? `a ${describePiece(q.answer)}` : 'an empty square';
    case 'locate':
      return q.answer;
    case 'check':
    case 'attacked':
      return q.answer ? 'Yes' : 'No';
  }
}

export function describeGiven(q: Question, answer: Answer): string {
  if (q.type === 'piece-on') return answer === null ? 'empty' : typeof answer === 'object' ? `a ${describePiece(answer)}` : String(answer);
  if (q.type === 'locate') return String(answer);
  return answer ? 'Yes' : 'No';
}
