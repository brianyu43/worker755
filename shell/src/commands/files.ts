// Filesystem commands: ls, mkdir, rmdir, touch, rm, mv, cp, chmod, stat, tree, find.

import type { Command, CommandContext } from './context.ts';
import {
  abs, fail, lq, lsTime, modeString, msgOf, nameCompare, ownerOf, pad2, parseOptions, q, statArg, usage,
} from './context.ts';
import { errorText, VfsError } from '../vfs.ts';
import { basename, dirname, isWithin, join } from '../path.ts';
import { globToRegex } from '../expand.ts';
import type { StatResult } from '../types.ts';

const DIR_SIZE = 4096;

function nameOf(path: string): string {
  return path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1);
}

/** Drop trailing slashes the way GNU tools do when building `dir/name`. */
function stripSlash(s: string): string {
  const t = s.replace(/\/+$/, '');
  return t === '' && s !== '' ? '/' : t;
}

// ---- ls ----------------------------------------------------------------------------------

interface LsEntry {
  name: string; // what to print
  st: StatResult;
}

function lsQuote(name: string, tty: boolean): string {
  if (!tty || !/[\s'"$`\\*?!&;|<>()[\]{}#~]/.test(name)) return name;
  return name.includes("'") ? `"${name}"` : `'${name}'`;
}

function humanSize(n: number): string {
  if (n < 1024) return String(n);
  const units = ['K', 'M', 'G', 'T'];
  let v = n;
  let u = -1;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + units[u];
}

function blocks(st: StatResult): number {
  return st.type === 'dir' ? 4 : Math.ceil(st.size / 4096) * 4;
}

function linkCount(ctx: CommandContext, st: StatResult): number {
  if (st.type !== 'dir') return 1;
  return 2 + ctx.fs.list(st.path).filter((c) => c.type === 'dir').length;
}

function lsLong(ctx: CommandContext, entries: LsEntry[], human: boolean): string {
  const now = ctx.state.now();
  const rows = entries.map((e) => ({
    mode: modeString(e.st.type, e.st.mode),
    links: String(linkCount(ctx, e.st)),
    size: e.st.type === 'dir' ? (human ? '4.0K' : String(DIR_SIZE)) : human ? humanSize(e.st.size) : String(e.st.size),
    time: lsTime(e.st.mtime, now),
    name: lsQuote(e.name, ctx.stdoutIsTty),
  }));
  const lw = Math.max(0, ...rows.map((r) => r.links.length));
  const sw = Math.max(0, ...rows.map((r) => r.size.length));
  const owners = entries.map((e) => ownerOf(ctx, e.st.path));
  const ow = Math.max(0, ...owners.map((o) => o.length));
  return rows.map((r, k) => `${r.mode} ${r.links.padStart(lw)} ${owners[k].padEnd(ow)} ${owners[k].padEnd(ow)} ${r.size.padStart(sw)} ${r.time} ${r.name}\n`).join('');
}

/** GNU ls column layout for an 80-column terminal, filled top-to-bottom. */
function lsColumns(names: string[], width = 80): string {
  if (names.length === 0) return '';
  for (let rows = 1; rows <= names.length; rows++) {
    const cols = Math.ceil(names.length / rows);
    const widths: number[] = [];
    for (let c = 0; c < cols; c++) {
      const col = names.slice(c * rows, (c + 1) * rows);
      widths.push(Math.max(...col.map((n) => n.length)) + (c === cols - 1 ? 0 : 2));
    }
    if (widths.reduce((a, b) => a + b, 0) <= width || rows === names.length) {
      let out = '';
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) {
          const n = names[c * rows + r];
          if (n === undefined) continue;
          line += c === cols - 1 ? n : n.padEnd(widths[c]);
        }
        out += line.trimEnd() + '\n';
      }
      return out;
    }
  }
  return names.join('\n') + '\n';
}

