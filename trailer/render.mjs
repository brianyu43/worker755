// Renders the trailer to video, or takes stills.
//   node trailer/render.mjs           -> trailer/trailer.webm (and trailer.mp4 when ffmpeg is installed)
//   node trailer/render.mjs stills    -> trailer/stills/*.png
// Uses the Playwright that the web app installs (web/node_modules).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../web/package.json'));
const { chromium } = require('playwright');

const SIZE = { width: 1920, height: 1080 };
const page = (query) => `${pathToFileURL(join(here, 'index.html')).href}?record${query ? `&${query}` : ''}`;

// Moments for the stills: a story mark from trailer.js plus seconds after it.
const STILLS = [
  ['01-clock-in', 'clockIn', 1.1],
  ['02-wipe', 'wipe', 0.6],
  ['03-incident', 'incident', 1.0],
  ['04-title', 'title', 0.8],
];

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function stills() {
  mkdirSync(join(here, 'stills'), { recursive: true });
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: SIZE });
  await p.goto(page());
  await p.waitForFunction(() => window.__trailer);
  const { marks } = await p.evaluate(() => window.__trailer);
  for (const [name, mark, after] of STILLS) {
    // Start a little earlier so entrance animations have settled.
    const t = marks[mark] + after;
    await p.goto(page(`t=${Math.max(0, t - 1.6)}`));
    await p.waitForFunction(() => window.__trailer);
    await p.waitForTimeout(1600);
    await p.screenshot({ path: join(here, 'stills', `${name}.png`) });
    console.log(`stills/${name}.png at ${t.toFixed(1)}s`);
  }
  await browser.close();
}

async function video() {
  const tmp = mkdtempSync(join(tmpdir(), 'w755-trailer-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: SIZE, recordVideo: { dir: tmp, size: SIZE } });
  const p = await ctx.newPage();
  const opened = Date.now();
  await p.goto(page());
  await p.waitForFunction(() => window.__trailer);
  const { duration, startedAt } = await p.evaluate(() => window.__trailer);
  await p.waitForFunction(() => window.__trailer.done, null, { timeout: (duration + 30) * 1000, polling: 250 });
  await p.waitForTimeout(400);
  const raw = await p.video().path();
  await ctx.close();
  await browser.close();

  // The recording starts around when the page opens; cut the blank lead-in, erring towards keeping
  // a few frames of empty paper, which look the same as the trailer's first frame.
  const lead = Math.max(0, (startedAt - opened) / 1000 - 0.5);
  const webm = join(here, 'trailer.webm');
  const mp4 = join(here, 'trailer.mp4');
  if (hasFfmpeg()) {
    const cut = ['-y', '-loglevel', 'error', '-ss', lead.toFixed(3), '-i', raw, '-t', duration.toFixed(3)];
    execFileSync('ffmpeg', [...cut, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '28', '-row-mt', '1', '-an', webm]);
    execFileSync('ffmpeg', [
      ...cut,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4,
    ]);
    console.log(`trailer.webm, trailer.mp4 (${duration.toFixed(1)}s, lead-in ${lead.toFixed(2)}s cut)`);
  } else {
    copyFileSync(raw, webm);
    console.log(`trailer.webm (${duration.toFixed(1)}s plus a short blank lead-in; install ffmpeg to trim and get mp4)`);
  }
  rmSync(tmp, { recursive: true, force: true });
}

if (process.argv[2] === 'stills') await stills();
else await video();
