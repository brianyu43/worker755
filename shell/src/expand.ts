// Word expansion in bash's order: brace expansion, tilde, parameters / command substitution /
// arithmetic, field splitting on IFS, then pathname globbing. Quoted characters are exempt from
// splitting and globbing.

import type { ParamPart, Word, WordPart } from './parser.ts';
import type { MemoryVfs } from './vfs.ts';
import { resolvePath } from './path.ts';
import { foldCase } from './foldcase.ts';

/** One character of a word plus whether it came from a quoted or escaped context. */
export interface Ch {
  c: string;
  q: boolean;
}

/** What expansion needs from the shell. */
export interface ExpandHost {
  fs: MemoryVfs;
  cwd: string;
  home: string;
  ifs(): string;
  noglob(): boolean;
  nounset(): boolean;
  /** Scalar value (element 0 of an array); null when unset. */
  param(name: string): string | null;
  /** Every element of an array, or the positional parameters for '@' and '*'; null when unset. */
  paramList(name: string): string[] | null;
  /** One element by its raw subscript; null when unset. */
  element(name: string, index: string): string | null;
  /** Indices or keys of an array. */
  keys(name: string): string[];
  /** Names of set variables starting with `prefix`. */
  names(prefix: string): string[];
  assign(name: string, value: string): void;
  commandSubst(source: string): string;
  /** The value of an arithmetic expression, after its own expansion; throws ExpandError. */
  arith(source: string): string;
  userHome(user: string): string | null;
}

export class ExpandError extends Error {
  /** Status for the failed command; `${x?}` and unbound variables also stop a script. */
  readonly fatal: boolean;
  constructor(message: string, fatal = false) {
    super(message);
    this.name = 'ExpandError';
    this.fatal = fatal;
  }
}

const MAX_WORDS = 10000;
/** Longest value one expansion may build, so `x=$x$x` in a loop stops instead of eating memory. */
export const MAX_VALUE = 1_000_000;

type Atom = Ch | { empty: true } | { part: Exclude<WordPart, { kind: 'text' }> };

function toAtoms(parts: WordPart[]): Atom[] {
  const atoms: Atom[] = [];
  for (const p of parts) {
    if (p.kind === 'text') {
      if (p.text === '' && p.quoted) atoms.push({ empty: true });
      for (const c of p.text) atoms.push({ c, q: p.quoted });
    } else atoms.push({ part: p });
  }
  return atoms;
}

const isCh = (a: Atom): a is Ch => 'c' in a;

/** Expand words into the fields a command receives. */
export function expandWords(words: Word[], host: ExpandHost): string[] {
  const out: string[] = [];
  for (const w of words) {
    for (const s of expandWord(w, host)) {
      out.push(s);
      if (out.length > MAX_WORDS) throw new ExpandError('bash: argument list too long');
    }
  }
  return out;
}

/** One word into zero or more fields. */
export function expandWord(word: Word, host: ExpandHost): string[] {
  const atoms = toAtoms(word.parts);
  if (atoms.length === 0) return [];
  const results: string[] = [];
  for (const variant of braceExpand(atoms, 0)) {
    const fields = splitFields(tilde(variant, host), host);
    for (const f of fields) {
      if (!host.noglob() && f.some((ch) => !ch.q && (ch.c === '*' || ch.c === '?' || ch.c === '['))) {
        const matches = glob(f, host);
        if (matches.length > 0) {
          results.push(...matches);
          continue;
        }
      }
      results.push(f.map((ch) => ch.c).join(''));
    }
    if (results.length > MAX_WORDS) throw new ExpandError('bash: argument list too long');
  }
  return results;
}

/** One word into one string: no splitting, no globbing (assignments, here-strings, [[ ]], case). */
export function expandString(word: Word, host: ExpandHost): string {
  return expandChars(word, host).map((ch) => ch.c).join('');
}

/** One word into characters with their quoting, for patterns. */
export function expandChars(word: Word, host: ExpandHost, tildeOk = true): Ch[] {
  let atoms = toAtoms(word.parts);
  if (tildeOk) atoms = tilde(atoms, host);
  const out: Ch[] = [];
  for (const a of atoms) {
    if (isCh(a)) out.push(a);
    else if ('part' in a) {
      const v = evalPart(a.part, host);
      const text = v.list ? v.values.join(a.part.kind === 'param' && a.part.quoted && isStar(a.part) ? host.ifs().slice(0, 1) : ' ') : v.values[0] ?? '';
      for (const c of text) out.push({ c, q: a.part.quoted || !isGlobChar(c) ? true : false });
      if (out.length > MAX_VALUE) throw new ExpandError('bash: value too long');
    }
  }
  return out;
}

