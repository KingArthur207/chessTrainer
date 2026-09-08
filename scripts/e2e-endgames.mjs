// End-to-end test for Endgame Drills against the bundled Stockfish.
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
  const attr = (name) => page.getAttribute('.eg', name);
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
  const waitForStatus = async (wanted, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const s = await attr('data-status');
      if (wanted.includes(s)) return s;
      await page.waitForTimeout(100);
    }
    return await attr('data-status');
  };

  await page.waitForSelector('a[href="#/activity/endgames"]');
  await page.click('a[href="#/activity/endgames"]');
  await page.waitForSelector('.eg');
  await page.waitForSelector('.engine-status[data-state="ready"]', { timeout: 15000 });
  const items = await page.locator('.eg__item').count();
  check('catalogue listed with every ending new', items === 13 && (await page.locator('.eg__pill.is-new').count()) === 13, `${items} endings`);
  check('everything is due at first', /13 due of 13/.test(await text('.eg__stats-line')), await text('.eg__stats-line'));
  await shot('eg1-list');

  // ---- Pawn ending: a slip, a take-back, a good move, then give up ----------------
  await page.click('.eg__item[data-id="kp-opposition-win"]');
  await page.waitForSelector('.eg[data-phase="play"]');
  check('drill starts with your move', (await waitForStatus(['user'])) === 'user' && (await attr('data-fen')).startsWith('8/8/4k3/8/3K4/4P3/8/8 w'));
  await drag('e3', 'e4');
  check('pushing the pawn is caught as a slip', (await waitForStatus(['slipped', 'engine', 'user'])) === 'slipped' && /win slipped/.test(await text('.eg__status')) && (await attr('data-slips')) === '1', await text('.eg__status'));
  await shot('eg2-slip');
  await page.keyboard.press('z');
  await page.waitForTimeout(150);
  check('take back restores the position', (await attr('data-moves')) === '0' && (await attr('data-status')) === 'user');
  await drag('d4', 'e4');
  check('taking the opposition keeps the win and the engine replies', (await waitForStatus(['user', 'slipped'])) === 'user' && (await attr('data-moves')) === '2', await text('.eg__status'));
  await page.click('.eg__actions .btn:has-text("Technique")');
  check('technique hint can be shown', (await page.locator('.eg__technique').count()) === 1);
  await page.click('.eg__actions .btn:has-text("Give up")');
  await page.waitForSelector('.eg__result');
  check('giving up schedules the ending again soon', /Given up/.test(await text('.eg__result')) && /later today|due/.test(await text('.eg__result')), await text('.eg__result'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.eg[data-phase="list"]');
  check('list reflects the attempt', /0\/1 solved/.test(await page.locator('.eg__item[data-id="kp-opposition-win"]').textContent()));

  // ---- Rook mate in one: a flawless solve --------------------------------------------
  await page.click('.eg__item[data-id="rook-finish"]');
  await page.waitForSelector('.eg[data-phase="play"]');
  await waitForStatus(['user']);
  await drag('a1', 'a8');
  await page.waitForSelector('.eg__result', { timeout: 10000 });
  check('checkmate solves the drill flawlessly', /Checkmate/.test(await text('.eg__status')) && /flawless/.test(await text('.eg__result')) && /tomorrow/.test(await text('.eg__result')), await text('.eg__result'));
  await shot('eg3-solved');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.eg[data-phase="list"]');
  const pillText = await page.locator('.eg__item[data-id="rook-finish"] .eg__pill').textContent();
  // The given-up ending comes back in ten minutes, so it is not due right now either.
  check('solved ending is scheduled for tomorrow', pillText === 'tomorrow' && /11 due of 13/.test(await text('.eg__stats-line')), `${pillText} · ${await text('.eg__stats-line')}`);

  // ---- A draw drill where the engine moves first --------------------------------------
  await page.click('.eg__item[data-id="wrong-bishop"]');
  await page.waitForSelector('.eg[data-phase="play"]');
  check('engine moves first when it is White to move', (await waitForStatus(['user'])) === 'user' && (await attr('data-moves')) === '1' && (await geometry()).orientation === 'black');
  const m = new Chess(await attr('data-fen')).moves({ verbose: true })[0];
  await drag(m.from, m.to);
  check('holding move verified and answered', (await waitForStatus(['user', 'slipped'])) === 'user' && (await attr('data-moves')) === '3' && /Holding/.test(await text('.eg__verdict')), await text('.eg__verdict'));
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/endgames"]');
  const summary = await page.locator('a[href="#/activity/endgames"] .activity-card__footer').textContent();
  check('home card summarises due endings', /11 of 13 due · 2 practised/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'eg-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
