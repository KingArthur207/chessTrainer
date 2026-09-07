// End-to-end test for Board Memory: flash, rebuild via palette stamping and
// dragging, scoring, view toggle, sources and persistence.
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
      return { left: b.left, top: b.top, size: b.width };
    });
  const center = async (key) => {
    const g = await geometry();
    const sq = g.size / 8;
    return { x: g.left + (key.charCodeAt(0) - 97 + 0.5) * sq, y: g.top + (7 - (key.charCodeAt(1) - 49) + 0.5) * sq };
  };
  const waitForBoard = async () => {
    for (let i = 0; i < 40; i++) {
      if ((await geometry()).size >= 200) break;
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(100);
  };
  /** Pieces currently on the board as {color, role, key}. */
  const boardPieces = () =>
    page.evaluate(() => {
      const b = document.querySelector('cg-board').getBoundingClientRect();
      const sq = b.width / 8;
      return [...document.querySelectorAll('cg-board piece')]
        .map((p) => {
          const m = /translate\(([\d.-]+)px,\s*([\d.-]+)px\)/.exec(p.style.transform);
          if (!m) return null;
          const [color, role] = p.className.split(' ');
          const key = String.fromCharCode(97 + Math.round(Number(m[1]) / sq)) + (8 - Math.round(Number(m[2]) / sq));
          return { color, role, key };
        })
        .filter(Boolean);
    });
  const dragTo = async (a, b) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const placedText = () => text('.bm__count strong');

  // ---- Setup ----------------------------------------------------------------
  await page.waitForSelector('a[href="#/activity/board-memory"]');
  // Keep the default run offline-safe: start from the bundled games, and use a
  // small Lichess batch for the opt-in live section.
  await page.evaluate(() => {
    localStorage.setItem('chess-trainer:board-memory:source', JSON.stringify('games'));
    localStorage.setItem('chess-trainer:board-memory:lichess-target-games', JSON.stringify(60));
  });
  await page.click('a[href="#/activity/board-memory"]');
  await page.waitForSelector('.bm');
  await waitForBoard();
  await page.click('.bm__times .chip:has-text("10s")');
  check('setup shows sources and times', (await page.locator('.bm__chips .chip').count()) === 8 && (await text('.bm__stats-line')).includes('No attempts'));
  await shot('m1-setup');

  // ---- Memorise -------------------------------------------------------------
  await page.click('.bm__panel .btn--primary');
  await page.waitForSelector('.bm__timer');
  await page.waitForTimeout(300);
  const target = await boardPieces();
  check('position flashed with a piece count', target.length >= 10 && (await placedText()) === `${target.length} pieces`, `${target.length} pieces`);
  await shot('m2-memorise');
  await page.click('.bm__panel .btn:has-text("Hide now")');
  await page.waitForSelector('.bm__palette');
  await page.waitForTimeout(150);
  check('board is empty for rebuilding', (await boardPieces()).length === 0 && (await placedText()) === `0 of ${target.length}`);

  // ---- Rebuild by stamping every piece exactly ----------------------------------
  const groups = new Map();
  for (const p of target) {
    const k = `${p.color}-${p.role}`;
    groups.set(k, [...(groups.get(k) ?? []), p.key]);
  }
  for (const [k, keys] of groups) {
    const [color, role] = k.split('-');
    await page.click(`.bm__palette piece.${color}.${role}`);
    for (const key of keys) {
      const c = await center(key);
      await page.mouse.click(c.x, c.y);
    }
  }
  await page.waitForTimeout(150);
  check('stamped all pieces', (await placedText()) === `${target.length} of ${target.length}`, await placedText());
  await shot('m3-rebuild');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.bm__accuracy');
  check('perfect reconstruction scores 100%', (await text('.bm__accuracy')) === '100%' && (await text('.bm__result-grid .stat--good .stat__value')) === String(target.length), await text('.bm__accuracy'));
  check('result names the game', /\d{4}, after \d+/.test(await text('.bm__source-label')), await text('.bm__source-label'));
  await shot('m4-result');

  // ---- Second round: palette drag, board drag, drop-off, eraser, empty answer ----
  await page.keyboard.press('Space');
  await page.waitForSelector('.bm__timer');
  await page.waitForTimeout(200);
  const target2 = await boardPieces();
  await page.keyboard.press('Space');
  await page.waitForSelector('.bm__palette');
  await page.waitForTimeout(150);
  const knight = await page.locator('.bm__palette piece.white.knight').boundingBox();
  await dragTo({ x: knight.x + knight.width / 2, y: knight.y + knight.height / 2 }, await center('e4'));
  let pieces = await boardPieces();
  check('dragging from the palette places a piece', pieces.length === 1 && pieces[0].key === 'e4' && pieces[0].role === 'knight', JSON.stringify(pieces));
  await dragTo(await center('e4'), await center('d5'));
  pieces = await boardPieces();
  check('placed pieces can be moved', pieces.length === 1 && pieces[0].key === 'd5', JSON.stringify(pieces));
  const g = await geometry();
  // Overshooting the edge by a few pixels still lands on the edge square.
  await dragTo(await center('d5'), { x: g.left - 12, y: (await center('a5')).y });
  pieces = await boardPieces();
  check('a drop just past the edge lands on the edge square', pieces.length === 1 && pieces[0].key === 'a5', JSON.stringify(pieces));
  await dragTo(await center('a5'), await center('d5'));
  await dragTo(await center('d5'), { x: g.left - 80, y: g.top + 40 });
  check('dragging off the board removes the piece', (await boardPieces()).length === 0 && (await placedText()) === `0 of ${target2.length}`);
  await page.click('.bm__palette piece.black.queen');
  const a1 = await center('a1');
  await page.mouse.click(a1.x, a1.y);
  await page.waitForTimeout(150);
  check('stamping with a brush places a piece', (await placedText()) === `1 of ${target2.length}`, await placedText());
  await page.click('.bm__tools .btn:has-text("Eraser")');
  await page.mouse.click(a1.x, a1.y);
  await page.waitForTimeout(150);
  check('eraser removes a stamped piece', (await placedText()) === `0 of ${target2.length}`, await placedText());
  await page.click('.bm__panel .btn--primary');
  await page.waitForSelector('.bm__accuracy');
  check('empty answer scores 0% with every piece missing', (await text('.bm__accuracy')) === '0%' && (await text('.bm__result-grid .stat:nth-child(2) .stat__value')) === String(target2.length));
  check('solution view marks missed squares', (await page.locator('cg-board square.missing').count()) === target2.length);
  await page.click('.bm__view button:has-text("Your answer")');
  await page.waitForTimeout(100);
  check('answer view shows the empty board', (await boardPieces()).length === 0);

  // ---- Sources and persistence -----------------------------------------------------
  await page.keyboard.press('Escape');
  await page.waitForSelector('.bm__times');
  check('history persisted', /2 attempts/.test(await text('.bm__stats-line')), await text('.bm__stats-line'));
  await page.click('.bm__chips .chip:has-text("My openings")');
  await page.click('.bm__panel .btn--primary');
  await page.waitForSelector('.bm__timer');
  await page.keyboard.press('Space');
  await page.waitForSelector('.bm__palette');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.bm__source-label');
  check('openings source draws from the seeded repertoire', /Sicilian Dragon/.test(await text('.bm__source-label')), await text('.bm__source-label'));
  await page.keyboard.press('Escape');
  await page.click('.bm__chips .chip:has-text("Random pieces")');
  await page.click('.bm__panel .btn--primary');
  await page.waitForSelector('.bm__timer');
  await page.waitForTimeout(200);
  const randomPieces = await boardPieces();
  check('random source places both kings', randomPieces.filter((p) => p.role === 'king').length === 2, `${randomPieces.length} pieces`);
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.bm__source-label');
  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/board-memory"]');
  const summary = await page.locator('a[href="#/activity/board-memory"] .activity-card__footer').textContent();
  check('home card summarises attempts', /Avg \d+% over 4 positions/.test(summary), summary);
  await shot('m5-home');

  // ---- Live Lichess pool (opt-in: E2E_LICHESS=1) --------------------------------
  if (process.env.E2E_LICHESS === '1') {
    const poolLine = () => text('.bm__pool-line span');
    const waitForIdle = async (timeoutMs) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const fetching = (await page.locator('.bm__pool-progress').count()) > 0;
        const error = (await page.locator('.bm__pool-status.is-error').count()) > 0;
        if (!fetching || error) return !error;
        await page.waitForTimeout(500);
      }
      return false;
    };
    await page.click('a[href="#/activity/board-memory"]');
    await page.waitForSelector('.bm');
    await page.click('.bm__chips .chip:has-text("Lichess masters")');
    await page.waitForSelector('.bm__pool');
    await page.waitForTimeout(500);
    check('selecting the Lichess source starts a fetch', (await page.locator('.bm__pool-progress').count()) === 1, await text('.bm__pool-status'));
    await shot('m6-lichess-fetching');
    const ok = await waitForIdle(120_000);
    if (!ok && (await page.locator('.bm__pool-status.is-error').count()) > 0) {
      console.log('  [lichess fetch error]', await text('.bm__pool-status.is-error'));
    }
    const line = await poolLine();
    const games = Number(/(\d+) games/.exec(line)?.[1] ?? 0);
    check('batch of games fetched and saved', ok && games >= 60, line);
    const unseenBefore = Number(/^([\d,]+) of/.exec(line)?.[1].replace(',', '') ?? 0);
    await page.click('.bm__panel .btn--primary');
    await page.waitForSelector('.bm__timer');
    await page.keyboard.press('Space');
    await page.waitForSelector('.bm__palette');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.bm__source-label');
    const label = await text('.bm__source-label');
    check('position labelled with players, event and move', /\(\d{3,4}\).*after \d+/.test(label), label);
    await shot('m7-lichess-result');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.bm__pool');
    const unseenAfter = Number(/^([\d,]+) of/.exec(await poolLine())?.[1].replace(',', '') ?? 0);
    check('shown position is marked seen', unseenAfter === unseenBefore - 1, `${unseenBefore} -> ${unseenAfter}`);

    await page.context().setOffline(true);
    await page.click('.bm__pool .btn');
    await page.waitForTimeout(400);
    check('offline: refresh is refused with a clear message, saved positions kept', /offline/i.test(await text('.bm__pool-status.is-error')) && (await poolLine()).includes(`${unseenAfter} of`), await text('.bm__pool-status.is-error'));
    await shot('m8-lichess-offline');
    await page.context().setOffline(false);

    await page.reload();
    await page.waitForSelector('.bm__pool');
    check('pool and seen marks persist across restarts', (await poolLine()).startsWith(`${unseenAfter} of`), await poolLine());
  }
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'm-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
