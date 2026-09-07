// Where visualisation sequences come from.
import { nextVisualisationPosition } from '@/activities/board-memory/lichessPool';
import type { Opening, TreeNode } from '@/activities/opening-trainer/model';
import { metaFromHeaders, parsePgn, splitPgnDatabase } from '@/games/pgn';
import type { ParsedGame } from '@/games/types';
import { SAMPLE_PGN } from '@/games/registry';
import { buildExercise, type Exercise, type VisSource } from './exercise';

export const VIS_SOURCES: Array<{ id: VisSource; label: string; blurb: string }> = [
  {
    id: 'lichess',
    label: 'Lichess masters',
    blurb: 'Sequences from recent master games in the local Lichess pool (shared with Board Memory).',
  },
  { id: 'games', label: 'Classic games', blurb: 'Sequences from the five bundled classics.' },
  { id: 'openings', label: 'My openings', blurb: 'Lines from your own repertoire trees. Visualise the theory you are learning.' },
];

const MIN_START_PLY = 8;

let classics: Array<{ game: ParsedGame; label: string }> | null = null;

function classicGames() {
  if (!classics) {
    classics = splitPgnDatabase(SAMPLE_PGN).map((pgn, i) => {
      const game = parsePgn(pgn);
      const meta = metaFromHeaders(`c${i}`, game.headers);
      return { game, label: `${meta.white} – ${meta.black}, ${meta.date?.slice(0, 4) ?? ''}` };
    });
  }
  return classics;
}

export function exerciseFromClassics(depth: number, rng: () => number = Math.random): Exercise | null {
  const usable = classicGames().filter((c) => c.game.moves.length >= MIN_START_PLY + depth);
  if (usable.length === 0) return null;
  const { game, label } = usable[Math.floor(rng() * usable.length)];
  const maxStart = game.moves.length - depth;
  const start = MIN_START_PLY + Math.floor(rng() * (maxStart - MIN_START_PLY + 1));
  const startFen = game.moves[start - 1].fenAfter;
  const sans = game.moves.slice(start, start + depth).map((m) => m.san);
  const m = game.moves[start - 1];
  const num = Math.floor((start - 1) / 2) + 1;
  return buildExercise(startFen, sans, `${label}, after ${num}${m.color === 'w' ? '.' : '...'}${m.san}`, 'games', rng);
}

/** Nodes with at least `depth` main-line moves below them. */
function openingCandidates(openings: Opening[], depth: number): Array<{ opening: Opening; node: TreeNode; sans: string[] }> {
  const out: Array<{ opening: Opening; node: TreeNode; sans: string[] }> = [];
  for (const opening of openings) {
    const walk = (node: TreeNode) => {
      const sans: string[] = [];
      let n = node;
      while (n.children[0] && sans.length < depth) {
        n = n.children[0];
        sans.push(n.san);
      }
      if (sans.length === depth) out.push({ opening, node, sans });
      for (const c of node.children) walk(c);
    };
    walk(opening.root);
  }
  return out;
}

export function openingsHaveSequences(openings: Opening[], depth: number): boolean {
  return openingCandidates(openings, depth).length > 0;
}

export function exerciseFromOpenings(openings: Opening[], depth: number, rng: () => number = Math.random): Exercise | null {
  const candidates = openingCandidates(openings, depth);
  if (candidates.length === 0) return null;
  const { opening, node, sans } = candidates[Math.floor(rng() * candidates.length)];
  const label = node.san ? `${opening.name}, after ${node.san}` : `${opening.name}, from the start`;
  return buildExercise(node.fen, sans, label, 'openings', rng);
}

export function exerciseFromLichess(depth: number): Exercise | null {
  const p = nextVisualisationPosition(depth);
  if (!p || !p.next) return null;
  return buildExercise(p.fen, p.next.slice(0, depth), p.label, 'lichess');
}
