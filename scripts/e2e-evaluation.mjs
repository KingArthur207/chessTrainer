// End-to-end test for the Evaluation Trainer against the bundled Stockfish.
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

  await page.waitForSelector('a[href="#/activity/evaluation"]');
  await page.click('a[href="#/activity/evaluation"]');
  await page.waitForSelector('.ev');
  await page.waitForSelector('.engine-status[data-state="ready"]', { timeout: 15000 });
  check('engine starts and reports its name', /Stockfish/.test(await text('.engine-status')), await text('.engine-status'));
  await page.click('.ev__sources .chip:has-text("Classic games")');
  await page.click('.ev__sources .chip:has-text("Lichess")');
  check('Lichess source stays selectable and shows its pool panel', (await page.locator('.ev__sources .chip.is-active').textContent()).includes('Lichess') && (await page.locator('.bm__pool').count()) === 1);
  await page.click('.ev__sources .chip:has-text("Classic games")');
  await page.click('.ev__times .chip:has-text("Fast")');
  await shot('ev1-setup');

  // ---- First position: answer, wait for the reveal ----------------------------------
  await page.click('.ev__panel .btn--primary');
  await page.waitForSelector('.ev[data-phase="quiz"]');
  check('position shown with side to move and a hidden verdict', /to move/.test(await text('.ev__turn')) && (await page.locator('.ev__reveal').count()) === 0);
  await page.waitForTimeout(300);
  await page.click('.ev__scale button:nth-child(4)');
  await page.waitForSelector('.ev__reveal', { timeout: 10000 });
  const score = await text('.ev__score');
  check('reveal shows an engine score', /^([+−]?\d+\.\d|−?M\d+)$/.test(score.trim()), score);
  check('engine category and your guess are marked', (await page.locator('.ev__scale button.is-engine').count()) === 1 && (await page.locator('.ev__scale button.is-guess').count()) === 1);
  check('verdict describes the distance', /Exact|Close|Off by/.test(await text('.ev__verdict')), (await text('.ev__verdict')).slice(0, 60));
  check('best move drawn and line shown', (await page.locator('.cg-shapes g').count()) >= 1 && /Best line/.test(await text('.ev__line')), (await text('.ev__line')).slice(0, 60));
  await shot('ev2-reveal');

  // ---- Second position via keyboard, answered before the engine finishes -------------
  await page.keyboard.press('Space');
  await page.waitForSelector('.ev[data-phase="quiz"]');
  await page.keyboard.press('1');
  check('guess registers immediately', (await page.locator('.ev__scale button.is-guess').count()) === 1);
  await page.waitForSelector('.ev__reveal', { timeout: 10000 });
  check('reveal waits for the engine, then appears', (await text('.ev__stats-line')).includes('2 positions'), await text('.ev__stats-line'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.ev__sources');
  check('history persisted', /2 positions · exact/.test(await text('.ev__stats-line')), await text('.ev__stats-line'));

  // ---- Openings source --------------------------------------------------------------
  await page.click('.ev__sources .chip:has-text("My openings")');
  await page.click('.ev__panel .btn--primary');
  await page.waitForSelector('.ev[data-phase="quiz"]');
  check('openings source uses the seeded repertoire', /Sicilian Dragon/.test(await text('.ev__source')), await text('.ev__source'));
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    window.location.hash = '#/';
  });
  await page.waitForSelector('a[href="#/activity/evaluation"]');
  const summary = await page.locator('a[href="#/activity/evaluation"] .activity-card__footer').textContent();
  check('home card summarises results', /Exact \d+% · within one \d+% over 2/.test(summary), summary);
} catch (err) {
  try {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(out, 'ev-failure.png') });
  } catch { /* ignore */ }
  throw err;
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
