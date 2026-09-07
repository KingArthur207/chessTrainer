// Parsers for the two UCI output lines activities care about.
import type { BestMove, EngineInfo } from './types';

/** Parse an `info …` line. Returns null for lines without useful data. */
export function parseInfoLine(line: string): EngineInfo | null {
  if (!line.startsWith('info ')) return null;
  const tokens = line.split(/\s+/);
  const info: EngineInfo = {};
  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i];
    switch (key) {
      case 'depth':
        info.depth = Number(tokens[++i]);
        break;
      case 'seldepth':
        info.selDepth = Number(tokens[++i]);
        break;
      case 'multipv':
        info.multiPv = Number(tokens[++i]);
        break;
      case 'nodes':
        info.nodes = Number(tokens[++i]);
        break;
      case 'nps':
        info.nps = Number(tokens[++i]);
        break;
      case 'time':
        info.timeMs = Number(tokens[++i]);
        break;
      case 'score': {
        const kind = tokens[++i];
        const value = Number(tokens[++i]);
        if (kind === 'cp') info.scoreCp = value;
        else if (kind === 'mate') info.scoreMate = value;
        // Skip optional "lowerbound"/"upperbound".
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') i++;
        break;
      }
      case 'pv':
        info.pv = tokens.slice(i + 1);
        i = tokens.length;
        break;
      case 'string':
        return null;
      default:
        break;
    }
    i++;
  }
  return Object.keys(info).length > 0 ? info : null;
}

export function parseBestMoveLine(line: string): BestMove | null {
  const m = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line);
  if (!m) return null;
  return { bestMove: m[1], ponder: m[2] };
}

export function buildGoCommand(options: {
  depth?: number;
  moveTimeMs?: number;
  nodes?: number;
  infinite?: boolean;
}): string {
  const parts = ['go'];
  if (options.infinite) parts.push('infinite');
  if (options.depth !== undefined) parts.push('depth', String(options.depth));
  if (options.moveTimeMs !== undefined) parts.push('movetime', String(options.moveTimeMs));
  if (options.nodes !== undefined) parts.push('nodes', String(options.nodes));
  return parts.join(' ');
}
