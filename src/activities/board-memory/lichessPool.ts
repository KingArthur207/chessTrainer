// A local pool of master-game positions fetched from Lichess broadcasts.
//
// - A batch targets 500 games (up to 8 positions each) and is saved locally,
//   so the drill works offline until every position has been seen.
// - Each position taken by the drill is marked "seen". When few unseen
//   positions remain and the app is online, the next batch is prefetched in
//   the background and seen positions are dropped; with none left, the drill
//   waits for a fetch (or asks for a connection).
// - Requests run one at a time with a pause between them, and an HTTP 429
//   pauses the fetch for the time Lichess asks (60 s by default).
import { loadJson, saveJson } from '@/lib/storage';
import { countPieces } from './positions';
import { metaFromHeaders, parsePgn, splitPgnDatabase } from '@/games/pgn';
import {
  fetchBroadcastPgn,
  listPastBroadcasts,
  LichessOfflineError,
  LichessRateLimitError,
  type BroadcastPage,
  type BroadcastTournament,
} from '@/lib/lichess';

export interface PoolPosition {
  /** `${tournamentId}:${gameIndex}:${ply}` */
  id: string;
  /** Full FEN (older pools may hold only the placement field). */
  fen: string;
  pieces: number;
  label: string;
  /** The next moves of the game in SAN, for the visualisation drill. */
  next?: string[];
}

/** A whole game kept for guess-the-move. */
export interface PoolGame {
  id: string;
  white: string;
  black: string;
  whiteElo?: number;
  blackElo?: number;
  event: string;
  year?: string;
  result: string;
  /** SAN moves from the start position. */
  sans: string[];
}

export interface LichessPool {
  positions: PoolPosition[];
  /** Whole games from the fetched tournaments (capped). */
  games?: PoolGame[];
  /** Game ids already used by guess-the-move. */
  playedGames?: string[];
  /** Ids shown by Board Memory. */
  seen: string[];
  /** Ids used by the visualisation drill (tracked separately). */
  seenVis?: string[];
  /** Tournament ids already fetched (newest first), so refreshes bring new games. */
  consumed: string[];
  fetchedAt: number | null;
}

export interface PoolSummary {
  total: number;
  unseen: number;
  games: number;
  fetchedAt: number | null;
}

export interface FetchProgress {
  tournaments: number;
  games: number;
  positions: number;
  current: string;
  /** Set while paused for a rate limit. */
  waitingUntil: number | null;
}

export type FetchStatus =
  | { state: 'idle' }
  | { state: 'fetching'; progress: FetchProgress }
  | { state: 'error'; message: string; offline: boolean };

const POOL_KEY = 'board-memory:lichess-pool:v1';
const TARGET_KEY = 'board-memory:lichess-target-games';
export const DEFAULT_TARGET_GAMES = 500;
const MAX_POSITIONS_PER_GAME = 8;
const CONTINUATION_PLIES = 10;
const MIN_PLIES = 24;
/** Whole games kept per batch and in total (localStorage budget). */
const MAX_GAMES_PER_BATCH = 200;
const MAX_GAMES_KEPT = 400;
const MIN_GAME_PLIES = 30;
const MAX_PAGES = 12;
const MAX_CONSUMED = 400;
const PAUSE_BETWEEN_REQUESTS_MS = 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
/** Prefetch when unseen positions drop below this share (or this count). */
const LOW_WATER_SHARE = 0.2;
const LOW_WATER_COUNT = 40;
const ERROR_BACKOFF_MS = 10 * 60_000;

// ---- Persistence -------------------------------------------------------------

export function emptyPool(): LichessPool {
  return { positions: [], games: [], playedGames: [], seen: [], seenVis: [], consumed: [], fetchedAt: null };
}

/** Positions from the first pool format held only the placement field; the
 * engine and visualisation drills need full FENs, so those are dropped. */
export function migratePool(pool: LichessPool): LichessPool {
  const keep = pool.positions.filter((p) => p.fen.includes(' '));
  if (keep.length === pool.positions.length) return pool;
  const ids = new Set(keep.map((p) => p.id));
  return {
    ...pool,
    positions: keep,
    seen: pool.seen.filter((id) => ids.has(id)),
    seenVis: (pool.seenVis ?? []).filter((id) => ids.has(id)),
  };
}

