// Built-in SQL functions: scalars, aggregates, date/time and printf.

import type { SqlValue } from './errors.ts';
import { MAX_LENGTH, tooBig } from './errors.ts';
import { compareValues, glob, like, sqlLiteral, toNumber, toText } from './values.ts';

export interface FnContext {
  now(): number; // ms since the epoch, stable within a statement
  changes(): number;
  totalChanges(): number;
  lastInsertRowid(): number;
}

export interface ScalarFn {
  min: number;
  max: number; // -1: any number
  real?: boolean; // result is a REAL
  fn: (args: SqlValue[], ctx: FnContext) => SqlValue;
}

const text = (v: SqlValue): string => toText(v) ?? '';
const asciiUpper = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Characters (code points) of a string, as sqlite counts them. */
const chars = (s: string): string[] => Array.from(s);

function substr(args: SqlValue[]): SqlValue {
  if (args[0] === null || args[1] === null || (args.length > 2 && args[2] === null)) return null;
  const s = chars(text(args[0]));
  let start = Math.trunc(toNumber(args[1]));
  let len = args.length > 2 ? Math.trunc(toNumber(args[2])) : Number.MAX_SAFE_INTEGER;
  if (start < 0) start = s.length + start + 1;
  else if (start === 0) {
    start = 1;
    len -= 1;
  }
  if (len < 0) {
    start += len;
    len = -len;
    if (start < 1) {
      len += start - 1;
      start = 1;
    }
  }
  if (start < 1) {
    len += start - 1;
    start = 1;
  }
  if (len <= 0) return '';
  return s.slice(start - 1, start - 1 + len).join('');
}

function trimChars(s: string, set: string, left: boolean, right: boolean): string {
  const cs = new Set(chars(set));
  const a = chars(s);
  let i = 0;
  let j = a.length;
  if (left) while (i < j && cs.has(a[i])) i++;
  if (right) while (j > i && cs.has(a[j - 1])) j--;
  return a.slice(i, j).join('');
}

function trimFn(left: boolean, right: boolean): ScalarFn {
  return {
    min: 1,
    max: 2,
    fn: (a) => {
      if (a[0] === null || (a.length > 1 && a[1] === null)) return null;
      return trimChars(text(a[0]), a.length > 1 ? text(a[1]) : ' ', left, right);
    },
  };
}

function round(a: SqlValue[]): SqlValue {
  if (a[0] === null) return null;
  const x = toNumber(a[0]);
  const n = a.length > 1 && a[1] !== null ? Math.max(0, Math.min(30, Math.trunc(toNumber(a[1])))) : 0;
  const p = 10 ** n;
  const r = Math.round(Math.abs(x) * p + 1e-9 * (n > 0 ? 1 : 0)) / p;
  return x < 0 ? -r : r;
}

function utf8Hex(s: string): string {
  let out = '';
  for (const b of new TextEncoder().encode(s)) out += b.toString(16).toUpperCase().padStart(2, '0');
  return out;
}

