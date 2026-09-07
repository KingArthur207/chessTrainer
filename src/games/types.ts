// Game-source plugin contract (master games, personal games, opening books…).
// A `GameSource` knows how to list and fetch games; ./pgn.ts turns a PGN into
// a replayable move list any activity can step through on the Board.

export interface GameMeta {
  id: string;
  white: string;
  black: string;
  result: string;
  event?: string;
  site?: string;
  date?: string;
  round?: string;
  eco?: string;
  whiteElo?: number;
  blackElo?: number;
}

export interface GameRecord extends GameMeta {
  pgn: string;
}

export interface GameQuery {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface GameSource {
  id: string;
  label: string;
  description: string;
  listGames(query?: GameQuery): Promise<GameMeta[]>;
  getGame(id: string): Promise<GameRecord | null>;
}

export interface ParsedMove {
  ply: number;
  san: string;
  /** UCI form, e.g. "e2e4" or "e7e8q". */
  uci: string;
  from: string;
  to: string;
  color: 'w' | 'b';
  /** FEN before / after the move. */
  fenBefore: string;
  fenAfter: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
  startFen: string;
}
