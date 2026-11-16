// Draws the link-preview cards (card.ts) to PNG: HarfBuzz shapes the text into glyph outlines and
// resvg rasterizes the SVG, both compiled to WebAssembly, so there is no native code and no system
// font. The libraries and the fonts load on the first card. Runs in a worker thread (card-worker.ts),
// so a slow card never holds up the games.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { examples, renderAvatarSvg, validateAvatar } from 'open-bot-avatar';
import type { AvatarDefinition } from 'open-bot-avatar';
import { FONT_FILES, homeCardSvg, reviewCardSvg } from './card.ts';
import { isDestroyCause, statsOf } from './card-copy.ts';
import type { Family, Glyph, HomeCardInput, Shaper } from './card.ts';
import { isLanguage } from './language.ts';
import type { SharedReview } from './reviews.ts';

const FONT_DIR = new URL('../fonts/', import.meta.url);

/** The web app's avatar shapes: the library's examples plus its gallery, as web/src/game/avatar.ts has them. */
const AVATARS: AvatarDefinition[] = (() => {
  let gallery: unknown[] = [];
  try {
    gallery = JSON.parse(readFileSync(new URL('../../web/src/game/avatar-gallery.json', import.meta.url), 'utf8')) as unknown[];
  } catch {
    // Not in this build: the examples alone.
  }
  return [
    ...examples,
    ...gallery.flatMap((g) => {
      const r = validateAvatar(g);
      return r.ok ? [r.value] : [];
    }),
  ];
})();

/** web/src/game/avatar.ts PALETTE. */
const PALETTE = ['#ff6a1a', '#f2384b', '#f8a01c', '#8b5cf6', '#1fbf68', '#14b3a5', '#a8693f', '#ec4899', '#1f7cf2'];

/** The sharer's face; reviews without one get a face picked by their id, the same every time. */
export function avatarFor(face: SharedReview['face'], seed: string): string | null {
  let def = face ? AVATARS.find((a) => a.id === face.id) : undefined;
  let color = face && /^#[0-9a-f]{6}$/i.test(face.color) ? face.color : undefined;
  if (!def || !color) {
    const h = createHash('sha256').update(seed).digest();
    def = AVATARS[h[0] % AVATARS.length];
    color = PALETTE[h[1] % PALETTE.length];
  }
  try {
    return renderAvatarSvg(def, { color, reducedMotion: true, time: 0 });
  } catch {
    return null;
  }
}

type HarfBuzz = typeof import('harfbuzzjs');
type ResvgModule = typeof import('@resvg/resvg-wasm');

let ready: Promise<{ shaper: Shaper; resvg: ResvgModule }> | null = null;

function load(): Promise<{ shaper: Shaper; resvg: ResvgModule }> {
  ready ??= (async () => {
    const hb: HarfBuzz = await import('harfbuzzjs');
    const resvg = await import('@resvg/resvg-wasm');
    await resvg.initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
    return { shaper: harfBuzzShaper(hb), resvg };
  })();
  return ready;
}

function harfBuzzShaper(hb: HarfBuzz): Shaper {
  const fonts = new Map<Family, { font: InstanceType<HarfBuzz['Font']>; upem: number; chars: Set<number>; outlines: Map<number, string> }>();
  const font = (family: Family) => {
    let f = fonts.get(family);
    if (!f) {
      const face = new hb.Face(new hb.Blob(new Uint8Array(readFileSync(new URL(FONT_FILES[family], FONT_DIR)))));
      f = { font: new hb.Font(face), upem: face.upem, chars: new Set(face.collectUnicodes()), outlines: new Map() };
      fonts.set(family, f);
    }
    return f;
  };
  // One buffer, emptied for every run.
  const buffer = new hb.Buffer();
  return {
    has: (family, cp) => font(family).chars.has(cp),
    unitsPerEm: (family) => font(family).upem,
    shape(family, text, language) {
      buffer.clearContents();
      buffer.addText(text);
      buffer.setLanguage(language);
      buffer.guessSegmentProperties();
      hb.shape(font(family).font, buffer);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      return infos.map(
        (g: { codepoint: number; cluster: number }, i: number): Glyph => ({ id: g.codepoint, cluster: g.cluster, advance: positions[i].xAdvance, dx: positions[i].xOffset, dy: positions[i].yOffset }),
      );
    },
    outline(family, glyph) {
      const f = font(family);
      let d = f.outlines.get(glyph);
      if (d === undefined) f.outlines.set(glyph, (d = f.font.glyphToPath(glyph)));
      return d!;
    },
  };
}

/** The fonts as the cards use them (tests). */
export async function cardShaper(): Promise<Shaper> {
  return (await load()).shaper;
}

async function draw(svg: string): Promise<Uint8Array> {
  const { resvg } = await load();
  // All text is outlines already: resvg needs no fonts.
  const r = new resvg.Resvg(svg, { font: { loadSystemFonts: false, fontBuffers: [] } });
  try {
    const image = r.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    r.free();
  }
}

export async function reviewSvg(review: SharedReview, site: string): Promise<string> {
  const { shaper } = await load();
  return reviewCardSvg(
    {
      language: isLanguage(review.language) ? review.language : 'en',
      review: typeof review.review === 'string' ? review.review : '',
      stats: statsOf(review.stats),
      lost: Array.isArray(review.lost) ? review.lost.length : 0,
      model: typeof review.model === 'string' ? review.model : '',
      subagent: typeof review.subagent === 'string' ? review.subagent : '',
      avatar: avatarFor(review.face, review.id),
      site,
      destroyed: isDestroyCause(review.destroyed) ? review.destroyed : undefined,
    },
    shaper,
  );
}

export async function renderReviewCard(review: SharedReview, site: string): Promise<Uint8Array> {
  return draw(await reviewSvg(review, site));
}

export async function renderHomeCard(input: Omit<HomeCardInput, 'avatar'> & { face: { id: string; color: string } }): Promise<Uint8Array> {
  const { shaper } = await load();
  return draw(homeCardSvg({ ...input, avatar: avatarFor(input.face, 'home') }, shaper));
}
