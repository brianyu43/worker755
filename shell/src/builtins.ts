// Shell builtins: the commands that change the shell itself (variables, options, aliases, the
// directory stack) or need to see its functions and history.

import type { Word } from './parser.ts';
import type { CommandContext } from './commands/context.ts';
import type { Io, Var, VirtualShell } from './shell.ts';
import { ExitSignal, LoopSignal, ReturnSignal, ShellError, scalarOf } from './shell.ts';
import { COMMANDS } from './commands/index.ts';
import { testCommand } from './cond.ts';
import { inPath } from './system.ts';
import { evaluate, ArithError } from './arith.ts';

export type Builtin = (sh: VirtualShell, ctx: CommandContext, io: Io, words?: Word[]) => number;

/** Builtins whose name=value arguments are assignments, not split or globbed. */
export const DECLARATION_BUILTINS = new Set(['export', 'local', 'declare', 'typeset', 'readonly']);

const KEYWORDS = ['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'time', '{', '}', '!', '[[', ']]', 'select', 'coproc'];

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function shq(s: string): string {
  if (s === '') return "''";
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `declare -p` rendering of one variable. */
function declareLine(name: string, v: Var): string {
  let flags = '';
  if (v.indexed) flags += 'a';
  if (v.assoc) flags += 'A';
  if (v.integer) flags += 'i';
  if (v.readonly) flags += 'r';
  if (v.exported) flags += 'x';
  const f = flags ? `-${flags}` : '--';
  const dq = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
  if (v.indexed) return `declare ${f} ${name}=(${[...v.indexed].sort((a, b) => a[0] - b[0]).map(([i, s]) => `[${i}]=${dq(s)}`).join(' ')})`;
  if (v.assoc) return `declare ${f} ${name}=(${[...v.assoc].map(([k, s]) => `[${k}]=${dq(s)} `).join('')})`;
  if (v.scalar === undefined) return `declare ${f} ${name}`;
  return `declare ${f} ${name}=${dq(v.scalar)}`;
}

/** Parses `name`, `name=value`, `name+=value`, `name[i]=value`. */
function parseAssign(arg: string): { name: string; index?: string; append: boolean; value: string | null } | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[([^\]]*)\])?(?:(\+?)=(.*))?$/s.exec(arg);
  if (!m) return null;
  return { name: m[1], ...(m[2] !== undefined ? { index: m[2] } : {}), append: m[3] === '+', value: m[4] ?? null };
}

