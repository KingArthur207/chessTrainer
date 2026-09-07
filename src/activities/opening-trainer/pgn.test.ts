import { describe, expect, it } from 'vitest';
import { createOpening, leafLines, lineToSan, countMoves } from './model';
import { exportPgn, importPgn, normalizeSan, tokenize } from './pgn';
import { EXAMPLE_PGN } from './store';
import { gradeFor, schedule, INTERVALS_DAYS } from './srs';

describe('tokenize / normalizeSan', () => {
  it('handles glued numbers, glyphs, castling and NAGs', () => {
    expect(normalizeSan('Nf3!?')).toBe('Nf3');
    expect(normalizeSan('0-0-0')).toBe('O-O-O');
    expect(normalizeSan('e8Q')).toBe('e8=Q');
    expect(normalizeSan('hello')).toBeNull();
    const kinds = tokenize('1.e4 c5 2.Nf3 $1 d6 {ok} 3...Nf6').map((t) => t.kind);
    expect(kinds).toEqual(['number', 'move', 'move', 'number', 'move', 'move', 'comment', 'number', 'move']);
  });
});

describe('importPgn', () => {
  it('builds a tree with variations and comments', () => {
    const op = createOpening('t', 'white');
    const r = importPgn(op, '1. e4 e5 (1... c5 2. Nf3 {open sicilian}) 2. Nf3 Nc6');
    expect(r.errors).toEqual([]);
    expect(r.added).toBe(6);
    expect(op.root.children.map((c) => c.san)).toEqual(['e4']);
    const e4 = op.root.children[0];
    expect(e4.children.map((c) => c.san)).toEqual(['e5', 'c5']);
    expect(e4.children[1].children[0].comment).toBe('open sicilian');
    expect(leafLines(op.root).map((l) => lineToSan(l.nodes))).toEqual(['1.e4 e5 2.Nf3 Nc6', '1.e4 c5 2.Nf3']);
  });

  it('treats blank lines, results and a fresh "1." as new lines, merging prefixes', () => {
    const op = createOpening('t', 'white');
    const text = `1. d4 Nf6 2. c4 e6 3. Nc3 Bb4\n\n1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 *\n1. d4 d5 2. c4 e6 1-0`;
    const r = importPgn(op, text);
    expect(r.errors).toEqual([]);
    expect(r.lines).toBe(3);
    expect(countMoves(op.root)).toBe(6 + 3 + 3);
    expect(leafLines(op.root)).toHaveLength(3);
  });

  it('reports illegal moves with context and keeps going', () => {
    const op = createOpening('t', 'white');
    const r = importPgn(op, '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf7\n1. e4 c5');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Nf7/);
    expect(leafLines(op.root).map((l) => lineToSan(l.nodes))).toEqual(['1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4', '1.e4 c5']);
  });

  it('is idempotent', () => {
    const op = createOpening('t', 'black');
    importPgn(op, EXAMPLE_PGN);
    const before = countMoves(op.root);
    const r = importPgn(op, EXAMPLE_PGN);
    expect(r.added).toBe(0);
    expect(countMoves(op.root)).toBe(before);
  });
});

describe('exportPgn', () => {
  it('round-trips the example repertoire exactly', () => {
    const a = createOpening('Sicilian Dragon', 'black');
    importPgn(a, EXAMPLE_PGN);
    const pgn = exportPgn(a);
    expect(pgn).toContain('[Event "Sicilian Dragon"]');
    expect(pgn).toContain('6. Be3 { Yugoslav Attack');
    expect(pgn).toContain('(6. Be2 Bg7');
    expect(pgn).toContain('6... Bg7');
    const b = createOpening('copy', 'black');
    const r = importPgn(b, pgn);
    expect(r.errors).toEqual([]);
    const strip = (o: typeof a) =>
      leafLines(o.root).map((l) => ({ san: lineToSan(l.nodes), comments: l.nodes.map((n) => n.comment ?? '') }));
    expect(strip(b)).toEqual(strip(a));
    expect(exportPgn(b).split('\n').slice(2).join('\n')).toBe(pgn.split('\n').slice(2).join('\n'));
  });

  it('numbers black moves after variations and comments', () => {
    const op = createOpening('t', 'white');
    importPgn(op, '1. e4 c5 (1... e5 2. Nf3) 2. Nf3 {x} d6');
    const body = exportPgn(op).split('\n\n')[1].trim();
    expect(body).toBe('1. e4 c5 (1... e5 2. Nf3) 2. Nf3 { x } 2... d6 *');
  });
});

describe('srs', () => {
  it('grades and schedules', () => {
    const now = 1_000_000;
    expect(gradeFor(0)).toBe('good');
    expect(gradeFor(2)).toBe('hard');
    expect(gradeFor(3)).toBe('again');
    const p1 = schedule(undefined, 0, now);
    expect(p1.step).toBe(0);
    expect(p1.due).toBe(now + INTERVALS_DAYS[0] * 86_400_000);
    const p2 = schedule(p1, 0, now);
    expect(p2.step).toBe(1);
    const p3 = schedule(p2, 5, now);
    expect(p3.step).toBe(0);
    expect(p3.lapses).toBe(1);
    expect(p3.due - now).toBeLessThan(86_400_000);
    const p4 = schedule(p3, 0, now);
    expect(p4.step).toBe(0);
    const p5 = schedule(p4, 1, now);
    expect(p5.step).toBe(0);
    expect(p5.due).toBe(now + INTERVALS_DAYS[0] * 86_400_000);
  });
});
