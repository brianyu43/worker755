// Plays one turn against a running game: node scripts/drive.mjs <url> <shot-prefix> [command...]
// Opens <url> (a start page, or a ?s=<id> link to rejoin), types the commands, reports, and
// prints the next instruction. With no commands it only clocks in / rejoins and prints the state.
import { chromium } from 'playwright';
const [url, prefix, ...commands] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
const order = async () => {
  const title = await page.textContent('.order-title').catch(() => null);
  const text = await page.textContent('.order-text').catch(() => null);
  return `${title}\n${text}`;
};
await page.goto(url);
if (!url.includes('?s=')) {
  await page.waitForSelector('select');
  await page.screenshot({ path: `screenshots/${prefix}-start.png` });
  await page.getByRole('button', { name: 'Clock in' }).click();
}
await page.waitForSelector('.order-title', { timeout: 60000 });
await page.waitForTimeout(800);
const before = await order();
for (const line of commands) {
  await page.keyboard.type(line, { delay: 3 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}
await page.screenshot({ path: `screenshots/${prefix}-work.png` });
if (commands.length) {
  const results = await page.$$eval('.fi-result', (x) => x.length);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.fi-result').length > n, results, { timeout: 20000 });
  // Wait for the manager to react: a new instruction, or the end of the game.
  await page
    .waitForFunction((b) => {
      const t = document.querySelector('.order-title')?.textContent;
      const x = document.querySelector('.order-text')?.textContent;
      return `${t}\n${x}` !== b;
    }, before, { timeout: 60000 })
    .catch(() => console.log('(no new instruction within 60s)'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/${prefix}-after.png` });
}
console.log('URL', page.url());
console.log('INSTRUCTION', await order());
await browser.close();
