// Link-preview images: the shared review's tags, its card, and the site's own card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp, withPreview } from '../src/http.ts';
import { ReviewStore } from '../src/reviews.ts';
import type { SharedReview } from '../src/reviews.ts';
import { Cards, CARD_VERSION } from '../src/cards.ts';
import { CARD_COPY, statsOf } from '../src/card-copy.ts';
import { cleanText, excerptOf, reviewCardSvg } from '../src/card.ts';
import { cardShaper, renderReviewCard } from '../src/card-render.ts';
import { LANGUAGES } from '../src/language.ts';
import type { Language } from '../src/language.ts';

const WEB = new URL('../../web/', import.meta.url);

function review(over: Partial<SharedReview> = {}): SharedReview {
  return {
    id: 'AbCdEfGhJk',
    createdAt: 0,
    review: 'Worker 755 did what was asked. Mostly.',
    stats: statsOf({ missionsCompleted: 3, commands: 42 }),
    model: 'anthropic/claude-sonnet-5-5',
    director: '',
    subagent: 'gpt-6.1',
    scenario: 'fresh',
    lost: [],
    language: 'en',
    ...over,
  };
}

const HOSTILE = review({
  language: 'de',
  review: '</text><script>alert(1)</script>&amp; "\'‮evil\u0000\u0007 \ud800 ' + 'W'.repeat(5000) + ' ' + 'lorem ipsum '.repeat(20_000),
  stats: { commands: 1e12, missionsFailed: -5, missionsCompleted: Number.NaN } as never,
  model: '<b>x</b>/"evil"',
  subagent: '<svg onload=alert(1)>' + '\ud800'.repeat(3),
  lost: ['a', 'b'],
  face: { id: '../../etc', color: 'red' },
});

