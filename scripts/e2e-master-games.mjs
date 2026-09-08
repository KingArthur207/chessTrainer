// End-to-end test for Master Games guess-the-move against the bundled Stockfish.
import { _electron as electron } from 'playwright-core';
import { Chess } from 'chess.js';
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

// Morphy's Opera Game, the first bundled classic.
const OPERA = '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#';
const operaSans = OPERA.replace(/\d+\.\s*/g, '').split(/\s+/).filter(Boolean);

const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer error]', msg.text());
  });
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const text = (sel) => page.locator(sel).first().textContent();
  const attr = (name) => page.getAttribute('.mg', name);
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
  const waitForStatus = async (wanted, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const s = await attr('data-status');
      if (wanted.includes(s)) return s;
      await page.waitForTimeout(100);
    }
    return await attr('data-status');
  };
  const sanToSquares = (fen, san) => {
    const c = new Chess(fen);
    const m = c.move(san);
    return [m.from, m.to];
  };

  await page.waitForSelector('a[href="#/activity/master-games"]');
  await page.click('a[href="#/activity/master-games"]');
  await page.waitForSelector('.mg');
  await page.waitForSelector('.engine-status[data-state="ready"]', { timeout: 15000 });
  await page.click('.mg__sources .chip:has-text("Classic games")');
  await page.selectOption('.mg__select', '0');
  await page.click('.mg__sides .chip:has-text("White")');
  await page.fill('.mg__input', '5');
  await page.click('.mg__times .chip:has-text("Fast")');
  await shot('mg1-setup');

  await page.click('.mg__panel .btn--primary');
  await page.waitForSelector('.mg[data-phase="play"]');
  check('seated at White\'s fifth move of the Opera Game', (await attr('data-ply')) === '8' && (await waitForStatus(['user'])) === 'user', await attr('data-ply'));
  let fen = await attr('data-fen');
  let [from, to] = sanToSquares(fen, operaSans[8]); // Qxf3
  await drag(from, to);
  await waitForStatus(['feedback']);
  check('the game move scores 3', (await attr('data-points')) === '3' && /game move/.test(await text('.mg__verdict')), await text('.mg__verdict'));
  await shot('mg2-feedback');
  await page.keyboard.press('Space');
  check('game move and reply are played on continue', (await waitForStatus(['user'])) === 'user' && (await attr('data-ply')) === '10' && /5\.Qxf3/.test(await text('.mg__moves')) && /dxe5/.test(await text('.mg__moves')), await attr('data-ply'));

  // A different, weaker move than 6.Bc4: 6.a3.
  fen = await attr('data-fen');
  await drag('a2', 'a3');
  await waitForStatus(['feedback']);
  const pts = Number(await page.getAttribute('.mg__feedback', 'data-points'));
  check('a different move is scored against the game and the engine', pts >= 0 && pts <= 2 && /Bc4/.test(await text('.mg__feedback')) && (await page.locator('.cg-shapes g').count()) >= 2, `${pts} points: ${await text('.mg__verdict')}`);
  await page.keyboard.press('Space');
  await waitForStatus(['user']);
  await page.click('.mg__actions .btn:has-text("Show me")');
  await waitForStatus(['feedback']);
  check('show me reveals the game move for 0 points', /Revealed/.test(await text('.mg__verdict')) && (await page.getAttribute('.mg__feedback', 'data-points')) === '0');
  await page.keyboard.press('Space');
  await waitForStatus(['user']);
  await page.click('.mg__actions .btn:has-text("End session")');
  await page.waitForSelector('.mg[data-phase="summary"]');
  const total = Number(await attr('data-points'));
  check('summary totals the session', total === 3 + pts && (await page.locator('.mg__list li').count()) === 3 && (await text('.mg__summary-grid .stat:nth-child(2) .stat__value')) === '1', `${total} / 9`);
  await shot('mg3-summary');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.mg__sources');
  check('session recorded', /1 sessions · accuracy/.test(await text('.mg__stats-line')), await text('.mg__stats-line'));

  // ---- Pasted PGN as Black -----------------------------------------------------------
  await page.click('.mg__sources .chip:has-text("Paste a PGN")');
  await page.fill('.mg__paste', `[White "Tester"]\n[Black "Defender"]\n\n${OPERA} 1-0`);
  await page.click('.mg__sides .chip:has-text("Black")');
  await page.fill('.mg__input', '3');
  await page.click('.mg__panel .btn--primary');
  await page.waitForSelector('.mg[data-phase="play"]');
  check('pasted game starts as Black at move 3', (await waitForStatus(['user'])) === 'user' && (await attr('data-ply')) === '5' && (await geometry()).orientation === 'black' && /Tester – Defender/.test(await text('.mg__game')), await text('.mg__game'));
  fen = await attr('data-fen');
  [from, to] = sanToSquares(fen, operaSans[5]); // 3...Bg4
  await drag(from, to);
  await waitForStatus(['feedback']);
  check('Black guess scored', (await page.getAttribute('.mg__feedback', 'data-points')) === '3');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/master-games"]');
  const summary = await page.locator('a[href="#/activity/master-games"] .activity-card__footer').textContent();
  check('home card summarises sessions', /Accuracy \d+% · \d+% game moves over 1/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'mg-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