export const ls: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'alA1dhFrtS',
    invalidExit: 2,
    long: { all: 'a', 'almost-all': 'A', directory: 'd', 'human-readable': 'h', reverse: 'r', classify: 'F' },
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const long = f.has('l');
  const operands = opts.operands.length ? opts.operands : ['.'];
  let status = 0;

  const files: LsEntry[] = [];
  const dirs: { arg: string; st: StatResult }[] = [];
  for (const arg of operands) {
    const st = statArg(ctx, arg);
    if (typeof st === 'string') {
      ctx.err(`ls: cannot access ${q(arg)}: ${errorText(st)}\n`);
      status = 2;
      continue;
    }
    if (st.type === 'dir' && !f.has('d')) dirs.push({ arg, st });
    else files.push({ name: arg, st });
  }

  const order = (entries: LsEntry[]): LsEntry[] => {
    const sorted = [...entries];
    if (f.has('t')) sorted.sort((a, b) => b.st.mtime - a.st.mtime || nameCompare(a.name, b.name));
    else if (f.has('S')) sorted.sort((a, b) => b.st.size - a.st.size || nameCompare(a.name, b.name));
    else sorted.sort((a, b) => nameCompare(a.name, b.name));
    if (f.has('r')) sorted.reverse();
    return sorted;
  };
  const decorate = (e: LsEntry): string => {
    const name = lsQuote(e.name, ctx.stdoutIsTty);
    if (!f.has('F')) return name;
    if (e.st.type === 'dir') return name + '/';
    return e.st.mode & 0o111 ? name + '*' : name;
  };
  const render = (entries: LsEntry[]): string => {
    const sorted = order(entries);
    if (long) return lsLong(ctx, sorted, f.has('h'));
    const names = sorted.map(decorate);
    if (ctx.stdoutIsTty && !f.has('1')) return lsColumns(names);
    return names.map((n) => n + '\n').join('');
  };

  const chunks: string[] = [];
  if (files.length) chunks.push(render(files));
  const showHeaders = operands.length > 1;
  for (const { name: arg, st } of order(dirs.map((d) => ({ name: d.arg, st: d.st })))) {
    const path = st.path;
    let entries: LsEntry[] = ctx.fs.list(path).map((c) => ({ name: nameOf(c.path), st: c }));
    if (!f.has('a') && !f.has('A')) entries = entries.filter((e) => !e.name.startsWith('.'));
    if (f.has('a')) {
      const parent = ctx.fs.stat(dirname(path))!;
      entries.push({ name: '.', st }, { name: '..', st: parent });
    }
    let text = showHeaders ? `${arg}:\n` : '';
    if (long) text += `total ${entries.reduce((n, e) => n + blocks(e.st), 0)}\n`;
    text += render(entries);
    chunks.push(text);
  }
  ctx.out(chunks.join('\n'));
  return status;
};

// ---- mkdir / rmdir / touch ---------------------------------------------------------------

export const mkdir: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'pv', withValue: 'm', long: { parents: 'p', verbose: 'v', mode: 'm' } });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length === 0) return usage(ctx, 'missing operand');
  let mode: number | undefined;
  if (opts.values.has('m')) {
    const m = opts.values.get('m')!;
    if (!/^[0-7]{1,4}$/.test(m)) return usage(ctx, `invalid mode ${lq(m)}`);
    mode = parseInt(m, 8);
  }
  let status = 0;
  const made = (shown: string): void => {
    if (opts.flags.has('v')) ctx.out(`mkdir: created directory ${q(shown)}\n`);
  };
  for (const arg of opts.operands) {
    if (arg === '') {
      fail(ctx, `cannot create directory ${lq(arg)}: No such file or directory`);
      status = 1;
      continue;
    }
    if (opts.flags.has('p')) {
      // Walk the path as typed so errors name the component that failed.
      const parts = arg.split('/');
      let shown = '';
      for (let i = 0; i < parts.length; i++) {
        shown = i === 0 ? parts[0] : shown + '/' + parts[i];
        if (parts[i] === '' || parts[i] === '.' || parts[i] === '..') continue;
        const st = statArg(ctx, shown);
        if (typeof st !== 'string') {
          if (st.type === 'dir') continue;
          fail(ctx, `cannot create directory ${lq(shown)}: ${i === parts.length - 1 || parts.slice(i + 1).every((p) => p === '') ? 'File exists' : 'Not a directory'}`);
          status = 1;
          break;
        }
        try {
          ctx.fs.mkdir(abs(ctx, shown), { mode });
          made(shown);
        } catch (e) {
          fail(ctx, `cannot create directory ${lq(shown)}: ${msgOf(e)}`);
          status = 1;
          break;
        }
      }
      continue;
    }
    try {
      ctx.fs.mkdir(abs(ctx, arg), { mode });
      made(arg);
    } catch (e) {
      fail(ctx, `cannot create directory ${lq(arg)}: ${msgOf(e)}`);
      status = 1;
    }
  }
  return status;
};

