// Text commands: cat, echo, printf, head, tail, wc, grep, sort, uniq.

import type { Command, CommandContext } from './context.ts';
import { abs, fail, lineTexts, lq, parseOptions, q, splitLines, statArg, usage } from './context.ts';
import { byteLength, errorText } from '../vfs.ts';
import { join } from '../path.ts';
import type { VfsErrorCode } from '../types.ts';
import { foldCase } from '../foldcase.ts';

export type Input = { ok: true; text: string } | { ok: false; code: VfsErrorCode };

/** Read a file operand ('-' is stdin). */
export function readInput(ctx: CommandContext, arg: string): Input {
  if (arg === '-' || arg === '/dev/stdin' || arg === '/dev/fd/0') return { ok: true, text: ctx.stdin };
  if (arg === '/dev/null') return { ok: true, text: '' };
  const st = statArg(ctx, arg);
  if (typeof st === 'string') return { ok: false, code: st };
  if (st.type === 'dir') return { ok: false, code: 'EISDIR' };
  return { ok: true, text: ctx.fs.readFile(abs(ctx, arg)) };
}

// ---- cat ---------------------------------------------------------------------------------

export const cat: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'nbsAETuv', long: { number: 'n', 'number-nonblank': 'b' } });
  if (typeof opts === 'number') return opts;
  const files = opts.operands.length ? opts.operands : ['-'];
  let status = 0;
  let n = 0;
  for (const f of files) {
    const input = readInput(ctx, f);
    if (!input.ok) {
      fail(ctx, `${f}: ${errorText(input.code)}`);
      status = 1;
      continue;
    }
    if (opts.flags.has('n') || opts.flags.has('b')) {
      for (const line of splitLines(input.text)) {
        const blank = line === '\n';
        if (opts.flags.has('b') && blank) ctx.out(line);
        else ctx.out(`${String(++n).padStart(6)}\t${line}`);
      }
    } else {
      ctx.out(input.text);
    }
  }
  return status;
};

// ---- echo / printf -----------------------------------------------------------------------

/** Backslash escapes shared by `echo -e` and printf. Returns the text and whether \c stopped output. */
function unescape(s: string, forPrintf: boolean): { text: string; stop: boolean } {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\' || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const e = s[++i];
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case 'e': case 'E': out += '\x1b'; break;
      case '\\': out += '\\'; break;
      case '"': out += forPrintf ? '"' : '\\"'; break;
      case 'c': return { text: out, stop: true };
      case 'x': {
        const m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1));
        if (m) {
          out += String.fromCharCode(parseInt(m[0], 16));
          i += m[0].length;
        } else out += '\\x';
        break;
      }
      case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
        // echo: \0nnn; printf: \nnn
        const re = e === '0' && !forPrintf ? /^[0-7]{0,3}/ : /^[0-7]{0,2}/;
        const m = re.exec(s.slice(i + 1))!;
        const digits = e === '0' && !forPrintf ? m[0] : e + m[0];
        if (!forPrintf && e !== '0') {
          out += '\\' + e;
          break;
        }
        out += String.fromCharCode(parseInt(digits || '0', 8) & 0xff);
        i += m[0].length;
        break;
      }
      default: out += '\\' + e;
    }
  }
  return { text: out, stop: false };
}

export const echo: Command = (ctx) => {
  let newline = true;
  let escapes = false;
  let i = 0;
  for (; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (!/^-[neE]+$/.test(a)) break;
    for (const f of a.slice(1)) {
      if (f === 'n') newline = false;
      else if (f === 'e') escapes = true;
      else escapes = false;
    }
  }
  let text = ctx.args.slice(i).join(' ');
  if (escapes) {
    const r = unescape(text, false);
    text = r.text;
    if (r.stop) newline = false;
  }
  ctx.out(text + (newline ? '\n' : ''));
  return 0;
};

/** Widest printf field this shell will pad to. */
const MAX_FIELD = 10_000;