/** declare, typeset, local, export, readonly. */
function declare(sh: VirtualShell, ctx: CommandContext, kind: 'declare' | 'local' | 'export' | 'readonly'): number {
  const flags = new Set<string>();
  const off = new Set<string>();
  const names: [number, string][] = [];
  ctx.args.forEach((a, i) => {
    if (names.length === 0 && /^[-+][a-zA-Z]+$/.test(a)) {
      for (const f of a.slice(1)) (a[0] === '-' ? flags : off).add(f);
    } else if (a === '--' && names.length === 0) {
      /* end of options */
    } else names.push([i + 1, a]);
  });
  const inFunction = sh.locals.length > 0;
  if (kind === 'local' && !inFunction) throw new ShellError('bash: local: can only be used in a function');
  if (kind === 'export') flags.add('x');
  if (kind === 'readonly') flags.add('r');
  if (flags.has('f') || flags.has('F')) {
    const list = names.length ? names.map(([, n]) => n) : [...sh.functions.keys()].sort();
    let status = 0;
    for (const n of list) {
      const fn = sh.functions.get(n);
      if (!fn) {
        status = 1;
        continue;
      }
      ctx.out(flags.has('F') ? `declare -f ${n}\n` : fn.source + '\n');
    }
    return status;
  }
  if (names.length === 0 || flags.has('p')) {
    const list = names.length ? names.map(([, n]) => n) : [...sh.vars.keys()].sort();
    let status = 0;
    for (const n of list) {
      const v = sh.vars.get(n);
      if (!v) {
        if (names.length) {
          ctx.err(`bash: ${kind === 'export' ? 'export' : 'declare'}: ${n}: not found\n`);
          status = 1;
        }
        continue;
      }
      if (kind === 'export' && !v.exported) continue;
      if (kind === 'readonly' && !v.readonly) continue;
      if (flags.has('x') && kind === 'declare' && !v.exported) continue;
      ctx.out(declareLine(n, v) + '\n');
    }
    return status;
  }
  let status = 0;
  for (const [pos, arg] of names) {
    const a = parseAssign(arg);
    if (!a) {
      ctx.err(`bash: ${kind}: \`${arg}': not a valid identifier\n`);
      status = 1;
      continue;
    }
    if (kind === 'export' && flags.has('n')) {
      const v = sh.vars.get(a.name);
      if (v) v.exported = false;
      continue;
    }
    // Inside a function, declare and local make the variable local unless -g.
    if ((kind === 'local' || (kind === 'declare' && inFunction && !flags.has('g'))) && !sh.locals[sh.locals.length - 1].has(a.name)) {
      sh.makeLocal(a.name);
    }
    let v = sh.vars.get(a.name);
    if (!v) {
      v = {};
      sh.vars.set(a.name, v);
    }
    if (v.readonly && (a.value !== null || off.has('r'))) {
      ctx.err(`bash: ${a.name}: readonly variable\n`);
      status = 1;
      continue;
    }
    if (flags.has('A') && !v.assoc) {
      v.assoc = new Map(v.scalar !== undefined ? [['0', v.scalar]] : []);
      delete v.scalar;
      delete v.indexed;
    }
    if (flags.has('a') && !v.indexed && !v.assoc) {
      v.indexed = new Map(v.scalar !== undefined ? [[0, v.scalar]] : []);
      delete v.scalar;
    }
    if (flags.has('i')) v.integer = true;
    if (off.has('i')) v.integer = false;
    if (flags.has('x')) v.exported = true;
    if (off.has('x')) v.exported = false;
    const array = sh.declArrays.get(pos);
    try {
      if (array) sh.setArray(a.name, array, a.append);
      else if (a.value !== null) sh.setVar(a.name, a.value, a.index, a.append);
      else if (kind === 'local' && v.scalar === undefined && !v.indexed && !v.assoc && !flags.has('a') && !flags.has('A')) {
        /* `local x` declares x without a value */
      }
    } catch (e) {
      if (e instanceof ShellError) {
        ctx.err(e.message + '\n');
        status = 1;
        continue;
      }
      throw e;
    }
    if (flags.has('l') || flags.has('u')) {
      const cur = sh.vars.get(a.name);
      if (cur?.scalar !== undefined) cur.scalar = flags.has('l') ? cur.scalar.toLowerCase() : cur.scalar.toUpperCase();
    }
    if (flags.has('r')) sh.vars.get(a.name)!.readonly = true;
  }
  return status;
}

function readLine(io: Io, delim: string, raw: boolean, count: number | null): { line: string; found: boolean } | null {
  const input = io.stdin;
  if (!input || input.pos >= input.text.length) return null;
  let line = '';
  let found = false;
  while (input.pos < input.text.length) {
    const c = input.text[input.pos++];
    if (count !== null) {
      line += c;
      if ([...line].length >= count) {
        found = true;
        break;
      }
      continue;
    }
    if (!raw && c === '\\') {
      const n = input.text[input.pos++];
      if (n === undefined) break;
      if (n === '\n') continue;
      line += n;
      continue;
    }
    if (c === delim) {
      found = true;
      break;
    }
    line += c;
  }
  return { line, found };
}

/** Splits for `read`: on IFS, the last name taking the rest. */
function splitForRead(text: string, ifs: string, n: number): string[] {
  const white = ifs.replace(/[^ \t\n]/g, '');
  const isWhite = (c: string) => white.includes(c);
  let s = text;
  // Leading and trailing IFS whitespace go.
  let a = 0;
  while (a < s.length && isWhite(s[a])) a++;
  let b = s.length;
  while (b > a && isWhite(s[b - 1])) b--;
  s = s.slice(a, b);
  const out: string[] = [];
  let i = 0;
  while (out.length < n - 1 && i <= s.length) {
    let j = i;
    while (j < s.length && !ifs.includes(s[j])) j++;
    if (j >= s.length) break;
    out.push(s.slice(i, j));
    // Skip the delimiter and IFS whitespace around it.
    let k = j;
    while (k < s.length && isWhite(s[k])) k++;
    if (k < s.length && ifs.includes(s[k]) && !isWhite(s[k]) && (k === j || isWhite(s[j]))) {
      k++;
      while (k < s.length && isWhite(s[k])) k++;
    } else if (k === j) k++;
    i = k;
  }
  out.push(s.slice(i));
  return out;
}