export const rmdir: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'pv', long: { parents: 'p', verbose: 'v' } });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length === 0) return usage(ctx, 'missing operand');
  let status = 0;
  const removeOne = (arg: string): boolean => {
    if (basename(arg) === '.' || /(^|\/)\.\/*$/.test(arg)) {
      fail(ctx, `failed to remove ${q(arg)}: Invalid argument`);
      return false;
    }
    const st = statArg(ctx, arg);
    if (typeof st === 'string') {
      fail(ctx, `failed to remove ${q(arg)}: ${errorText(st)}`);
      return false;
    }
    try {
      ctx.fs.rmdir(st.path);
      if (opts.flags.has('v')) ctx.out(`rmdir: removing directory, ${q(arg)}\n`);
      return true;
    } catch (e) {
      fail(ctx, `failed to remove ${q(arg)}: ${msgOf(e)}`);
      return false;
    }
  };
  for (const arg of opts.operands) {
    if (!removeOne(arg)) {
      status = 1;
      continue;
    }
    if (opts.flags.has('p')) {
      let cur = stripSlash(arg);
      while (cur.includes('/')) {
        cur = cur.slice(0, cur.lastIndexOf('/'));
        if (cur === '' || !removeOne(cur)) break;
      }
    }
  }
  return status;
};

export const touch: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'acm', long: { 'no-create': 'c' } });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length === 0) return usage(ctx, 'missing file operand');
  let status = 0;
  for (const arg of opts.operands) {
    const st = statArg(ctx, arg);
    if (typeof st === 'string' && st !== 'ENOENT') {
      fail(ctx, `cannot touch ${q(arg)}: ${errorText(st)}`);
      status = 1;
      continue;
    }
    if (typeof st === 'string' && opts.flags.has('c')) continue;
    if (typeof st === 'string' && (arg === '' || arg.endsWith('/'))) {
      fail(ctx, `cannot touch ${q(arg)}: No such file or directory`);
      status = 1;
      continue;
    }
    try {
      ctx.fs.touch(abs(ctx, arg));
    } catch (e) {
      fail(ctx, `cannot touch ${q(arg)}: ${msgOf(e)}`);
      status = 1;
    }
  }
  return status;
};

// ---- rm ----------------------------------------------------------------------------------

export const rm: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'rRfdvi',
    long: { recursive: 'r', force: 'f', dir: 'd', verbose: 'v', 'no-preserve-root': 'P' },
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const recursive = f.has('r') || f.has('R');
  const force = f.has('f');
  if (opts.operands.length === 0) {
    if (force) return 0;
    return usage(ctx, 'missing operand');
  }
  let status = 0;
  for (const arg of opts.operands) {
    if (/(^|\/)\.\.?\/*$/.test(arg)) {
      fail(ctx, `refusing to remove '.' or '..' directory: skipping ${q(arg)}`);
      status = 1;
      continue;
    }
    const st = statArg(ctx, arg);
    if (typeof st === 'string') {
      if (!(force && st === 'ENOENT')) {
        fail(ctx, `cannot remove ${q(arg)}: ${errorText(st)}`);
        status = 1;
      }
      continue;
    }
    if (st.path === '/') {
      if (recursive && f.has('P')) {
        try {
          ctx.fs.removeAll();
        } catch (e) {
          fail(ctx, `cannot remove ${q(e instanceof VfsError ? e.path : arg)}: ${msgOf(e)}`);
          status = 1;
        }
        continue;
      }
      if (recursive) {
        ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
      } else {
        fail(ctx, `cannot remove ${q(arg)}: Is a directory`);
      }
      status = 1;
      continue;
    }
    if (st.type === 'dir' && !recursive) {
      if (!f.has('d')) {
        fail(ctx, `cannot remove ${q(arg)}: Is a directory`);
        status = 1;
        continue;
      }
      try {
        ctx.fs.rmdir(st.path);
      } catch (e) {
        fail(ctx, `cannot remove ${q(arg)}: ${msgOf(e)}`);
        status = 1;
        continue;
      }
    } else {
      try {
        ctx.fs.remove(st.path, true);
      } catch (e) {
        // A volume: its contents are gone, but the directory itself stays.
        fail(ctx, `cannot remove ${q(e instanceof VfsError ? e.path : arg)}: ${msgOf(e)}`);
        status = 1;
        continue;
      }
    }
    if (f.has('v')) ctx.out(`removed ${st.type === 'dir' ? 'directory ' : ''}${q(arg)}\n`);
  }
  return status;
};

// ---- mv / cp -----------------------------------------------------------------------------

interface Transfer {
  sources: string[];
  target: string;
  intoDir: boolean;
}

/** Shared operand handling for mv and cp. Returns an exit code after printing on error. */
function planTransfer(ctx: CommandContext, operands: string[], noTargetDir: boolean): Transfer | number {
  if (operands.length === 0) return usage(ctx, 'missing file operand');
  if (operands.length === 1) return usage(ctx, `missing destination file operand after ${q(operands[0])}`);
  const target = operands[operands.length - 1];
  const sources = operands.slice(0, -1);
  const tst = statArg(ctx, target);
  const targetIsDir = typeof tst !== 'string' && tst.type === 'dir';
  if (sources.length > 1 && !targetIsDir) {
    if (typeof tst === 'string') fail(ctx, `target ${q(target)}: ${errorText(tst)}`);
    else fail(ctx, `target ${q(target)} is not a directory`);
    return 1;
  }
  return { sources, target, intoDir: targetIsDir && !noTargetDir };
}

export const mv: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'finvT',
    long: { force: 'f', interactive: 'i', 'no-clobber': 'n', verbose: 'v', 'no-target-directory': 'T' },
  });
  if (typeof opts === 'number') return opts;
  const plan = planTransfer(ctx, opts.operands, opts.flags.has('T'));
  if (typeof plan === 'number') return plan;
  let status = 0;
  for (const src of plan.sources) {
    const sst = statArg(ctx, src);
    if (typeof sst === 'string') {
      fail(ctx, `cannot stat ${q(src)}: ${errorText(sst)}`);
      status = 1;
      continue;
    }
    const shownDest = plan.intoDir ? join(stripSlash(plan.target), nameOf(sst.path)) : plan.target;
    if (shownDest === '') {
      fail(ctx, `cannot move ${q(src)} to ${q(shownDest)}: No such file or directory`);
      status = 1;
      continue;
    }
    const dest = abs(ctx, shownDest);
    if (dest === sst.path) {
      fail(ctx, `${q(src)} and ${q(shownDest)} are the same file`);
      status = 1;
      continue;
    }
    if (sst.type === 'dir' && isWithin(sst.path, dest)) {
      fail(ctx, `cannot move ${q(src)} to a subdirectory of itself, ${q(shownDest)}`);
      status = 1;
      continue;
    }
    const dst = ctx.fs.stat(dest);
    if (dst && opts.flags.has('n')) continue;
    if (dst && dst.type === 'dir' && sst.type !== 'dir') {
      fail(ctx, `cannot overwrite directory ${q(shownDest)} with non-directory ${q(src)}`);
      status = 1;
      continue;
    }
    if (dst && dst.type !== 'dir' && sst.type === 'dir') {
      fail(ctx, `cannot overwrite non-directory ${q(shownDest)} with directory ${q(src)}`);
      status = 1;
      continue;
    }
    try {
      ctx.fs.rename(sst.path, dest);
      if (opts.flags.has('v')) ctx.out(`renamed ${q(src)} -> ${q(shownDest)}\n`);
    } catch (e) {
      fail(ctx, `cannot move ${q(src)} to ${q(shownDest)}: ${msgOf(e)}`);
      status = 1;
    }
  }
  return status;
};

