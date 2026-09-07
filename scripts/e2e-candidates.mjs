// End-to-end test for the Candidate Moves drill against the bundled Stockfish.
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
    await page.waitForTimeout(250);
  };
  const filled = () => page.locator('.cm__slot.is-filled').count();

  await page.waitForSelector('a[href="#/activity/candidates"]');
  await page.click('a[href="#/activity/candidates"]');
  await page.waitForSelector('.cm');
  await page.waitForSelector('.engine-status[data-state="ready"]', { timeout: 15000 });
  await page.click('.cm__sources .chip:has-text("Classic games")');
  await page.click('.cm__times .chip:has-text("Fast")');
  await shot('cm1-setup');

  // ---- Enter three candidates, auto-reveal --------------------------------------------
  await page.click('.cm__panel .btn--primary');
  await page.waitForSelector('.cm[data-phase="quiz"]');
  await page.waitForTimeout(300);
  const fen = await page.getAttribute('.cm', 'data-fen');
  const chess = new Chess(fen);
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  check('board oriented to the side to move', (await geometry()).orientation === turn && (await text('.cm__turn')).includes(turn === 'white' ? 'White' : 'Black'));
  const legal = chess.moves({ verbose: true });
  const picks = [legal[0], legal[Math.floor(legal.length / 2)], legal[legal.length - 1]];
  await drag(picks[0].from, picks[0].to);
  check('a played move becomes candidate 1 and snaps back', (await filled()) === 1 && (await page.locator('.cm__slot.is-filled .san').first().textContent()) === picks[0].san && (await page.locator('.cg-shapes g').count()) >= 1, picks[0].san);
  await drag(picks[0].from, picks[0].to);
  check('duplicates are ignored', (await filled()) === 1);
  await page.keyboard.press('Backspace');
  check('Backspace removes the last candidate', (await filled()) === 0);
  for (const m of picks) await drag(m.from, m.to);
  check('three candidates fill the slots', (await filled()) === 3);
  await shot('cm2-candidates');
  await page.waitForSelector('.cm[data-phase="reveal"]', { timeout: 15000 });
  const rows = await page.locator('.cm__engine li').count();
  check('reveal lists the engine\'s top three with scores and lines', rows === 3 && /^([+−]?\d+\.\d|−?M\d+)$/.test((await page.locator('.cm__engine .score').first().textContent()).trim()) && (await text('.cm__engine .line')).length > 3);
  const engineUcis = await page.locator('.cm__engine li').evaluateAll((els) => els.map((e) => e.dataset.uci));
  const ownUcis = picks.map((m) => m.from + m.to + (m.promotion ?? ''));
  const overlap = ownUcis.filter((u) => engineUcis.includes(u)).length;
  const hits = await page.locator('.cm__slot.is-hit').count();
  const misses = await page.locator('.cm__slot.is-miss').count();
  check('slots marked hit/miss consistently with the ranking', hits === overlap && misses === 3 - overlap, `overlap ${overlap}`);
  const verdict = await text('.cm__verdict');
  check('verdict matches', engineUcis[0] && ownUcis.includes(engineUcis[0]) ? /best move/.test(verdict) : /(best move was missing|None)/.test(verdict), verdict);
  if (misses > 0) {
    await page.waitForFunction
      ? null
      : null;
    let scored = false;
    for (let i = 0; i < 40 && !scored; i++) {
      const metas = await page.locator('.cm__slot.is-miss .meta').allTextContents();
      scored = metas.length > 0 && metas.every((m) => m.trim() !== '…');
      if (!scored) await page.waitForTimeout(250);
    }
    check('unranked candidates get their own evaluation', scored, (await page.locator('.cm__slot.is-miss .meta').allTextContents()).join(', '));
  }
  await shot('cm3-reveal');

  // ---- Reveal early with one candidate ------------------------------------------------
  await page.keyboard.press('Space');
  await page.waitForSelector('.cm[data-phase="quiz"]');
  await page.waitForTimeout(200);
  const fen2 = await page.getAttribute('.cm', 'data-fen');
  const m2 = new Chess(fen2).moves({ verbose: true })[0];
  await drag(m2.from, m2.to);
  await page.keyboard.press('Space');
  await page.waitForSelector('.cm[data-phase="reveal"]', { timeout: 15000 });
  check('Space reveals early with a single candidate', (await filled()) === 1 && (await page.locator('.cm__engine li').count()) === 3);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.cm__sources');
  check('history persisted', /2 positions/.test(await text('.cm__stats-line')), await text('.cm__stats-line'));

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/candidates"]');
  const summary = await page.locator('a[href="#/activity/candidates"] .activity-card__footer').textContent();
  check('home card summarises results', /Best move \d+% · \d\.\d\/3 hits over 2/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'cm-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
