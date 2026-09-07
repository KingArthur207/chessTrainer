// PGN <-> tree. Import accepts what people paste from Chessable, Lichess
// studies or their own notes: one or many lines, move numbers with or without
// "...", nested ( variations ), { comments }, ;line comments, NAGs and !?
// glyphs, headers and result tokens. Export writes a single game with nested
// variations that re-imports to the identical tree.
import { tokenizePgn } from '@/chess/pgnTokens';
import { applySan, moveNumberPrefix, START_FEN } from '@/chess/position';
import { addChild, type Opening, type TreeNode } from './model';

export { normalizeSan, tokenizePgn as tokenize } from '@/chess/pgnTokens';

export interface ImportResult {
  /** Moves that were new to the tree. */
  added: number;
  /** Moves parsed in total (new or already present). */
  parsed: number;
  /** Lines (sequences from the start position) encountered. */
  lines: number;
  errors: string[];
}

/**
 * Parse PGN text and merge every line into `opening.root`. Each line starts
 * from the opening's start position; a blank line, a result token or a fresh
 * "1." begins a new line.
 */
export function importPgn(opening: Opening, text: string): ImportResult {
  const result: ImportResult = { added: 0, parsed: 0, lines: 0, errors: [] };
  const root = opening.root;
  const tokens = tokenizePgn(text);

  let path: TreeNode[] = [root];
  const stack: TreeNode[][] = [];
  let lineHasMoves = false;
  // When a move is illegal we skip the rest of that sequence.
  let skipDepth: number | null = null;
  let depth = 0;

  const resetLine = () => {
    if (lineHasMoves) result.lines++;
    path = [root];
    stack.length = 0;
    depth = 0;
    skipDepth = null;
    lineHasMoves = false;
  };

  for (const tok of tokens) {
    if (skipDepth !== null) {
      // Skipping the rest of a broken sequence: until its closing ")" when
      // inside a variation, or until the next line starts at top level.
      if (tok.kind === 'open') depth++;
      else if (tok.kind === 'close') {
        if (depth > 0) depth--;
        if (depth < skipDepth) {
          skipDepth = null;
          path = stack.pop() ?? [root];
        }
      } else if (
        tok.kind === 'result' ||
        tok.kind === 'header' ||
        (tok.kind === 'break' && depth === 0) ||
        (tok.kind === 'number' && tok.n === 1 && !tok.black && depth === 0)
      ) {
        resetLine();
      }
      continue;
    }

    switch (tok.kind) {
      case 'header': {
        if (tok.name === 'FEN' && tok.value.trim() !== root.fen && tok.value.split(' ')[0] !== root.fen.split(' ')[0]) {
          result.errors.push(`Line ${tok.line}: this opening starts from ${root.fen === START_FEN ? 'the standard position' : 'a custom position'}; a different [FEN] header was ignored.`);
        }
        if (depth === 0) resetLine();
        break;
      }
      case 'break':
        if (depth === 0) resetLine();
        break;
      case 'result':
        resetLine();
        break;
      case 'number':
        // A fresh "1." at top level starts another line.
        if (depth === 0 && tok.n === 1 && !tok.black && path.length > 1) resetLine();
        break;
      case 'open': {
        depth++;
        stack.push(path);
        // A variation replaces the last move played.
        path = path.length > 1 ? path.slice(0, -1) : path;
        break;
      }
      case 'close': {
        if (depth === 0) {
          result.errors.push(`Line ${tok.line}: unexpected ")".`);
          break;
        }
        depth--;
        path = stack.pop() ?? [root];
        break;
      }
      case 'comment': {
        const node = path[path.length - 1];
        if (tok.text) node.comment = node.comment ? `${node.comment} ${tok.text}` : tok.text;
        break;
      }
      case 'move': {
        const parent = path[path.length - 1];
        const applied = applySan(parent.fen, tok.san);
        if (!applied) {
          result.errors.push(`Line ${tok.line}: "${tok.san}" is not a legal move after ${describe(path)}.`);
          skipDepth = depth;
          break;
        }
        const before = parent.children.length;
        const child = addChild(parent, applied);
        if (parent.children.length > before) result.added++;
        result.parsed++;
        lineHasMoves = true;
        path = [...path, child];
        break;
      }
    }
  }
  if (lineHasMoves) result.lines++;
  if (result.parsed > 0) opening.updatedAt = new Date().toISOString();
  return result;
}

function describe(path: TreeNode[]): string {
  const moves = path.slice(1);
  if (moves.length === 0) return 'the start position';
  return moves
    .slice(-4)
    .map((n) => n.san)
    .join(' ');
}

// ---- Export -----------------------------------------------------------------

export function exportPgn(opening: Opening): string {
  const headers = [
    `[Event "${escapeHeader(opening.name)}"]`,
    `[Site "Chess Trainer"]`,
    `[Date "${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    `[White "${opening.color === 'white' ? 'Repertoire' : '?'}"]`,
    `[Black "${opening.color === 'black' ? 'Repertoire' : '?'}"]`,
    `[Result "*"]`,
  ];
  if (opening.root.fen !== START_FEN) {
    headers.push(`[SetUp "1"]`, `[FEN "${opening.root.fen}"]`);
  }
  const body = renderChildren(opening.root, false);
  const rootComment = opening.root.comment ? `{ ${escapeComment(opening.root.comment)} } ` : '';
  return `${headers.join('\n')}\n\n${wrap(`${rootComment}${body}${body ? ' ' : ''}*`)}\n`;
}

/** Movetext for everything below `parent`. */
function renderChildren(parent: TreeNode, forceNumber: boolean): string {
  const out: string[] = [];
  let node = parent;
  let force = forceNumber;
  while (node.children.length > 0) {
    const [main, ...alts] = node.children;
    out.push(moveText(node.fen, main, force));
    for (const alt of alts) {
      const inner = `${moveText(node.fen, alt, true)}${alt.children.length ? ' ' + renderChildren(alt, !!alt.comment) : ''}`;
      out.push(`(${inner})`);
    }
    // After a comment or a variation, a black move needs its number again.
    force = alts.length > 0 || !!main.comment;
    node = main;
  }
  return out.join(' ');
}

function moveText(fenBefore: string, node: TreeNode, forceNumber: boolean): string {
  const prefix = moveNumberPrefix(fenBefore, forceNumber);
  const move = prefix ? `${prefix} ${node.san}` : node.san;
  return node.comment ? `${move} { ${escapeComment(node.comment)} }` : move;
}

function escapeComment(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function escapeHeader(text: string): string {
  return text.replace(/["\\]/g, '');
}

/** Wrap movetext at ~80 columns without breaking inside comments. */
function wrap(text: string, width = 80): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  let inComment = false;
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > width && current && !inComment) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
    if (w.includes('{')) inComment = true;
    if (w.includes('}')) inComment = false;
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