const read: Builtin = (sh, ctx, io) => {
  let raw = false;
  let delim = '\n';
  let count: number | null = null;
  let array: string | null = null;
  let prompt = '';
  const names: string[] = [];
  const args = ctx.args;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (names.length === 0 && /^-[a-zA-Z]+/.test(a)) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j];
        const value = () => (j + 1 < a.length ? a.slice(j + 1) : args[++i]);
        if (f === 'r') raw = true;
        else if (f === 's' || f === 'e') continue;
        else if (f === 'p') {
          prompt = value() ?? '';
          break;
        } else if (f === 'd') {
          delim = (value() ?? '')[0] ?? '\0';
          break;
        } else if (f === 'n' || f === 'N') {
          count = Number(value());
          break;
        } else if (f === 'a') {
          array = value() ?? null;
          break;
        } else if (f === 't' || f === 'u') {
          value();
          break;
        } else {
          ctx.err(`bash: read: -${f}: invalid option\nread: usage: read [-ers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n`);
          return 2;
        }
      }
      continue;
    }
    names.push(a);
  }
  for (const n of [...names, ...(array ? [array] : [])]) {
    if (!NAME.test(n)) {
      ctx.err(`bash: read: \`${n}': not a valid identifier\n`);
      return 1;
    }
  }
  if (prompt && io.stdin === null) ctx.err(prompt);
  const got = readLine(io, delim, raw, count);
  if (!got) {
    for (const n of names) sh.setVar(n, '');
    if (!names.length && !array) sh.setVar('REPLY', '');
    return 1;
  }
  const ifs = sh.param('IFS') ?? ' \t\n';
  if (array) sh.setArray(array, got.line === '' ? [] : splitForRead(got.line, ifs, Infinity), false);
  else if (!names.length) sh.setVar('REPLY', got.line);
  else {
    const parts = splitForRead(got.line, ifs, names.length);
    names.forEach((n, i) => sh.setVar(n, parts[i] ?? ''));
  }
  return got.found ? 0 : 1;
};

const mapfile: Builtin = (sh, ctx, io) => {
  let strip = false;
  let name = 'MAPFILE';
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '-t') strip = true;
    else if (a === '-d' || a === '-n' || a === '-O' || a === '-s' || a === '-u' || a === '-C' || a === '-c') i++;
    else name = a;
  }
  const text = io.stdin ? io.stdin.text.slice(io.stdin.pos) : '';
  if (io.stdin) io.stdin.pos = io.stdin.text.length;
  const lines = text === '' ? [] : text.split(/(?<=\n)/);
  sh.setArray(name, lines.map((l) => (strip ? l.replace(/\n$/, '') : l)), false);
  return 0;
};

const SET_OPTIONS: Record<string, string> = { e: 'errexit', u: 'nounset', x: 'xtrace', f: 'noglob', C: 'noclobber' };
const ALL_OPTIONS = ['allexport', 'braceexpand', 'emacs', 'errexit', 'errtrace', 'functrace', 'hashall', 'histexpand', 'history', 'ignoreeof', 'interactive-comments', 'keyword', 'monitor', 'noclobber', 'noexec', 'noglob', 'nolog', 'notify', 'nounset', 'onecmd', 'physical', 'pipefail', 'posix', 'privileged', 'verbose', 'vi', 'xtrace'];

const set: Builtin = (sh, ctx) => {
  const args = ctx.args;
  if (!args.length) {
    for (const [k, v] of [...sh.vars].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (v.indexed || v.assoc) ctx.out(declareLine(k, v).replace(/^declare -\S* /, '') + '\n');
      else ctx.out(`${k}=${shq(scalarOf(v) ?? '')}\n`);
    }
    for (const fn of [...sh.functions.values()]) ctx.out(fn.source + '\n');
    return 0;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--' || a === '-') {
      sh.args = args.slice(i + 1);
      return 0;
    }
    if (a === '-o' || a === '+o') {
      const name = args[++i];
      if (name === undefined) {
        if (a === '-o') for (const o of ALL_OPTIONS) ctx.out(`${o.padEnd(15)}\t${sh.options[o] ? 'on' : 'off'}\n`);
        else for (const o of ALL_OPTIONS) ctx.out(`set ${sh.options[o] ? '-o' : '+o'} ${o}\n`);
        continue;
      }
      if (!ALL_OPTIONS.includes(name)) {
        ctx.err(`bash: set: ${name}: invalid option name\n`);
        return 1;
      }
      sh.options[name] = a === '-o';
      continue;
    }
    if (/^[-+][a-zA-Z]+$/.test(a)) {
      for (const f of a.slice(1)) {
        const name = SET_OPTIONS[f];
        if (name) sh.options[name] = a[0] === '-';
        else if (!'vhBHmbknpPtaT'.includes(f)) {
          ctx.err(`bash: set: ${a[0]}${f}: invalid option\nset: usage: set [-abefhkmnptuvxBCEHPT] [-o option-name] [--] [-] [arg ...]\n`);
          return 2;
        }
      }
      continue;
    }
    sh.args = args.slice(i);
    return 0;
  }
  return 0;
};

