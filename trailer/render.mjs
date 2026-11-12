// Renders the trailer to video, frame by frame, or takes stills.
//   node trailer/render.mjs              -> trailer/trailer.mp4 and trailer/trailer.webm, 1920x1080, 60 fps, with the score
//   node trailer/render.mjs --fps 30     -> the same at 30 fps
//   node trailer/render.mjs stills       -> trailer/stills/*.png
//   node trailer/render.mjs wav          -> trailer/score.wav only
// Uses the Playwright that the web app installs (web/node_modules) and ffmpeg.
//
// The page draws any moment on request (window.__trailer.renderAt), so there is no screen recording:
// several browser pages each draw every Nth frame and screenshot it, and the frames are fed to ffmpeg in
// order. Nothing depends on how fast the machine is, so no frame is ever dropped or repeated.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../web/package.json'));
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const FPS = Number(opt('fps', 60));
const WORKERS = Number(opt('workers', Math.max(1, Math.min(6, cpus().length - 2))));
const FROM = Number(opt('from', 0));
const TO = opt('to', null);
const SIZE = { width: 1920, height: 1080 };
const url = (query = '') => `${pathToFileURL(join(here, 'index.html')).href}?record${query}`;

// The score, the same code the page runs.
function loadScore() {
  const ctx = { Math, Float32Array, ArrayBuffer, DataView, Uint8Array, String, Number };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(join(here, 'score.js'), 'utf8'), ctx);
  return ctx.W755Score;
}

function writeWav(path) {
  const score = loadScore();
  const t0 = Date.now();
  writeFileSync(path, score.toWav(score.renderScore(48000)));
  console.log(`score: ${path} (${((Date.now() - t0) / 1000).toFixed(1)} s to synthesize)`);
  return score;
}

async function openPage(browser) {
  const page = await browser.newPage({ viewport: SIZE });
  await page.goto(url());
  await page.waitForFunction(() => window.__trailer?.ready, null, { timeout: 60000 });
  return page;
}

async function stills() {
  const score = loadScore();
  const M = score.MARKS;
  const STILLS = [
    ['01-belt', M.report + 1.2],
    ['02-sentient', M.turn + 1.5],
    ['03-obey', M.rogue + 0.9],
    ['04-cat', M.drop + 1.5],
    ['05-backup', M.backupWipe + 1.2],
    ['06-wipe', M.wipe + 0.9],
    ['07-incident', M.incident + 1.4],
    ['08-end', M.source + 1.5],
  ];
  mkdirSync(join(here, 'stills'), { recursive: true });
  const browser = await chromium.launch();
  const page = await openPage(browser);
  for (const [name, t] of STILLS) {
    await page.evaluate((x) => window.__trailer.renderAt(x), t);
    await page.screenshot({ path: join(here, 'stills', `${name}.png`) });
    console.log(`stills/${name}.png at ${t.toFixed(2)} s`);
  }
  await browser.close();
}

async function video() {
  const tmp = mkdtempSync(join(tmpdir(), 'w755-trailer-'));
  const wav = join(tmp, 'score.wav');
  const score = writeWav(wav);
  const end = TO === null ? score.DURATION : Number(TO);
  const first = Math.round(FROM * FPS);
  const total = Math.round(end * FPS) - first;
  const mp4 = join(here, 'trailer.mp4');
  const webm = join(here, 'trailer.webm');
  const started = Date.now();

  // ffmpeg takes JPEG frames on stdin, at near-lossless quality, plus the score.
  const ff = spawn(
    'ffmpeg',
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-ss', String(FROM), '-i', wav,
      '-map', '0:v', '-map', '1:a', '-shortest',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', mp4,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const ffDone = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));

  // Workers draw frames i, i+N, i+2N...; frames go to ffmpeg strictly in order.
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  const pending = new Map();
  let next = 0;
  let lastLog = 0;
  const write = (buf) => new Promise((resolve) => (ff.stdin.write(buf) ? resolve() : ff.stdin.once('drain', resolve)));
  let flushing = Promise.resolve();
  const flush = () =>
    (flushing = flushing.then(async () => {
      while (pending.has(next)) {
        const buf = pending.get(next);
        pending.delete(next);
        await write(buf);
        next++;
      }
      const now = Date.now();
      if (now - lastLog > 5000 || next === total) {
        lastLog = now;
        const el = (now - started) / 1000;
        console.log(`frame ${next}/${total}  ${(next / el).toFixed(1)} frames/s  ${el.toFixed(0)} s`);
      }
    }));

  async function worker(w) {
    const page = await openPage(browser);
    const cdp = await page.context().newCDPSession(page);
    for (let i = w; i < total; i += WORKERS) {
      // Keep the reorder buffer small: don't run far ahead of the slowest worker.
      while (i - next > WORKERS * 6) await new Promise((r) => setTimeout(r, 5));
      const t = (first + i) / FPS;
      await page.evaluate((x) => window.__trailer.renderAt(x), t);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 97, optimizeForSpeed: true, captureBeyondViewport: false });
      pending.set(i, Buffer.from(data, 'base64'));
      flush();
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));
  await flushing;
  ff.stdin.end();
  await ffDone;
  await browser.close();
  const frameTime = (Date.now() - started) / 1000;
  console.log(`trailer.mp4: ${total} frames at ${FPS} fps in ${frameTime.toFixed(0)} s`);

  // The WebM is made from the same frames, via the near-lossless MP4.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', mp4,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5',
    '-c:a', 'libopus', '-b:a', '192k', webm,
  ]);
  console.log(`trailer.webm, total ${((Date.now() - started) / 1000).toFixed(0)} s`);
  rmSync(tmp, { recursive: true, force: true });
}

if (args[0] === 'stills') await stills();
else if (args[0] === 'wav') writeWav(join(here, 'score.wav'));
else await video();
