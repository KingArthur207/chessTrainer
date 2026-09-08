// Verifies each catalogue endgame's theoretical result with the bundled
// Stockfish: "win" must show a mate or a big advantage for the drill's side,
// "draw" must show near-zero. Run: node scripts/verify-endgames.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const catalogue = JSON.parse(readFileSync(new URL('../src/activities/endgames/catalogue.json', import.meta.url), 'utf8'));
const depth = Number(process.env.DEPTH ?? 28);

function analyse(fen) {
  return new Promise((resolve) => {
    const sf = spawn('./stockfish/stockfish-macos-universal');
    let last = null;
    let done = false;
    sf.stdout.setEncoding('utf8');
    sf.on('exit', () => {
      if (!done) resolve({ kind: 'error', value: 0 });
    });
    let buf = '';
    sf.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('info') && line.includes(' score ') && line.includes(' pv ')) last = line;
        if (line.startsWith('info string') && /ERROR/.test(line)) console.log('  ', line);
        if (line.startsWith('bestmove')) {
          done = true;
          sf.kill();
          const m = /score (cp|mate) (-?\d+)/.exec(last ?? '');
          resolve(m ? { kind: m[1], value: Number(m[2]) } : null);
        }
      }
    });
    sf.stdin.write(`uci\nsetoption name MultiPV value 1\nposition fen ${fen}\ngo depth ${depth}\n`);
  });
}

const forSide = (fen, score, side) => {
  const toMove = fen.split(' ')[1] === 'w' ? 'white' : 'black';
  const sign = toMove === side ? 1 : -1;
  return { ...score, value: score.value * sign };
};

let bad = 0;
for (const e of catalogue) {
  const raw = await analyse(e.fen);
  const s = forSide(e.fen, raw, e.side);
  const win = s.kind === 'mate' ? s.value > 0 : s.kind === 'cp' && s.value >= (e.winCp ?? 300);
  const draw = s.kind === 'cp' && Math.abs(s.value) <= (e.drawCp ?? 40);
  const ok = e.goal === 'win' ? win : draw;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'BAD '} ${e.id.padEnd(20)} ${e.goal.padEnd(4)} ${e.side.padEnd(5)} -> ${s.kind} ${s.value}`);
}
console.log(bad ? `\n${bad} position(s) do not match their stated result` : '\nAll endgames verified');
process.exit(bad ? 1 : 0);