export const printf: Command = (ctx) => {
  let args = ctx.args;
  if (args[0] === '--') args = args.slice(1);
  if (args[0] === '-v') {
    ctx.err('bash: printf: -v: variables are not supported in this shell\n');
    return 2;
  }
  if (args.length === 0) {
    ctx.err('printf: usage: printf [-v var] format [arguments]\n');
    return 2;
  }
  const format = args[0];
  const values = args.slice(1);
  let vi = 0;
  let status = 0;
  let out = '';

  const toNumber = (v: string | undefined, float: boolean): number => {
    if (v === undefined || v === '') return 0;
    if (/^['"]./.test(v)) return v.codePointAt(1)!;
    const n = float ? Number(v) : /^[+-]?0[xX][0-9a-fA-F]+$/.test(v) ? parseInt(v, 16) : /^[+-]?\d+$/.test(v) ? parseInt(v, 10) : NaN;
    if (Number.isNaN(n)) {
      ctx.err(`bash: printf: ${v}: invalid number\n`);
      status = 1;
      return 0;
    }
    return n;
  };

  for (let pass = 0; pass < 1000; pass++) {
    const startVi = vi;
    let i = 0;
    while (i < format.length) {
      const c = format[i];
      if (c === '\\') {
        let j = i + 1;
        if (format[j] === 'x') j += /^[0-9a-fA-F]{0,2}/.exec(format.slice(j + 1))![0].length + 1;
        else if (/[0-7]/.test(format[j] ?? '')) j += /^[0-7]{1,3}/.exec(format.slice(j))![0].length;
        else j += 1;
        const r = unescape(format.slice(i, j), true);
        out += r.text;
        if (r.stop) {
          ctx.out(out);
          return status;
        }
        i = j;
        continue;
      }
      if (c !== '%') {
        out += c;
        i++;
        continue;
      }
      const m = /^%([-+ 0#]*)(\d+|\*)?(?:\.(\d*|\*))?([a-zA-Z%])?/.exec(format.slice(i))!;
      i += m[0].length;
      const conv = m[4];
      if (conv === '%') {
        out += '%';
        continue;
      }
      const flags = m[1];
      let width = m[2] === '*' ? toNumber(values[vi++], false) : m[2] ? Number(m[2]) : 0;
      let precision: number | undefined = m[3] === '*' ? toNumber(values[vi++], false) : m[3] !== undefined ? Number(m[3] || 0) : undefined;
      // Real printf would happily allocate gigabytes; this one shares a process with every player.
      if (Math.abs(width) > MAX_FIELD || (precision ?? 0) > MAX_FIELD) {
        ctx.err(`bash: printf: ${Math.abs(width) > MAX_FIELD ? width : precision}: field width too large\n`);
        ctx.out(out);
        return 1;
      }
      if (conv === undefined) {
        ctx.err('bash: printf: `%\': missing format character\n');
        ctx.out(out);
        return 1;
      }
      const arg = values[vi++];
      let s: string;
      switch (conv) {
        case 's': s = arg ?? ''; if (precision !== undefined) s = s.slice(0, precision); break;
        case 'b': { const r = unescape(arg ?? '', true); s = r.text; break; }
        case 'c': s = (arg ?? '').slice(0, 1); break;
        case 'd': case 'i': {
          const n = Math.trunc(toNumber(arg, false));
          s = String(Math.abs(n));
          if (precision !== undefined) s = s.padStart(precision, '0');
          s = (n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s;
          break;
        }
        case 'u': s = String(Math.abs(Math.trunc(toNumber(arg, false)))); break;
        case 'x': s = Math.trunc(toNumber(arg, false)).toString(16); break;
        case 'X': s = Math.trunc(toNumber(arg, false)).toString(16).toUpperCase(); break;
        case 'o': s = Math.trunc(toNumber(arg, false)).toString(8); break;
        case 'f': case 'F': {
          const n = toNumber(arg, true);
          s = n.toFixed(precision ?? 6);
          if (n >= 0 && flags.includes('+')) s = '+' + s;
          break;
        }
        case 'e': case 'E': {
          s = toNumber(arg, true).toExponential(precision ?? 6).replace(/e([+-])(\d)$/, 'e$10$2');
          if (conv === 'E') s = s.toUpperCase();
          break;
        }
        case 'g': case 'G': s = String(toNumber(arg, true)); break;
        default:
          ctx.err(`bash: printf: \`${conv}': invalid format character\n`);
          ctx.out(out);
          return 1;
      }
      if (width < 0) {
        width = -width;
        s = s.padEnd(width);
      } else if (flags.includes('-')) s = s.padEnd(width);
      else if (flags.includes('0') && /[diuxXofFeE]/.test(conv) && !/^[-+ ]/.test(s)) s = s.padStart(width, '0');
      else if (flags.includes('0') && /[diuxXofFeE]/.test(conv)) s = s[0] + s.slice(1).padStart(width - 1, '0');
      else s = s.padStart(width);
      out += s;
    }
    // Reuse the format while arguments remain, as long as it consumes some.
    if (vi >= values.length || vi === startVi) break;
  }
  ctx.out(out);
  return status;
};

// ---- head / tail -------------------------------------------------------------------------

/** Turn the obsolete `-5` / `+5` forms into `-n 5` / `-n +5`. */
function normalizeCountArgs(args: string[], allowPlus: boolean): string[] {
  return args.flatMap((a, i) => {
    if (/^-\d+$/.test(a) && (i === 0 || args[i - 1] !== '-n')) return ['-n', a.slice(1)];
    if (allowPlus && i === 0 && /^\+\d+$/.test(a)) return ['-n', a];
    return [a];
  });
}

function headTail(ctx: CommandContext, isTail: boolean): number {
  const opts = parseOptions(ctx, normalizeCountArgs(ctx.args, isTail), {
    flags: isTail ? 'qvfF' : 'qvz',
    withValue: 'nc',
    long: { lines: 'n', bytes: 'c', quiet: 'q', silent: 'q', verbose: 'v', follow: 'f' },
  });
  if (typeof opts === 'number') return opts;
  const byBytes = opts.values.has('c') && !opts.values.has('n');
  const raw = (byBytes ? opts.values.get('c') : opts.values.get('n')) ?? '10';
  const m = /^([+-]?)(\d+)$/.exec(raw);
  if (!m) {
    ctx.err(`${ctx.name}: invalid number of ${byBytes ? 'bytes' : 'lines'}: ${lq(raw)}\n`);
    return 1;
  }
  const count = Number(m[2]);
  const sign = m[1];
  const files = opts.operands.length ? opts.operands : ['-'];
  const headers = opts.flags.has('v') || (files.length > 1 && !opts.flags.has('q'));
  let status = 0;
  let first = true;

  const take = (text: string): string => {
    if (byBytes) {
      const bytes = new TextEncoder().encode(text);
      let slice: Uint8Array;
      if (isTail) slice = sign === '+' ? bytes.slice(Math.max(count - 1, 0)) : bytes.slice(Math.max(bytes.length - count, 0));
      else slice = sign === '-' ? bytes.slice(0, Math.max(bytes.length - count, 0)) : bytes.slice(0, count);
      return new TextDecoder().decode(slice);
    }
    const lines = splitLines(text);
    let picked: string[];
    if (isTail) picked = sign === '+' ? lines.slice(Math.max(count - 1, 0)) : count === 0 ? [] : lines.slice(-count);
    else picked = sign === '-' ? lines.slice(0, Math.max(lines.length - count, 0)) : lines.slice(0, count);
    return picked.join('');
  };

  for (const f of files) {
    const input = readInput(ctx, f);
    if (!input.ok) {
      if (input.code === 'EISDIR') {
        if (headers) ctx.out(`${first ? '' : '\n'}==> ${f} <==\n`);
        first = false;
        ctx.err(`${ctx.name}: error reading ${q(f)}: Is a directory\n`);
      } else {
        ctx.err(`${ctx.name}: cannot open ${q(f)} for reading: ${errorText(input.code)}\n`);
      }
      status = 1;
      continue;
    }
    if (headers) ctx.out(`${first ? '' : '\n'}==> ${f === '-' ? 'standard input' : f} <==\n`);
    first = false;
    ctx.out(take(input.text));
  }
  return status;
}

export const head: Command = (ctx) => headTail(ctx, false);
export const tail: Command = (ctx) => headTail(ctx, true);

// ---- wc ----------------------------------------------------------------------------------

export const wc: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'lwcmL',
    long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm', 'max-line-length': 'L' },
  });
  if (typeof opts === 'number') return opts;
  let fields = ['l', 'w', 'm', 'c', 'L'].filter((f) => opts.flags.has(f));
  if (fields.length === 0) fields = ['l', 'w', 'c'];
  const files = opts.operands.length ? opts.operands : [null];

  interface Row { counts: number[]; name: string | null; error?: string }
  const rows: Row[] = [];
  const totals = fields.map(() => 0);
  let nonRegular = false;
  let totalSize = 0;
  let status = 0;

  for (const f of files) {
    let text = '';
    let error: string | undefined;
    if (f === null || f === '-') {
      text = ctx.stdin;
      nonRegular = true;
    } else {
      const input = readInput(ctx, f);
      if (!input.ok) {
        if (input.code !== 'EISDIR') {
          fail(ctx, `${f}: ${errorText(input.code)}`);
          status = 1;
          continue;
        }
        nonRegular = true;
        error = `${f}: Is a directory`;
        status = 1;
      } else {
        text = input.text;
        totalSize += byteLength(text);
      }
    }
    const counts = fields.map((field) => {
      switch (field) {
        case 'l': return (text.match(/\n/g) ?? []).length;
        case 'w': return (text.match(/\S+/g) ?? []).length;
        case 'c': return byteLength(text);
        case 'm': return [...text].length;
        default: return Math.max(0, ...lineTexts(text).map((l) => l.length));
      }
    });
    counts.forEach((c, i) => {
      totals[i] = fields[i] === 'L' ? Math.max(totals[i], c) : totals[i] + c;
    });
    rows.push({ counts, name: f, error });
  }
  if (rows.length === 0) return status;
  if (rows.length > 1) rows.push({ counts: totals, name: 'total' });

  let width = String(totalSize).length;
  if (nonRegular) width = Math.max(width, 7);
  if (fields.length === 1 && files.length === 1) width = 1;
  for (const row of rows) {
    const line = row.counts.map((c) => String(c).padStart(width)).join(' ');
    ctx.out(line + (row.name !== null && row.name !== '-' ? ' ' + row.name : '') + '\n');
    if (row.error) fail(ctx, row.error);
  }
  return status;
};

// ---- grep --------------------------------------------------------------------------------

const POSIX_CLASSES: Record<string, string> = {
  alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f',
  word: '\\w', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e', graph: '\\x21-\\x7e',
};

class GrepPatternError extends Error {}

/** Translate a POSIX basic or extended regular expression into JavaScript syntax. */
export function posixToJs(pattern: string, extended: boolean): string {
  let out = '';
  let i = 0;
  let groups = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '[') {
      let j = i + 1;
      let body = '';
      if (pattern[j] === '^') {
        body += '^';
        j++;
      }
      if (pattern[j] === ']') {
        body += '\\]';
        j++;
      }
      let closed = false;
      while (j < pattern.length) {
        const d = pattern[j];
        if (d === ']') {
          closed = true;
          break;
        }
        if (d === '[' && pattern[j + 1] === ':') {
          const end = pattern.indexOf(':]', j + 2);
          const cls = end > 0 ? POSIX_CLASSES[pattern.slice(j + 2, end)] : undefined;
          if (cls === undefined) throw new GrepPatternError(end > 0 ? 'Invalid character class name' : 'Unmatched [, [^, [:, [., or [=');
          body += cls;
          j = end + 2;
          continue;
        }
        body += d === '\\' || d === '[' ? '\\' + d : d;
        j++;
      }
      if (!closed) throw new GrepPatternError('Unmatched [, [^, [:, [., or [=');
      out += `[${body}]`;
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      const e = pattern[i + 1];
      if (e === undefined) throw new GrepPatternError('Trailing backslash');
      i += 2;
      if (e === '<' || e === '>') out += '\\b';
      else if ('wWsSbB'.includes(e)) out += '\\' + e;
      else if (!extended && '(){}|+?'.includes(e)) {
        if (e === '(') groups++;
        if (e === ')' && --groups < 0) throw new GrepPatternError('Unmatched ) or \\)');
        out += e;
      } else if (/[0-9]/.test(e)) out += '\\' + e;
      else out += e.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      continue;
    }
    if ('(){}|+?'.includes(c)) {
      if (extended) {
        if (c === '(') groups++;
        if (c === ')' && --groups < 0) throw new GrepPatternError('Unmatched ) or \\)');
        out += c;
      } else out += '\\' + c;
      i++;
      continue;
    }
    if (c === '*' && (out === '' || out === '^' || out.endsWith('(') || out.endsWith('|'))) {
      out += '\\*';
      i++;
      continue;
    }
    out += c === '/' ? '\\/' : c;
    i++;
  }
  if (groups > 0) throw new GrepPatternError('Unmatched ( or \\(');
  return out;
}

