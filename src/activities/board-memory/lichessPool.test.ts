import { describe, expect, it } from 'vitest';
import { SAMPLE_PGN } from '@/games/registry';
import { LichessRateLimitError, parseBroadcastPage, type BroadcastPage } from '@/lib/lichess';
import {
  emptyPool,
  extractPositions,
  fetchBatch,
  mergeBatch,
  migratePool,
  shouldPrefetch,
  summarise,
  takePosition,
  type FetchDeps,
} from './lichessPool';

const tour = { id: 'T1', name: 'Test Open', tier: 3, dates: [] };

describe('extractPositions', () => {
  it('samples up to 8 middlegame positions per game with readable labels', () => {
    const { games, positions } = extractPositions(SAMPLE_PGN, tour);
    expect(games).toBe(5);
    expect(positions.length).toBeLessThanOrEqual(40);
    expect(positions.every((p) => p.pieces >= 10)).toBe(true);
    expect(new Set(positions.map((p) => p.id)).size).toBe(positions.length);
    expect(positions[0].id).toMatch(/^T1:0:\d+$/);
    expect(positions[0].label).toMatch(/^Morphy – Duke Karl \/ Count Isouard, Test Open 1858, after \d/);
  });
});

describe('pool bookkeeping', () => {
  const batch = extractPositions(SAMPLE_PGN, tour).positions;

  it('takes unseen positions without repeats and reports exhaustion', () => {
    let pool = mergeBatch(emptyPool(), batch, ['T1'], 1000);
    expect(summarise(pool)).toMatchObject({ total: batch.length, unseen: batch.length, games: 5, fetchedAt: 1000 });
    const seen = new Set<string>();
    for (let i = 0; i < batch.length; i++) {
      const r = takePosition(pool);
      pool = r.pool;
      expect(r.position).not.toBeNull();
      expect(seen.has(r.position!.id)).toBe(false);
      seen.add(r.position!.id);
    }
    expect(takePosition(pool).position).toBeNull();
    expect(shouldPrefetch(pool)).toBe(true);
  });

  it('prefetches when running low and merging drops seen positions', () => {
    let pool = mergeBatch(emptyPool(), batch, ['T1']);
    expect(batch.length).toBe(40);
    expect(shouldPrefetch(pool)).toBe(false); // exactly at the 40-position low-water mark
    for (let i = 0; i < 3; i++) pool = takePosition(pool).pool;
    expect(shouldPrefetch(pool)).toBe(true);
    const next = extractPositions(SAMPLE_PGN, { ...tour, id: 'T2' }).positions;
    const merged = mergeBatch(pool, next, ['T2']);
    expect(merged.positions.length).toBe(batch.length - 3 + next.length);
    expect(merged.seen).toEqual([]);
    expect(merged.consumed).toEqual(['T2', 'T1']);
  });
});

describe('migratePool', () => {
  it('drops placement-only positions from the first pool format', () => {
    const legacy = { ...emptyPool(), positions: [{ id: 'a', fen: '8/8/8/8/8/8/8/8', pieces: 0, label: 'old' }, { id: 'b', fen: '8/8/8/8/8/8/8/8 w - - 0 1', pieces: 0, label: 'new' }], seen: ['a', 'b'] };
    const migrated = migratePool(legacy);
    expect(migrated.positions.map((p) => p.id)).toEqual(['b']);
    expect(migrated.seen).toEqual(['b']);
    expect(migratePool(migrated)).toBe(migrated);
  });
});

describe('fetchBatch', () => {
  const pages: Record<number, BroadcastPage> = {
    1: { tournaments: [tour, { ...tour, id: 'T2', name: 'Second' }], nextPage: 2 },
    2: { tournaments: [{ ...tour, id: 'T3', name: 'Third' }], nextPage: null },
  };

  const deps = (opts: { rateLimitOnce?: boolean; failIds?: string[] } = {}): FetchDeps & { calls: string[]; slept: number[] } => {
    const calls: string[] = [];
    const slept: number[] = [];
    let limited = opts.rateLimitOnce ?? false;
    return {
      calls,
      slept,
      listPage: async (page) => {
        calls.push(`list:${page}`);
        return pages[page];
      },
      fetchPgn: async (id) => {
        if (limited) {
          limited = false;
          throw new LichessRateLimitError(5000);
        }
        if (opts.failIds?.includes(id)) throw new Error(`Lichess responded with HTTP 404 for ${id}`);
        calls.push(`pgn:${id}`);
        return SAMPLE_PGN;
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: () => 0,
    };
  };

  it('stops once the target is reached and skips consumed tournaments', async () => {
    const d = deps();
    const progress: string[] = [];
    const r = await fetchBatch(new Set(['T1']), 6, (p) => progress.push(p.current), d);
    expect(r.games).toBe(10);
    expect(r.consumedIds).toEqual(['T2', 'T3']);
    expect(d.calls).toEqual(['list:1', 'pgn:T2', 'list:2', 'pgn:T3']);
    expect(progress).toContain('Second');
  });

  it('skips a tournament whose export fails and keeps going', async () => {
    const d = deps({ failIds: ['T1'] });
    const r = await fetchBatch(new Set(), 6, () => undefined, d);
    expect(r.games).toBe(10);
    expect(r.consumedIds).toEqual(['T1', 'T2', 'T3']);
    expect(d.calls).toEqual(['list:1', 'pgn:T2', 'list:2', 'pgn:T3']);
  });

  it('fails only when nothing at all could be fetched', async () => {
    const d = deps({ failIds: ['T1', 'T2', 'T3'] });
    await expect(fetchBatch(new Set(), 6, () => undefined, d)).rejects.toThrow(/HTTP 404/);
  });

  it('waits out a rate limit and retries', async () => {
    const d = deps({ rateLimitOnce: true });
    const waits: Array<number | null> = [];
    const r = await fetchBatch(new Set(), 5, (p) => waits.push(p.waitingUntil), d);
    expect(r.games).toBe(5);
    expect(d.slept).toContain(5000);
    expect(waits).toContain(5000);
  });
});

describe('parseBroadcastPage', () => {
  it('reads tournaments and pagination from the top-broadcasts JSON', () => {
    const json = JSON.stringify({
      active: [],
      past: { currentPage: 1, nextPage: 2, currentPageResults: [{ tour: { id: 'abc', name: 'Open', tier: 3, dates: [1] } }, { round: {} }] },
    });
    expect(parseBroadcastPage(json)).toEqual({ tournaments: [{ id: 'abc', name: 'Open', tier: 3, dates: [1] }], nextPage: 2 });
  });
});
