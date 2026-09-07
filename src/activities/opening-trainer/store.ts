// Persistence for openings and practice progress (localStorage, namespaced),
// plus the one-time example repertoire.
import { loadJson, saveJson } from '@/lib/storage';
import { createOpening, type Opening } from './model';
import { importPgn } from './pgn';
import type { LineProgress } from './srs';

const OPENINGS_KEY = 'openings:v1';
const PROGRESS_KEY = 'openings:progress:v1';
const SEEDED_KEY = 'openings:seeded:v1';

/** openingId -> lineKey -> progress */
export type ProgressTable = Record<string, Record<string, LineProgress>>;

export const EXAMPLE_PGN = `[Event "Sicilian Dragon (example)"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 { The Dragon: Black fianchettoes the bishop and aims at the long diagonal. }
6. Be3 { Yugoslav Attack, White's sharpest try. }
  (6. Be2 Bg7 7. O-O O-O 8. Nb3 Nc6 9. Bg5 a6 10. f4 b5 { Classical Variation: Black expands on the queenside. })
  (6. f4 Nc6 7. Nxc6 bxc6 8. e5 Nd7 { Levenfish Attack. })
6... Bg7 7. f3 O-O 8. Qd2 Nc6
9. Bc4 (9. O-O-O d5 10. exd5 Nxd5 11. Nxc6 bxc6 12. Bd4 Bxd4 13. Qxd4 Qb6 { The thematic ...d5 break against 9.O-O-O. })
9... Bd7 10. O-O-O Rc8 11. Bb3 Ne5 12. h4 h5 { Soltis Variation: ...h5 blunts White's kingside pawn storm. } *
`;

export function loadOpenings(): Opening[] {
  const openings = loadJson<Opening[]>(OPENINGS_KEY, []);
  if (openings.length === 0 && !loadJson<boolean>(SEEDED_KEY, false)) {
    const example = createOpening('Sicilian Dragon (example)', 'black');
    importPgn(example, EXAMPLE_PGN);
    saveJson(SEEDED_KEY, true);
    saveOpenings([example]);
    return [example];
  }
  return openings;
}

export function saveOpenings(openings: Opening[]): void {
  saveJson(OPENINGS_KEY, openings);
}

export function loadProgress(): ProgressTable {
  return loadJson<ProgressTable>(PROGRESS_KEY, {});
}

export function saveProgress(table: ProgressTable): void {
  saveJson(PROGRESS_KEY, table);
}
