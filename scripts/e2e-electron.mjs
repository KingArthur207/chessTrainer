// End-to-end smoke test: launches the real Electron app with Playwright,
// drives the Bullet Trainer with trusted mouse events, and saves screenshots.
//
//   npm run build && npm run test:e2e            # against dist/
//   E2E_URL=http://localhost:5173 npm run test:e2e  # against the Vite dev server
//
// Screenshots land in ./e2e-output (override with E2E_OUT).
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = process.env.E2E_OUT ?? 'e2e-output';
fs.mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const env = {
  ...process.env,
  CHESS_TRAINER_WINDOWED: '1',
  CHESS_TRAINER_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'chess-trainer-e2e-')),
};
if (process.env.E2E_URL) env.ELECTRON_START_URL = process.env.E2E_URL;

const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer error]', msg.text());
  });

  // ---- Home ---------------------------------------------------------------
  await page.waitForSelector('.activity-card--available');
  await page.waitForTimeout(400);
  await shot('01-home');
  const bridge = await page.evaluate(async () => ({
    platform: window.chessTrainer?.platform,
    fullscreen: await window.chessTrainer?.window.isFullscreen(),
    version: await window.chessTrainer?.app.version(),
  }));
  check('preload bridge exposed', bridge.platform === 'electron', JSON.stringify(bridge));
  const engineRes = await page.evaluate(() => window.chessTrainer.engine.start('/nonexistent/stockfish'));
  check('engine bridge rejects a missing binary', engineRes.ok === false, engineRes.error);

  // Bundled Stockfish through the IPC bridge: handshake, then a real search.
  const enginePath = await page.evaluate(() => window.chessTrainer.engine.defaultPath());
  check('bundled Stockfish discovered', typeof enginePath === 'string' && enginePath.endsWith('stockfish-macos-universal'), enginePath ?? 'null');
  if (enginePath) {
    const search = await page.evaluate(async (binary) => {
      const eng = window.chessTrainer.engine;
      const lines = [];
      const waitFor = (pred, timeoutMs) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            off();
            reject(new Error(`timeout waiting; last lines: ${lines.slice(-3).join(' | ')}`));
          }, timeoutMs);
          const off = eng.onLine((line) => {
            lines.push(line);
            if (pred(line)) {
              clearTimeout(timer);
              off();
              resolve(line);
            }
          });
        });
      const started = await eng.start(binary);
      if (!started.ok) return { error: started.error };
      const uciok = waitFor((l) => l === 'uciok', 10000);
      await eng.send('uci');
      await uciok;
      const name = lines.find((l) => l.startsWith('id name')) ?? '';
      const readyok = waitFor((l) => l === 'readyok', 10000);
      await eng.send('isready');
      await readyok;
      await eng.send('position startpos');
      const done = waitFor((l) => l.startsWith('bestmove'), 60000);
      await eng.send('go depth 16');
      const bestLine = await done;
      const depths = lines.filter((l) => l.startsWith('info depth')).map((l) => Number(l.split(' ')[2]));
      await eng.stop();
      return { name, bestLine, maxDepth: Math.max(...depths), infoLines: depths.length };
    }, enginePath);
    check('Stockfish UCI handshake via bridge', /Stockfish/.test(search.name ?? ''), search.name ?? search.error);
    const best = /^bestmove (\S+)/.exec(search.bestLine ?? '')?.[1];
    check('Stockfish searched to depth 16 and chose a sensible first move', search.maxDepth >= 16 && ['e2e4', 'd2d4', 'g1f3', 'c2c4', 'e2e3'].includes(best), `${best} at depth ${search.maxDepth}, ${search.infoLines} info lines`);
  }

  // ---- Trainer: idle + resizing ------------------------------------------
  await page.click('.activity-card--available');
  await page.waitForSelector('.cg-wrap piece');
  await page.waitForTimeout(300);
  await shot('02-trainer-idle');
  const boardWidth = () => page.evaluate(() => document.querySelector('.cg-wrap').getBoundingClientRect().width);
  const before = await boardWidth();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
  await page.waitForTimeout(400);
  const after = await boardWidth();
  check('board shrinks with the window (multiple of 8px)', after < before && after % 8 === 0, `${before} -> ${after}`);
  await shot('03-trainer-small-window');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await page.waitForTimeout(400);
  check('board grows back', (await boardWidth()) === before, `${await boardWidth()}`);

  // ---- Trainer: a run -----------------------------------------------------
  await page.click('.btn--primary');
  await page.waitForSelector('.bullet__clock');
  await page.waitForTimeout(200);
  const g = await page.evaluate(() => {
    const b = document.querySelector('cg-board').getBoundingClientRect();
    return { left: b.left, top: b.top, size: b.width };
  });
  const sq = g.size / 8;
  const center = (key) => ({
    x: g.left + (key.charCodeAt(0) - 97 + 0.5) * sq,
    y: g.top + (7 - (key.charCodeAt(1) - 49) + 0.5) * sq,
  });
  const task = () => page.evaluate(() => document.querySelector('.bullet__task-text strong').textContent.split(' → '));
  const stats = () =>
    page.evaluate(() => ({
      solved: Number(document.querySelectorAll('.stat__value')[0].textContent),
      misses: Number(document.querySelectorAll('.stat__value')[1].textContent),
    }));
  const pieceAt = () =>
    page.evaluate(() => {
      const b = document.querySelector('cg-board').getBoundingClientRect();
      const s = b.width / 8;
      const p = document.querySelector('cg-board piece');
      const m = /translate\(([\d.-]+)px,\s*([\d.-]+)px\)/.exec(p.style.transform);
      if (!m) return `?${p.style.transform}`;
      return String.fromCharCode(97 + Math.round(Number(m[1]) / s)) + (8 - Math.round(Number(m[2]) / s));
    });
  const wrongSquare = (from, to) => ['a1', 'h8', 'h1', 'a8'].find((s) => s !== from && s !== to);
  const clickMove = async (from, to) => {
    const a = center(from);
    const b = center(to);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(250);
  };
  const dragMove = async (from, to) => {
    const a = center(from);
    const b = center(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };

  let [from, to] = await task();
  check('target square highlighted', (await page.locator('cg-board square.target').count()) === 1);
  check('piece rendered on the task origin', (await pieceAt()) === from, `${await pieceAt()} vs ${from}`);
  await shot('04-trainer-running');

  await clickMove(from, wrongSquare(from, to));
  let s = await stats();
  check('wrong click-move counts a miss', s.misses === 1 && s.solved === 0, JSON.stringify(s));
  check('piece snapped back after wrong click-move', (await pieceAt()) === from, await pieceAt());

  await clickMove(from, to);
  s = await stats();
  check('correct click-move counts as solved', s.solved === 1, JSON.stringify(s));
  [from, to] = await task();
  check('new puzzle appears after a solve', (await pieceAt()) === from, `${await pieceAt()} vs ${from}`);

  await dragMove(from, to);
  s = await stats();
  check('correct drag counts as solved', s.solved === 2, JSON.stringify(s));

  [from, to] = await task();
  // Capture the piece mid-drag for the screenshot, then finish on a wrong square.
  {
    const a = center(from);
    const w = center(wrongSquare(from, to));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + w.x) / 2, (a.y + w.y) / 2, { steps: 8 });
    await shot('05-trainer-mid-drag');
    await page.mouse.move(w.x, w.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    check('miss ring flashes on the board', await page.evaluate(() => document.querySelector('.board-frame').classList.contains('is-miss')));
    await page.waitForTimeout(250);
  }
  s = await stats();
  check('wrong drag counts a miss and snaps back', s.misses === 2 && (await pieceAt()) === from, `${JSON.stringify(s)} at ${await pieceAt()}`);

  {
    const a = center(from);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(g.left - 60, g.top - 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  s = await stats();
  check('dropping off the board is ignored', s.misses === 2 && s.solved === 2 && (await pieceAt()) === from, JSON.stringify(s));

  for (let i = 0; i < 5; i++) {
    [from, to] = await task();
    await dragMove(from, to);
  }
  s = await stats();
  check('five more drags all solved', s.solved === 7 && s.misses === 2, JSON.stringify(s));
  await shot('06-trainer-mid-run');

  await page.keyboard.press('Escape');
  await page.waitForSelector('.results');
  await page.waitForTimeout(300);
  const score = await page.evaluate(() => document.querySelector('.results__score').textContent);
  check('results overlay shows the score', score === '7', score);
  await shot('07-results');

  await page.keyboard.press('Space');
  await page.waitForSelector('.bullet__clock');
  s = await stats();
  check('play again resets counters', s.solved === 0 && s.misses === 0, JSON.stringify(s));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.results');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.btn--primary');
  const best = await page.evaluate(() => document.querySelector('.bullet__best strong').textContent);
  check('personal best persisted', best === '7', best);

  // ---- Fullscreen via the bridge -------------------------------------------
  const waitForFullscreen = async (expected) => {
    for (let i = 0; i < 40; i++) {
      if ((await page.evaluate(() => window.chessTrainer.window.isFullscreen())) === expected) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const fs1 = await page.evaluate(() => window.chessTrainer.window.toggleFullscreen());
  const entered = await waitForFullscreen(true);
  const fs2 = await page.evaluate(() => window.chessTrainer.window.toggleFullscreen());
  const left = await waitForFullscreen(false);
  check('fullscreen toggle round-trips', fs1 === true && entered && fs2 === false && left, `${fs1}/${entered} -> ${fs2}/${left}`);
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