export function loadPool(): LichessPool {
  const pool = migratePool({ ...emptyPool(), ...loadJson<LichessPool>(POOL_KEY, emptyPool()) });
  return pool;
}

export function savePool(pool: LichessPool): void {
  saveJson(POOL_KEY, pool);
}

export function getTargetGames(): number {
  const n = loadJson<number>(TARGET_KEY, DEFAULT_TARGET_GAMES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TARGET_GAMES;
}

// ---- Pure helpers --------------------------------------------------------------

export function summarise(pool: LichessPool): PoolSummary {
  const seen = new Set(pool.seen);
  const games = new Set(pool.positions.map((p) => p.id.split(':').slice(0, 2).join(':')));
  return {
    total: pool.positions.length,
    unseen: pool.positions.filter((p) => !seen.has(p.id)).length,
    games: games.size,
    fetchedAt: pool.fetchedAt,
  };
}

export function shouldPrefetch(pool: LichessPool): boolean {
  const s = summarise(pool);
  if (s.total === 0) return true;
  return s.unseen < Math.max(LOW_WATER_COUNT, Math.floor(s.total * LOW_WATER_SHARE));
}

/** Pick a random unseen position and mark it seen. Null when exhausted. */
export function takePosition(pool: LichessPool): { pool: LichessPool; position: PoolPosition | null } {
  const seen = new Set(pool.seen);
  const unseen = pool.positions.filter((p) => !seen.has(p.id));
  if (unseen.length === 0) return { pool, position: null };
  const position = unseen[Math.floor(Math.random() * unseen.length)];
  return { pool: { ...pool, seen: [...pool.seen, position.id] }, position };
}

/** Add a fetched batch, dropping positions already seen. */
export function mergeBatch(pool: LichessPool, batch: PoolPosition[], consumedIds: string[], now = Date.now(), games: PoolGame[] = []): LichessPool {
  const seen = new Set(pool.seen);
  const kept = pool.positions.filter((p) => !seen.has(p.id));
  const known = new Set(kept.map((p) => p.id));
  const fresh = batch.filter((p) => !known.has(p.id));
  const consumed = [...consumedIds, ...pool.consumed.filter((id) => !consumedIds.includes(id))].slice(0, MAX_CONSUMED);
  const keptIds = new Set(kept.map((p) => p.id));
  const played = new Set(pool.playedGames ?? []);
  const keptGames = (pool.games ?? []).filter((g) => !played.has(g.id));
  const knownGames = new Set(keptGames.map((g) => g.id));
  const freshGames = games.filter((g) => !knownGames.has(g.id));
  return {
    positions: [...kept, ...fresh],
    games: [...keptGames, ...freshGames].slice(-MAX_GAMES_KEPT),
    playedGames: [],
    seen: [],
    seenVis: (pool.seenVis ?? []).filter((id) => keptIds.has(id)),
    consumed,
    fetchedAt: now,
  };
}

/** Games not yet used by guess-the-move. */
export function unplayedGames(pool: LichessPool): PoolGame[] {
  const played = new Set(pool.playedGames ?? []);
  return (pool.games ?? []).filter((g) => !played.has(g.id));
}

export function takeGame(pool: LichessPool): { pool: LichessPool; game: PoolGame | null } {
  const candidates = unplayedGames(pool);
  if (candidates.length === 0) return { pool, game: null };
  const game = candidates[Math.floor(Math.random() * candidates.length)];
  return { pool: { ...pool, playedGames: [...(pool.playedGames ?? []), game.id] }, game };
}

/** Positions with at least `depth` continuation moves not yet used by the visualisation drill. */
export function visualisationCandidates(pool: LichessPool, depth: number): PoolPosition[] {
  const seen = new Set(pool.seenVis ?? []);
  return pool.positions.filter((p) => !seen.has(p.id) && (p.next?.length ?? 0) >= depth && p.fen.includes(' '));
}

export function takeVisualisationPosition(pool: LichessPool, depth: number): { pool: LichessPool; position: PoolPosition | null } {
  const candidates = visualisationCandidates(pool, depth);
  if (candidates.length === 0) return { pool, position: null };
  const position = candidates[Math.floor(Math.random() * candidates.length)];
  return { pool: { ...pool, seenVis: [...(pool.seenVis ?? []), position.id] }, position };
}

function shortName(name: string): string {
  // "Carlsen, Magnus" -> "Carlsen"; leave single-word names alone.
  return name.split(',')[0].trim() || name;
}

/** Positions (and whole games) from every usable game in a tournament PGN export. */
export function extractPositions(
  pgnText: string,
  tournament: BroadcastTournament,
  maxPerGame = MAX_POSITIONS_PER_GAME,
): { games: number; positions: PoolPosition[]; records: PoolGame[] } {
  const positions: PoolPosition[] = [];
  const records: PoolGame[] = [];
  let games = 0;
  splitPgnDatabase(pgnText).forEach((pgn, gameIndex) => {
    let parsed;
    try {
      parsed = parsePgn(pgn);
    } catch {
      return;
    }
    if (parsed.moves.length < MIN_PLIES) return;
    const meta = metaFromHeaders(`${tournament.id}:${gameIndex}`, parsed.headers);
    const year = meta.date?.slice(0, 4) ?? '';
    const white = `${shortName(meta.white)}${meta.whiteElo ? ` (${meta.whiteElo})` : ''}`;
    const black = `${shortName(meta.black)}${meta.blackElo ? ` (${meta.blackElo})` : ''}`;
    const candidates: number[] = [];
    for (let i = 11; i < parsed.moves.length - 1; i++) {
      if (countPieces(parsed.moves[i].fenAfter) >= 10) candidates.push(i);
    }
    if (candidates.length === 0) return;
    games++;
    if (parsed.moves.length >= MIN_GAME_PLIES && records.length < MAX_GAMES_PER_BATCH) {
      records.push({
        id: `${tournament.id}:${gameIndex}`,
        white: meta.white,
        black: meta.black,
        whiteElo: meta.whiteElo,
        blackElo: meta.blackElo,
        event: tournament.name,
        year: year || undefined,
        result: meta.result,
        sans: parsed.moves.map((m) => m.san),
      });
    }
    const take = Math.min(maxPerGame, candidates.length);
    const step = candidates.length / take;
    for (let k = 0; k < take; k++) {
      const i = candidates[Math.floor(k * step)];
      const m = parsed.moves[i];
      const fen = m.fenAfter;
      const num = Math.floor(i / 2) + 1;
      positions.push({
        id: `${tournament.id}:${gameIndex}:${i}`,
        fen,
        pieces: countPieces(fen),
        label: `${white} – ${black}, ${tournament.name}${year ? ` ${year}` : ''}, after ${num}${m.color === 'w' ? '.' : '...'}${m.san}`,
        next: parsed.moves.slice(i + 1, i + 1 + CONTINUATION_PLIES).map((n) => n.san),
      });
    }
  });
  return { games, positions, records };
}

// ---- Fetching ------------------------------------------------------------------

export interface FetchDeps {
  listPage: (page: number) => Promise<BroadcastPage>;
  fetchPgn: (tournamentId: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const realDeps: FetchDeps = {
  listPage: listPastBroadcasts,
  fetchPgn: fetchBroadcastPgn,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

/**
 * Fetch tournaments (newest first, skipping consumed ones) until `targetGames`
 * games are collected. Rate limits pause the run; other failures abort it.
 */
export async function fetchBatch(
  consumed: Set<string>,
  targetGames: number,
  onProgress: (p: FetchProgress) => void,
  deps: FetchDeps = realDeps,
): Promise<{ positions: PoolPosition[]; consumedIds: string[]; games: number; records: PoolGame[] }> {
  const positions: PoolPosition[] = [];
  const consumedIds: string[] = [];
  const records: PoolGame[] = [];
  let games = 0;
  let tournaments = 0;
  const report = (current: string, waitingUntil: number | null = null) =>
    onProgress({ tournaments, games, positions: positions.length, current, waitingUntil });

  const withRateLimit = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof LichessRateLimitError && attempt < 2) {
          report(label, deps.now() + err.retryAfterMs);
          await deps.sleep(err.retryAfterMs);
          continue;
        }
        throw err;
      }
    }
  };

  let page: number | null = 1;
  let consecutiveFailures = 0;
  let lastError: unknown = null;
  while (page !== null && page <= MAX_PAGES && games < targetGames) {
    report('Listing tournaments…');
    const listing: BroadcastPage = await withRateLimit(() => deps.listPage(page as number), 'Listing tournaments…');
    for (const tour of listing.tournaments) {
      if (games >= targetGames) break;
      if (consumed.has(tour.id) || consumedIds.includes(tour.id)) continue;
      report(tour.name);
      let pgn: string;
      try {
        pgn = await withRateLimit(() => deps.fetchPgn(tour.id), tour.name);
      } catch (err) {
        // Being offline (or repeatedly failing) ends the run; one bad export
        // just skips that tournament so a single 404 never sinks the batch.
        if (err instanceof LichessOfflineError) throw err;
        lastError = err;
        consumedIds.push(tour.id);
        if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) throw err;
        await deps.sleep(PAUSE_BETWEEN_REQUESTS_MS);
        continue;
      }
      consecutiveFailures = 0;
      const extracted = extractPositions(pgn, tour);
      consumedIds.push(tour.id);
      tournaments++;
      games += extracted.games;
      positions.push(...extracted.positions);
      if (records.length < MAX_GAMES_PER_BATCH) records.push(...extracted.records.slice(0, MAX_GAMES_PER_BATCH - records.length));
      report(tour.name);
      await deps.sleep(PAUSE_BETWEEN_REQUESTS_MS);
    }
    page = listing.nextPage;
  }
  if (games === 0 && lastError) throw lastError;
  return { positions, consumedIds, games, records };
}