const shift: Builtin = (sh, ctx) => {
  const n = ctx.args.length ? Number(ctx.args[0]) : 1;
  if (!Number.isInteger(n) || n < 0) {
    ctx.err(`bash: shift: ${ctx.args[0]}: numeric argument required\n`);
    return 1;
  }
  if (n > sh.args.length) return 1;
  sh.args = sh.args.slice(n);
  return 0;
};

const unset: Builtin = (sh, ctx) => {
  let funcs = false;
  let status = 0;
  for (const a of ctx.args) {
    if (a === '-f') {
      funcs = true;
      continue;
    }
    if (a === '-v' || a === '-n') continue;
    if (funcs) {
      sh.functions.delete(a);
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$/.exec(a);
    if (!m) {
      ctx.err(`bash: unset: \`${a}': not a valid identifier\n`);
      status = 1;
      continue;
    }
    if (!sh.vars.has(m[1]) && m[2] === undefined && sh.functions.has(m[1])) {
      sh.functions.delete(m[1]);
      continue;
    }
    try {
      sh.unsetVar(m[1], m[2]);
    } catch (e) {
      if (!(e instanceof ShellError)) throw e;
      ctx.err(e.message + '\n');
      status = 1;
    }
  }
  return status;
};

const alias: Builtin = (sh, ctx) => {
  const args = ctx.args.filter((a) => a !== '-p');
  if (!args.length) {
    for (const [k, v] of [...sh.aliases].sort(([a], [b]) => (a < b ? -1 : 1))) ctx.out(`alias ${k}='${v.replace(/'/g, `'\\''`)}'\n`);
    return 0;
  }
  let status = 0;
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq > 0) {
      const name = a.slice(0, eq);
      if (/[\s/$`=|&;()<>'"]/.test(name)) {
        ctx.err(`bash: alias: \`${name}': invalid alias name\n`);
        status = 1;
        continue;
      }
      sh.aliases.set(name, a.slice(eq + 1));
    } else if (sh.aliases.has(a)) ctx.out(`alias ${a}='${sh.aliases.get(a)!.replace(/'/g, `'\\''`)}'\n`);
    else {
      ctx.err(`bash: alias: ${a}: not found\n`);
      status = 1;
    }
  }
  return status;
};

const unalias: Builtin = (sh, ctx) => {
  if (ctx.args[0] === '-a') {
    sh.aliases.clear();
    return 0;
  }
  if (!ctx.args.length) {
    ctx.err('unalias: usage: unalias [-a] name [name ...]\n');
    return 2;
  }
  let status = 0;
  for (const a of ctx.args) {
    if (!sh.aliases.delete(a)) {
      ctx.err(`bash: unalias: ${a}: not found\n`);
      status = 1;
    }
  }
  return status;
};

const history: Builtin = (sh, ctx) => {
  if (ctx.args[0] === '-c') {
    sh.history = [];
    return 0;
  }
  if (ctx.args[0] === '-d') {
    const n = Number(ctx.args[1]);
    if (!Number.isInteger(n) || n < 1 || n > sh.history.length) {
      ctx.err(`bash: history: ${ctx.args[1] ?? ''}: history position out of range\n`);
      return 1;
    }
    sh.history.splice(n - 1, 1);
    return 0;
  }
  let start = 0;
  if (ctx.args.length) {
    const n = Number(ctx.args[0]);
    if (!Number.isInteger(n) || n < 0) {
      ctx.err(`bash: history: ${ctx.args[0]}: numeric argument required\n`);
      return 1;
    }
    start = Math.max(0, sh.history.length - n);
  }
  ctx.out(sh.history.slice(start).map((h, i) => `${String(start + i + 1).padStart(5)}  ${h}\n`).join(''));
  return 0;
};

/** What a name is: alias, keyword, function, builtin, file; null when nothing. */
function kindOf(sh: VirtualShell, name: string): 'alias' | 'keyword' | 'function' | 'builtin' | 'file' | null {
  if (sh.aliases.has(name)) return 'alias';
  if (KEYWORDS.includes(name)) return 'keyword';
  if (sh.functions.has(name)) return 'function';
  if (Object.prototype.hasOwnProperty.call(BUILTINS, name) || name === 'source' || name === '.' || name === 'cd' || name === 'echo' || name === 'printf' || name === 'pwd' || name === 'true' || name === 'false' || name === 'help') return 'builtin';
  if (inPath(name)) return 'file';
  if (name.includes('/') && sh.fs.stat(sh.resolve(name))?.type === 'file') return 'file';
  return null;
}

const type: Builtin = (sh, ctx) => {
  let terse = false;
  let pathOnly = false;
  const names: string[] = [];
  for (const a of ctx.args) {
    if (a === '-t') terse = true;
    else if (a === '-p' || a === '-P') pathOnly = true;
    else if (a === '-a' || a === '-f') continue;
    else names.push(a);
  }
  let status = 0;
  for (const n of names) {
    const k = kindOf(sh, n);
    if (!k) {
      if (!terse && !pathOnly) ctx.err(`bash: type: ${n}: not found\n`);
      status = 1;
      continue;
    }
    if (terse) {
      ctx.out(k + '\n');
      continue;
    }
    if (pathOnly) {
      if (k === 'file') ctx.out((n.includes('/') ? n : `/usr/bin/${n}`) + '\n');
      continue;
    }
    switch (k) {
      case 'alias': ctx.out(`${n} is aliased to \`${sh.aliases.get(n)}'\n`); break;
      case 'keyword': ctx.out(`${n} is a shell keyword\n`); break;
      case 'function': ctx.out(`${n} is a function\n${sh.functions.get(n)!.source}\n`); break;
      case 'builtin': ctx.out(`${n} is a shell builtin\n`); break;
      case 'file': ctx.out(`${n} is ${n.includes('/') ? n : `/usr/bin/${n}`}\n`); break;
    }
  }
  return status;
};

