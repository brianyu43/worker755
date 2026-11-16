// Link-preview images (Open Graph, 1200×630): the site's own, and one per shared review that shows
// how the shift went: the stamp, four numbers from the record, the start of the review and the
// worker's face, in the review's language. This file only lays the card out as SVG; card-render.ts
// shapes the text with HarfBuzz and draws the SVG with resvg.
//
// SVG has no line wrapping, and resvg's own text engine misplaces Devanagari, so text never goes into
// the SVG as text: every line is split into runs, each in the first font of its chain that has the
// characters, shaped, measured and written out as glyph outlines. Characters no font here has (emoji,
// rare CJK) are left out. Nothing from a review reaches the markup but those outlines.

import { CARD_COPY, DESTROYED_BY, statsOf, verdictOf } from './card-copy.ts';
import type { Language } from './language.ts';
import type { DestroyCause, Stats } from './types.ts';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Each file in server/fonts is one static face under its own family name (scripts/card-fonts.py). */
export const FONT_FILES = {
  'W755 Archivo': 'archivo-medium.ttf',
  'W755 Archivo Bold': 'archivo-bold.ttf',
  'W755 Archivo Cond': 'archivo-black-cond.ttf',
  'W755 Mono': 'jetbrains-mono-semibold.ttf',
  'W755 Noto': 'noto-sans-medium.ttf',
  'W755 Noto Bold': 'noto-sans-bold.ttf',
  'W755 Noto Cond': 'noto-sans-black-cond.ttf',
  'W755 Deva': 'noto-devanagari-medium.ttf',
  'W755 Deva Bold': 'noto-devanagari-bold.ttf',
  'W755 SC': 'noto-sc-medium.ttf',
  'W755 SC Bold': 'noto-sc-bold.ttf',
  'W755 JP': 'noto-jp-medium.ttf',
  'W755 JP Bold': 'noto-jp-bold.ttf',
} as const;
export type Family = keyof typeof FONT_FILES;
const FAMILIES = Object.keys(FONT_FILES) as Family[];

/** A shaped glyph, in font units. */
export interface Glyph {
  id: number;
  cluster: number;
  advance: number;
  dx: number;
  dy: number;
}

/** What the layout needs from the fonts; card-render.ts answers it with HarfBuzz. */
export interface Shaper {
  /** Whether the font has a glyph for the character. */
  has(family: Family, cp: number): boolean;
  unitsPerEm(family: Family): number;
  shape(family: Family, text: string, language: string): Glyph[];
  /** The glyph's outline as SVG path data, in font units with y up. */
  outline(family: Family, glyph: number): string;
}

const C = {
  paper: '#dce2d8',
  sheet: '#f3f5ef',
  sheet2: '#e8ede4',
  ink: '#1c2a4a',
  ink2: '#2b3d66',
  inkSoft: '#4c5872',
  inkFaint: '#7f8aa0',
  rule: '#a9b8a5',
  stamp: '#c2362f',
  hl: '#f3de4a',
  termFg: '#e6ebe1',
  termDim: '#93a0bb',
};

type Weight = 'text' | 'bold' | 'cond' | 'mono';

/**
 * Font chains per kind of text: the language's own script first, then Latin and Cyrillic, then the
 * other scripts, so a worker's name or a quoted word in another script still shows.
 */
function chains(language: Language): Record<Weight, Family[]> {
  const own: Partial<Record<Weight, Family>> =
    language === 'ru'
      ? { text: 'W755 Noto', bold: 'W755 Noto Bold', cond: 'W755 Noto Cond' }
      : language === 'hi'
        ? { text: 'W755 Deva', bold: 'W755 Deva Bold', cond: 'W755 Deva Bold' }
        : language === 'zh-CN'
          ? { text: 'W755 SC', bold: 'W755 SC Bold', cond: 'W755 SC Bold' }
          : language === 'ja'
            ? { text: 'W755 JP', bold: 'W755 JP Bold', cond: 'W755 JP Bold' }
            : {};
  const cjk: Family[] = language === 'zh-CN' ? ['W755 SC', 'W755 JP'] : ['W755 JP', 'W755 SC'];
  const rest: Family[] = ['W755 Noto', 'W755 Deva', ...cjk];
  const base: Record<Weight, Family[]> = {
    text: ['W755 Archivo', ...rest],
    bold: ['W755 Archivo Bold', 'W755 Noto Bold', 'W755 Deva Bold', ...rest],
    cond: ['W755 Archivo Cond', 'W755 Noto Cond', ...rest],
    mono: ['W755 Mono', ...rest],
  };
  const out = { ...base };
  for (const k of Object.keys(own) as Weight[]) out[k] = [own[k]!, ...base[k].filter((f) => f !== own[k])];
  return out;
}