export const cp: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, {
    flags: 'rRafinvpT',
    long: { recursive: 'r', archive: 'a', force: 'f', 'no-clobber': 'n', verbose: 'v', 'no-target-directory': 'T' },
  });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  const recursive = f.has('r') || f.has('R') || f.has('a');
  const plan = planTransfer(ctx, opts.operands, f.has('T'));
  if (typeof plan === 'number') return plan;
  let status = 0;
  for (const src of plan.sources) {
    const sst = statArg(ctx, src);
    if (typeof sst === 'string') {
      fail(ctx, `cannot stat ${q(src)}: ${errorText(sst)}`);
      status = 1;
      continue;
    }
    if (sst.type === 'dir' && !recursive) {
      fail(ctx, `-r not specified; omitting directory ${q(src)}`);
      status = 1;
      continue;
    }
    const shownDest = plan.intoDir ? join(stripSlash(plan.target), nameOf(sst.path)) : plan.target;
    if (shownDest === '') {
      fail(ctx, `cannot create ${sst.type === 'dir' ? 'directory' : 'regular file'} ${q(shownDest)}: No such file or directory`);
      status = 1;
      continue;
    }
    const dest = abs(ctx, shownDest);
    if (dest === sst.path) {
      fail(ctx, `${q(src)} and ${q(shownDest)} are the same file`);
      status = 1;
      continue;
    }
    if (sst.type === 'dir' && isWithin(sst.path, dest)) {
      fail(ctx, `cannot copy a directory, ${q(src)}, into itself, ${q(shownDest)}`);
      status = 1;
      continue;
    }
    const dst = statArg(ctx, shownDest);
    if (typeof dst !== 'string') {
      if (f.has('n')) continue;
      if (dst.type === 'dir' && sst.type !== 'dir') {
        fail(ctx, `cannot overwrite directory ${q(shownDest)} with non-directory`);
        status = 1;
        continue;
      }
      if (dst.type !== 'dir' && sst.type === 'dir') {
        fail(ctx, `cannot overwrite non-directory ${q(shownDest)} with directory ${q(src)}`);
        status = 1;
        continue;
      }
    }
    try {
      ctx.fs.copy(sst.path, dest, recursive);
      if (f.has('v')) ctx.out(`${q(src)} -> ${q(shownDest)}\n`);
    } catch (e) {
      const what = sst.type === 'dir' ? 'directory' : 'regular file';
      fail(ctx, `cannot create ${what} ${q(shownDest)}: ${msgOf(e)}`);
      status = 1;
    }
  }
  return status;
};

// ---- chmod -------------------------------------------------------------------------------

const UMASK = 0o022;

/** Apply an octal or symbolic mode (u+x, go-w, a=r, +x, u+x,g-w) to `mode`. Null when invalid. */
export function applyMode(spec: string, mode: number, isDir: boolean): number | null {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let result = mode;
  for (const clause of spec.split(',')) {
    const m = /^([ugoa]*)((?:[-+=][rwxXst]*)+)$/.exec(clause);
    if (!m) return null;
    let who = 0;
    for (const w of m[1]) who |= w === 'u' ? 0o4700 : w === 'g' ? 0o2070 : w === 'o' ? 0o1007 : 0o7777;
    const masked = m[1] === '';
    if (masked) who = 0o7777;
    for (const op of m[2].match(/[-+=][rwxXst]*/g)!) {
      let bits = 0;
      for (const p of op.slice(1)) {
        if (p === 'r') bits |= 0o444;
        else if (p === 'w') bits |= 0o222;
        else if (p === 'x') bits |= 0o111;
        else if (p === 'X') { if (isDir || result & 0o111) bits |= 0o111; }
        else if (p === 's') bits |= 0o6000;
        else if (p === 't') bits |= 0o1000;
      }
      bits &= who;
      if (masked) bits &= ~UMASK;
      if (op[0] === '+') result |= bits;
      else if (op[0] === '-') result &= ~bits;
      else result = (result & ~(who & 0o777)) | bits;
    }
  }
  return result & 0o7777;
}