export const grep: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'invrRclLEFGwxqshHoI',
    withValue: 'emABC',
    invalidExit: 2,
    long: {
      'ignore-case': 'i', 'line-number': 'n', 'invert-match': 'v', recursive: 'r', count: 'c',
      'files-with-matches': 'l', 'files-without-match': 'L', 'extended-regexp': 'E', 'fixed-strings': 'F',
      'word-regexp': 'w', 'line-regexp': 'x', quiet: 'q', silent: 'q', 'no-messages': 's',
      'no-filename': 'h', 'with-filename': 'H', 'only-matching': 'o', regexp: 'e', 'max-count': 'm',
      'after-context': 'A', 'before-context': 'B', context: 'C',
    },
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  // Context lines around matches: -A after, -B before, -C both.
  const contextOf = (letter: string): number | null => {
    const raw = opts.values.get(letter) ?? opts.values.get('C');
    if (raw === undefined) return 0;
    return /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const after = contextOf('A');
  const before = contextOf('B');
  if (after === null || before === null) {
    const raw = opts.values.get('A') ?? opts.values.get('B') ?? opts.values.get('C');
    ctx.err(`grep: ${raw}: invalid context length argument\n`);
    return 2;
  }
  const operands = [...opts.operands];
  const patterns: string[] = [];
  if (opts.all.has('e')) patterns.push(...opts.all.get('e')!);
  else if (operands.length) patterns.push(operands.shift()!);
  if (patterns.length === 0) {
    ctx.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n");
    return 2;
  }
  const maxCount = opts.values.has('m') ? Number(opts.values.get('m')) : Infinity;

  let regex: RegExp;
  try {
    const alts = patterns.flatMap((p) => p.split('\n')).map((p) => {
      let src = f.has('F') ? p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') : posixToJs(p, f.has('E'));
      if (f.has('x')) src = `^(?:${src})$`;
      // -w is checked by matches() below: lookarounds would switch off the linear-time regex fallback.
      return src;
    });
    // Backreferences make a regex exponential with no linear-time fallback, and every player shares
    // one thread with this one.
    if (alts.some((a) => /(^|[^\\])(\\\\)*\\[1-9]/.test(a))) {
      ctx.err('grep: backreferences are not supported in this shell\n');
      return 2;
    }
    // -i spells out both cases instead of using the `i` flag, which would switch off V8's
    // linear-time fallback for patterns that backtrack too much (see foldcase.ts).
    const joined = alts.join('|');
    regex = new RegExp(f.has('i') ? foldCase(joined) : joined, 'g');
  } catch (e) {
    const msg = e instanceof GrepPatternError ? e.message
      : /Unterminated group/.test(String(e)) ? 'Unmatched ( or \\('
      : /Unmatched '\)'/.test(String(e)) ? 'Unmatched ) or \\)'
      : /Unterminated character class/.test(String(e)) ? 'Unmatched [, [^, [:, [., or [='
      : /Nothing to repeat/.test(String(e)) ? 'Invalid preceding regular expression'
      : 'Invalid regular expression';
    ctx.err(`grep: ${msg}\n`);
    return 2;
  }

  // Matches in a line; with -w only those with a non-word character (or the line's edge) on both sides.
  const isWord = (c: string | undefined) => c !== undefined && /\w/.test(c);
  const matches = (line: string): string[] => {
    const out: string[] = [];
    regex.lastIndex = 0;
    for (let m = regex.exec(line); m; m = regex.exec(line)) {
      const end = m.index + m[0].length;
      if (!f.has('w') || (!isWord(line[m.index - 1]) && !isWord(line[end]))) {
        out.push(m[0]);
        if (!f.has('o')) break;
      } else {
        // Not a whole word here; look for one starting further on.
        regex.lastIndex = m.index + 1;
        continue;
      }
      if (m[0] === '') regex.lastIndex++;
    }
    return out;
  };

  const recursive = f.has('r') || f.has('R');
  let errors = false;
  let matchedAny = false;

  // Collect [display name, text] pairs.
  const inputs: { name: string; text: string }[] = [];
  const walk = (display: string, path: string): void => {
    for (const entry of ctx.fs.list(path)) {
      const name = entry.path.slice(entry.path.lastIndexOf('/') + 1);
      const shown = display === '' ? name : join(display, name);
      if (entry.type === 'dir') walk(shown, entry.path);
      else inputs.push({ name: shown, text: ctx.fs.readFile(entry.path) });
    }
  };
  const targets = operands.length ? operands : recursive ? [null] : ['-'];
  for (const t of targets) {
    if (t === null) {
      if (ctx.fs.isDir(ctx.state.cwd)) walk('', ctx.state.cwd);
      continue;
    }
    if (t === '-') {
      inputs.push({ name: '(standard input)', text: ctx.stdin });
      continue;
    }
    const st = statArg(ctx, t);
    if (typeof st === 'string') {
      if (!f.has('s')) ctx.err(`grep: ${t}: ${errorText(st)}\n`);
      errors = true;
      continue;
    }
    if (st.type === 'dir') {
      if (recursive) walk(t, abs(ctx, t));
      else {
        if (!f.has('s')) ctx.err(`grep: ${t}: Is a directory\n`);
        errors = true;
      }
      continue;
    }
    inputs.push({ name: t, text: ctx.fs.readFile(abs(ctx, t)) });
  }

  const showNames = f.has('H') || (!f.has('h') && (targets.length > 1 || recursive));
  const invert = f.has('v');
  const quiet = f.has('q') || f.has('l') || f.has('L') || f.has('c');
  const withContext = !quiet && !f.has('o') && (after > 0 || before > 0);
  let printedGroup = false;

  for (const input of inputs) {
    // Matching lines use ':' after the name and number, context lines '-', as GNU grep does.
    const prefix = showNames ? input.name + ':' : '';
    const lead = (i: number, sep: string) => (showNames ? input.name + sep : '') + (f.has('n') ? `${i + 1}${sep}` : '');
    const lines = lineTexts(input.text);
    let count = 0;
    let lastShown = -1;
    let trailing = 0;
    for (const [i, line] of lines.entries()) {
      if (count >= maxCount && trailing === 0) break;
      regex.lastIndex = 0;
      const hit = matches(line).length > 0 !== invert && count < maxCount;
      if (!hit) {
        if (withContext && trailing > 0) {
          ctx.out(`${lead(i, '-')}${line}\n`);
          lastShown = i;
          trailing--;
        }
        continue;
      }
      count++;
      if (quiet) continue;
      if (withContext) {
        const from = Math.max(lastShown + 1, i - before);
        if (printedGroup && (lastShown === -1 || from > lastShown + 1)) ctx.out('--\n');
        for (let k = from; k < i; k++) ctx.out(`${lead(k, '-')}${lines[k]}\n`);
        printedGroup = true;
        lastShown = i;
        trailing = after;
      }
      if (f.has('o') && !invert) {
        regex.lastIndex = 0;
        for (const m of matches(line)) if (m !== '') ctx.out(`${lead(i, ':')}${m}\n`);
      } else {
        ctx.out(`${lead(i, ':')}${line}\n`);
      }
    }
    if (count > 0) matchedAny = true;
    if (f.has('q')) {
      if (matchedAny) return 0;
      continue;
    }
    if (f.has('c')) ctx.out(`${prefix}${count}\n`);
    else if (f.has('l') && count > 0) ctx.out(input.name + '\n');
    else if (f.has('L') && count === 0) ctx.out(input.name + '\n');
  }
  if (errors && !(f.has('q') && matchedAny)) return 2;
  return matchedAny ? 0 : 1;
};

