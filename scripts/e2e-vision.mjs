// End-to-end test for Board Vision: find-the-square (both perspectives),
// square colours, and knight routes with the BFS optimum computed here.
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

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const sqOf = (f, r) => (f < 0 || f > 7 || r < 0 || r > 7 ? null : String.fromCharCode(97 + f) + (r + 1));
const knightMoves = (sq) => KNIGHT.map(([df, dr]) => sqOf(sq.charCodeAt(0) - 97 + df, sq.charCodeAt(1) - 49 + dr)).filter(Boolean);
const bfs = (from, to, forbidden) => {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of knightMoves(cur)) {
      if (prev.has(n) || forbidden.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const p = [];
        for (let s = to; s !== null; s = prev.get(s)) p.unshift(s);
        return p;
      }
      queue.push(n);
    }
  }
  return null;
};
const isLight = (sq) => (sq.charCodeAt(0) - 97 + sq.charCodeAt(1) - 49) % 2 === 1;

const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer error]', msg.text());
  });
  const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const text = (sel) => page.locator(sel).first().textContent();
  const attr = (name) => page.getAttribute('.bv', name);
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
  const clickSquare = async (key) => {
    const c = await center(key);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(120);
  };
  const drag = async (from, to) => {
    const a = await center(from);
    const b = await center(to);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const stat = (i) => text(`.bv__stats .stat:nth-child(${i}) .stat__value`);

  // ---- Find the square, White ------------------------------------------------------
  await page.waitForSelector('a[href="#/activity/board-vision"]');
  await page.click('a[href="#/activity/board-vision"]');
  await page.waitForSelector('.bv');
  await page.waitForTimeout(300);
  check('no coordinates on the find-the-square board', (await page.locator('.cg-wrap coords').count()) === 0);
  await page.click('.bv__perspectives .chip:has-text("White")');
  await shot('bv1-setup');
  await page.click('.bv__panel .btn--primary');
  await page.waitForSelector('.bv[data-phase="running"]');
  let prompt = await attr('data-prompt');
  await clickSquare(prompt);
  check('clicking the named square scores', (await stat(1)) === '1' && (await attr('data-prompt')) !== prompt, `${prompt} -> ${await attr('data-prompt')}`);
  prompt = await attr('data-prompt');
  await clickSquare(prompt === 'a1' ? 'h8' : 'a1');
  check('wrong square counts a miss and keeps the prompt', (await stat(2)) === '1' && (await attr('data-prompt')) === prompt);
  await shot('bv2-squares');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.bv__results');
  check('results overlay shows the score', (await text('.bv__results-score')) === '1' && /New personal best/.test(await text('.bv__results-badge')));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.bv__modes');

  // ---- Find the square, Black -----------------------------------------------------
  await page.click('.bv__perspectives .chip:has-text("Black")');
  await page.click('.bv__panel .btn--primary');
  await page.waitForSelector('.bv[data-phase="running"]');
  check('black perspective flips the board', (await geometry()).orientation === 'black' && /Black at the bottom/.test(await text('.bv__orientation')));
  prompt = await attr('data-prompt');
  await clickSquare(prompt);
  check('scores from the black side', (await stat(1)) === '1');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.bv__modes');
  check('best score persisted', /1$/.test((await text('.bv__best')).trim()), await text('.bv__best'));

  // ---- Square colours -------------------------------------------------------------
  await page.click('.bv__modes .chip:has-text("Square colour")');
  check('colour drill hides the board', (await page.locator('.bv__mental').count()) === 1 && (await page.locator('cg-board').count()) === 0);
  await page.click('.bv__panel .btn--primary');
  await page.waitForSelector('.bv[data-phase="running"]');
  for (let i = 0; i < 3; i++) {
    prompt = await attr('data-prompt');
    await page.click(isLight(prompt) ? '.bv__answers .btn--light' : '.bv__answers .btn--dark');
    await page.waitForTimeout(80);
  }
  prompt = await attr('data-prompt');
  await page.keyboard.press(isLight(prompt) ? 'd' : 'l');
  await page.waitForTimeout(80);
  check('colour answers score and keys work', (await stat(1)) === '3' && (await stat(2)) === '1', `${await stat(1)} / ${await stat(2)}`);
  await shot('bv3-colours');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.bv__modes');

  // ---- Knight route ---------------------------------------------------------------
  await page.click('.bv__modes .chip:has-text("Knight route")');
  await page.click('.bv__pawns .chip:has-text("3")');
  await page.click('.bv__panel .btn--primary');
  await page.waitForSelector('.bv[data-phase="running"]');
  await page.waitForTimeout(200);
  const knight = await attr('data-knight');
  const target = await attr('data-target');
  const forbidden = new Set((await attr('data-forbidden')).split(' ').filter(Boolean));
  const route = bfs(knight, target, forbidden);
  check('knight puzzle is solvable and marks attacked squares', route !== null && (await page.locator('cg-board square.forbidden').count()) === forbidden.size, `${knight} -> ${target}, ${forbidden.size} forbidden, ${route ? route.length - 1 : '-'} moves`);
  // An unsafe attempt first, if one is available from the start square.
  const unsafe = knightMoves(knight).find((s) => forbidden.has(s));
  if (unsafe) {
    await drag(knight, unsafe);
    check('landing on an attacked square is refused and counted', (await stat(2)) === '1' && (await attr('data-phase')) === 'running');
  }
  for (let i = 1; i < route.length; i++) await drag(route[i - 1], route[i]);
  await page.waitForSelector('.bv__knight-status.is-solved');
  check('optimal route is recognised', /optimal\.$/.test(await text('.bv__knight-status')) && (await page.locator('.cg-shapes g').count()) >= 1, await text('.bv__knight-status'));
  await shot('bv4-knight');
  await page.keyboard.press('Space');
  await page.waitForSelector('.bv[data-phase="running"]');
  check('next puzzle starts', (await attr('data-knight')) !== '' && (await text('.bv__best')).includes('1 / 1 optimal'));
  await page.keyboard.press('Escape');

  // ---- Home summary ------------------------------------------------------------------
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/board-vision"]');
  const summary = await page.locator('a[href="#/activity/board-vision"] .activity-card__footer').textContent();
  check('home card summarises bests', /Squares 1 · Colours 3 · 1 routes/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'bv-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
