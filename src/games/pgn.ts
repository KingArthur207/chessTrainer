import { Chess } from 'chess.js';
import { tokenizePgn } from '@/chess/pgnTokens';
import type { GameMeta, ParsedGame, ParsedMove } from './types';

/** Split a multi-game PGN file into individual game strings. */
export function splitPgnDatabase(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n(?=\[)/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/**
 * Parse one PGN game into headers plus a fully resolved main-line move list.
 * Uses the tolerant tokenizer (chess.js's own PGN grammar rejects the
 * `{ [%clk …] }` annotations and escaped header quotes that Lichess exports),
 * skips variations, and throws on an illegal main-line move.
 */
export function parsePgn(pgn: string): ParsedGame {
  const headers: Record<string, string> = {};
  const moves: ParsedMove[] = [];
  let chess: Chess | null = null;
  let depth = 0;
  for (const tok of tokenizePgn(pgn)) {
    if (tok.kind === 'header') {
      headers[tok.name] = tok.value;
      continue;
    }
    if (tok.kind === 'open') {
      depth++;
      continue;
    }
    if (tok.kind === 'close') {
      if (depth > 0) depth--;
      continue;
    }
    if (tok.kind === 'result') break;
    if (tok.kind !== 'move' || depth > 0) continue;
    chess ??= new Chess(headers.FEN);
    const before = chess.fen();
    let m;
    try {
      m = chess.move(tok.san);
    } catch {
      throw new Error(`Illegal move "${tok.san}" at ply ${moves.length + 1} (line ${tok.line})`);
    }
    moves.push({
      ply: moves.length + 1,
      san: m.san,
      uci: `${m.from}${m.to}${m.promotion ?? ''}`,
      from: m.from,
      to: m.to,
      color: m.color,
      fenBefore: before,
      fenAfter: chess.fen(),
    });
  }
  const startFen = moves[0]?.fenBefore ?? headers.FEN ?? new Chess().fen();
  return { headers, moves, startFen };
}

export function metaFromHeaders(id: string, headers: Record<string, string>): GameMeta {
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  return {
    id,
    white: headers.White ?? '?',
    black: headers.Black ?? '?',
    result: headers.Result ?? '*',
    event: headers.Event,
    site: headers.Site,
    date: headers.Date,
    round: headers.Round,
    eco: headers.ECO,
    whiteElo: num(headers.WhiteElo),
    blackElo: num(headers.BlackElo),
  };
}