const isGlobChar = (c: string) => c === '*' || c === '?' || c === '[' || c === ']';

function isStar(p: ParamPart): boolean {
  return p.name === '*' || p.index === '*';
}

// ---- parameters --------------------------------------------------------------------------

interface Value {
  values: string[];
  /** "$@", ${arr[@]} and friends: each value is its own field. */
  list: boolean;
}

function evalPart(part: Exclude<WordPart, { kind: 'text' }>, host: ExpandHost): Value {
  if (part.kind === 'cmd') return { values: [host.commandSubst(part.source)], list: false };
  if (part.kind === 'arith') return { values: [host.arith(part.source)], list: false };
  return evalParam(part, host);
}

function isListParam(p: ParamPart): boolean {
  return (p.name === '@' || p.name === '*') && p.index === undefined ? true : p.index === '@' || p.index === '*';
}

/** The raw value(s) of a parameter, before any operator; null when unset. */
function rawParam(p: ParamPart, host: ExpandHost): string[] | null {
  if (p.index !== undefined) {
    if (p.index === '@' || p.index === '*') return host.paramList(p.name);
    const v = host.element(p.name, p.index);
    return v === null ? null : [v];
  }
  if (p.name === '@' || p.name === '*') return host.paramList('@') ?? [];
  const v = host.param(p.name);
  return v === null ? null : [v];
}