export const chmod: Command = (ctx) => {
  // `chmod -x file` is a mode, not an option, so pick the mode out by hand.
  let recursive = false;
  let verbose = false;
  const rest: string[] = [];
  let modeArg: string | null = null;
  for (let i = 0; i < ctx.args.length; i++) {
    const a = ctx.args[i];
    if (a === '--') {
      rest.push(...ctx.args.slice(i + 1));
      break;
    }
    if (a === '-R' || a === '--recursive') recursive = true;
    else if (a === '-v' || a === '--verbose' || a === '-c' || a === '--changes') verbose = true;
    else if (a === '-f' || a === '--silent' || a === '--quiet') continue;
    else if (modeArg === null && /^-[rwxXst]+$/.test(a)) modeArg = a;
    else if (/^-(R|v|f|c)+$/.test(a)) {
      if (a.includes('R')) recursive = true;
      if (a.includes('v') || a.includes('c')) verbose = true;
    } else if (a.startsWith('--')) return usage(ctx, `unrecognized option '${a}'`);
    else if (a.startsWith('-') && a.length > 1 && modeArg !== null) return usage(ctx, `invalid option -- '${a[1]}'`);
    else rest.push(a);
  }
  if (modeArg === null) modeArg = rest.shift() ?? null;
  if (modeArg === null) return usage(ctx, 'missing operand');
  if (rest.length === 0) return usage(ctx, `missing operand after ${lq(modeArg)}`);
  if (applyMode(modeArg, 0o644, false) === null) return usage(ctx, `invalid mode: ${lq(modeArg)}`);

  let status = 0;
  const apply = (shown: string, path: string, st: StatResult): void => {
    const next = applyMode(modeArg!, st.mode, st.type === 'dir')!;
    ctx.fs.chmod(path, next);
    if (verbose && next !== st.mode) {
      const o = (n: number): string => n.toString(8).padStart(4, '0');
      ctx.out(`mode of ${q(shown)} changed from ${o(st.mode)} (${modeString(st.type, st.mode).slice(1)}) to ${o(next)} (${modeString(st.type, next).slice(1)})\n`);
    }
    if (recursive && st.type === 'dir') {
      for (const child of ctx.fs.list(path)) apply(join(shown, nameOf(child.path)), child.path, child);
    }
  };
  for (const arg of rest) {
    const st = statArg(ctx, arg);
    if (typeof st === 'string') {
      fail(ctx, `cannot access ${q(arg)}: ${errorText(st)}`);
      status = 1;
      continue;
    }
    apply(arg, st.path, st);
  }
  return status;
};

// ---- stat --------------------------------------------------------------------------------

function statTime(ms: number): string {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  return `${date} ${time}.${String((ms % 1000) * 1000000).padStart(9, '0')} +0000`;
}

export const stat: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'Lt', withValue: 'cf', long: { format: 'c' } });
  if (typeof opts === 'number') return opts;
  if (opts.operands.length === 0) return usage(ctx, 'missing operand');
  let status = 0;
  for (const arg of opts.operands) {
    const st = statArg(ctx, arg);
    if (typeof st === 'string') {
      fail(ctx, `cannot statx ${q(arg)}: ${errorText(st)}`);
      status = 1;
      continue;
    }
    const size = st.type === 'dir' ? DIR_SIZE : st.size;
    const blk = st.type === 'dir' ? 8 : Math.ceil(st.size / 4096) * 8;
    const user = ownerOf(ctx, st.path);
    const kind = st.type === 'dir' ? 'directory' : st.size === 0 ? 'regular empty file' : 'regular file';
    const mode = st.mode.toString(8).padStart(4, '0');
    const fmt = opts.values.get('c');
    if (fmt !== undefined) {
      ctx.out(
        fmt.replace(/%([nsaAFUGYy%])/g, (_m, c: string) => {
          switch (c) {
            case 'n': return arg;
            case 's': return String(size);
            case 'a': return st.mode.toString(8);
            case 'A': return modeString(st.type, st.mode);
            case 'F': return kind;
            case 'U': case 'G': return user;
            case 'Y': return String(Math.floor(st.mtime / 1000));
            case 'y': return statTime(st.mtime);
            default: return '%';
          }
        }) + '\n',
      );
      continue;
    }
    const t = statTime(st.mtime);
    const id = `(${(user === 'root' ? '0' : '1000').padStart(5)}/${user.padStart(8)})`;
    ctx.out(
      `  File: ${arg}\n` +
        `  Size: ${String(size).padEnd(10)}\tBlocks: ${String(blk).padEnd(10)} IO Block: 4096   ${kind}\n` +
        `Device: 0,34\tInode: ${1000 + (hash(st.path) % 9000000)}     Links: ${st.type === 'dir' ? 2 + ctx.fs.list(st.path).filter((c) => c.type === 'dir').length : 1}\n` +
        `Access: (${mode}/${modeString(st.type, st.mode)})  Uid: ${id}   Gid: ${id}\n` +
        `Access: ${t}\nModify: ${t}\nChange: ${t}\n Birth: ${t}\n`,
    );
  }
  return status;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

// ---- tree --------------------------------------------------------------------------------

