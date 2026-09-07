import { describe, expect, it } from 'vitest';
import { EngineSession, formatScore, scoreValue, whiteShare } from './session';
import type { BestMove, ChessEngine, EngineInfo, SearchOptions } from './types';

/** Scripted engine: emits the given info lines, then a best move. */
function fakeEngine(script: (fen: string, options: SearchOptions) => { infos: EngineInfo[]; best: BestMove }) {
  const calls: string[] = [];
  const engine: ChessEngine = {
    name: 'Fake 1.0',
    async init() {},
    setPosition(fen) {
      calls.push(`position ${fen}`);
    },
    setOption(name, value) {
      calls.push(`option ${name}=${value}`);
    },
    async go(options, onInfo) {
      calls.push(`go ${options.depth ?? ''}/${options.moveTimeMs ?? ''}/${options.multiPv ?? ''}`);
      const fen = calls.filter((c) => c.startsWith('position')).pop()!.slice(9);
      const { infos, best } = script(fen, options);
      for (const info of infos) onInfo?.(info);
      await new Promise((r) => setTimeout(r, 5));
      return best;
    },
    stop() {
      calls.push('stop');
    },
    dispose() {},
  };
  return { engine, calls };
}

const WHITE_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('EngineSession', () => {
  it('normalises scores to White and keeps the deepest line per MultiPV', async () => {
    const { engine, calls } = fakeEngine(() => ({
      infos: [
        { depth: 8, multiPv: 1, scoreCp: 30, pv: ['e7e5'] },
        { depth: 8, multiPv: 2, scoreCp: 10, pv: ['c7c5'] },
        { depth: 12, multiPv: 1, scoreCp: -25, pv: ['e7e5', 'g1f3'] },
        { depth: 12, multiPv: 2, scoreMate: 3, pv: ['c7c5'] },
      ],
      best: { bestMove: 'e7e5' },
    }));
    const session = new EngineSession(async () => engine);
    const progress: number[] = [];
    const ev = await session.analyse(BLACK_FEN, { moveTimeMs: 100, multiPv: 2, onProgress: (p) => progress.push(p.depth) });
    expect(session.name).toBe('Fake 1.0');
    expect(ev.final).toBe(true);
    expect(ev.bestMove).toBe('e7e5');
    expect(ev.depth).toBe(12);
    // Black to move: a score of -25 for Black is +25 for White.
    expect(ev.lines[0]).toMatchObject({ multiPv: 1, depth: 12, cp: 25, mate: null, pv: ['e7e5', 'g1f3'] });
    expect(ev.lines[1]).toMatchObject({ multiPv: 2, cp: null, mate: -3 });
    expect(ev.cp).toBe(25);
    expect(progress).toEqual([8, 8, 12, 12]);
    expect(calls).toContain('option MultiPV=2');
  });

  it('keeps White-to-move scores as they are and serialises searches', async () => {
    let n = 0;
    const { engine, calls } = fakeEngine((fen) => {
      n++;
      return { infos: [{ depth: 5, scoreCp: fen === WHITE_FEN ? 40 : -60, pv: ['e2e4'] }], best: { bestMove: 'e2e4' } };
    });
    const session = new EngineSession(async () => engine);
    const [a, b] = await Promise.all([session.analyse(WHITE_FEN), session.analyse(BLACK_FEN)]);
    expect(a.cp).toBe(40);
    expect(b.cp).toBe(60); // -60 for Black = +60 for White
    expect(n).toBe(2);
    const positions = calls.filter((c) => c.startsWith('position'));
    expect(positions[0]).toContain(WHITE_FEN);
    expect(positions[1]).toContain(BLACK_FEN);
  });

  it('limits strength only for play requests and resets it for analysis', async () => {
    const { engine, calls } = fakeEngine(() => ({ infos: [{ depth: 3, scoreCp: 10, pv: ['e2e4'] }], best: { bestMove: 'e2e4' } }));
    const session = new EngineSession(async () => engine);
    expect(await session.playMove(WHITE_FEN, { elo: 1500 })).toBe('e2e4');
    expect(calls).toContain('option UCI_LimitStrength=true');
    expect(calls).toContain('option UCI_Elo=1500');
    calls.length = 0;
    await session.playMove(WHITE_FEN, { elo: 1500 });
    expect(calls.filter((c) => c.startsWith('option UCI_'))).toEqual([]); // unchanged strength: no chatter
    await session.analyse(WHITE_FEN);
    expect(calls).toContain('option UCI_LimitStrength=false');
    calls.length = 0;
    await session.playMove(WHITE_FEN, { elo: 99999 });
    expect(calls).toContain('option UCI_Elo=3190');
  });

  it('surfaces a missing engine as an error', async () => {
    const session = new EngineSession(async () => {
      throw new Error('no engine');
    });
    await expect(session.analyse(WHITE_FEN)).rejects.toThrow('no engine');
  });
});

describe('score helpers', () => {
  it('formats and orders scores', () => {
    expect(formatScore({ cp: 130, mate: null })).toBe('+1.3');
    expect(formatScore({ cp: -40, mate: null })).toBe('−0.4');
    expect(formatScore({ cp: 0, mate: null })).toBe('0.0');
    expect(formatScore({ cp: null, mate: 3 })).toBe('M3');
    expect(formatScore({ cp: null, mate: -2 })).toBe('−M2');
    expect(scoreValue({ cp: null, mate: 1 })).toBeGreaterThan(scoreValue({ cp: null, mate: 5 }));
    expect(scoreValue({ cp: null, mate: 5 })).toBeGreaterThan(scoreValue({ cp: 900, mate: null }));
    expect(whiteShare({ cp: 0, mate: null })).toBeCloseTo(0.5);
    expect(whiteShare({ cp: 300, mate: null })).toBeGreaterThan(0.9);
    expect(whiteShare({ cp: null, mate: -1 })).toBe(0);
  });
});