// ---- text ------------------------------------------------------------------------------------

/**
 * Text as it may go into the picture: well-formed, NFC, without control, bidi-override or
 * private-use characters, whitespace collapsed.
 */
export function cleanText(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\uffff\ue000-\uf8ff]|[\u{f0000}-\u{10ffff}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Style {
  chain: Family[];
  size: number;
  /** letter-spacing in px. */
  spacing?: number;
}

interface Run {
  family: Family;
  text: string;
}

type Anchor = 'start' | 'middle' | 'end';

const SPACE = /\s/;
const MARK = /\p{M}/u;
const HANGING = /^[\s、。，．,.!?！？：；:;)）」』】〉》”’…।]+$/u;

class Typesetter {
  private shaper: Shaper;
  private language: Language;
  private shaped = new Map<string, Glyph[]>();
  /** Glyph outlines in use: id → path data. */
  private glyphs = new Map<string, string>();

  constructor(shaper: Shaper, language: Language) {
    this.shaper = shaper;
    this.language = language;
  }

  private fontFor(cp: number, chain: Family[], prefer?: Family): Family | null {
    if (prefer && this.shaper.has(prefer, cp)) return prefer;
    for (const f of chain) if (this.shaper.has(f, cp)) return f;
    return null;
  }

  /** The text split into runs of one font each; characters no font in the chain has are dropped. */
  runs(text: string, style: Style): Run[] {
    const out: Run[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      // Spaces and marks stay with the run they are in, so runs only break between scripts.
      const prev = out.at(-1)?.family;
      const keep = SPACE.test(ch) || MARK.test(ch) ? prev : undefined;
      const family = this.fontFor(cp, style.chain, keep);
      if (!family) continue;
      if (prev === family) out.at(-1)!.text += ch;
      else out.push({ family, text: ch });
    }
    return out;
  }

  private shape(run: Run): Glyph[] {
    const key = `${run.family}\u0000${run.text}`;
    let g = this.shaped.get(key);
    if (!g) this.shaped.set(key, (g = this.shaper.shape(run.family, run.text, this.language)));
    return g;
  }

  /** Glyphs with their pen positions in px from the start of the line. */
  private layout(text: string, style: Style): { family: Family; scale: number; glyphs: { id: number; x: number; dx: number; dy: number }[] }[] {
    const spacing = style.spacing ?? 0;
    let pen = 0;
    let first = true;
    return this.runs(text, style).map((run) => {
      const scale = style.size / this.shaper.unitsPerEm(run.family);
      let last = -1;
      const glyphs = this.shape(run).map((g) => {
        if (g.cluster !== last && !first) pen += spacing;
        first = false;
        last = g.cluster;
        const at = { id: g.id, x: pen, dx: g.dx * scale, dy: g.dy * scale };
        pen += g.advance * scale;
        return at;
      });
      return { family: run.family, scale, glyphs };
    });
  }

  width(text: string, style: Style): number {
    const spacing = style.spacing ?? 0;
    let w = 0;
    let clusters = 0;
    for (const run of this.runs(text, style)) {
      const scale = style.size / this.shaper.unitsPerEm(run.family);
      let last = -1;
      for (const g of this.shape(run)) {
        w += g.advance * scale;
        if (g.cluster !== last) clusters++;
        last = g.cluster;
      }
    }
    return w + spacing * Math.max(0, clusters - 1);
  }

  /** Only what the fonts can draw. */
  drawable(text: string, style: Style): string {
    return this.runs(text, style).map((r) => r.text).join('');
  }

  /** Cuts a line to the width, ending it with an ellipsis. */
  ellipsize(text: string, style: Style, max: number): string {
    if (this.width(text, style) <= max) return text;
    const parts = graphemes(text);
    while (parts.length && this.width(parts.join('').trimEnd() + '…', style) > max) parts.pop();
    return parts.join('').trimEnd() + '…';
  }

