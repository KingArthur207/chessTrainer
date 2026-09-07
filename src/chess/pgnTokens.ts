// Tolerant PGN tokenizer shared by the opening trainer (import with
// variations) and the game parser (broadcast exports with %clk/%eval
// annotations). It accepts what real-world PGN looks like: headers with
// escaped quotes, glued move numbers, NAGs, ( variations ), { comments },
// ; line comments and result tokens.

export type PgnToken =
  | { kind: 'move'; san: string; line: number }
  | { kind: 'open'; line: number }
  | { kind: 'close'; line: number }
  | { kind: 'comment'; text: string; line: number }
  | { kind: 'number'; n: number; black: boolean; line: number }
  | { kind: 'break'; line: number }
  | { kind: 'result'; line: number }
  | { kind: 'header'; name: string; value: string; line: number };

const RESULT_RE = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const MOVE_NUMBER_RE = /^(\d+)(\.{1,3})?$/;
const NAG_RE = /^\$\d+$/;

/** Split raw PGN text into tokens. */
export function tokenizePgn(text: string): PgnToken[] {
  const tokens: PgnToken[] = [];
  const src = text.replace(/\r\n?/g, '\n');
  let i = 0;
  let line = 1;
  let sawNewline = false;
  const len = src.length;

  while (i < len) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      i++;
      // A blank line separates games/lines.
      if (sawNewline) tokens.push({ kind: 'break', line });
      sawNewline = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    sawNewline = false;

    if (ch === '{') {
      const end = src.indexOf('}', i + 1);
      const body = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
      line += (body.match(/\n/g) ?? []).length;
      tokens.push({ kind: 'comment', text: body.replace(/\s+/g, ' ').trim(), line });
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (ch === ';') {
      const end = src.indexOf('\n', i);
      const body = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
      tokens.push({ kind: 'comment', text: body.trim(), line });
      i = end < 0 ? len : end;
      continue;
    }
    if (ch === '[' && (i === 0 || src[i - 1] === '\n')) {
      // Header tag pair: [Name "value"]
      const end = src.indexOf(']', i);
      const body = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
      const m = /^(\w+)\s+"(.*)"$/.exec(body.trim());
      if (m) tokens.push({ kind: 'header', name: m[1], value: m[2].replace(/\\"/g, '"'), line });
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'open', line });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'close', line });
      i++;
      continue;
    }

    // Word token: read until whitespace or a structural character.
    let j = i;
    while (j < len && !/[\s(){}]/.test(src[j])) j++;
    let word = src.slice(i, j);
    i = j;

    if (RESULT_RE.test(word)) {
      tokens.push({ kind: 'result', line });
      continue;
    }
    if (NAG_RE.test(word)) continue;

    // "12.Nf3" or "12...Nf6" glued together.
    const glued = /^(\d+)(\.{1,3})(\S+)$/.exec(word);
    if (glued) {
      tokens.push({ kind: 'number', n: Number(glued[1]), black: glued[2].length > 1, line });
      word = glued[3];
    }
    const num = MOVE_NUMBER_RE.exec(word);
    if (num) {
      tokens.push({ kind: 'number', n: Number(num[1]), black: (num[2] ?? '').length > 1, line });
      continue;
    }
    // Bare "..." after a number.
    if (/^\.+$/.test(word)) continue;

    const san = normalizeSan(word);
    if (san) tokens.push({ kind: 'move', san, line });
  }
  return tokens;
}

/** Strip glyphs and normalise castling; returns null for non-move words. */
export function normalizeSan(word: string): string | null {
  let san = word.replace(/[!?]+$/g, '').replace(/[+#]+$/g, '');
  san = san.replace(/^0-0-0$/i, 'O-O-O').replace(/^0-0$/i, 'O-O').replace(/^o-o-o$/, 'O-O-O').replace(/^o-o$/, 'O-O');
  if (/^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=?[QRBN])?|[a-h]x?[a-h][1-8](=?[QRBN])?)$/.test(san)) {
    // Accept "e8Q" as well as "e8=Q".
    return san.replace(/([a-h][18])([QRBN])$/, '$1=$2');
  }
  return null;
}
