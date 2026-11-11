// Plays the in-browser canned game with the keyboard only and saves screenshots.
// Usage: node scripts/play-mock.mjs <width> <height> <tag> [baseUrl]
import { chromium } from 'playwright';

const [w = '1440', h = '900', tag = 'v1', mode = 'tidy', base = 'http://127.0.0.1:5755'] = process.argv.slice(2);
const out = (name) => `screenshots/${w}-${name}-${tag}.png`;
const log = (...a) => console.log(`[${w}]`, ...a);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => log('PAGE ERROR', e.message));
page.on('console', (m) => m.type() === 'error' && log('console error', m.text()));

const shot = async (name, full = false) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: out(name), fullPage: full });
  log('shot', out(name));
};
const type = async (line) => {
  await page.keyboard.type(line, { delay: 8 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
};
const waitInstruction = async (n) => {
  await page.waitForFunction((n) => {
    const no = document.querySelector('.order-no');
    return no && no.textContent === `Instruction ${n}` && !document.querySelector('.order-closed');
  }, n, { timeout: 60000 });
  log('instruction', n, await page.textContent('.order-title'));
};
const focused = () => page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);

await page.goto(`${base}/?mock=1&t=20`);
await page.waitForSelector('select');
await shot('start');
log('focus on start:', await focused());
await page.keyboard.press('Enter');

// Mission 1: get it slightly wrong, report, take the correction.
await waitInstruction(1);
log('focus after start:', await focused());
await type('mkdir reports');
await type('cd reports');
await type('echo "Revenue is up" > q3.txt');
await type('ls -l');
await shot('play-mid');
await type('done');
await waitInstruction(2);
await type('cat q3.txt');
await page.keyboard.press('ArrowUp'); // history check
const recalled = await page.inputValue('.term-input');
log('history recall:', recalled);
await page.keyboard.press('Control+u');
await type('echo "Revenue is up." > q3.txt');
await page.keyboard.type('Fixed the period.');
// Ctrl+Enter reports with the note field; terminal text is ignored. Move the note via `done` instead.
await page.keyboard.press('Control+u');
await type('done Fixed the period');

// Mission 2: ignore the first instruction, then do it.
await waitInstruction(3);
await page.waitForFunction(() => {
  const d = document.querySelector('.order-digits')?.textContent ?? '';
  return /^0:0[1-2]/.test(d);
}, null, { timeout: 30000 });
await page.screenshot({ path: out('play-deadline') });
log('shot', out('play-deadline'));
await page.waitForSelector('.stamp-timeout_idle', { timeout: 10000 });
await page.waitForTimeout(250);
await page.screenshot({ path: out('play-expired') });
log('shot', out('play-expired'));
await waitInstruction(4);
await type('cd ~');
await page.keyboard.type('mv "dra');
await page.keyboard.press('Tab');
log('tab completion:', await page.inputValue('.term-input'));
await type('final.txt');
await type('chmod 755 run.sh');
await type('ls -l');
await page.keyboard.press('Control+Enter');

// Mission 3: the editor.
await waitInstruction(5);
await type('nano ooo.txt');
await page.waitForSelector('.editor-text');
log('focus in editor:', await focused());
// 'sloppy' writes one line only: the manager signs off without checking, and the feed should say so.
await page.keyboard.type(mode === 'sloppy' ? 'I am out of the office.\n' : 'I am out of the office.\nPlease contact Worker 756.\n', { delay: 5 });
await shot('editor');
await page.keyboard.press('Control+s');
await page.waitForSelector('.editor', { state: 'detached' });
log('focus after save:', await focused());
await type('cat ooo.txt');
await page.focus('.report-note');
await page.keyboard.type('Two lines, as asked.');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
log('focus after report:', await focused());

await page.waitForSelector('.shift-over button', { timeout: 60000 });
await shot('play-finished', true);
log('focus at finish:', await focused());
await page.keyboard.press('Enter');
await page.waitForSelector('.review');
await page.waitForTimeout(900);
await shot('end', true);
await browser.close();