export const SCALARS: Record<string, ScalarFn> = {
  lower: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : asciiLower(text(a[0]))) },
  upper: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : asciiUpper(text(a[0]))) },
  length: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : chars(text(a[0])).length) },
  octet_length: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : new TextEncoder().encode(text(a[0])).length) },
  substr: { min: 2, max: 3, fn: substr },
  substring: { min: 2, max: 3, fn: substr },
  trim: trimFn(true, true),
  ltrim: trimFn(true, false),
  rtrim: trimFn(false, true),
  replace: {
    min: 3,
    max: 3,
    fn: (a) => {
      if (a[0] === null || a[1] === null || a[2] === null) return null;
      const from = text(a[1]);
      return from === '' ? text(a[0]) : text(a[0]).split(from).join(text(a[2]));
    },
  },
  instr: {
    min: 2,
    max: 2,
    fn: (a) => {
      if (a[0] === null || a[1] === null) return null;
      const i = text(a[0]).indexOf(text(a[1]));
      return i < 0 ? 0 : chars(text(a[0]).slice(0, i)).length + 1;
    },
  },
  coalesce: { min: 2, max: -1, fn: (a) => a.find((v) => v !== null) ?? null },
  ifnull: { min: 2, max: 2, fn: (a) => (a[0] !== null ? a[0] : a[1]) },
  nullif: { min: 2, max: 2, fn: (a) => (compareValues(a[0], a[1]) === 0 && a[0] !== null ? null : a[0]) },
  iif: { min: 3, max: 3, fn: (a) => (a[0] !== null && toNumber(a[0]) !== 0 ? a[1] : a[2]) },
  abs: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : Math.abs(toNumber(a[0]))) },
  sign: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : Math.sign(toNumber(a[0]))) },
  round: { min: 1, max: 2, real: true, fn: round },
  ceil: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : Math.ceil(toNumber(a[0]))) },
  ceiling: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : Math.ceil(toNumber(a[0]))) },
  floor: { min: 1, max: 1, fn: (a) => (a[0] === null ? null : Math.floor(toNumber(a[0]))) },
  sqrt: { min: 1, max: 1, real: true, fn: (a) => (a[0] === null || toNumber(a[0]) < 0 ? null : Math.sqrt(toNumber(a[0]))) },
  power: { min: 2, max: 2, real: true, fn: (a) => (a[0] === null || a[1] === null ? null : toNumber(a[0]) ** toNumber(a[1])) },
  pow: { min: 2, max: 2, real: true, fn: (a) => (a[0] === null || a[1] === null ? null : toNumber(a[0]) ** toNumber(a[1])) },
  mod: { min: 2, max: 2, real: true, fn: (a) => (a[0] === null || a[1] === null || toNumber(a[1]) === 0 ? null : toNumber(a[0]) % toNumber(a[1])) },
  min: {
    min: 2,
    max: -1,
    fn: (a) => {
      if (a.some((v) => v === null)) return null;
      return a.reduce((m, v) => (compareValues(v, m) < 0 ? v : m));
    },
  },
  max: {
    min: 2,
    max: -1,
    fn: (a) => {
      if (a.some((v) => v === null)) return null;
      return a.reduce((m, v) => (compareValues(v, m) > 0 ? v : m));
    },
  },
  typeof: { min: 1, max: 1, fn: (a) => (a[0] === null ? 'null' : typeof a[0] === 'string' ? 'text' : Number.isInteger(a[0]) ? 'integer' : 'real') },
  printf: { min: 1, max: -1, fn: (a) => (a[0] === null ? null : sqlPrintf(text(a[0]), a.slice(1))) },
  format: { min: 1, max: -1, fn: (a) => (a[0] === null ? null : sqlPrintf(text(a[0]), a.slice(1))) },
  random: { min: 0, max: 0, fn: () => Math.floor((Math.random() - 0.5) * 2 ** 53) },
  randomblob: {
    min: 1,
    max: 1,
    fn: (a) => {
      const n = Math.max(1, toNumber(a[0]));
      if (n > MAX_LENGTH) throw tooBig();
      return Array.from({ length: n }, () => String.fromCharCode(Math.floor(Math.random() * 256))).join('');
    },
  },
  hex: { min: 1, max: 1, fn: (a) => (a[0] === null ? '' : utf8Hex(text(a[0]))) },
  quote: { min: 1, max: 1, fn: (a) => sqlLiteral(a[0]) },
  char: { min: 0, max: -1, fn: (a) => a.map((v) => String.fromCodePoint(Math.max(0, Math.trunc(toNumber(v))))).join('') },
  unicode: { min: 1, max: 1, fn: (a) => (a[0] === null || text(a[0]) === '' ? null : text(a[0]).codePointAt(0)!) },
  concat: { min: 1, max: -1, fn: (a) => a.map((v) => toText(v) ?? '').join('') },
  concat_ws: {
    min: 2,
    max: -1,
    fn: (a) => (a[0] === null ? null : a.slice(1).filter((v) => v !== null).map(text).join(text(a[0]))),
  },
  like: { min: 2, max: 3, fn: (a) => (a[0] === null || a[1] === null ? null : like(text(a[0]), text(a[1]), a.length > 2 ? text(a[2]) : null) ? 1 : 0) },
  glob: { min: 2, max: 2, fn: (a) => (a[0] === null || a[1] === null ? null : glob(text(a[0]), text(a[1])) ? 1 : 0) },
  likely: { min: 1, max: 1, fn: (a) => a[0] },
  unlikely: { min: 1, max: 1, fn: (a) => a[0] },
  likelihood: { min: 2, max: 2, fn: (a) => a[0] },
  zeroblob: {
    min: 1,
    max: 1,
    fn: (a) => {
      const n = Math.max(0, toNumber(a[0]));
      if (n > MAX_LENGTH) throw tooBig();
      return '\u0000'.repeat(n);
    },
  },
  changes: { min: 0, max: 0, fn: (_a, c) => c.changes() },
  total_changes: { min: 0, max: 0, fn: (_a, c) => c.totalChanges() },
  last_insert_rowid: { min: 0, max: 0, fn: (_a, c) => c.lastInsertRowid() },
  sqlite_version: { min: 0, max: 0, fn: () => SQLITE_VERSION },
  date: { min: 0, max: -1, fn: (a, c) => timeFn(a, c, (t) => fmtDate(t)) },
  time: { min: 0, max: -1, fn: (a, c) => timeFn(a, c, (t) => fmtTime(t)) },
  datetime: { min: 0, max: -1, fn: (a, c) => timeFn(a, c, (t) => `${fmtDate(t)} ${fmtTime(t)}`) },
  julianday: { min: 0, max: -1, real: true, fn: (a, c) => timeFn(a, c, (t) => t / 86400000 + 2440587.5) },
  unixepoch: { min: 0, max: -1, fn: (a, c) => timeFn(a, c, (t) => Math.floor(t / 1000)) },
  strftime: {
    min: 1,
    max: -1,
    fn: (a, c) => (a[0] === null ? null : timeFn(a.length > 1 ? a.slice(1) : ['now'], c, (t) => strftime(text(a[0]), t))),
  },
};