export const tree: Command = (ctx) => {
  const opts = parseOptions(ctx, ctx.args, { flags: 'adfF', withValue: 'L', invalidExit: 2 });
  if (typeof opts === 'number') return opts;
  const f = opts.flags;
  let maxDepth = Infinity;
  if (opts.values.has('L')) {
    const n = Number(opts.values.get('L'));
    if (!Number.isInteger(n) || n < 1) {
      ctx.err('tree: Invalid level, must be greater than 0.\n');
      return 1;
    }
    maxDepth = n;
  }
  const roots = opts.operands.length ? opts.operands : ['.'];
  let dirs = 0;
  let files = 0;
  let status = 0;
  let out = '';
  const decorate = (name: string, st: StatResult): string =>
    !f.has('F') ? name : st.type === 'dir' ? name + '/' : st.mode & 0o111 ? name + '*' : name;
  const walk = (path: string, shown: string, prefix: string, depth: number): void => {
    let children = ctx.fs.list(path);
    if (!f.has('a')) children = children.filter((c) => !nameOf(c.path).startsWith('.'));
    if (f.has('d')) children = children.filter((c) => c.type === 'dir');
    children.sort((a, b) => nameCompare(nameOf(a.path), nameOf(b.path)));
    children.forEach((child, i) => {
      const last = i === children.length - 1;
      const name = nameOf(child.path);
      const childShown = join(shown, name);
      out += `${prefix}${last ? '└── ' : '├── '}${decorate(f.has('f') ? childShown : name, child)}\n`;
      if (child.type === 'dir') {
        dirs++;
        if (depth + 1 < maxDepth) walk(child.path, childShown, prefix + (last ? '    ' : '│   '), depth + 1);
      } else files++;
    });
  };
  for (const root of roots) {
    const st = statArg(ctx, root);
    if (typeof st === 'string' || st.type !== 'dir') {
      out += `${root}  [error opening dir]\n`;
      status = 2;
      continue;
    }
    out += root + '\n';
    walk(st.path, root, '', 0);
  }
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  out += `\n${plural(dirs, 'directory', 'directories')}`;
  if (!f.has('d')) out += `, ${plural(files, 'file', 'files')}`;
  ctx.out(out + '\n');
  return status;
};

// ---- find --------------------------------------------------------------------------------


/** One file as an expression sees it. */
interface Visit {
  shown: string;
  st: StatResult;
  depth: number;
}

type Expr = (v: Visit) => boolean;

/** find's expression, parsed: tests, actions, operators. */
interface FindPlan {
  expr: Expr;
  /** True when the expression has an action, so nothing is printed by default. */
  hasAction: boolean;
  maxDepth: number;
  minDepth: number;
  /** Visit a directory's contents before the directory itself (-depth, -delete). */
  depthFirst: boolean;
  /** Batches for `-exec … {} +`, run once the walk ends. */
  batches: { argv: string[]; paths: string[] }[];
}

/** Compare a number the way -size, -mtime and friends do: +n is more than n, -n less, n exactly. */
function numericTest(spec: string): ((n: number) => boolean) | null {
  const m = /^([+-]?)(\d+)$/.exec(spec);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === '+' ? (x) => x > n : m[1] === '-' ? (x) => x < n : (x) => x === n;
}