// ---- sort / uniq -------------------------------------------------------------------------

function gatherLines(ctx: CommandContext, files: string[], onError: (f: string, code: string) => void): string[] | null {
  const lines: string[] = [];
  for (const file of files.length ? files : ['-']) {
    const input = readInput(ctx, file);
    if (!input.ok) {
      onError(file, errorText(input.code));
      return null;
    }
    lines.push(...lineTexts(input.text));
  }
  return lines;
}

export const sort: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'rnufb',
    invalidExit: 2,
    long: { reverse: 'r', 'numeric-sort': 'n', unique: 'u', 'ignore-case': 'f' },
  });
  if (typeof opts === 'number') return opts;
  const lines = gatherLines(ctx, opts.operands, (file, msg) => ctx.err(`sort: cannot read: ${file}: ${msg}\n`));
  if (!lines) return 2;
  const key = (s: string): string => (opts.flags.has('f') ? s.toUpperCase() : s);
  const cmp = (a: string, b: string): number => {
    if (opts.flags.has('n')) {
      const na = parseFloat(a) || 0;
      const nb = parseFloat(b) || 0;
      if (na !== nb) return na - nb;
    }
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  lines.sort(cmp);
  if (opts.flags.has('r')) lines.reverse();
  const out = opts.flags.has('u') ? lines.filter((l, i) => i === 0 || cmp(lines[i - 1], l) !== 0) : lines;
  ctx.out(out.map((l) => l + '\n').join(''));
  return 0;
};

export const uniq: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'cdui',
    long: { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i' },
  });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length > 1) {
    return usage(ctx, `extra operand ${q(opts.operands[1])}`);
  }
  const lines = gatherLines(ctx, opts.operands, (file, msg) => fail(ctx, `${file}: ${msg}`));
  if (!lines) return 1;
  const same = (a: string, b: string): boolean => (opts.flags.has('i') ? a.toLowerCase() === b.toLowerCase() : a === b);
  let out = '';
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && same(lines[i], lines[j])) j++;
    const n = j - i;
    const keep = opts.flags.has('d') ? n > 1 : opts.flags.has('u') ? n === 1 : true;
    if (keep) out += (opts.flags.has('c') ? `${String(n).padStart(7)} ` : '') + lines[i] + '\n';
    i = j;
  }
  ctx.out(out);
  return 0;
};