export const SQLITE_VERSION = '3.46.1';

// ---- aggregates -----------------------------------------------------------------------------

export interface AggFn {
  min: number;
  max: number;
  real?: boolean;
  init(): unknown;
  step(acc: unknown, args: SqlValue[]): unknown;
  final(acc: unknown): SqlValue;
}

interface SumAcc {
  n: number;
  sum: number;
  real: boolean;
}

const sumInit = (): SumAcc => ({ n: 0, sum: 0, real: false });
const sumStep = (acc: unknown, a: SqlValue[]) => {
  const s = acc as SumAcc;
  if (a[0] === null) return s;
  const v = toNumber(a[0]);
  s.n++;
  s.sum += v;
  if (!Number.isInteger(v) || (typeof a[0] === 'string' && !/^\s*[+-]?\d+\s*$/.test(a[0]))) s.real = true;
  return s;
};

function concatAgg(defaultSep: string | null): AggFn {
  return {
    min: defaultSep === null ? 2 : 1,
    max: 2,
    init: () => ({ parts: [] as string[], seps: [] as string[] }),
    step: (acc, a) => {
      const s = acc as { parts: string[]; seps: string[] };
      if (a[0] === null) return s;
      if (s.parts.length) s.seps.push(a.length > 1 ? text(a[1]) : (defaultSep ?? ','));
      s.parts.push(text(a[0]));
      (s as { len?: number }).len = ((s as { len?: number }).len ?? 0) + s.parts[s.parts.length - 1].length + 1;
      if ((s as { len?: number }).len! > MAX_LENGTH) throw tooBig();
      return s;
    },
    final: (acc) => {
      const s = acc as { parts: string[]; seps: string[] };
      if (!s.parts.length) return null;
      let out = s.parts[0];
      for (let i = 1; i < s.parts.length; i++) out += s.seps[i - 1] + s.parts[i];
      return out;
    },
  };
}