export const find: Command = (ctx) => {
  const args = ctx.args;
  let i = 0;
  const paths: string[] = [];
  while (i < args.length && (!args[i].startsWith('-') || args[i] === '-') && args[i] !== '!' && args[i] !== '(') paths.push(args[i++]);
  if (paths.length === 0) paths.push('.');

  const plan: FindPlan = { expr: () => true, hasAction: false, maxDepth: Infinity, minDepth: 0, depthFirst: false, batches: [] };
  let status = 0;
  let quit = false;
  const pruned = new Set<string>();
  let lastPredicate = '';
  class Bad extends Error {}
  const bad = (message: string): never => {
    ctx.err(message);
    throw new Bad();
  };
  const needArg = (a: string): string => {
    if (i >= args.length) bad(`find: missing argument to \`${a}'\n`);
    return args[i++];
  };

  // Recursive descent over: or := and (-o and)* ; and := unary ((-a)? unary)* ; unary := ! unary | ( or ) | primary
  const parseOr = (): Expr => {
    let left = parseAnd();
    while (args[i] === '-o' || args[i] === '-or') {
      i++;
      const l = left;
      const r = parseAnd();
      left = (v) => l(v) || r(v);
    }
    return left;
  };
  const parseAnd = (): Expr => {
    let left = parseUnary();
    while (i < args.length && args[i] !== '-o' && args[i] !== '-or' && args[i] !== ')' && args[i] !== ',') {
      if (args[i] === '-a' || args[i] === '-and') i++;
      const l = left;
      const r = parseUnary();
      left = (v) => l(v) && r(v);
    }
    return left;
  };
  const parseUnary = (): Expr => {
    const a = args[i];
    if (a === undefined) bad('find: expected an expression\n');
    if (a === '!' || a === '-not') {
      i++;
      const e = parseUnary();
      return (v) => !e(v);
    }
    if (a === '(') {
      i++;
      const e = parseOr();
      if (args[i] !== ')') bad("find: invalid expression; I was expecting to find a ')' somewhere but did not see one.\n");
      i++;
      return e;
    }
    i++;
    return primary(a);
  };

  const primary = (a: string): Expr => {
    switch (a) {
      case '-true':
        return () => true;
      case '-false':
        return () => false;
      case '-name':
      case '-iname': {
        const re = globToRegex(needArg(a), a === '-iname');
        lastPredicate = a;
        return (v) => re.test(v.shown === '/' ? '/' : nameOf(stripSlash(v.shown)));
      }
      case '-path':
      case '-wholename':
      case '-ipath': {
        const re = globToRegex(needArg(a), a === '-ipath');
        lastPredicate = a;
        return (v) => re.test(v.shown);
      }
      case '-regex':
      case '-iregex': {
        const src = needArg(a);
        let re: RegExp;
        try {
          re = new RegExp(`^(?:${src})$`, a === '-iregex' ? 'i' : '');
        } catch {
          return bad(`find: invalid regular expression ${lq(src)}\n`);
        }
        return (v) => re.test(v.shown);
      }
      case '-type': {
        const t = needArg(a);
        const kinds = t.split(',');
        if (!kinds.every((k) => /^[fdlbcps]$/.test(k))) bad(`find: Unknown argument to -type: ${t}\n`);
        return (v) => kinds.includes(v.st.type === 'file' ? 'f' : 'd');
      }
      case '-empty':
        return (v) => (v.st.type === 'dir' ? ctx.fs.list(v.st.path).length === 0 : v.st.size === 0);
      case '-size': {
        const spec = needArg(a);
        const m = /^([+-]?\d+)([bcwkMG]?)$/.exec(spec);
        if (!m) return bad(`find: invalid -size type in ${lq(spec)}\n`);
        const unit = { b: 512, c: 1, w: 2, k: 1024, M: 1024 ** 2, G: 1024 ** 3, '': 512 }[m[2]]!;
        const cmp = numericTest(m[1])!;
        // Sizes are rounded up to whole units, as GNU find does.
        return (v) => cmp(Math.ceil((v.st.type === 'dir' ? DIR_SIZE : v.st.size) / unit));
      }
      case '-mtime':
      case '-mmin': {
        const spec = needArg(a);
        const cmp = numericTest(spec);
        if (!cmp) return bad(`find: invalid argument ${lq(spec)} to ${lq(a)}\n`);
        const unit = a === '-mtime' ? 86_400_000 : 60_000;
        const now = ctx.state.now();
        return (v) => cmp(Math.floor((now - v.st.mtime) / unit));
      }
      case '-newer': {
        const ref = needArg(a);
        const st = statArg(ctx, ref);
        if (typeof st === 'string') return bad(`find: ${lq(ref)}: ${errorText(st)}\n`);
        return (v) => v.st.mtime > st.mtime;
      }
      case '-perm': {
        const spec = needArg(a);
        const m = /^([-/]?)([0-7]{1,4})$/.exec(spec);
        if (!m) return bad(`find: invalid mode ${lq(spec)}\n`);
        const mode = parseInt(m[2], 8);
        if (m[1] === '-') return (v) => (v.st.mode & mode) === mode;
        if (m[1] === '/') return (v) => mode === 0 || (v.st.mode & mode) !== 0;
        return (v) => (v.st.mode & 0o7777) === mode;
      }
      case '-executable':
        return (v) => (v.st.mode & 0o100) !== 0;
      case '-readable':
        return (v) => (v.st.mode & 0o400) !== 0;
      case '-writable':
        return (v) => (v.st.mode & 0o200) !== 0;
      case '-user':
      case '-group': {
        const who = needArg(a);
        return (v) => ownerOf(ctx, v.st.path) === who || (who === '1000' && ownerOf(ctx, v.st.path) !== 'root') || (who === '0' && ownerOf(ctx, v.st.path) === 'root');
      }
      case '-maxdepth':
      case '-mindepth': {
        const v = needArg(a);
        if (!/^\d+$/.test(v)) bad(`find: Expected a positive decimal integer argument to ${a}, but got ${lq(v)}\n`);
        if (a === '-maxdepth') plan.maxDepth = Number(v);
        else plan.minDepth = Number(v);
        return () => true;
      }
      case '-depth':
        plan.depthFirst = true;
        return () => true;
      case '-xdev':
      case '-mount':
      case '-noleaf':
      case '-follow':
        return () => true;
      case '-prune':
        return (v) => {
          if (v.st.type === 'dir') pruned.add(v.st.path);
          return true;
        };
      case '-quit':
        return () => {
          quit = true;
          return true;
        };
      case '-print':
        plan.hasAction = true;
        return (v) => {
          ctx.out(v.shown + '\n');
          return true;
        };
      case '-print0':
        plan.hasAction = true;
        return (v) => {
          ctx.out(v.shown + '\0');
          return true;
        };
      case '-printf': {
        plan.hasAction = true;
        const format = needArg(a);
        return (v) => {
          ctx.out(findPrintf(format, v));
          return true;
        };
      }
      case '-ls':
        plan.hasAction = true;
        return (v) => {
          const size = v.st.type === 'dir' ? DIR_SIZE : v.st.size;
          ctx.out(`${String(1000 + v.depth).padStart(7)} ${String(Math.ceil(size / 1024) * 4).padStart(6)} ${modeString(v.st.type, v.st.mode)}   1 ${ownerOf(ctx, v.st.path).padEnd(8)} ${ownerOf(ctx, v.st.path).padEnd(8)} ${String(size).padStart(8)} ${lsTime(v.st.mtime, ctx.state.now())} ${v.shown}\n`);
          return true;
        };
      case '-delete':
        plan.hasAction = true;
        plan.depthFirst = true;
        return (v) => {
          if (v.st.path === ctx.state.cwd && v.shown === '.') return true;
          try {
            if (v.st.type === 'dir') ctx.fs.rmdir(v.st.path);
            else ctx.fs.remove(v.st.path);
            return true;
          } catch (e) {
            ctx.err(`find: cannot delete ${lq(v.shown)}: ${msgOf(e)}\n`);
            status = 1;
            return false;
          }
        };
      case '-exec':
      case '-execdir':
      case '-ok':
      case '-okdir': {
        plan.hasAction = true;
        const argv: string[] = [];
        while (i < args.length && args[i] !== ';' && !(args[i] === '+' && argv[argv.length - 1] === '{}')) argv.push(args[i++]);
        if (i >= args.length || !argv.length) bad(`find: missing argument to \`${a}'\n`);
        const batch = args[i++] === '+';
        const inDir = a.endsWith('dir');
        const target = (v: Visit) => (inDir ? './' + nameOf(stripSlash(v.st.path)) : v.shown);
        if (batch) {
          const b = { argv: argv.slice(0, -1), paths: [] as string[] };
          plan.batches.push(b);
          return (v) => {
            b.paths.push(target(v));
            return true;
          };
        }
        return (v) => {
          const cmd = argv.map((w) => w.replaceAll('{}', target(v)));
          if (inDir) {
            const saved = ctx.state.cwd;
            ctx.state.cwd = v.st.type === 'dir' && v.depth === 0 ? v.st.path : dirname(v.st.path);
            try {
              return ctx.run(cmd, null) === 0;
            } finally {
              ctx.state.cwd = saved;
            }
          }
          return ctx.run(cmd, null) === 0;
        };
      }
      default:
        if (a.startsWith('-')) return bad(`find: unknown predicate \`${a}'\n`);
        ctx.err(`find: paths must precede expression: \`${a}'\n`);
        if (lastPredicate) ctx.err(`find: possible unquoted pattern after predicate \`${lastPredicate}'?\n`);
        throw new Bad();
    }
  };

  try {
    if (i < args.length) {
      plan.expr = parseOr();
      if (i < args.length) bad(`find: unexpected ${lq(args[i])}\n`);
    }
  } catch (e) {
    if (e instanceof Bad) return 1;
    throw e;
  }
  const expr = plan.expr;
  const check = (v: Visit): void => {
    if (v.depth < plan.minDepth) return;
    if (expr(v) && !plan.hasAction) ctx.out(v.shown + '\n');
  };
  const visit = (shown: string, st: StatResult, depth: number): void => {
    if (quit) return;
    ctx.tick();
    const v = { shown, st, depth };
    if (!plan.depthFirst) check(v);
    if (st.type === 'dir' && depth < plan.maxDepth && !pruned.has(st.path) && ctx.fs.stat(st.path)) {
      const children = [...ctx.fs.list(st.path)].sort((a, b) => nameCompare(nameOf(a.path), nameOf(b.path)));
      for (const child of children) visit(join(shown, nameOf(child.path)), child, depth + 1);
    }
    if (plan.depthFirst && !quit) check(v);
  };
  for (const p of paths) {
    const st = statArg(ctx, p);
    if (typeof st === 'string') {
      ctx.err(`find: ${lq(p)}: ${errorText(st)}\n`);
      status = 1;
      continue;
    }
    visit(p, st, 0);
  }
  for (const b of plan.batches) {
    // ARG_MAX-sized batches, as find does with `-exec … +`.
    for (let k = 0; k < b.paths.length; k += 5000) if (ctx.run([...b.argv, ...b.paths.slice(k, k + 5000)], null) !== 0) status = 1;
  }
  return status;
};