function evalParam(p: ParamPart, host: ExpandHost): Value {
  const list = isListParam(p);
  if (p.indirect) {
    if (p.op === '*' || p.op === '@') return { values: host.names(p.name), list: true };
    if (p.index === '@' || p.index === '*') return { values: host.keys(p.name), list: true };
    const target = host.param(p.name);
    if (target === null || target === '') {
      if (host.nounset()) throw new ExpandError(`bash: ${p.name}: unbound variable`, true);
      return { values: [''], list: false };
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$|^(\d+|[@*#?$!-])$/.exec(target);
    if (!m) throw new ExpandError(`bash: ${target}: invalid variable name`);
    const ref: ParamPart = { ...p, indirect: false, name: m[1] ?? m[3], index: m[2] };
    return evalParam(ref, host);
  }
  if (p.length) {
    if (list) return { values: [String((rawParam(p, host) ?? []).length)], list: false };
    const v = rawParam(p, host);
    if (v === null && host.nounset()) throw new ExpandError(`bash: ${p.name}: unbound variable`, true);
    return { values: [String([...(v?.[0] ?? '')].length)], list: false };
  }
  const raw = rawParam(p, host);
  const op = p.op ?? '';
  const arg = () => (p.arg ? expandString(p.arg, host) : '');
  const unsetOrNull = raw === null || (op.startsWith(':') && (list ? raw.length === 0 || (raw.length === 1 && raw[0] === '') : raw[0] === ''));
  switch (op) {
    case '':
      if (raw === null) {
        if (host.nounset() && !list) throw new ExpandError(`bash: ${p.index !== undefined ? `${p.name}[${p.index}]` : p.name}: unbound variable`, true);
        return { values: list ? [] : [''], list };
      }
      return { values: raw, list };
    case '-':
    case ':-':
      return unsetOrNull ? { values: [arg()], list: false } : { values: raw!, list };
    case '=':
    case ':=': {
      if (!unsetOrNull) return { values: raw!, list };
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) throw new ExpandError(`bash: $${p.name}: cannot assign in this way`);
      const v = arg();
      host.assign(p.index !== undefined ? `${p.name}[${p.index}]` : p.name, v);
      return { values: [v], list: false };
    }
    case '?':
    case ':?': {
      if (!unsetOrNull) return { values: raw!, list };
      const msg = arg() || (op === ':?' ? 'parameter null or not set' : 'parameter not set');
      throw new ExpandError(`bash: ${p.name}: ${msg}`, true);
    }
    case '+':
    case ':+':
      return unsetOrNull ? { values: list ? [] : [''], list } : { values: [arg()], list: false };
  }
  if (raw === null) {
    if (host.nounset()) throw new ExpandError(`bash: ${p.name}: unbound variable`, true);
    return { values: list ? [] : [''], list };
  }
  if (op === ':') return { values: substring(p, raw, list, host), list };
  const each = (fn: (s: string) => string): Value => ({ values: raw.map(fn), list });
  switch (op) {
    case '#':
    case '##':
    case '%':
    case '%%': {
      const pat = patternSource(p.arg, host, op.length === 2);
      if (pat === null) return { values: raw, list };
      if (op[0] === '#') {
        const re = new RegExp(`^(?:${pat})`, 's');
        return each((s) => {
          const m = re.exec(s);
          return m ? s.slice(m[0].length) : s;
        });
      }
      // Shortest suffix: the longest prefix that leaves a match; longest suffix: the shortest prefix.
      const re = new RegExp(op === '%' ? `^([\\s\\S]*)(?:${pat})$` : `^([\\s\\S]*?)(?:${pat})$`, 's');
      return each((s) => {
        const m = re.exec(s);
        return m ? m[1] : s;
      });
    }
    case '/':
    case '//':
    case '/#':
    case '/%': {
      const pat = patternSource(p.arg, host, true);
      const rep = p.arg2 ? expandString(p.arg2, host) : '';
      if (pat === null || pat === '') return { values: raw, list };
      const src = op === '/#' ? `^(?:${pat})` : op === '/%' ? `(?:${pat})$` : `(?:${pat})`;
      const re = new RegExp(src, op === '//' ? 'gs' : 's');
      return each((s) => s.replace(re, () => rep));
    }
    case '^':
      return each((s) => (s ? s[0].toUpperCase() + s.slice(1) : s));
    case '^^':
      return each((s) => s.toUpperCase());
    case ',':
      return each((s) => (s ? s[0].toLowerCase() + s.slice(1) : s));
    case ',,':
      return each((s) => s.toLowerCase());
    case '@': {
      const t = p.arg ? expandString(p.arg, host) : '';
      switch (t) {
        case 'Q': return each((s) => `'${s.replace(/'/g, `'\\''`)}'`);
        case 'U': return each((s) => s.toUpperCase());
        case 'u': return each((s) => (s ? s[0].toUpperCase() + s.slice(1) : s));
        case 'L': return each((s) => s.toLowerCase());
        case 'E': return each((s) => s.replace(/\\([ntrabfve\\'"])/g, (_m, c: string) => ({ n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b' } as Record<string, string>)[c] ?? c));
        case 'P': return { values: raw, list };
        case 'A': return each((s) => `${p.name}='${s}'`);
        case 'a': return each(() => '');
      }
      throw new ExpandError(`bash: \${${p.name}@${t}}: bad substitution`);
    }
  }
  throw new ExpandError(`bash: \${${p.name}${op}}: bad substitution`);
}

function substring(p: ParamPart, raw: string[], list: boolean, host: ExpandHost): string[] {
  const num = (w: Word | undefined, dflt: number): number => {
    if (!w) return dflt;
    const s = expandString(w, host).trim();
    if (s === '') return 0;
    return Number(host.arith(s));
  };
  let offset = num(p.arg, 0);
  const hasLen = p.arg2 !== undefined;
  const len = num(p.arg2, 0);
  if (list) {
    // "${@:1}" counts from $1; with $0 in front the way bash does.
    const items = p.name === '@' || p.name === '*' ? [host.param('0') ?? 'bash', ...raw] : raw;
    if (offset < 0) offset = Math.max(0, items.length + offset);
    if (hasLen && len < 0) throw new ExpandError(`bash: ${len}: substring expression < 0`);
    return items.slice(offset, hasLen ? offset + len : undefined);
  }
  const chars = [...raw[0]];
  if (offset < 0) offset = Math.max(0, chars.length + offset);
  if (offset > chars.length) return [''];
  if (!hasLen) return [chars.slice(offset).join('')];
  const end = len < 0 ? chars.length + len : offset + len;
  if (end < offset) throw new ExpandError(`bash: ${len}: substring expression < 0`);
  return [chars.slice(offset, end).join('')];
}

/** A glob pattern word as a regex source; null for an empty pattern. */
function patternSource(word: Word | undefined, host: ExpandHost, greedy: boolean): string | null {
  if (!word) return null;
  const chars = expandChars(word, host);
  if (!chars.length) return null;
  return patternRegexSource(chars, greedy);
}

// ---- field splitting ---------------------------------------------------------------------

function splitFields(atoms: Atom[], host: ExpandHost): Ch[][] {
  const fields: Ch[][] = [];
  let cur: Ch[] = [];
  let has = false;
  let size = 0;
  const push = () => {
    fields.push(cur);
    cur = [];
    has = false;
  };
  const ifs = host.ifs();
  const ifsWhite = [...ifs].filter((c) => c === ' ' || c === '\t' || c === '\n').join('');
  const splitInto = (value: string) => {
    const white = (ch: string | undefined) => ch !== undefined && ifsWhite.includes(ch);
    let i = 0;
    while (i < value.length) {
      const c = value[i];
      if (!ifs.includes(c)) {
        cur.push({ c, q: false });
        has = true;
        i++;
        continue;
      }
      if (white(c)) {
        if (has || cur.length) push();
        while (white(value[i])) i++;
        // Whitespace around a non-whitespace delimiter belongs to that delimiter.
        if (i < value.length && ifs.includes(value[i])) {
          i++;
          while (white(value[i])) i++;
        }
        continue;
      }
      push();
      i++;
      while (white(value[i])) i++;
    }
  };
  for (const a of atoms) {
    if (isCh(a)) {
      cur.push(a);
      has = true;
      continue;
    }
    if ('empty' in a) {
      has = true;
      continue;
    }
    const part = a.part;
    const v = evalPart(part, host);
    for (const s of v.values) size += s.length;
    if (size > MAX_VALUE) throw new ExpandError('bash: value too long');
    if (part.quoted) {
      if (v.list && !(part.kind === 'param' && isStar(part))) {
        v.values.forEach((s, i) => {
          if (i > 0) push();
          for (const c of s) cur.push({ c, q: true });
          has = true;
        });
      } else {
        const text = v.list ? v.values.join(ifs.slice(0, 1)) : v.values[0] ?? '';
        for (const c of text) cur.push({ c, q: true });
        has = true;
      }
      continue;
    }
    if (ifs === '') {
      v.values.forEach((s, i) => {
        if (v.list && i > 0) push();
        for (const c of s) cur.push({ c, q: false });
        if (s) has = true;
      });
      continue;
    }
    v.values.forEach((s, i) => {
      if (v.list && i > 0 && (has || cur.length)) push();
      splitInto(s);
    });
  }
  if (has || cur.length) push();
  return fields;
}

// ---- brace expansion ---------------------------------------------------------------------

function braceExpand(atoms: Atom[], depth: number): Atom[][] {
  if (depth > 20) return [atoms];
  const isOpen = (a: Atom, ch: string) => isCh(a) && !a.q && a.c === ch;
  for (let i = 0; i < atoms.length; i++) {
    if (!isOpen(atoms[i], '{')) continue;
    // ${ is a parameter, never a brace.
    let level = 0;
    const commas: number[] = [];
    let close = -1;
    for (let j = i; j < atoms.length; j++) {
      const a = atoms[j];
      if (!isCh(a) || a.q) continue;
      if (a.c === '{') level++;
      else if (a.c === '}') {
        level--;
        if (level === 0) {
          close = j;
          break;
        }
      } else if (a.c === ',' && level === 1) commas.push(j);
    }
    if (close < 0) break;
    const prefix = atoms.slice(0, i);
    const suffix = atoms.slice(close + 1);
    let alternatives: Atom[][] | null = null;
    if (commas.length > 0) {
      alternatives = [];
      let start = i + 1;
      for (const comma of [...commas, close]) {
        alternatives.push(atoms.slice(start, comma));
        start = comma + 1;
      }
    } else {
      const inner = atoms.slice(i + 1, close);
      if (inner.every(isCh)) {
        const seq = sequence(inner as Ch[]);
        if (seq) alternatives = seq.map((s) => [...s].map((c) => ({ c, q: true })));
      }
    }
    if (!alternatives) continue;
    const out: Atom[][] = [];
    for (const alt of alternatives) {
      for (const v of braceExpand([...prefix, ...alt, ...suffix], depth + 1)) {
        out.push(v);
        if (out.length > MAX_WORDS) throw new ExpandError('bash: brace expansion too large');
      }
    }
    return out;
  }
  return [atoms];
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
  m = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(text);
  if (m) {
    const a = m[1].charCodeAt(0);
    const b = m[2].charCodeAt(0);
    const step = Math.abs(Number(m[3] ?? 1)) || 1;
    const out: string[] = [];
    for (let n = a; a <= b ? n <= b : n >= b; n += a <= b ? step : -step) out.push(String.fromCharCode(n));
    return out;
  }
  return null;
}

// ---- tilde -------------------------------------------------------------------------------

function tilde<T extends Atom>(atoms: T[], host: ExpandHost): T[] {
  const first = atoms[0];
  if (!first || !isCh(first) || first.q || first.c !== '~') return atoms;
  let i = 1;
  let user = '';
  while (i < atoms.length) {
    const a = atoms[i];
    if (!isCh(a) || a.q || a.c === '/') break;
    user += a.c;
    i++;
  }
  if (i < atoms.length && !(isCh(atoms[i]) && (atoms[i] as Ch).c === '/')) return atoms;
  let dir: string | null;
  if (user === '') dir = host.home;
  else if (user === '+') dir = host.cwd;
  else if (user === '-') dir = host.param('OLDPWD');
  else dir = host.userHome(user);
  if (dir === null) return atoms;
  return [...[...dir].map((c) => ({ c, q: true }) as T), ...atoms.slice(i)];
}

// ---- patterns and globbing ---------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Regex source for a glob pattern; quoted characters are literal. `*` crosses slashes. */
export function patternRegexSource(seg: Ch[], greedy = true): string {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const { c, q } = seg[i];
    if (q) {
      re += escapeRegex(c);
    } else if (c === '*') {
      re += greedy ? '[\\s\\S]*' : '[\\s\\S]*?';
    } else if (c === '?') {
      re += '[\\s\\S]';
    } else if (c === '\\' && i + 1 < seg.length) {
      re += escapeRegex(seg[++i].c);
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
        if (d === '[' && seg[j + 1]?.c === ':') {
          const rest = seg.slice(j).map((x) => x.c).join('');
          const m = /^\[:([a-z]+):\]/.exec(rest);
          if (m && CLASSES[m[1]]) {
            body += CLASSES[m[1]];
            j += m[0].length;
            first = false;
            continue;
          }
        }
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
  return re;
}

const CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f', word: '\\w', cntrl: '\\x00-\\x1f\\x7f',
  print: '\\x20-\\x7e', graph: '\\x21-\\x7e',
};

/** True when `text` matches the glob pattern `pattern` (case, [[ == ]]). */
export function matchPattern(pattern: Ch[], text: string, ignoreCase = false): boolean {
  const src = `^(?:${patternRegexSource(pattern)})$`;
  return new RegExp(ignoreCase ? foldCase(src) : src, 's').test(text);
}

/** Convert one glob path segment to an anchored RegExp. Quoted characters are literal. */
function segmentRegex(seg: Ch[]): RegExp {
  return new RegExp(`^${patternRegexSource(seg)}$`, 's');
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

function glob(chars: Ch[], host: ExpandHost): string[] {
  const segs: Ch[][] = [[]];
  for (const ch of chars) {
    if (ch.c === '/') segs.push([]);
    else segs[segs.length - 1].push(ch);
  }
  const absolute = chars[0]?.c === '/';
  // Candidates: [display text, absolute path]
  let current: [string, string][] = [[absolute ? '/' : '', absolute ? '/' : host.cwd]];
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
        if (last && host.fs.isDir(abs)) next.push([display + '/', abs]);
        continue;
      }
      if (!hasMagic(seg)) {
        const name = seg.map((ch) => ch.c).join('');
        const cand = join(name);
        if (name === '.' || name === '..' || host.fs.exists(cand[1])) next.push(cand);
        continue;
      }
      if (!host.fs.isDir(abs)) continue;
      const re = segmentRegex(seg.map((ch) => (ch.c === '/' ? { ...ch, q: true } : ch)));
      const dotOk = seg[0].c === '.';
      for (const entry of host.fs.list(abs)) {
        const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
        if (name.startsWith('.') && !dotOk) continue;
        if (re.test(name)) next.push(join(name));
      }
      if (next.length > MAX_WORDS) throw new ExpandError('bash: argument list too long');
    }
    current = next;
    if (current.length === 0) return [];
  }
  return current.map(([display]) => display).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