function extremum(dir: 1 | -1): AggFn {
  return {
    min: 1,
    max: 1,
    init: () => ({ v: null as SqlValue }),
    step: (acc, a) => {
      const s = acc as { v: SqlValue };
      if (a[0] !== null && (s.v === null || compareValues(a[0], s.v) * dir > 0)) s.v = a[0];
      return s;
    },
    final: (acc) => (acc as { v: SqlValue }).v,
  };
}

export const AGGREGATES: Record<string, AggFn> = {
  count: {
    min: 0,
    max: 1,
    init: () => ({ n: 0 }),
    step: (acc, a) => {
      const s = acc as { n: number };
      if (a.length === 0 || a[0] !== null) s.n++;
      return s;
    },
    final: (acc) => (acc as { n: number }).n,
  },
  sum: {
    min: 1,
    max: 1,
    init: sumInit,
    step: sumStep,
    final: (acc) => {
      const s = acc as SumAcc;
      return s.n === 0 ? null : s.sum;
    },
  },
  total: { min: 1, max: 1, real: true, init: sumInit, step: sumStep, final: (acc) => (acc as SumAcc).sum },
  avg: {
    min: 1,
    max: 1,
    real: true,
    init: sumInit,
    step: sumStep,
    final: (acc) => {
      const s = acc as SumAcc;
      return s.n === 0 ? null : s.sum / s.n;
    },
  },
  min: extremum(-1),
  max: extremum(1),
  group_concat: concatAgg(','),
  string_agg: concatAgg(null),
};

/** Whether a call is an aggregate: min/max only with one argument. */
export function isAggregate(name: string, nargs: number): boolean {
  if (name === 'min' || name === 'max') return nargs === 1;
  return name in AGGREGATES;
}

export const WINDOW_ONLY = new Set(['row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value']);

// ---- date and time --------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0');

function fmtDate(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

const DATE_RE = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|[+-]\d{2}:\d{2})?\s*$/i;
const TIME_RE = /^\s*(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*$/;

/** Parse a time value into ms since the epoch. Numbers are Julian day numbers. */
function parseTime(v: SqlValue, ctx: FnContext): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return (v - 2440587.5) * 86400000;
  if (v.trim().toLowerCase() === 'now') return ctx.now();
  let m = DATE_RE.exec(v);
  if (m) {
    const [, Y, Mo, D, h = '0', mi = '0', s = '0', frac = '', tz] = m;
    if (+Mo < 1 || +Mo > 12 || +D < 1 || +D > 31 || +h > 24 || +mi > 59 || +s > 59) return null;
    let t = Date.UTC(+Y, +Mo - 1, +D, +h, +mi, +s) + Math.round(Number('0' + frac) * 1000);
    if (+Y < 100) t = new Date(t).setUTCFullYear(+Y);
    if (tz && tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      t -= sign * (+tz.slice(1, 3) * 60 + +tz.slice(4, 6)) * 60000;
    }
    return t;
  }
  m = TIME_RE.exec(v);
  if (m) {
    const [, h, mi, s = '0', frac = ''] = m;
    return Date.UTC(2000, 0, 1, +h, +mi, +s) + Math.round(Number('0' + frac) * 1000);
  }
  if (/^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/.test(v)) return (Number(v) - 2440587.5) * 86400000;
  return null;
}

const UNITS: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000 };