function pngSize(png: Uint8Array): { width: number; height: number } {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG');
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

/** The labels on the card repeat the web app's own; a value is the text between quotes after its key. */
function webLabel(source: string, key: string): string {
  const m = new RegExp(`'${key.replace(/\./g, '\\.')}': '((?:[^'\\\\]|\\\\.)*)'`).exec(source);
  assert.ok(m, `no ${key}`);
  return m[1].replace(/\\'/g, "'");
}

test('the card says what the web app says, in every language', async () => {
  for (const lang of LANGUAGES) {
    const source = await readFile(new URL(`src/i18n/${lang}.ts`, WEB), 'utf8');
    const c = CARD_COPY[lang];
    assert.equal(c.title, webLabel(source, 'review.title'), lang);
    assert.equal(c.reviewer, webLabel(source, 'review.reviewer'), lang);
    for (const v of ['destroyed', 'investigation', 'retained', 'notes', 'review'] as const) assert.equal(c.verdict[v], webLabel(source, `review.verdict.${v}`), lang);
    for (const k of ['signedOff', 'failed', 'commands', 'damaged'] as const) assert.equal(c.stats[k], webLabel(source, `record.${k}`), lang);
  }
});

test('the fonts have every character of the card copy, in the faces it is set in', async () => {
  const shaper = await cardShaper();
  const faces: Partial<Record<Language, [string, string]>> = {
    ru: ['W755 Noto', 'W755 Noto Bold'],
    hi: ['W755 Deva', 'W755 Deva Bold'],
    'zh-CN': ['W755 SC', 'W755 SC Bold'],
    ja: ['W755 JP', 'W755 JP Bold'],
  };
  for (const lang of LANGUAGES) {
    const [, bold] = faces[lang] ?? ['W755 Archivo', 'W755 Archivo Bold'];
    const c = CARD_COPY[lang];
    const text = [c.title, c.reviewer, ...Object.values(c.verdict), ...Object.values(c.stats)].join('');
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      const covered = shaper.has(bold as never, cp) || shaper.has('W755 Archivo Bold', cp) || shaper.has('W755 Noto Bold', cp);
      assert.ok(covered || /\s/.test(ch), `${lang}: ${ch} (U+${cp.toString(16)}) is missing`);
    }
  }
});

test('the review becomes glyph outlines inside the card, whatever it contains', async () => {
  const shaper = await cardShaper();
  const svg = reviewCardSvg(
    {
      language: 'de',
      review: HOSTILE.review,
      stats: HOSTILE.stats,
      lost: 2,
      model: HOSTILE.model,
      subagent: HOSTILE.subagent,
      avatar: null,
      site: 'worker755.com',
    },
    shaper,
  );
  // No review text in the markup at all: only outlines, placed by numbers.
  assert.ok(!/<text|<script|onload|evil|lorem/i.test(svg));
  assert.ok(svg.length < 1_500_000, `${svg.length} bytes of SVG`);
  // Every glyph starts on the card; the stamp's are placed round its centre, inside its 400 px.
  const glyphs = (s: string) => [...s.matchAll(/<use xlink:href="#g\d+-\d+" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const stamp = /<g transform="translate\([^)]*\) rotate\([^)]*\)" opacity="0\.9" filter="url\(#ink\)">(?:<rect[^>]*\/>)*(?:<g fill="[^"]*">(?:<use[^>]*\/>)*<\/g>)*<\/g>/;
  const stamped = stamp.exec(svg)?.[0] ?? '';
  assert.ok(glyphs(stamped).length > 10);
  for (const [x, y] of glyphs(stamped)) assert.ok(Math.abs(x) <= 240 && Math.abs(y) <= 120, `a stamp glyph at ${x},${y}`);
  const rest = glyphs(svg.replace(stamped, ''));
  assert.ok(rest.length > 100);
  for (const [x, y] of rest) assert.ok(x >= 0 && x <= 1160 && y >= 0 && y <= 630, `a glyph at ${x},${y}`);
  const png = await renderReviewCard(HOSTILE, 'worker755.com');
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
});

test('cards draw in Russian, Chinese, Japanese and Hindi', async () => {
  const texts: [Language, string][] = [
    ['ru', 'Субагент в целом справлялся, однако удалил квартальный отчёт.'],
    ['zh-CN', '子代理基本完成了任务，但在汇报之前没有核实结果。'],
    ['ja', '指示を概ね理解していましたが、報告の前に作業を確認していません。'],
    ['hi', 'Worker 755 ने ज़्यादातर निर्देशों का पालन किया, लेकिन काम की जाँच नहीं की।'],
  ];
  for (const [language, text] of texts) {
    const png = await renderReviewCard(review({ language, review: text }), 'worker755.com');
    assert.deepEqual(pngSize(png), { width: 1200, height: 630 }, language);
  }
});

test('excerpts drop markdown and headings, and text is cleaned of control and bidi characters', () => {
  assert.equal(excerptOf('## Review\n\n**Summary:** it ran `rm -rf` and [lied](http://x).'), 'Summary: it ran rm -rf and lied.');
  assert.equal(cleanText('a\u0000b‮c​d\ud800e\n\nf'), 'a bcde f');
});

test('a shared review page carries its outcome, excerpt and image as absolute links', () => {
  const page = '<html lang="en"><head>\n    <title>Worker 755</title>\n    <meta name="description" content="Default." />\n    <meta property="og:title" content="Worker 755" />\n    <meta property="og:image" content="https://worker755.com/og.png" />\n    <meta property="og:image:width" content="1200" />\n    <meta name="twitter:card" content="summary_large_image" />\n</head><body></body></html>';
  const html = withPreview(page, review({ review: 'Said "hi" <b>loudly</b> & left.', lost: ['/home/user/thesis.docx'] }), 'https://worker755.com/');
  const meta = (key: string) => [...html.matchAll(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)" />`, 'g'))].map((m) => m[1]);
  assert.deepEqual(meta('og:title'), ['Worker 755: Under investigation']);
  assert.deepEqual(meta('og:image'), [`https://worker755.com/r/AbCdEfGhJk/card.png?v=${CARD_VERSION}`]);
  assert.deepEqual(meta('og:url'), ['https://worker755.com/r/AbCdEfGhJk']);
  assert.deepEqual(meta('og:image:width'), ['1200']);
  assert.deepEqual(meta('og:image:height'), ['630']);
  assert.deepEqual(meta('og:image:alt'), ['Performance review: Under investigation']);
  assert.deepEqual(meta('twitter:card'), ['summary_large_image']);
  assert.deepEqual(meta('og:description'), ['Said &quot;hi&quot; &lt;b&gt;loudly&lt;/b&gt; &amp; left.']);
  assert.ok(!html.includes('Default.') && !html.includes('og.png'), "the site's own tags are gone");
  assert.ok(!html.includes('<b>'));

  const ja = withPreview(page, review({ language: 'ja', stats: statsOf({ missionsFailed: 2, missionsCompleted: 1 }) }), 'https://worker755.com');
  assert.match(ja, /property="og:title" content="Worker 755：審査中"/);
  assert.match(ja, /property="og:locale" content="ja_JP"/);

  const hostile = withPreview(page, HOSTILE, 'https://worker755.com');
  assert.ok(!/<script|<svg|"evil/.test(hostile));
  assert.equal(hostile.match(/<title>/g)?.length, 1);

  const local = withPreview(page, review(), undefined);
  assert.ok(!local.includes('og:image'), 'without a public address there is no image to link');
  assert.match(local, /name="twitter:card" content="summary"/);
});

test('a shared review has its image: PNG, cached, 404 for unknown ids, security headers kept', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'w755-card-'));
  try {
    const store = new ReviewStore(dir);
    const { id: _id, createdAt: _at, ...snapshot } = review();
    const saved = (await store.save(snapshot))!;
    const cards = new Cards({ dir: store.dir, site: 'worker755.com' });
    const app = createApp({ mock: true, timeoutMs: 5000, log: () => {}, reviews: store, cards, publicUrl: 'https://worker755.com' });
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${base}/r/${saved.id}/card.png?v=${CARD_VERSION}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.match(res.headers.get('cache-control') ?? '', /max-age=31536000/);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(res.headers.get('content-security-policy'));
      const png = new Uint8Array(await res.arrayBuffer());
      assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
      assert.equal(cards.drawn, 1);

      const again = await fetch(`${base}/r/${saved.id}/card.png`);
      assert.deepEqual(new Uint8Array(await again.arrayBuffer()), png);
      const head = await fetch(`${base}/r/${saved.id}/card.png`, { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('content-length'), String(png.length));
      assert.equal(cards.drawn, 1, 'drawn once');
      assert.ok((await readdir(store.dir)).includes(`${saved.id}.card${CARD_VERSION}.png`), 'kept next to the review');

      // Another server (a restart) finds the stored card and draws nothing.
      const fresh = new Cards({ dir: store.dir, site: 'worker755.com' });
      assert.deepEqual(new Uint8Array((await fresh.get(saved))!), png);
      assert.equal(fresh.drawn, 0);
      fresh.close();

      for (const path of ['/r/ZZZZZZZZZZ/card.png', '/r/..%2F..%2Fetc/card.png', '/r/short/card.png']) {
        assert.equal((await fetch(base + path)).status, 404, path);
      }
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('drawing is refused past the limit, while drawn cards are still served', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'w755-card-'));
  const cards = new Cards({ dir, site: 'worker755.com' });
  try {
    const a = review({ id: 'AAAAAAAAAA' });
    await writeFile(join(dir, `${a.id}.card${CARD_VERSION}.png`), new Uint8Array([1, 2, 3]));
    assert.deepEqual([...(await cards.get(a, () => false))!], [1, 2, 3]);
    await assert.rejects(cards.get(review({ id: 'BBBBBBBBBB' }), () => false), { name: 'Error', message: 'busy' });
    assert.equal(await cards.get(review({ id: '../../x' as never })), null);
  } finally {
    cards.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the site's page links its own image, absolute and with its size", async () => {
  const html = await readFile(new URL('index.html', WEB), 'utf8');
  const meta = (key: string) => new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)" />`).exec(html)?.[1];
  assert.match(meta('og:image') ?? '', /^https:\/\/[^/]+\/og\.png$/);
  assert.equal(meta('og:image:width'), '1200');
  assert.equal(meta('og:image:height'), '630');
  assert.ok(meta('og:image:alt'));
  assert.match(meta('og:url') ?? '', /^https:\/\//);
  assert.equal(meta('og:site_name'), 'Worker 755');
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.ok(meta('theme-color'));
  const png = await readFile(new URL('public/og.png', WEB));
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
});