// ---- Store (singleton the UI subscribes to) ---------------------------------------

type Listener = () => void;

interface Snapshot {
  pool: LichessPool;
  summary: PoolSummary;
  status: FetchStatus;
}

let pool = loadPool();
let status: FetchStatus = { state: 'idle' };
let snapshot: Snapshot = { pool, summary: summarise(pool), status };
let lastFailureAt = 0;
const listeners = new Set<Listener>();
let inFlight: Promise<void> | null = null;

function publish() {
  snapshot = { pool, summary: summarise(pool), status };
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Take a position for the drill (marks it seen) and prefetch if running low. */
export function nextLichessPosition(): PoolPosition | null {
  const result = takePosition(pool);
  pool = result.pool;
  savePool(pool);
  publish();
  if (shouldPrefetch(pool)) void refreshPool();
  return result.position;
}

/** Take a whole game for guess-the-move (marks it played). */
export function nextLichessGame(): PoolGame | null {
  const result = takeGame(pool);
  pool = result.pool;
  savePool(pool);
  publish();
  return result.game;
}

export function lichessGamesRemaining(): number {
  return unplayedGames(pool).length;
}

/** Take a position with continuation moves for the visualisation drill. */
export function nextVisualisationPosition(depth: number): PoolPosition | null {
  const result = takeVisualisationPosition(pool, depth);
  pool = result.pool;
  savePool(pool);
  publish();
  if (visualisationCandidates(pool, depth).length < LOW_WATER_COUNT) void refreshPool();
  return result.position;
}

/** How many visualisation exercises of this depth remain in the saved pool. */
export function visualisationRemaining(depth: number): number {
  return visualisationCandidates(pool, depth).length;
}

/** Fetch a new batch (no-op if one is already running or we recently failed). */
export function refreshPool(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastFailureAt < ERROR_BACKOFF_MS) return Promise.resolve();
  if (!isOnline()) {
    status = { state: 'error', message: 'You are offline. Saved positions stay available; connect to fetch new games.', offline: true };
    lastFailureAt = Date.now();
    publish();
    return Promise.resolve();
  }
  inFlight = (async () => {
    status = { state: 'fetching', progress: { tournaments: 0, games: 0, positions: 0, current: 'Contacting Lichess…', waitingUntil: null } };
    publish();
    try {
      const batch = await fetchBatch(new Set(pool.consumed), getTargetGames(), (progress) => {
        status = { state: 'fetching', progress };
        publish();
      });
      if (batch.games === 0) throw new Error('Lichess returned no new tournaments to draw from.');
      pool = mergeBatch(pool, batch.positions, batch.consumedIds, Date.now(), batch.records);
      savePool(pool);
      status = { state: 'idle' };
    } catch (err) {
      lastFailureAt = Date.now();
      const offline = err instanceof LichessOfflineError || !isOnline();
      status = {
        state: 'error',
        offline,
        message: offline
          ? 'Could not reach Lichess. Saved positions stay available; connect to fetch new games.'
          : err instanceof Error
            ? err.message
            : String(err),
      };
    } finally {
      inFlight = null;
      publish();
    }
  })();
  return inFlight;
}
