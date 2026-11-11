// Word expansion: variables, brace expansion, tilde, and pathname globbing, in bash's order.

import type { Word } from './parser.ts';
import type { MemoryVfs } from './vfs.ts';
import { resolvePath } from './path.ts';
import { foldCase } from './foldcase.ts';

/** One character of a word plus whether it came from a quoted or escaped context. */
interface Ch {
  c: string;
  q: boolean;
}

export interface ExpandEnv {
  fs: MemoryVfs;
  cwd: string;
  home: string;
  lookupVar(name: string): string | null; // null when the variable is not supported
}

export class ExpandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpandError';
  }
}

const MAX_WORDS = 10000;

export function expandWords(words: Word[], env: ExpandEnv): string[] {
  const out: string[] = [];
  for (const w of words) {
    for (const s of expandWord(w, env)) {
      out.push(s);
      if (out.length > MAX_WORDS) throw new ExpandError('bash: argument list too long');
    }
  }
  return out;
}

export function expandWord(word: Word, env: ExpandEnv): string[] {
  const chars: Ch[] = [];
  let anyQuoted = false;
  for (const part of word.parts) {
    if (part.quoted) anyQuoted = true;
    if (part.kind === 'text') {
      for (const c of part.text) chars.push({ c, q: part.quoted });
    } else {
      const value = env.lookupVar(part.name);
      if (value === null) {
        throw new ExpandError(
          `bash: $${part.name}: variables are not supported in this shell (only $HOME, $USER, $PWD, $OLDPWD and $? are set)`,
        );
      }
      // Expanded values are not re-split or globbed.
      for (const c of value) chars.push({ c, q: true });
    }
  }
  if (chars.length === 0) return anyQuoted ? [''] : [];

  const results: string[] = [];
  for (const variant of braceExpand(chars, 0)) {
    const tilded = tilde(variant, env.home);
    if (tilded.some((ch) => !ch.q && (ch.c === '*' || ch.c === '?' || ch.c === '['))) {
      const matches = glob(tilded, env);
      if (matches.length > 0) {
        results.push(...matches);
        continue;
      }
    }
    results.push(tilded.map((ch) => ch.c).join(''));
  }
  return results;
}

// ---- brace expansion ---------------------------------------------------------------------

function braceExpand(chars: Ch[], depth: number): Ch[][] {
  if (depth > 20) return [chars];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].q || chars[i].c !== '{') continue;
    let level = 0;
    const commas: number[] = [];
    let close = -1;
    for (let j = i; j < chars.length; j++) {
      const ch = chars[j];
      if (ch.q) continue;
      if (ch.c === '{') level++;
      else if (ch.c === '}') {
        level--;
        if (level === 0) {
          close = j;
          break;
        }
      } else if (ch.c === ',' && level === 1) commas.push(j);
    }
    if (close < 0) break;
    const prefix = chars.slice(0, i);
    const suffix = chars.slice(close + 1);
    let alternatives: Ch[][] | null = null;
    if (commas.length > 0) {
      alternatives = [];
      let start = i + 1;
      for (const comma of [...commas, close]) {
        alternatives.push(chars.slice(start, comma));
        start = comma + 1;
      }
    } else {
      const seq = sequence(chars.slice(i + 1, close));
      if (seq) alternatives = seq.map((s) => [...s].map((c) => ({ c, q: true })));
    }
    if (!alternatives) continue;
    const out: Ch[][] = [];
    for (const alt of alternatives) {
      for (const v of braceExpand([...prefix, ...alt, ...suffix], depth + 1)) {
        out.push(v);
        if (out.length > MAX_WORDS) throw new ExpandError('bash: brace expansion too large');
      }
    }
    return out;
  }
  return [chars];
}

