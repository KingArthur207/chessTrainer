// Minimal Lichess API client for the endpoints the app uses. Lichess asks
// clients to make one request at a time and to wait a full minute after an
// HTTP 429; `LichessRateLimitError` carries that wait so callers can show it.
import { fetchText } from './platform';

export const LICHESS = 'https://lichess.org';
const DEFAULT_RETRY_MS = 60_000;

export class LichessRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Lichess rate limit reached; retry in ${Math.round(retryAfterMs / 1000)}s`);
    this.name = 'LichessRateLimitError';
  }
}

export class LichessOfflineError extends Error {
  constructor(detail: string) {
    super(`Could not reach Lichess (${detail})`);
    this.name = 'LichessOfflineError';
  }
}

async function request(path: string, accept: string): Promise<string> {
  const res = await fetchText(`${LICHESS}${path}`, accept);
  if (res.status === 429) {
    const seconds = Number(res.retryAfter);
    throw new LichessRateLimitError(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS);
  }
  if (res.status === 0) throw new LichessOfflineError(res.error ?? 'no connection');
  if (!res.ok || res.text === undefined) throw new Error(`Lichess responded with HTTP ${res.status} for ${path}`);
  return res.text;
}

export interface BroadcastTournament {
  id: string;
  name: string;
  tier: number;
  /** Start (and end) timestamps in ms, when known. */
  dates: number[];
}

export interface BroadcastPage {
  tournaments: BroadcastTournament[];
  nextPage: number | null;
}

/** Parse the JSON of GET /api/broadcast/top: finished official tournaments, newest first. */
export function parseBroadcastPage(json: string): BroadcastPage {
  const data = JSON.parse(json) as {
    past?: { currentPageResults?: Array<{ tour?: { id?: string; name?: string; tier?: number; dates?: number[] } }>; nextPage?: number | null };
  };
  const results = data.past?.currentPageResults ?? [];
  const tournaments = results
    .map((r) => r.tour)
    .filter((t): t is { id: string; name: string; tier?: number; dates?: number[] } => !!t && typeof t.id === 'string' && typeof t.name === 'string')
    .map((t) => ({ id: t.id, name: t.name, tier: t.tier ?? 0, dates: t.dates ?? [] }));
  const next = data.past?.nextPage;
  return { tournaments, nextPage: typeof next === 'number' ? next : null };
}

export async function listPastBroadcasts(page = 1): Promise<BroadcastPage> {
  return parseBroadcastPage(await request(`/api/broadcast/top?page=${page}`, 'application/json'));
}

/** Every game of a broadcast tournament, all rounds, as one PGN document. */
export async function fetchBroadcastPgn(tournamentId: string): Promise<string> {
  return request(`/api/broadcast/${encodeURIComponent(tournamentId)}.pgn`, 'application/x-chess-pgn');
}