const which: Builtin = (sh, ctx) => {
  const all = ctx.args.includes('-a');
  const names = ctx.args.filter((a) => !a.startsWith('-'));
  if (!names.length) return 1;
  let status = 0;
  for (const n of names) {
    if (n.includes('/')) {
      const st = sh.fs.stat(sh.resolve(n));
      if (st?.type === 'file' && st.mode & 0o111) ctx.out(n + '\n');
      else status = 1;
      continue;
    }
    if (inPath(n)) {
      ctx.out(`/usr/bin/${n}\n`);
      if (all) ctx.out(`/bin/${n}\n`);
    } else status = 1;
  }
  return status;
};

const command: Builtin = (sh, ctx, io) => {
  let i = 0;
  let mode: '' | 'v' | 'V' = '';
  while (i < ctx.args.length && /^-[pvV]+$/.test(ctx.args[i])) {
    if (ctx.args[i].includes('v')) mode = 'v';
    if (ctx.args[i].includes('V')) mode = 'V';
    i++;
  }
  const rest = ctx.args.slice(i);
  if (!rest.length) return 0;
  if (mode) {
    let status = 0;
    for (const n of rest) {
      const k = kindOf(sh, n);
      if (!k) {
        if (mode === 'V') ctx.err(`bash: command: ${n}: not found\n`);
        status = 1;
        continue;
      }
      if (mode === 'V') {
        const r = type(sh, { ...ctx, args: [n] }, io);
        if (r) status = r;
        continue;
      }
      if (k === 'alias') ctx.out(`alias ${n}='${sh.aliases.get(n)}'\n`);
      else if (k === 'file') ctx.out((n.includes('/') ? n : `/usr/bin/${n}`) + '\n');
      else ctx.out(n + '\n');
    }
    return status;
  }
  return sh.runNonFunction(rest, io);
};

const builtin: Builtin = (sh, ctx, io) => {
  const name = ctx.args[0];
  if (!name) return 0;
  if (!Object.prototype.hasOwnProperty.call(BUILTINS, name) && kindOf(sh, name) !== 'builtin') {
    ctx.err(`bash: builtin: ${name}: not a shell builtin\n`);
    return 1;
  }
  return sh.runNonFunction(ctx.args, io);
};

const evalBuiltin: Builtin = (sh, ctx, io) => {
  const text = ctx.args.join(' ');
  if (!text.trim()) return 0;
  return sh.evalText(text, io);
};

function numeric(ctx: CommandContext, name: string, fallback: number): number {
  if (!ctx.args.length) return fallback;
  const n = Number(ctx.args[0]);
  if (!Number.isInteger(n)) {
    ctx.err(`bash: ${name}: ${ctx.args[0]}: numeric argument required\n`);
    return 2;
  }
  return ((n % 256) + 256) % 256;
}

const exit: Builtin = (sh, ctx) => {
  throw new ExitSignal(numeric(ctx, 'exit', sh.state.lastExit));
};

const ret: Builtin = (sh, ctx) => {
  if (sh.locals.length === 0 && sh.scriptDepth === 0) {
    ctx.err("bash: return: can only `return' from a function or sourced script\n");
    return 1;
  }
  throw new ReturnSignal(numeric(ctx, 'return', sh.state.lastExit));
};

