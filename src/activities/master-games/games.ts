// Game sources for guess-the-move: the bundled classics, whole games from
// the Lichess pool, and a pasted PGN.
import { lichessGamesRemaining, nextLichessGame, type PoolGame } from '@/activities/board-memory/lichessPool';
import { metaFromHeaders, parsePgn, splitPgnDatabase } from '@/games/pgn';
import { SAMPLE_PGN } from '@/games/registry';

export type GameSource = 'games' | 'lichess' | 'paste';

export const GAME_SOURCES: Array<{ id: GameSource; label: string; blurb: string }> = [
  { id: 'games', label: 'Classic games', blurb: 'The five bundled classics: Morphy, Anderssen, Fischer, Kasparov.' },
  { id: 'lichess', label: 'Lichess masters', blurb: 'Whole games from the local Lichess pool (fetched with the positions).' },
  { id: 'paste', label: 'Paste a PGN', blurb: 'Any game you paste: annotated classics, your own games, anything.' },
];

export interface MasterGame {
  id: string;
  label: string;
  white: string;
  black: string;
  result: string;
  sans: string[];
}

export function labelFor(g: { white: string; black: string; event?: string; year?: string; whiteElo?: number; blackElo?: number }): string {
  const elo = (n?: number) => (n ? ` (${n})` : '');
  const where = [g.event, g.year].filter(Boolean).join(' ');
  return `${g.white}${elo(g.whiteElo)} – ${g.black}${elo(g.blackElo)}${where ? `, ${where}` : ''}`;
}

let classics: MasterGame[] | null = null;

export function classicGames(): MasterGame[] {
  if (!classics) {
    classics = splitPgnDatabase(SAMPLE_PGN).map((pgn, i) => {
      const parsed = parsePgn(pgn);
      const meta = metaFromHeaders(`classic-${i}`, parsed.headers);
      return {
        id: meta.id,
        label: labelFor({ white: meta.white, black: meta.black, event: meta.event, year: meta.date?.slice(0, 4) }),
        white: meta.white,
        black: meta.black,
        result: meta.result,
        sans: parsed.moves.map((m) => m.san),
      };
    });
  }
  return classics;
}

export function fromPool(g: PoolGame): MasterGame {
  return { id: g.id, label: labelFor(g), white: g.white, black: g.black, result: g.result, sans: g.sans };
}

export function lichessGame(): MasterGame | null {
  const g = nextLichessGame();
  return g ? fromPool(g) : null;
}

export function lichessRemaining(): number {
  return lichessGamesRemaining();
}

/** Parse the first game of a pasted PGN; throws with a readable message. */
export function gameFromPgn(text: string): MasterGame {
  const first = splitPgnDatabase(text)[0];
  if (!first) throw new Error('No moves found in the pasted text.');
  const parsed = parsePgn(first);
  if (parsed.moves.length < 10) throw new Error('That game is too short to practise on (fewer than 10 plies).');
  const meta = metaFromHeaders('pasted', parsed.headers);
  return {
    id: `pasted-${Date.now()}`,
    label: labelFor({ white: meta.white, black: meta.black, event: meta.event, year: meta.date?.slice(0, 4) }),
    white: meta.white,
    black: meta.black,
    result: meta.result,
    sans: parsed.moves.map((m) => m.san),
  };
}

/** Which side won, if any. */
export function winner(result: string): 'white' | 'black' | null {
  return result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
}