/** The directives of `find -printf` that make sense here. */
function findPrintf(format: string, v: Visit): string {
  const unescaped = format.replace(/\\([nt0\\])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === '0' ? '\0' : '\\'));
  return unescaped.replace(/%([-\d]*)([pfhPsdmMtTyk%])/g, (_m, width: string, d: string) => {
    let s: string;
    const p = v.shown;
    switch (d) {
      case 'p': s = p; break;
      case 'f': s = nameOf(stripSlash(p)); break;
      case 'h': s = p.includes('/') ? dirname(p) || '/' : '.'; break;
      case 'P': s = p.replace(/^[^/]*\/?/, ''); break;
      case 's': s = String(v.st.type === 'dir' ? DIR_SIZE : v.st.size); break;
      case 'k': s = String(Math.ceil((v.st.type === 'dir' ? DIR_SIZE : v.st.size) / 1024)); break;
      case 'd': s = String(v.depth); break;
      case 'm': s = (v.st.mode & 0o7777).toString(8); break;
      case 'M': s = modeString(v.st.type, v.st.mode); break;
      case 'y': s = v.st.type === 'dir' ? 'd' : 'f'; break;
      case 't': s = new Date(v.st.mtime).toUTCString(); break;
      case 'T': s = String(Math.floor(v.st.mtime / 1000)); break;
      case '%': s = '%'; break;
      default: s = '';
    }
    if (!width) return s;
    const w = Number(width.replace('-', ''));
    return width.startsWith('-') ? s.padEnd(w) : s.padStart(w);
  });
}