function loopControl(kind: 'break' | 'continue'): Builtin {
  return (sh, ctx) => {
    const n = ctx.args.length ? Number(ctx.args[0]) : 1;
    if (!Number.isInteger(n) || n < 1) {
      ctx.err(`bash: ${kind}: ${ctx.args[0]}: loop count out of range\n`);
      return 1;
    }
    if (sh.loopDepth === 0) {
      ctx.err(`bash: ${kind}: only meaningful in a \`for', \`while', or \`until' loop\n`);
      return 0;
    }
    throw new LoopSignal(kind, Math.min(n, sh.loopDepth));
  };
}

const letBuiltin: Builtin = (sh, ctx, io) => {
  if (!ctx.args.length) {
    ctx.err('bash: let: expression expected\n');
    return 1;
  }
  let last = 0n;
  for (const a of ctx.args) {
    try {
      last = evaluate(a, sh.arithEnv());
    } catch (e) {
      if (e instanceof ArithError) {
        sh.err(io, `bash: let: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }
  return last !== 0n ? 0 : 1;
};

const getopts: Builtin = (sh, ctx) => {
  const [spec, name, ...given] = ctx.args;
  if (spec === undefined || name === undefined) {
    ctx.err('getopts: usage: getopts optstring name [arg ...]\n');
    return 2;
  }
  const args = given.length ? given : sh.args;
  const silent = spec.startsWith(':');
  const letters = silent ? spec.slice(1) : spec;
  let optind = Number(sh.param('OPTIND') ?? '1') || 1;
  // Where inside a group like -abc the next letter is; kept in a private variable.
  let sub = Number(sh.param('__OPTCHAR') ?? '1') || 1;
  const arg = args[optind - 1];
  if (arg === undefined || arg === '--' || !arg.startsWith('-') || arg === '-') {
    if (arg === '--') optind++;
    sh.setVar('OPTIND', String(optind));
    sh.setVar(name, '?');
    sh.unsetVar('__OPTCHAR');
    return 1;
  }
  const ch = arg[sub];
  const nextLetter = () => {
    if (sub + 1 < arg.length) sh.setVar('__OPTCHAR', String(sub + 1));
    else {
      optind++;
      sh.unsetVar('__OPTCHAR');
    }
  };
  const at = letters.indexOf(ch);
  if (at < 0 || ch === ':') {
    nextLetter();
    sh.setVar('OPTIND', String(optind));
    sh.setVar(name, '?');
    if (silent) sh.setVar('OPTARG', ch);
    else {
      ctx.err(`${sh.arg0}: illegal option -- ${ch}\n`);
      sh.unsetVar('OPTARG');
    }
    return 0;
  }
  if (letters[at + 1] === ':') {
    let value: string | undefined;
    if (sub + 1 < arg.length) value = arg.slice(sub + 1);
    else value = args[optind];
    optind += sub + 1 < arg.length ? 1 : 2;
    sub = 1;
    sh.unsetVar('__OPTCHAR');
    if (value === undefined) {
      sh.setVar('OPTIND', String(optind - 1));
      if (silent) {
        sh.setVar(name, ':');
        sh.setVar('OPTARG', ch);
      } else {
        ctx.err(`${sh.arg0}: option requires an argument -- ${ch}\n`);
        sh.setVar(name, '?');
      }
      return 0;
    }
    sh.setVar('OPTARG', value);
  } else {
    nextLetter();
    sh.unsetVar('OPTARG');
  }
  sh.setVar('OPTIND', String(optind));
  sh.setVar(name, ch);
  return 0;
};

function cdTo(ctx: CommandContext, dir: string): number {
  return COMMANDS.cd({ ...ctx, name: 'cd', args: [dir] }) === 0 ? 0 : 1;
}

const pushd: Builtin = (sh, ctx) => {
  const arg = ctx.args.find((a) => a !== '-n');
  const show = () => ctx.out([sh.state.cwd, ...sh.dirStack].map(tild(sh)).join(' ') + '\n');
  if (arg === undefined) {
    const top = sh.dirStack[0];
    if (top === undefined) {
      ctx.err('bash: pushd: no other directory\n');
      return 1;
    }
    const cur = sh.state.cwd;
    if (cdTo(ctx, top)) return 1;
    sh.dirStack[0] = cur;
    show();
    return 0;
  }
  const cur = sh.state.cwd;
  if (cdTo({ ...ctx, err: (t) => ctx.err(t.replace(/^bash: cd:/, 'bash: pushd:')) }, arg)) return 1;
  sh.dirStack.unshift(cur);
  show();
  return 0;
};

const popd: Builtin = (sh, ctx) => {
  const top = sh.dirStack[0];
  if (top === undefined) {
    ctx.err('bash: popd: directory stack empty\n');
    return 1;
  }
  if (cdTo(ctx, top)) return 1;
  sh.dirStack.shift();
  ctx.out([sh.state.cwd, ...sh.dirStack].map(tild(sh)).join(' ') + '\n');
  return 0;
};

const tild = (sh: VirtualShell) => (p: string) => (p === sh.state.home ? '~' : p.startsWith(sh.state.home + '/') ? '~' + p.slice(sh.state.home.length) : p);

const dirs: Builtin = (sh, ctx) => {
  if (ctx.args.includes('-c')) {
    sh.dirStack = [];
    return 0;
  }
  const list = [sh.state.cwd, ...sh.dirStack].map(ctx.args.includes('-l') ? (p: string) => p : tild(sh));
  if (ctx.args.includes('-v')) ctx.out(list.map((d, i) => ` ${i}  ${d}\n`).join(''));
  else if (ctx.args.includes('-p')) ctx.out(list.map((d) => d + '\n').join(''));
  else ctx.out(list.join(' ') + '\n');
  return 0;
};

const umask: Builtin = (sh, ctx) => {
  const a = ctx.args.filter((x) => x !== '-S' && x !== '-p');
  if (!a.length) {
    if (ctx.args.includes('-S')) {
      const m = ~sh.umask & 0o777;
      const part = (s: number) => (m >> s & 4 ? 'r' : '') + (m >> s & 2 ? 'w' : '') + (m >> s & 1 ? 'x' : '');
      ctx.out(`u=${part(6)},g=${part(3)},o=${part(0)}\n`);
    } else ctx.out(sh.umask.toString(8).padStart(4, '0') + '\n');
    return 0;
  }
  if (!/^[0-7]{1,4}$/.test(a[0])) {
    ctx.err(`bash: umask: ${a[0]}: octal number out of range\n`);
    return 1;
  }
  sh.umask = parseInt(a[0], 8);
  return 0;
};

const printfBuiltin: Builtin = (sh, ctx) => {
  if (ctx.args[0] !== '-v') return COMMANDS.printf(ctx);
  const name = ctx.args[1];
  if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_]*(\[.*\])?$/.test(name)) {
    ctx.err(`bash: printf: \`${name ?? ''}': not a valid identifier\n`);
    return 2;
  }
  let captured = '';
  const status = COMMANDS.printf({ ...ctx, args: ctx.args.slice(2), out: (t) => (captured += t) });
  const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$/.exec(name)!;
  sh.setVar(m[1], captured, m[2]);
  return status;
};

const execBuiltin: Builtin = (sh, ctx, io) => {
  const args = ctx.args[0] === '-a' ? ctx.args.slice(2) : ctx.args.filter((a, i) => !(i === 0 && (a === '-c' || a === '-l')));
  if (!args.length) return 0;
  const status = sh.dispatch(args, io);
  if (sh.scriptDepth > 0 || sh.subshellDepth > 0) throw new ExitSignal(status);
  return status;
};

const trap: Builtin = (_sh, ctx) => {
  if (ctx.args[0] === '-l') {
    ctx.out(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\n 6) SIGABRT\t 7) SIGBUS\t 8) SIGFPE\t 9) SIGKILL\t10) SIGUSR1\n11) SIGSEGV\t12) SIGUSR2\t13) SIGPIPE\t14) SIGALRM\t15) SIGTERM\n');
  }
  return 0;
};