function applyModifier(t: number, mod: string, raw: SqlValue, first: boolean): number | null {
  const m = mod.trim().toLowerCase();
  if (m === 'unixepoch' || m === 'auto') {
    if (!first) return null;
    const n = typeof raw === 'number' ? raw : raw !== null && /^\s*[+-]?\d+(\.\d*)?\s*$/.test(raw) ? Number(raw) : NaN;
    if (Number.isNaN(n)) return m === 'auto' ? t : null;
    if (m === 'auto' && n >= 0 && n < 5373484.5) return t;
    return n * 1000;
  }
  if (m === 'localtime' || m === 'utc' || m === 'subsec' || m === 'subsecond') return t;
  if (m === 'julianday') return t;
  const d = new Date(t);
  if (m === 'start of day') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (m === 'start of month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  if (m === 'start of year') return Date.UTC(d.getUTCFullYear(), 0, 1);
  let w = /^weekday\s+(\d)$/.exec(m);
  if (w) {
    const target = +w[1];
    if (target > 6) return null;
    const diff = (target - d.getUTCDay() + 7) % 7;
    return t + diff * 86400000;
  }
  w = /^([+-]?\d+(?:\.\d*)?)\s+(second|minute|hour|day|month|year)s?$/.exec(m);
  if (w) {
    const n = Number(w[1]);
    const unit = w[2];
    if (unit === 'month' || unit === 'year') {
      const months = unit === 'year' ? n * 12 : n;
      const whole = Math.trunc(months);
      const r = new Date(t);
      r.setUTCMonth(r.getUTCMonth() + whole);
      return r.getTime() + (months - whole) * 30 * 86400000;
    }
    return t + n * UNITS[unit];
  }
  w = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(m);
  if (w) {
    const ms = ((+w[2] * 60 + +w[3]) * 60 + +(w[4] ?? 0)) * 1000;
    return t + (w[1] === '-' ? -ms : ms);
  }
  return null;
}

function timeFn(args: SqlValue[], ctx: FnContext, out: (t: number) => SqlValue): SqlValue {
  const raw = args.length ? args[0] : 'now';
  let t = parseTime(raw, ctx);
  if (t === null) return null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === null) return null;
    t = applyModifier(t, text(args[i]), raw, i === 1);
    if (t === null || Number.isNaN(t)) return null;
  }
  const year = new Date(t).getUTCFullYear();
  if (Number.isNaN(year) || year < 0 || year > 9999) return null;
  return out(t);
}

