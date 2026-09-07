// End-to-end test for the Opening Trainer: library, editor (board moves,
// tree navigation, delete, import, export) and a practice session, driven
// with real mouse input in the Electron app. Uses a scratch user-data folder.
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
  /** Wait until a freshly mounted board has been sized. */
  const waitForBoard = async () => {
    for (let i = 0; i < 40; i++) {
      if ((await geometry()).size >= 200) break;
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(100);
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
  // The app's CSP forbids eval, which page.waitForFunction relies on; poll instead.
  const waitForMoves = async (fragment) => {
    for (let i = 0; i < 40; i++) {
      const moves = await page.evaluate(() => document.querySelector('.pr__moves')?.textContent ?? '');
      if (moves.includes(fragment)) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`timed out waiting for "${fragment}" in the move list`);
  };

  // ---- Library ------------------------------------------------------------
  await page.waitForSelector('a[href="#/activity/opening-trainer"]');
  await page.click('a[href="#/activity/opening-trainer"]');
  await page.waitForSelector('.ot-lib');
  await page.waitForTimeout(300);
  await shot('o1-library');
  check('example opening seeded', (await text('.op-card__name'))?.includes('Sicilian Dragon'), await text('.op-card__name'));
  const stats0 = await text('.op-card__stats');
  check('example has 4 lines, all due', /4 lines/.test(stats0) && /4 due/.test(stats0), stats0);

  // ---- Editor -------------------------------------------------------------
  await page.click('.op-card .btn[title="Edit theory"]');
  await page.waitForSelector('.ot__tree');
  await waitForBoard();
  await page.waitForTimeout(200);
  await shot('o2-editor');
  check('tree renders moves and variations', (await page.locator('.mt-move').count()) > 30 && (await page.locator('.mt-variation').count()) === 3, `${await page.locator('.mt-move').count()} moves, ${await page.locator('.mt-variation').count()} variations`);
  check('board oriented for Black', (await geometry()).orientation === 'black');

  await page.locator('.mt-move', { hasText: /^1\.e4$/ }).first().click();
  check('clicking a move selects it', (await text('.mt-move.is-current')) === '1.e4', await text('.mt-move.is-current'));
  await page.keyboard.press('ArrowDown');
  check('ArrowDown jumps to the end of the main line', (await text('.mt-move.is-current')) === 'h5', await text('.mt-move.is-current'));
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);

  await drag('d2', 'd4');
  await page.waitForTimeout(200);
  const hasD4 = (await page.locator('.mt-variation .mt-move', { hasText: /^1\.d4$/ }).count()) === 1;
  check('board move adds a variation to the tree', hasD4 && /5 lines/.test(await text('.ot__meta')), await text('.ot__meta'));
  await page.click('.ot__actions .btn:has-text("Delete from here")');
  await page.click('.ot__actions .btn--danger');
  await page.waitForTimeout(150);
  check('delete removes the branch', (await page.locator('.mt-move', { hasText: /^1\.d4$/ }).count()) === 0 && /4 lines/.test(await text('.ot__meta')), await text('.ot__meta'));

  await page.click('.ot__toolbar .btn:has-text("Import PGN")');
  await page.waitForSelector('.modal textarea');
  await page.fill('.modal textarea', '1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 g6 {Accelerated Dragon}\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 g6 6. Be3 Bg7 7. f3 Qxd8');
  await page.click('.modal .btn--primary');
  await page.waitForSelector('.modal__result');
  const importMsg = await text('.modal__result');
  check('import adds new moves and reports the illegal one', /Added 5 new moves/.test(importMsg) && /Qxd8/.test(importMsg), importMsg.replace(/\s+/g, ' ').slice(0, 140));
  await shot('o3-import');
  await page.click('.modal .btn--ghost');
  check('tree shows 5 lines after import', /5 lines/.test(await text('.ot__meta')), await text('.ot__meta'));

  await page.click('.ot__toolbar .btn:has-text("Export PGN")');
  await page.waitForSelector('.modal textarea');
  const pgn = await page.inputValue('.modal textarea');
  check('export is a single PGN with nested variations', pgn.startsWith('[Event "Sicilian Dragon (example)"]') && pgn.includes('(2... Nc6 3. d4 cxd4 4. Nxd4 g6 { Accelerated Dragon })') && pgn.includes('(6. Be2 Bg7'), pgn.split('\n')[0]);
  await shot('o4-export');
  await page.click('.modal .btn--ghost');

  // ---- Practice as Black --------------------------------------------------
  await page.click('.ot__toolbar .btn--primary:has-text("Practise")');
  await page.waitForSelector('.pr__status');
  await waitForBoard();
  await waitForMoves('1.e4');
  check('app plays White\'s first book move', true);
  check('board oriented for Black in practice', (await geometry()).orientation === 'black');
  await drag('e7', 'e5');
  await page.waitForTimeout(150);
  check('non-book move is rejected and counted', (await page.locator('.pr__status.is-wrong').count()) === 1 && (await text('.stat--bad .stat__value')) === '1', await text('.pr__status'));
  await drag('c7', 'c5');
  await waitForMoves('2.Nf3');
  check('book move accepted, app replies 2.Nf3', true);
  await page.click('.ot__actions .btn:has-text("Hint")');
  await page.waitForTimeout(100);
  check('first hint highlights the piece', (await page.locator('cg-board square.hint').count()) === 1);
  await page.click('.ot__actions .btn:has-text("Hint")');
  await page.waitForTimeout(150);
  check('second hint draws the move as an arrow', (await page.locator('.cg-shapes g').count()) >= 1);
  await shot('o5-practice-hint');
  await drag('d7', 'd6');
  await waitForMoves('3.d4');
  check('continues down the line after the hinted move', true);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ot-lib');

  // ---- New opening as White, complete a line, spaced repetition --------------
  await page.fill('.ot-lib__create input', 'E2E Italian');
  await page.click('.ot-lib__create .btn--primary');
  await page.waitForSelector('.ot__tree');
  check('new opening opens an empty editor', (await text('.ot__tree'))?.includes('No moves yet'));
  await page.click('.ot__toolbar .btn:has-text("Import PGN")');
  await page.fill('.modal textarea', '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *');
  await page.click('.modal .btn--primary');
  await page.waitForSelector('.modal__result');
  await page.click('.modal .btn--ghost');
  await page.click('.ot__toolbar .btn--primary:has-text("Practise")');
  await page.waitForSelector('.pr__status.is-user');
  check('White repertoire starts with the user to move', (await geometry()).orientation === 'white');
  await waitForBoard();
  await drag('e2', 'e4');
  await waitForMoves('e5');
  await drag('g1', 'f3');
  await waitForMoves('Nc6');
  await drag('f1', 'c4');
  await waitForMoves('Bc5');
  await page.waitForSelector('.pr__status.is-done', { timeout: 3000 });
  check('line completes at the end of theory', /Line complete, flawless/.test(await text('.pr__status')), await text('.pr__status'));
  await page.waitForSelector('.pr__summary', { timeout: 5000 });
  await shot('o6-session-done');
  check('session summary shows 1 line, 0 mistakes', (await text('.pr__summary .stat--good .stat__value')) === '1' && (await text('.pr__summary .stat:nth-child(2) .stat__value')) === '0');
  await page.click('.ot__panel .btn--ghost:has-text("Back to openings")');
  await page.waitForSelector('.ot-lib');
  const italianStats = await page.locator('.op-card', { hasText: 'E2E Italian' }).locator('.op-card__stats').textContent();
  check('completed line is no longer due and shows last practice', /0 due/.test(italianStats) && /just now/.test(italianStats), italianStats);
  await shot('o7-library-after');

  // ---- Persistence ----------------------------------------------------------
  await page.reload();
  await page.waitForSelector('.ot-lib');
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/opening-trainer"]');
  const summary = await page.locator('a[href="#/activity/opening-trainer"] .activity-card__footer').textContent();
  check('home card summarises openings and due lines', /2 openings · 5 of 6 lines due/.test(summary), summary);
  await page.click('a[href="#/activity/opening-trainer"]');
  await page.waitForSelector('.ot-lib');
  check('openings persist across reload', (await page.locator('.op-card').count()) === 2);
} catch (err) {
  // Diagnostics for a failed step: screenshot plus the practice/board state.
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'o-failure.png') });
    const state = await page.evaluate(() => {
      const st = window.__board?.state;
      return {
        status: document.querySelector('.pr__status')?.textContent,
        moves: document.querySelector('.pr__moves')?.textContent,
        board: st && {
          free: st.movable.free, color: st.movable.color, dests: st.movable.dests?.size ?? null,
          turn: st.turnColor, dragEnabled: st.draggable.enabled, selected: st.selected,
          e2: st.pieces.get('e2')?.role, e4: st.pieces.get('e4')?.role,
        },
      };
    });
    console.log('  [state at failure]', JSON.stringify(state));
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
