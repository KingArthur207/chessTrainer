// End-to-end test for Blindfold Visualisation: settings, a fully correct
// exercise (answers computed with chess.js from the shown moves), a wrong
// answer, blindfold mode, the openings source and persistence.
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

const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

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
      return { left: b.left, top: b.top, size: b.width };
    });
  const center = async (key) => {
    const g = await geometry();
    const sq = g.size / 8;
    return { x: g.left + (key.charCodeAt(0) - 97 + 0.5) * sq, y: g.top + (7 - (key.charCodeAt(1) - 49) + 0.5) * sq };
  };
  const boardPieces = () =>
    page.evaluate(() => {
      const b = document.querySelector('cg-board').getBoundingClientRect();
      const sq = b.width / 8;
      return [...document.querySelectorAll('cg-board piece')]
        .map((p) => {
          const m = /translate\(([\d.-]+)px,\s*([\d.-]+)px\)/.exec(p.style.transform);
          if (!m) return null;
          const [color, role] = p.className.split(' ');
          return { color, role, key: String.fromCharCode(97 + Math.round(Number(m[1]) / sq)) + (8 - Math.round(Number(m[2]) / sq)) };
        })
        .filter(Boolean);
    });

  /** Replay the shown moves from the start FEN with chess.js. */
  const finalPosition = async () => {
    const startFen = await page.getAttribute('.vis', 'data-start-fen');
    const moves = (await text('.vis__moves')).trim().split(/\s+/).map((t) => t.replace(/^\d+\.+/, ''));
    const chess = new Chess(startFen);
    for (const san of moves) chess.move(san);
    return { chess, plies: moves.length };
  };

  /** Answer the current question correctly (or deliberately wrongly). */
  const answer = async (chess, wrong = false) => {
    const q = page.locator('.vis__question');
    const type = await q.getAttribute('data-type');
    const square = await q.getAttribute('data-square');
    const pieceAttr = await q.getAttribute('data-piece');
    if (type === 'piece-on') {
      const p = chess.get(square);
      if (wrong) {
        await page.click(p && p.type === 'k' ? '.piece-palette piece.white.queen' : '.piece-palette piece.white.king');
      } else if (!p) {
        await page.click('.vis__question .btn:has-text("Empty square")');
      } else {
        await page.click(`.piece-palette piece.${p.color === 'w' ? 'white' : 'black'}.${ROLE[p.type]}`);
      }
    } else if (type === 'locate') {
      const [color, role] = pieceAttr.split(' ');
      const found = chess
        .board()
        .flat()
        .find((c) => c && (c.color === 'w' ? 'white' : 'black') === color && ROLE[c.type] === role);
      const target = wrong ? (found.square === 'a1' ? 'h8' : 'a1') : found.square;
      const c = await center(target);
      await page.mouse.click(c.x, c.y);
    } else {
      let truth;
      if (type === 'check') truth = chess.isCheck();
      else {
        const [color] = pieceAttr.split(' ');
        truth = chess.isAttacked(square, color === 'white' ? 'b' : 'w');
      }
      const say = wrong ? !truth : truth;
      await page.click(`.vis__yesno .btn:has-text("${say ? 'Yes' : 'No'}")`);
    }
    await page.waitForSelector('.vis__feedback');
    return type;
  };

  // ---- Setup ----------------------------------------------------------------
  await page.waitForSelector('a[href="#/activity/visualisation"]');
  await page.evaluate(() => localStorage.setItem('chess-trainer:visualisation:source', JSON.stringify('games')));
  await page.click('a[href="#/activity/visualisation"]');
  await page.waitForSelector('.vis');
  await page.waitForTimeout(300);
  await page.click('.vis__depths .chip:has-text("4 plies")');
  check('setup shows sources, depths and board modes', (await page.locator('.vis__chips .chip').count()) === 7 && (await page.locator('.vis__mode button').count()) === 2);
  await shot('v1-setup');

  // ---- A fully correct exercise ------------------------------------------------
  await page.click('.vis__panel .btn--primary');
  await page.waitForSelector('.vis__question');
  await page.waitForTimeout(300);
  const { chess, plies } = await finalPosition();
  check('four half-moves shown in notation, board frozen at the start', plies === 4 && (await boardPieces()).length >= 10, await text('.vis__moves'));
  await shot('v2-quiz');
  const types = [];
  for (let i = 0; i < 3; i++) {
    types.push(await answer(chess));
    check(`question ${i + 1} (${types[i]}) answered correctly`, /^Correct/.test(await text('.vis__feedback')), await text('.vis__feedback'));
    if (i === 0) await shot('v3-feedback');
    await page.click('.vis__panel .btn--primary');
  }
  check('questions cover piece, location and check/attack', types[0] === 'piece-on' && types[1] === 'locate' && ['check', 'attacked'].includes(types[2]), types.join(','));
  await page.waitForSelector('.vis__score');
  await page.waitForTimeout(4 * 750 + 600);
  check('reveal shows 3 / 3', (await text('.vis__score')).startsWith('3 / 3'), await text('.vis__score'));
  const shown = await boardPieces();
  const expected = chess.board().flat().filter(Boolean).length;
  check('board plays through to the final position', shown.length === expected && shown.every((p) => { const c = chess.get(p.key); return c && ROLE[c.type] === p.role && (c.color === 'w' ? 'white' : 'black') === p.color; }), `${shown.length} pieces`);
  await shot('v4-reveal');

  // ---- A wrong answer ---------------------------------------------------------
  await page.keyboard.press('Space');
  await page.waitForSelector('.vis__question');
  await page.waitForTimeout(200);
  const second = await finalPosition();
  await answer(second.chess, true);
  check('wrong answer is explained', /^Wrong\. You said .* the answer is /.test(await text('.vis__feedback')), await text('.vis__feedback'));
  await page.click('.vis__panel .btn--primary');
  await answer(second.chess);
  await page.click('.vis__panel .btn--primary');
  await answer(second.chess);
  await page.click('.vis__panel .btn--primary');
  await page.waitForSelector('.vis__score');
  check('score reflects the miss', (await text('.vis__score')).startsWith('2 / 3'), await text('.vis__score'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.vis__depths');
  check('history records both exercises', /2 exercises/.test(await text('.vis__stats-line')) && /83%/.test(await text('.vis__stats-line')), await text('.vis__stats-line'));

  // ---- Blindfold mode -----------------------------------------------------------
  await page.click('.vis__mode button:has-text("Hidden")');
  await page.click('.vis__panel .btn--primary');
  await page.waitForSelector('.vis__question');
  await page.waitForTimeout(200);
  check('blindfold mode shows the position first', (await boardPieces()).length >= 10 && (await page.locator('.vis__timer').count()) === 1);
  await page.click('.vis__panel .btn:has-text("Hide the board now")');
  await page.waitForTimeout(200);
  check('board hides while the moves stay visible', (await boardPieces()).length === 0 && (await text('.vis__moves')).length > 5);
  await shot('v5-blindfold');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.vis__depths');
  await page.click('.vis__mode button:has-text("Stays visible")');

  // ---- Openings source ----------------------------------------------------------
  await page.click('.vis__chips .chip:has-text("My openings")');
  await page.click('.vis__panel .btn--primary');
  await page.waitForSelector('.vis__question');
  check('openings source uses the seeded repertoire', /Sicilian Dragon/.test(await text('.vis__source')), await text('.vis__source'));
  await page.keyboard.press('Escape');

  // ---- Persistence --------------------------------------------------------------
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/visualisation"]');
  const summary = await page.locator('a[href="#/activity/visualisation"] .activity-card__footer').textContent();
  check('home card summarises exercises', /Avg 83% over 2 exercises/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'v-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