function strftime(fmt: string, t: number): string | null {
  const d = new Date(t);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const yday = Math.floor((t - startOfYear) / 86400000);
  let bad = false;
  const s = fmt.replace(/%(.)/g, (_m, f: string) => {
    switch (f) {
      case 'd': return pad(d.getUTCDate());
      case 'e': return String(d.getUTCDate()).padStart(2, ' ');
      case 'f': return `${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
      case 'F': return fmtDate(t);
      case 'H': return pad(d.getUTCHours());
      case 'I': return pad(d.getUTCHours() % 12 || 12);
      case 'j': return pad(yday + 1, 3);
      case 'J': return String(t / 86400000 + 2440587.5);
      case 'k': return String(d.getUTCHours()).padStart(2, ' ');
      case 'm': return pad(d.getUTCMonth() + 1);
      case 'M': return pad(d.getUTCMinutes());
      case 'p': return d.getUTCHours() < 12 ? 'AM' : 'PM';
      case 'P': return d.getUTCHours() < 12 ? 'am' : 'pm';
      case 'R': return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
      case 's': return String(Math.floor(t / 1000));
      case 'S': return pad(d.getUTCSeconds());
      case 'T': return fmtTime(t);
      case 'u': return String(d.getUTCDay() || 7);
      case 'w': return String(d.getUTCDay());
      case 'W': return pad(Math.floor((yday + 7 - ((d.getUTCDay() + 6) % 7)) / 7));
      case 'U': return pad(Math.floor((yday + 7 - d.getUTCDay()) / 7));
      case 'Y': return pad(d.getUTCFullYear(), 4);
      case 'y': return pad(d.getUTCFullYear() % 100);
      case '%': return '%';
      default:
        bad = true;
        return '';
    }
  });
  return bad ? null : s;
}

// ---- printf ---------------------------------------------------------------------------------

function withCommas(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** sqlite's printf(): %d %i %u %f %e %g %s %q %Q %w %c %x %X %o %%, with flags, width, precision. */
export function sqlPrintf(fmt: string, args: SqlValue[]): string {
  let ai = 0;
  const nextArg = (): SqlValue => (ai < args.length ? args[ai++] : null);
  return fmt.replace(/%([-+ 0#,!]*)(\d+|\*)?(?:\.(\d+|\*))?(?:ll|l|h)?([a-zA-Z%])/g, (m, flags: string, w: string | undefined, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    let width = w === '*' ? Math.trunc(toNumber(nextArg())) : w ? Number(w) : 0;
    if (Math.abs(width) > MAX_LENGTH) throw tooBig();
    let left = flags.includes('-');
    if (width < 0) {
      left = true;
      width = -width;
    }
    const prec = p === '*' ? Math.trunc(toNumber(nextArg())) : p !== undefined ? Number(p) : undefined;
    if (prec !== undefined && prec > MAX_LENGTH) throw tooBig();
    const zero = flags.includes('0') && !left;
    let body: string;
    let sign = '';
    switch (conv) {
      case 'd':
      case 'i':
      case 'u': {
        const v = nextArg();
        let n = Math.trunc(toNumber(v));
        if (conv === 'u' && n < 0) n = 0;
        if (n < 0) sign = '-';
        else if (flags.includes('+')) sign = '+';
        else if (flags.includes(' ')) sign = ' ';
        body = String(Math.abs(n));
        if (prec !== undefined) body = body.padStart(prec, '0');
        if (flags.includes(',')) body = withCommas(body);
        break;
      }
      case 'f':
      case 'e':
      case 'E':
      case 'g':
      case 'G': {
        const n = toNumber(nextArg());
        if (n < 0 || Object.is(n, -0)) sign = '-';
        else if (flags.includes('+')) sign = '+';
        else if (flags.includes(' ')) sign = ' ';
        const a = Math.abs(n);
        const pr = prec ?? 6;
        if (conv === 'f') {
          body = a.toFixed(Math.min(pr, 100));
          if (flags.includes(',')) {
            const [ip, fp] = body.split('.');
            body = withCommas(ip) + (fp !== undefined ? '.' + fp : '');
          }
        } else if (conv === 'e' || conv === 'E') {
          body = a.toExponential(Math.min(pr, 100)).replace(/e([+-])(\d)$/, 'e$10$2');
          if (conv === 'E') body = body.toUpperCase();
        } else {
          const pg = pr === 0 ? 1 : pr;
          const exp = a === 0 ? 0 : Math.floor(Math.log10(a));
          if (exp < -4 || exp >= pg) {
            body = a.toExponential(pg - 1);
            if (!flags.includes('#')) body = body.replace(/\.?0+e/, 'e');
            body = body.replace(/e([+-])(\d)$/, 'e$10$2');
          } else {
            body = a.toFixed(Math.max(0, pg - 1 - exp));
            if (!flags.includes('#') && body.includes('.')) body = body.replace(/\.?0+$/, '');
          }
          if (conv === 'G') body = body.toUpperCase();
        }
        break;
      }
      case 'x':
      case 'X':
      case 'o': {
        let n = Math.trunc(toNumber(nextArg()));
        if (n < 0) n = Number(BigInt.asUintN(64, BigInt(n)));
        body = n.toString(conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) body = body.padStart(prec, '0');
        if (flags.includes('#') && n !== 0) body = (conv === 'o' ? '0' : conv === 'x' ? '0x' : '0X') + body;
        break;
      }
      case 'c': {
        const s = text(nextArg());
        body = chars(s)[0] ?? '';
        if (prec !== undefined && prec > 1) body = body.repeat(prec);
        break;
      }
      case 's':
      case 'z': {
        const v = nextArg();
        body = v === null ? '' : text(v);
        if (prec !== undefined) body = chars(body).slice(0, prec).join('');
        break;
      }
      case 'q':
      case 'Q':
      case 'w': {
        const v = nextArg();
        if (conv === 'Q' && v === null) {
          body = 'NULL';
          break;
        }
        const q = conv === 'w' ? '"' : "'";
        body = (v === null ? '(NULL)' : text(v)).split(q).join(q + q);
        if (conv === 'Q') body = `'${body}'`;
        break;
      }
      default:
        return m;
    }
    const full = sign + body;
    if (full.length >= width) return full;
    if (left) return full.padEnd(width, ' ');
    if (zero && 'diufeEgGxXo'.includes(conv)) return sign + body.padStart(width - sign.length, '0');
    return full.padStart(width, ' ');
  });
}