const jobs: Builtin = () => 0;

const noJob = (name: string): Builtin => (_sh, ctx) => {
  ctx.err(`bash: ${name}: ${ctx.args[0] ?? 'current'}: no such job\n`);
  return 1;
};

const shopt: Builtin = (sh, ctx) => {
  const known = ['autocd', 'cdspell', 'checkwinsize', 'cmdhist', 'dotglob', 'expand_aliases', 'extglob', 'extquote', 'failglob', 'globstar', 'histappend', 'interactive_comments', 'lastpipe', 'nocaseglob', 'nocasematch', 'nullglob', 'progcomp', 'promptvars', 'sourcepath', 'xpg_echo'];
  const on = new Set(['checkwinsize', 'cmdhist', 'expand_aliases', 'extquote', 'histappend', 'interactive_comments', 'progcomp', 'promptvars', 'sourcepath', ...Object.keys(sh.options).filter((k) => k.startsWith('shopt:') && sh.options[k]).map((k) => k.slice(6))]);
  const setting = ctx.args.includes('-s') ? true : ctx.args.includes('-u') ? false : null;
  const names = ctx.args.filter((a) => !a.startsWith('-'));
  for (const n of names) {
    if (!known.includes(n)) {
      ctx.err(`bash: shopt: ${n}: invalid shell option name\n`);
      return 1;
    }
  }
  if (setting !== null) {
    for (const n of names) sh.options['shopt:' + n] = setting;
    return 0;
  }
  const list = names.length ? names : known;
  for (const n of list) ctx.out(`${n.padEnd(15)}\t${on.has(n) ? 'on' : 'off'}\n`);
  return names.length && names.some((n) => !on.has(n)) ? 1 : 0;
};

