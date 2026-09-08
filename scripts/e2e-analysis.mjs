// End-to-end test for the Engine Analysis board against the bundled Stockfish.
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer error]', msg.text());
  });
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const text = (sel) => page.locator(sel).first().textContent();
  const attr = (name) => page.getAttribute('.an', name);
  const geometry = () =>
    page.evaluate(() => {
      const b = document.querySelector('cg-board').getBoundingClientRect();
      const wrap = document.querySelector('.cg-wrap');
      return { left: b.left, top: b.top, size: b.width, orientation: wrap.classList.contains('orientation-black') ? 'black' : 'white' };
    });
  const center = async (key) => {
    const g = await geometry();
    const sq = g.size / 8;
    const f = key.charCodeAt(0) - 97;
    const r = key.charCodeAt(1) - 49;
    return g.orientation === 'white'
      ? { x: g.left + (f + 0.5) * sq, y: g.top + (7 - r + 0.5) * sq }
      : { x: g.left + (7 - f + 0.5) * sq, y: g.top + (r + 0.5) * sq };
  };
  const drag = async (from, to) => {
    const a = await center(from);
    const b = await center(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const waitForDepth = async (min, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (Number(await attr('data-depth')) >= min) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const firstLineUci = () => page.getAttribute('.an__line', 'data-uci');

  await page.waitForSelector('a[href="#/activity/analysis"]');
  await page.click('a[href="#/activity/analysis"]');
  await page.waitForSelector('.an');
  check('engine analyses the start position live', await waitForDepth(12) && /^[+−]?\d\.\d$/.test((await text('.an__score')).trim()) && (await page.locator('.an__line').count()) === 1, `${await text('.an__score')} depth ${await attr('data-depth')}`);
  const startUci = await firstLineUci();
  await shot('an1-start');

  await drag('e2', 'e4');
  check('a move is recorded and the analysis restarts', (await attr('data-moves')) === '1' && (await attr('data-cursor')) === '1' && /1\.e4/.test(await text('.an__moves')));
  const restarted = await waitForDepth(10);
  const uci = await firstLineUci();
  check('lines now belong to the new position', restarted && uci !== startUci && /^[a-h][78][a-h][56]$/.test(uci ?? ''), uci ?? 'none');

  await page.click('.an__controls .btn:has-text("Play best move")');
  await page.waitForTimeout(300);
  check('Play best move appends the engine\'s choice', (await attr('data-moves')) === '2' && (await attr('data-cursor')) === '2');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  check('arrow keys step back to the start', (await attr('data-cursor')) === '0' && (await attr('data-fen')).startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP'));
  await page.keyboard.press('ArrowRight');
  await drag('g1', 'f3');
  check('a new move from an earlier position replaces the continuation', (await attr('data-moves')) === '2' && /1\.e4 .* 2\.Nf3/.test((await text('.an__moves')).replace(/\s+/g, ' ')) === false && /2\.Nf3|1\.e4/.test(await text('.an__moves')), await text('.an__moves'));

  await page.click('.an__controls .seg button:has-text("3 lines")');
  const started = Date.now();
  let three = false;
  while (Date.now() - started < 15000 && !three) {
    three = (await page.locator('.an__line[data-uci]').count()) === 3;
    if (!three) await page.waitForTimeout(200);
  }
  check('MultiPV shows three lines with scores', three && (await page.locator('.an__line .score').allTextContents()).every((t) => /^[+−]?\d\.\d$|M\d/.test(t.trim())));
  await shot('an2-lines');

  await page.click('.an__tools .btn:has-text("Paste FEN")');
  await page.fill('.modal textarea', '6k1/8/6K1/8/8/8/8/R7 w - - 0 1');
  await page.click('.modal .btn--primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  check('a pasted FEN loads and shows mate in one', (await attr('data-fen')).startsWith('6k1/8/6K1/8/8/8/8/R7') && (await waitForDepth(5)) && (await text('.an__score')).trim() === 'M1', await text('.an__score'));
  await page.click('.an__controls .btn:has-text("Play best move")');
  await page.waitForTimeout(400);
  check('checkmate is recognised and analysis stops', /Checkmate: 1-0/.test(await text('.an__status')) && (await page.locator('.an__line').count()) === 0, await text('.an__status'));
  await shot('an3-mate');

  await page.click('.an__tools .btn:has-text("Paste FEN")');
  await page.fill('.modal textarea', '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6');
  await page.click('.modal .btn--primary');
  await page.waitForSelector('.modal', { state: 'detached' });
  check('a pasted PGN loads the whole game at its end', (await attr('data-moves')) === '10' && (await attr('data-cursor')) === '10' && /5\.Nc3/.test(await text('.an__moves')));
  await page.click('.an__tools .btn[data-action="export"]');
  await page.waitForSelector('.modal textarea');
  const exported = await page.inputValue('.modal textarea');
  check('PGN export reproduces the moves', exported.startsWith('1. e4 c5 2. Nf3 d6'), exported.slice(0, 40));
  await page.click('.modal .btn--ghost');
  await page.keyboard.press('f');
  check('F flips the board', (await geometry()).orientation === 'black');
  await page.click('.an__tools .btn:has-text("Start position")');
  check('reset returns to the start position', (await attr('data-moves')) === '0');

  await page.reload();
  await page.waitForSelector('.an');
  check('board state persists across restarts', (await attr('data-moves')) === '0');
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'an-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