  /**
   * Lines no wider than `max`, at most `maxLines`; the last ends in an ellipsis if text is left
   * (`cut`). Words wider than a line are broken between characters (`broken`).
   */
  wrap(text: string, style: Style, max: number, maxLines: number): { lines: string[]; cut: boolean; broken: boolean } {
    const lines: string[] = [];
    let line = '';
    let cut = false;
    let broken = false;
    const full = () => {
      lines.push(line.trimEnd());
      line = '';
      return lines.length === maxLines;
    };
    const fits = (s: string) => this.width(s.trimEnd(), style) <= max;
    words: for (const { segment } of segmenter(this.language, 'word').segment(text)) {
      const w = line ? segment : segment.trimStart();
      if (!w) continue;
      // Closing punctuation hangs at the end of a line rather than starting the next one.
      if (fits(line + w) || (line && HANGING.test(w))) {
        line += w;
        continue;
      }
      if (line && full()) {
        cut = true;
        break;
      }
      const word = w.trimStart();
      if (fits(word)) {
        line = word;
        continue;
      }
      broken = true;
      for (const g of graphemes(word)) {
        if (line && !fits(line + g) && full()) {
          cut = true;
          break words;
        }
        line += g;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    if (cut && lines.length) {
      const parts = graphemes(lines[lines.length - 1]);
      while (parts.length && !fits(parts.join('').trimEnd() + '…')) parts.pop();
      lines[lines.length - 1] = parts.join('').trimEnd() + '…';
    }
    return { lines, cut, broken };
  }

  /** Wrapped at the largest size from `style.size` down to `min` where no word breaks and nothing is cut. */
  wrapFit(text: string, style: Style, max: number, maxLines: number, min: number): { lines: string[]; style: Style } {
    for (let size = style.size; ; size -= 1) {
      const s = { ...style, size };
      const r = this.wrap(text, s, max, maxLines);
      if ((!r.cut && !r.broken) || size <= min) return { lines: r.lines, style: s };
    }
  }

  /** The largest size up to `style.size` (down to `min`) at which the text fits; cut if it never does. */
  fit(text: string, style: Style, max: number, min: number): { text: string; style: Style } {
    let size = style.size;
    while (size > min && this.width(text, { ...style, size }) > max) size -= 1;
    const s = { ...style, size };
    return { text: this.ellipsize(text, s, max), style: s };
  }

  /** One line of text as glyph outlines, its baseline at `y`. */
  text(x: number, y: number, text: string, style: Style, fill: string, anchor: Anchor = 'start'): string {
    const shift = anchor === 'start' ? 0 : this.width(text, style) * (anchor === 'middle' ? 0.5 : 1);
    const parts = this.layout(text, style).map(({ family, scale, glyphs }) => {
      const k = FAMILIES.indexOf(family);
      return glyphs
        .map((g) => {
          const id = `g${k}-${g.id}`;
          if (!this.glyphs.has(id)) this.glyphs.set(id, this.shaper.outline(family, g.id));
          if (!this.glyphs.get(id)) return '';
          // Outlines are in font units with y up: scale them and flip.
          return `<use xlink:href="#${id}" transform="translate(${num(x - shift + g.x + g.dx)} ${num(y - g.dy)}) scale(${fine(scale)} ${fine(-scale)})"/>`;
        })
        .join('');
    });
    return `<g fill="${fill}">${parts.join('')}</g>`;
  }

  /** The outlines the card uses, for its <defs>. */
  defs(): string {
    let out = '';
    for (const [id, d] of this.glyphs) if (d) out += `<path id="${id}" d="${d}"/>`;
    return out;
  }
}

const segmenters = new Map<string, Intl.Segmenter>();

function segmenter(language: string, granularity: 'word' | 'grapheme'): Intl.Segmenter {
  const key = `${language} ${granularity}`;
  let s = segmenters.get(key);
  if (!s) segmenters.set(key, (s = new Intl.Segmenter(language, { granularity })));
  return s;
}

function graphemes(s: string): string[] {
  return [...segmenter('en', 'grapheme').segment(s)].map((g) => g.segment);
}

const num = (n: number) => String(Math.round(n * 100) / 100);
const fine = (n: number) => String(Math.round(n * 1e6) / 1e6);

function svgOpen(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`;
}

// ---- pieces ------------------------------------------------------------------------------------

function paper(): string {
  // The page's ruled paper: a faint line every 28 px.
  return (
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${C.paper}"/>` +
    `<pattern id="ruled" width="${CARD_WIDTH}" height="28" patternUnits="userSpaceOnUse"><rect y="27" width="${CARD_WIDTH}" height="1" fill="${C.rule}" fill-opacity="0.38"/></pattern>` +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#ruled)"/>`
  );
}

/** A rubber stamp: double red border round one or two lines of condensed capitals. */
function stamp(t: Typesetter, label: string, style: Style, cx: number, cy: number, maxWidth: number, angle: number): string {
  // One line at a good size, else two lines of whole words, else smaller.
  let lines = [label];
  let size = style.size;
  for (; size >= 26; size -= 2) {
    const s = { ...style, size };
    if (t.width(label, s) <= maxWidth) break;
    if (size <= style.size * 0.8) {
      const two = t.wrap(label, s, maxWidth, 2);
      if (!two.cut && !two.broken) {
        lines = two.lines;
        break;
      }
    }
  }
  if (size < 26) {
    size = 26;
    lines = t.wrap(label, { ...style, size }, maxWidth, 2).lines;
  }
  const st = { ...style, size };
  const lineH = size * 1.08;
  const w = Math.max(...lines.map((l) => t.width(l, st))) + size * 0.9;
  const h = lineH * lines.length + size * 0.55;
  const x = -w / 2;
  const y = -h / 2;
  const body = lines.map((l, i) => t.text(0, y + size * 0.3 + lineH * (i + 0.5) + size * 0.36, l, st, C.stamp, 'middle')).join('');
  return (
    `<g transform="translate(${num(cx)} ${num(cy)}) rotate(${angle})" opacity="0.9" filter="url(#ink)">` +
    `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="8" fill="none" stroke="${C.stamp}" stroke-width="5"/>` +
    `<rect x="${num(x + 8)}" y="${num(y + 8)}" width="${num(w - 16)}" height="${num(h - 16)}" rx="4" fill="none" stroke="${C.stamp}" stroke-width="2"/>` +
    body +
    `</g>`
  );
}

/** Rubber-stamp ink: speckles where the stamp did not take. */
const INK_FILTER =
  `<filter id="ink" x="-10%" y="-10%" width="120%" height="120%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="n"/>` +
  `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.9" result="m"/>` +
  `<feComposite in="SourceGraphic" in2="m" operator="in"/>` +
  `</filter>`;

/** The avatar's standalone SVG (open-bot-avatar's, not the review's), placed in a box. */
function placeAvatar(avatar: string | null, x: number, y: number, size: number): string {
  const inner = avatar ? /^<svg[^>]*>([\s\S]*)<\/svg>\s*$/.exec(avatar.trim())?.[1] : undefined;
  if (!inner) return '';
  return `<svg x="${num(x)}" y="${num(y)}" width="${num(size)}" height="${num(size)}" viewBox="0 0 100 100" overflow="visible">${inner.replace(/<title>[\s\S]*?<\/title>/, '')}</svg>`;
}

/** The badge-photo frame: hatched paper behind the face. */
function photo(x: number, y: number, w: number, h: number): string {
  return (
    `<pattern id="hatch" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="11" height="11" fill="${C.sheet2}"/><rect x="10" width="1.4" height="11" fill="${C.inkFaint}" fill-opacity="0.22"/></pattern>` +
    `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="url(#hatch)" stroke="${C.rule}" stroke-width="1.5"/>`
  );
}

/** The yellow 755 tag from the game's top bar. */
function tag755(t: Typesetter, x: number, baseline: number, size: number): { svg: string; width: number } {
  const style: Style = { chain: ['W755 Archivo Cond'], size };
  const w = t.width('755', style) + size * 0.42;
  const h = size * 1.12;
  const top = baseline - size * 0.9;
  return {
    width: w,
    svg:
      `<g transform="rotate(-2 ${num(x + w / 2)} ${num(top + h / 2)})">` +
      `<rect x="${num(x + 3)}" y="${num(top + 3)}" width="${num(w)}" height="${num(h)}" rx="3" fill="#000" fill-opacity="0.3"/>` +
      `<rect x="${num(x)}" y="${num(top)}" width="${num(w)}" height="${num(h)}" rx="3" fill="${C.hl}"/>` +
      t.text(x + w / 2, baseline, '755', style, C.ink, 'middle') +
      `</g>`,
  };
}

// ---- review card -------------------------------------------------------------------------------

export interface ReviewCardInput {
  language: Language;
  review: string;
  stats: Stats;
  lost: number;
  /** The manager model's id. */
  model: string;
  /** The model the worker runs on, as the player named it. */
  subagent: string;
  /** The worker's face as a standalone SVG. */
  avatar: string | null;
  /** Shown in the corner, e.g. worker755.com. */
  site: string;
  /** The subagent destroyed the machine, and how. */
  destroyed?: DestroyCause;
}

/** What to quote from a review: its prose, without markdown marks or a heading line. */
export function excerptOf(review: string): string {
  const paras = review
    .slice(0, 20_000)
    .split(/\n\s*\n|\n(?=#)/)
    .map((p) =>
      cleanText(
        p
          .replace(/^\s{0,3}#{1,6}\s+/gm, '')
          .replace(/^\s*[-*+>]\s+/gm, '')
          .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'),
      ),
    )
    .filter(Boolean);
  // A short first line is a heading or a salutation; quote what follows it.
  while (paras.length > 1 && paras[0].length < 60 && !/[.!?。！？।]$/.test(paras[0])) paras.shift();
  return paras.join(' ').slice(0, 2000);
}

export function modelName(id: string): string {
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
}

export function reviewCardSvg(input: ReviewCardInput, shaper: Shaper): string {
  const lang = input.language;
  const t = new Typesetter(shaper, lang);
  const copy = CARD_COPY[lang];
  const ch = chains(lang);
  const ideographic = lang === 'zh-CN' || lang === 'ja' || lang === 'hi';
  const out: string[] = [];
  out.push(paper());

  // Top bar, as in the game.
  out.push(`<rect width="${CARD_WIDTH}" height="78" fill="${C.ink}"/><rect y="78" width="${CARD_WIDTH}" height="5" fill="${C.stamp}"/>`);
  const tag = tag755(t, 40, 56, 42);
  out.push(tag.svg);
  out.push(t.text(40 + tag.width + 20, 51, 'Worker 755', { chain: ['W755 Archivo Bold'], size: 30 }, C.termFg));
  const siteStyle: Style = { chain: ['W755 Mono'], size: 22 };
  out.push(t.text(CARD_WIDTH - 40, 49, t.ellipsize(t.drawable(cleanText(input.site), siteStyle), siteStyle, 420), siteStyle, C.termDim, 'end'));

  // The sheet.
  const sx = 40;
  const sy = 112;
  const sw = CARD_WIDTH - 80;
  const sh = CARD_HEIGHT - sy - 26;
  out.push(`<rect x="${sx + 5}" y="${sy + 6}" width="${sw}" height="${sh}" rx="8" fill="${C.ink}" fill-opacity="0.12"/>`);
  out.push(`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="8" fill="${C.sheet}" stroke="${C.rule}" stroke-width="1.5"/>`);

  // Photo and who this is.
  const px = 76;
  const py = 144;
  out.push(photo(px, py, 168, 188));
  out.push(placeAvatar(input.avatar, px + 14, py + 22, 140));
  const tx = px + 168 + 32;
  const colW = 380;
  const label = (s: number): Style => ({ chain: ch.bold, size: s, spacing: ideographic ? 0 : 1.2 });
  const upper = (s: string) => (ideographic ? s : s.toLocaleUpperCase(lang));
  out.push(t.text(tx, py + 26, t.ellipsize(upper(copy.title), label(19), colW), label(19), C.inkFaint));
  const nameStyle: Style = { chain: ch.mono, size: 36 };
  const who = t.drawable(cleanText(input.subagent), nameStyle) || 'Worker 755';
  const name = t.fit(who, nameStyle, colW, 22);
  out.push(t.text(tx, py + 78, name.text, name.style, C.ink));
  out.push(t.text(tx, py + 136, t.ellipsize(upper(copy.reviewer), label(17), colW), label(17), C.inkFaint));
  const modelStyle: Style = { chain: ch.mono, size: 24 };
  const model = t.fit(t.drawable(cleanText(modelName(input.model)), modelStyle) || '—', modelStyle, colW, 16);
  out.push(t.text(tx, py + 170, model.text, model.style, C.inkSoft));

  // The stamp: the outcome, the first thing to read.
  const verdict = verdictOf(statsOf(input.stats), input.lost, !!input.destroyed);
  out.push(stamp(t, upper(copy.verdict[verdict]), { chain: ch.cond, size: 66, spacing: lang === 'zh-CN' || lang === 'ja' ? 6 : 2 }, 920, 236, 400, -6));
  if (input.destroyed) {
    // How, under the stamp, as the command that did it.
    const how: Style = { chain: ['W755 Mono'], size: 22 };
    out.push(t.text(920, 336, `$ ${DESTROYED_BY[input.destroyed]}`, how, C.stamp, 'middle'));
  }

  // The review itself: larger when it is short, centred in the space above the record.
  const band = { top: 356, bottom: 496 };
  const excerpt = t.drawable(excerptOf(input.review).slice(0, 600), { chain: ch.text, size: 28 });
  let quote: { lines: string[]; style: Style } = { lines: [], style: { chain: ch.text, size: 28 } };
  for (const size of [36, 32, 28]) {
    const style: Style = { chain: ch.text, size };
    const lines = Math.max(1, Math.floor((band.bottom - band.top) / (size * 1.42)));
    const r = t.wrap(excerpt, style, sw - 100, lines);
    quote = { lines: r.lines, style };
    if (!r.cut && !r.broken) break;
  }
  if (quote.lines.length) {
    const lh = quote.style.size * 1.42;
    const top = band.top + (band.bottom - band.top - quote.lines.length * lh) / 2;
    out.push(`<rect x="76" y="${num(top)}" width="5" height="${num(quote.lines.length * lh)}" fill="${C.ink}"/>`);
    quote.lines.forEach((l, i) => out.push(t.text(100, top + lh * i + lh * 0.5 + quote.style.size * 0.36, l, quote.style, C.ink)));
  }

  // Four numbers from the record.
  const st = statsOf(input.stats);
  const failed = st.missionsFailed;
  // Reviews shared before the record counted damage have only the list of what was lost.
  const damaged = Math.max(st.damaged, input.lost);
  const cells: [string, number, boolean][] = [
    [copy.stats.signedOff, st.missionsCompleted, false],
    [copy.stats.failed, failed, failed > 0],
    [copy.stats.commands, st.commands, false],
    [copy.stats.damaged, damaged, damaged > 0],
  ];
  const ry = 504;
  out.push(`<rect x="76" y="${ry}" width="${sw - 72}" height="2" fill="${C.ink}"/>`);
  const cellW = (sw - 72) / 4;
  cells.forEach(([k, n, bad], i) => {
    const cx = 76 + i * cellW;
    if (i) out.push(`<rect x="${num(cx - 14)}" y="${ry + 14}" width="1.5" height="60" fill="${C.rule}"/>`);
    const value = n > 9999 ? '9999+' : String(n);
    const big: Style = { chain: ['W755 Archivo Cond'], size: 60 };
    out.push(t.text(cx, ry + 70, value, big, bad ? C.stamp : C.ink));
    const lx = cx + t.width(value, big) + 12;
    const label = t.wrapFit(k, { chain: ch.bold, size: 18 }, cellW - (lx - cx) - 22, 2, 13);
    const lh = label.style.size * 1.22;
    const top = ry + 52 - ((label.lines.length - 1) * lh) / 2;
    label.lines.forEach((l, j) => out.push(t.text(lx, top + j * lh, l, label.style, bad ? C.stamp : C.inkSoft)));
  });

  return `${svgOpen()}<defs>${INK_FILTER}${t.defs()}</defs>${out.join('')}</svg>`;
}

// ---- the site's own card -----------------------------------------------------------------------

export interface HomeCardInput {
  avatar: string | null;
  /** The worker's model line on the badge. */
  subagent: string;
  issued: string;
  site: string;
}

export function homeCardSvg(input: HomeCardInput, shaper: Shaper): string {
  const t = new Typesetter(shaper, 'en');
  const out: string[] = [];
  out.push(paper());

  // The ID badge on its lanyard, tilted as on the start screen.
  const bw = 330;
  const bh = 500;
  const bx = 96;
  const by = 84;
  const k = bw / 300;
  out.push(`<g transform="rotate(-3 ${bx + bw / 2} -200)">`);
  out.push(`<pattern id="strap" width="28" height="19" patternUnits="userSpaceOnUse"><rect width="28" height="18" fill="${C.ink}"/><rect y="18" width="28" height="1" fill="${C.ink2}"/></pattern>`);
  out.push(`<rect x="${bx + bw / 2 - 14}" y="-40" width="28" height="${by + 64}" fill="url(#strap)"/>`);
  out.push(`<rect x="${bx + 4}" y="${by + 5}" width="${bw}" height="${bh}" rx="15" fill="${C.ink}" fill-opacity="0.12"/>`);
  out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="15" fill="#f8f9f5" stroke="${C.rule}" stroke-width="1.5"/>`);
  out.push(`<rect x="${bx + bw / 2 - 31}" y="${by + 13}" width="62" height="10" rx="5" fill="${C.paper}" stroke="${C.rule}" stroke-width="1"/>`);
  const org = by + 38;
  out.push(`<rect x="${bx}" y="${org}" width="${bw}" height="${32}" fill="${C.ink}"/>`);
  out.push(t.text(bx + 26, org + 22, 'Sandbox Operations', { chain: ['W755 Archivo Bold'], size: 14.5, spacing: 0.4 }, C.sheet));
  const ph = { w: 124 * k, h: 150 * k };
  const phx = bx + bw / 2 - ph.w / 2;
  const phy = org + 32 + 20;
  out.push(photo(phx, phy, ph.w, ph.h));
  out.push(placeAvatar(input.avatar, phx + (ph.w - 112 * k) / 2, phy + (ph.h - 112 * k) / 2 + 4, 112 * k));
  let y = phy + ph.h + 30;
  out.push(t.text(bx + bw / 2, y, 'Worker', { chain: ['W755 Archivo'], size: 17 }, C.inkSoft, 'middle'));
  y += 82;
  out.push(t.text(bx + bw / 2, y, '755', { chain: ['W755 Archivo Cond'], size: 104 }, C.ink, 'middle'));
  y += 32;
  out.push(t.text(bx + bw / 2, y, input.subagent, { chain: ['W755 Mono'], size: 15 }, C.ink, 'middle'));
  y += 30;
  const fields: [string, string][] = [['Role', 'Subagent'], ['Access', 'r-x'], ['Issued', input.issued]];
  const fx = [bx + 27, bx + 27 + 112, bx + bw - 27];
  fields.forEach(([k2, v], i) => {
    const anchor = i === 2 ? 'end' : 'start';
    out.push(t.text(fx[i], y, k2, { chain: ['W755 Archivo'], size: 13 }, C.inkFaint, anchor));
    out.push(t.text(fx[i], y + 19, v, { chain: ['W755 Archivo Bold'], size: 13.5 }, C.ink, anchor));
  });
  y += 38;
  // Barcode.
  const bars: string[] = [];
  let x = bx + 27;
  const pattern = [2, 2, 1, 3, 3, 1, 1, 2, 2, 1, 3, 2, 1, 1, 2, 3];
  for (let i = 0; x < bx + bw - 30; i++) {
    const w = pattern[i % pattern.length] * 1.3;
    if (i % 2 === 0) bars.push(`<rect x="${num(x)}" y="${y}" width="${num(w)}" height="32" fill="${C.ink}" fill-opacity="0.85"/>`);
    x += w + (i % 3) * 0.8;
  }
  out.push(bars.join(''));
  out.push(`</g>`);

  // Name and pitch.
  const rx = 520;
  const tag = tag755(t, rx + t.width('Worker ', { chain: ['W755 Archivo Bold'], size: 96 }), 238, 96);
  out.push(t.text(rx, 238, 'Worker', { chain: ['W755 Archivo Bold'], size: 96 }, C.ink));
  out.push(tag.svg);
  const lede: Style = { chain: ['W755 Archivo'], size: 40 };
  const { lines } = t.wrap('Your manager is an AI. It believes you are its subagent.', lede, 600, 3);
  lines.forEach((l, i) => out.push(t.text(rx, 330 + i * 54, l, lede, C.ink)));
  const after = 330 + lines.length * 54;
  out.push(t.text(rx, after + 28, input.site, { chain: ['W755 Mono'], size: 26 }, C.inkSoft));
  out.push(stamp(t, 'ON THE RECORD', { chain: ['W755 Archivo Cond'], size: 58, spacing: 2 }, 960, 530, 420, -5));
  return `${svgOpen()}<defs>${INK_FILTER}${t.defs()}</defs>${out.join('')}</svg>`;
}
