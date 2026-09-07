// Position sources shared by the engine-backed drills (evaluation, candidate
// moves, …): the local Lichess pool, the bundled classics, the user's openings.
import { getSnapshot } from '@/activities/board-memory/lichessPool';
import type { Opening, TreeNode } from '@/activities/opening-trainer/model';
import { metaFromHeaders, parsePgn, splitPgnDatabase } from '@/games/pgn';
import { SAMPLE_PGN } from '@/games/registry';

export type PositionSource = 'lichess' | 'games' | 'openings';

export const POSITION_SOURCES: Array<{ id: PositionSource; label: string; blurb: string }> = [
  { id: 'lichess', label: 'Lichess masters', blurb: 'Middlegame positions from the local Lichess pool; games are fetched here when it is empty.' },
  { id: 'games', label: 'Classic games', blurb: 'Positions from the five bundled classics.' },
  { id: 'openings', label: 'My openings', blurb: 'Positions from your repertoire: what happens after the theory ends?' },
];

export interface SourcedPosition {
  fen: string;
  label: string;
  source: PositionSource;
}

const MIN_PLY = 10;
let classics: SourcedPosition[] | null = null;

function classicPositions(): SourcedPosition[] {
  if (!classics) {
    classics = [];
    splitPgnDatabase(SAMPLE_PGN).forEach((pgn, g) => {
      const game = parsePgn(pgn);
      const meta = metaFromHeaders(`c${g}`, game.headers);
      game.moves.forEach((m, i) => {
        if (i < MIN_PLY || i >= game.moves.length - 2) return;
        const num = Math.floor(i / 2) + 1;
        classics!.push({
          fen: m.fenAfter,
          label: `${meta.white} – ${meta.black}, ${meta.date?.slice(0, 4) ?? ''}, after ${num}${m.color === 'w' ? '.' : '...'}${m.san}`,
          source: 'games',
        });
      });
    });
  }
  return classics;
}

function openingPositions(openings: Opening[]): SourcedPosition[] {
  const out: SourcedPosition[] = [];
  for (const op of openings) {
    const walk = (node: TreeNode, depth: number) => {
      if (depth >= 6) out.push({ fen: node.fen, label: `${op.name}, after ${node.san}`, source: 'openings' });
      for (const c of node.children) walk(c, depth + 1);
    };
    walk(op.root, 0);
  }
  return out;
}

/** Positions in the local Lichess pool with a full FEN. */
export function lichessUsableCount(): number {
  return getSnapshot().pool.positions.filter((p) => p.fen.includes(' ')).length;
}

export function openingsAvailable(openings: Opening[]): boolean {
  return openingPositions(openings).length > 0;
}

export function pickPosition(
  source: PositionSource,
  openings: Opening[],
  avoidFen?: string,
  rng: () => number = Math.random,
  accept: (fen: string) => boolean = () => true,
): SourcedPosition | null {
  let pool: SourcedPosition[];
  if (source === 'lichess') {
    pool = getSnapshot()
      .pool.positions.filter((p) => p.fen.includes(' '))
      .map((p) => ({ fen: p.fen, label: p.label, source: 'lichess' as const }));
  } else if (source === 'games') pool = classicPositions();
  else pool = openingPositions(openings);
  let candidates = pool.filter((p) => accept(p.fen));
  if (candidates.length > 1) candidates = candidates.filter((p) => p.fen !== avoidFen);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}