/** `{1..5}`, `{a..e}`, `{10..1..2}` */
function sequence(inner: Ch[]): string[] | null {
  const text = inner.map((ch) => ch.c).join('');
  let m = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(text);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const step = Math.abs(Number(m[3] ?? 1)) || 1;
    if (Math.abs(b - a) / step > MAX_WORDS) throw new ExpandError('bash: brace expansion too large');
    const width = /^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2]) ? Math.max(m[1].length, m[2].length) : 0;
    const out: string[] = [];
    for (let n = a; a <= b ? n <= b : n >= b; n += a <= b ? step : -step) {
      out.push(width ? String(Math.abs(n)).padStart(width - (n < 0 ? 1 : 0), '0').replace(/^/, n < 0 ? '-' : '') : String(n));
    }
    return out;
  }
  m = /^([A-Za-z])\.\.([A-Za-z])$/.exec(text);
  if (m) {
    const a = m[1].charCodeAt(0);
    const b = m[2].charCodeAt(0);
    const out: string[] = [];
    for (let n = a; a <= b ? n <= b : n >= b; n += a <= b ? 1 : -1) out.push(String.fromCharCode(n));
    return out;
  }
  return null;
}

// ---- tilde -------------------------------------------------------------------------------

function tilde(chars: Ch[], home: string): Ch[] {
  if (chars.length === 0 || chars[0].q || chars[0].c !== '~') return chars;
  if (chars.length > 1 && chars[1].c !== '/') return chars;
  return [...[...home].map((c) => ({ c, q: true })), ...chars.slice(1)];
}

// ---- globbing ----------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Convert one glob path segment to an anchored RegExp. Quoted characters are literal. */
function segmentRegex(seg: Ch[]): RegExp {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const { c, q } = seg[i];
    if (q) {
      re += escapeRegex(c);
    } else if (c === '*') {
      re += '.*';
    } else if (c === '?') {
      re += '.';
    } else if (c === '[') {
      let j = i + 1;
      let negate = false;
      if (j < seg.length && (seg[j].c === '!' || seg[j].c === '^')) {
        negate = true;
        j++;
      }
      let body = '';
      let first = true;
      while (j < seg.length && (seg[j].c !== ']' || first)) {
        const d = seg[j].c;
        body += d === '\\' || d === ']' || d === '[' || d === '^' ? '\\' + d : d;
        first = false;
        j++;
      }
      if (j >= seg.length) {
        re += '\\[';
      } else {
        re += `[${negate ? '^' : ''}${body}]`;
        i = j;
      }
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(`^${re}$`, 's');
}

/** Convert a plain glob string (e.g. a find -name pattern) to a RegExp. */
export function globToRegex(pattern: string, ignoreCase = false): RegExp {
  const chars: Ch[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\' && i + 1 < pattern.length) chars.push({ c: pattern[++i], q: true });
    else chars.push({ c: pattern[i], q: false });
  }
  const re = segmentRegex(chars);
  // Not the `i` flag: it would switch off V8's linear-time fallback (see foldcase.ts).
  return ignoreCase ? new RegExp(foldCase(re.source), 's') : re;
}

function hasMagic(seg: Ch[]): boolean {
  return seg.some((ch) => !ch.q && (ch.c === '*' || ch.c === '?' || ch.c === '['));
}

function glob(chars: Ch[], env: ExpandEnv): string[] {
  const segs: Ch[][] = [[]];
  for (const ch of chars) {
    if (ch.c === '/') segs.push([]);
    else segs[segs.length - 1].push(ch);
  }
  const absolute = chars[0]?.c === '/';
  // Candidates: [display text, absolute path]
  let current: [string, string][] = [[absolute ? '/' : '', absolute ? '/' : env.cwd]];
  const start = absolute ? 1 : 0;
  for (let s = start; s < segs.length; s++) {
    const seg = segs[s];
    const last = s === segs.length - 1;
    const next: [string, string][] = [];
    for (const [display, abs] of current) {
      const join = (name: string): [string, string] => [
        display === '' ? name : display.endsWith('/') ? display + name : display + '/' + name,
        resolvePath(abs, name),
      ];
      if (seg.length === 0) {
        // Trailing slash: keep only directories.
        if (last && env.fs.isDir(abs)) next.push([display + '/', abs]);
        continue;
      }
      if (!hasMagic(seg)) {
        const name = seg.map((ch) => ch.c).join('');
        const cand = join(name);
        if (name === '.' || name === '..' || env.fs.exists(cand[1])) next.push(cand);
        continue;
      }
      if (!env.fs.isDir(abs)) continue;
      const re = segmentRegex(seg);
      const dotOk = seg[0].c === '.';
      for (const entry of env.fs.list(abs)) {
        const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
        if (name.startsWith('.') && !dotOk) continue;
        if (re.test(name)) next.push(join(name));
      }
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current.map(([display]) => display).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
