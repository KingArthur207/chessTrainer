// End-to-end test for Play the Opening against the bundled Stockfish, using
// the seeded Sicilian Dragon repertoire (user plays Black).
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

const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer error]', msg.text());
  });
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const text = (sel) => page.locator(sel).first().textContent();
  const attr = (name) => page.getAttribute('.rp', name);
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
  const waitForMoves = async (n, timeout = 8000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (Number(await attr('data-moves')) >= n && (await attr('data-thinking')) === '0') return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  const moves = () => page.locator('.rp__move').evaluateAll((els) => els.map((e) => `${e.textContent}:${e.dataset.by}:${e.dataset.book}`));

  await page.waitForSelector('a[href="#/activity/repertoire-play"]');
  await page.click('a[href="#/activity/repertoire-play"]');
  await page.waitForSelector('.rp');
  await page.waitForSelector('.engine-status[data-state="ready"]', { timeout: 15000 });
  check('seeded opening offered', /Sicilian Dragon/.test(await text('.rp__select')));
  await page.click('.rp__modes .chip:has-text("From move one")');
  await page.click('.rp__strengths .chip:has-text("Beginner")');
  await shot('rp1-setup');

  // ---- From move one: book replies, a deviation, the engine takes over --------------
  await page.click('.rp__panel .btn--primary');
  await page.waitForSelector('.rp[data-phase="playing"]');
  check('book plays the first move for White', await waitForMoves(1), await attr('data-moves'));
  check('board oriented for Black and it is your move in book', (await geometry()).orientation === 'black' && (await attr('data-in-book')) === '1' && /Your move/.test(await text('.rp__status')));
  await drag('c7', 'c5');
  check('book reply follows your book move', await waitForMoves(3), (await moves()).join(' '));
  check('book moves are marked', (await moves()).every((m) => m.endsWith(':1')) && (await moves())[0].includes(':book:'));
  await drag('b8', 'c6');
  check('a deviation notes the expected book move and ends the book', /book: d6/.test(await text('.rp__moves')) && (await page.locator('.rp__book-end').count()) === 1);
  check('engine takes over after the book', await waitForMoves(5, 10000) && (await moves())[4].includes(':engine:'), (await moves()).join(' '));
  await shot('rp2-playing');

  // ---- Take back and book hint ---------------------------------------------------
  await page.keyboard.press('z');
  await page.waitForTimeout(200);
  check('take back removes your move and the reply', (await attr('data-moves')) === '3' && (await attr('data-in-book')) === '1');
  await page.click('.rp__actions .btn:has-text("Book hint")');
  await page.waitForTimeout(150);
  check('book hint draws the expected move', (await page.locator('.cg-shapes g').count()) >= 1);
  await drag('d7', 'd6');
  check('back in book: book reply again', await waitForMoves(5) && (await moves())[4].includes(':book:'), (await moves()).join(' '));

  // ---- Stop and review ------------------------------------------------------------
  await page.click('.rp__actions .btn:has-text("Stop")');
  await page.waitForSelector('.rp[data-phase="review"]');
  await page.waitForSelector('.rp__review-done', { timeout: 30000 });
  const score = await text('.rp__score');
  check('review shows a final evaluation and move counts', /^([+−]?\d+\.\d|−?M\d+)/.test(score.trim()) && (await text('.rp__summary .stat__value')) === '2', score.slice(0, 20));
  check('status reads stopped', /Stopped for review/.test(await text('.rp__status')));
  await shot('rp3-review');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rp__modes');
  check('game recorded', /1 game/.test(await text('.rp__stats-line')), await text('.rp__stats-line'));

  // ---- Where the book ends: engine plays from the start -------------------------------
  await page.click('.rp__modes .chip:has-text("Where the book ends")');
  await page.click('.rp__panel .btn--primary');
  await page.waitForSelector('.rp[data-phase="playing"]');
  await page.waitForTimeout(200);
  const fen = await attr('data-fen');
  check('starts deep in a line', Number(fen.split(' ')[5]) >= 7 && /Starting after/.test(await text('.rp__context')), await text('.rp__context'));
  if ((await attr('data-turn')) === 'black') {
    const m = new Chess(fen).moves({ verbose: true })[0];
    await drag(m.from, m.to);
  }
  check('engine replies out of book at the chosen strength', await waitForMoves(1, 10000) && (await moves()).some((m) => m.includes(':engine:')), (await moves()).join(' '));
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/repertoire-play"]');
  const summary = await page.locator('a[href="#/activity/repertoire-play"] .activity-card__footer').textContent();
  check('home card summarises games', /1 game · \d\.\d errors per game/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'rp-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