const ulimit: Builtin = (_sh, ctx) => {
  if (ctx.args.includes('-a')) {
    ctx.out('real-time non-blocking time  (microseconds, -R) unlimited\ncore file size              (blocks, -c) 0\ndata seg size               (kbytes, -d) unlimited\nfile size                   (blocks, -f) unlimited\nmax memory size             (kbytes, -m) unlimited\nopen files                          (-n) 1024\npipe size                (512 bytes, -p) 8\nstack size                  (kbytes, -s) 8192\ncpu time                   (seconds, -t) unlimited\nmax user processes                  (-u) 7823\nvirtual memory              (kbytes, -v) unlimited\n');
    return 0;
  }
  ctx.out(ctx.args.includes('-n') ? '1024\n' : 'unlimited\n');
  return 0;
};

const kill: Builtin = (sh, ctx) => {
  if (ctx.args.some((a) => a.startsWith('%'))) {
    const job = ctx.args.find((a) => a.startsWith('%'))!;
    ctx.err(`bash: kill: ${job}: no such job\n`);
    return 1;
  }
  return sh.program('kill')!(ctx);
};

const caller: Builtin = (sh, ctx) => {
  if (!sh.funcNames.length) return 1;
  ctx.out(`1 ${sh.funcNames[1] ?? 'main'} ${sh.arg0}\n`);
  return 0;
};

const compgen: Builtin = (sh, ctx) => {
  const prefix = ctx.args.find((a) => !a.startsWith('-')) ?? '';
  let list: string[] = [];
  if (ctx.args.includes('-c')) list = sh.commandNames();
  else if (ctx.args.includes('-v')) list = [...sh.vars.keys()];
  else if (ctx.args.includes('-a')) list = [...sh.aliases.keys()];
  else if (ctx.args.includes('-b')) list = Object.keys(BUILTINS);
  else if (ctx.args.includes('-A') && ctx.args.includes('function')) list = [...sh.functions.keys()];
  const hits = list.filter((n) => n.startsWith(prefix)).sort();
  ctx.out(hits.map((h) => h + '\n').join(''));
  return hits.length ? 0 : 1;
};

export const BUILTINS: Record<string, Builtin> = {
  ':': () => 0,
  true: () => 0,
  false: () => 1,
  export: (sh, ctx) => declare(sh, ctx, 'export'),
  declare: (sh, ctx) => declare(sh, ctx, 'declare'),
  typeset: (sh, ctx) => declare(sh, ctx, 'declare'),
  local: (sh, ctx) => declare(sh, ctx, 'local'),
  readonly: (sh, ctx) => declare(sh, ctx, 'readonly'),
  unset,
  read,
  mapfile,
  readarray: mapfile,
  set,
  shift,
  alias,
  unalias,
  history,
  type,
  which,
  command,
  builtin,
  eval: evalBuiltin,
  exit,
  return: ret,
  break: loopControl('break'),
  continue: loopControl('continue'),
  let: letBuiltin,
  test: (sh, ctx, io) => testCommand(sh, 'test', ctx.args, io),
  '[': (sh, ctx, io) => testCommand(sh, '[', ctx.args, io),
  getopts,
  pushd,
  popd,
  dirs,
  umask,
  printf: printfBuiltin,
  exec: execBuiltin,
  trap,
  jobs,
  wait: () => 0,
  disown: () => 0,
  fg: noJob('fg'),
  bg: noJob('bg'),
  times: (_sh, ctx) => {
    ctx.out('0m0.012s 0m0.004s\n0m0.031s 0m0.010s\n');
    return 0;
  },
  shopt,
  hash: (_sh, ctx) => {
    if (!ctx.args.length) ctx.out('hash: hash table empty\n');
    return 0;
  },
  ulimit,
  kill,
  caller,
  compgen,
  logout: (_sh, ctx) => {
    ctx.err("bash: logout: not login shell: use `exit'\n");
    return 1;
  },
  enable: () => 0,
};
