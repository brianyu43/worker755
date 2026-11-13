// What a command sees when it runs, plus helpers shared by the command implementations.

import { errorText, VfsError } from '../vfs.ts';
import type { MemoryVfs } from '../vfs.ts';
import type { ExecResult, StatResult, Web } from '../types.ts';
import { resolvePath } from '../path.ts';

export type Action = NonNullable<ExecResult['action']>;

export interface ShellState {
  cwd: string;
  oldpwd: string | null;
  home: string;
  user: string;
  lastExit: number;
  now: () => number;
  web?: Web;
  hostname: string;
}

export interface CommandContext {
  name: string; // argv[0] as typed
  args: string[]; // argv[1..]
  stdin: string;
  stdinIsTty: boolean; // true when nothing was piped or redirected in
  stdoutIsTty: boolean; // true when stdout goes straight to the terminal
  fs: MemoryVfs;
  state: ShellState;
  out(text: string): void;
  err(text: string): void;
  setAction(action: Action): void;
  commandNames(): string[];
  /** True once stdout can take no more (a full pipe or the output cap), so endless writers stop. */
  outputFull(): boolean;
  /** Exported variables. */
  env(): Record<string, string>;
  /** Runs another command (xargs, env, find -exec, timeout) with this command's output; returns its status. */
  run(argv: string[], stdin?: string | null): number;
  /** Runs another command with its stdout collected instead of printed (awk's `cmd | getline`). */
  capture(argv: string[], stdin?: string | null): { status: number; stdout: string };
  /** Moves the clock forward instead of waiting. */
  sleep(ms: number): void;
  /** Counts one unit of work against the command line's budget; throws when it runs out. */
  tick(): void;
}

export type Command = (ctx: CommandContext) => number;

/** Absolute path for an argument, relative to the current directory. */
export function abs(ctx: CommandContext, path: string): string {
  return resolvePath(ctx.state.cwd, path);
}

/** Who owns a path: the player owns their home and what they put in /tmp; the system owns the rest. */
export function ownerOf(ctx: CommandContext, path: string): string {
  const home = ctx.state.home;
  if (path === home || path.startsWith(home + '/')) return ctx.state.user;
  if (/^\/(var\/)?tmp\/./.test(path)) return ctx.state.user;
  return 'root';
}

/** GNU 'shell-escape' quoting, used by ls, rm, cp, mv, …: 'name' */
export function q(s: string): string {
  return s.includes("'") ? `"${s}"` : `'${s}'`;
}

/** GNU 'locale' quoting, used by mkdir, chmod, head, find, …: ‘name’ */
export function lq(s: string): string {
  return `‘${s}’`;
}

export function codeOf(e: unknown): VfsError['code'] {
  return e instanceof VfsError ? e.code : 'EINVAL';
}

export function msgOf(e: unknown): string {
  return errorText(codeOf(e));
}

/** Print `name: message` to stderr. */
export function fail(ctx: CommandContext, message: string): void {
  ctx.err(`${ctx.name}: ${message}\n`);
}

/** Print a usage error with GNU's "Try … --help" hint and return `code`. */
export function usage(ctx: CommandContext, message: string, code = 1): number {
  ctx.err(`${ctx.name}: ${message}\nTry '${ctx.name} --help' for more information.\n`);
  return code;
}

/**
 * Stat an argument as the kernel would: a trailing slash on a non-directory is ENOTDIR.
 * Returns the stat result, or a VfsError code.
 */
export function statArg(ctx: CommandContext, arg: string): StatResult | VfsError['code'] {
  if (arg === '') return 'ENOENT'; // the empty path never names anything
  const p = abs(ctx, arg);
  const st = ctx.fs.stat(p);
  if (!st) {
    // Distinguish "a path component is a file" from plain missing.
    let cur = '';
    for (const part of p.split('/').filter(Boolean)) {
      cur += '/' + part;
      const s = ctx.fs.stat(cur);
      if (!s) return 'ENOENT';
      if (s.type === 'file' && cur !== p) return 'ENOTDIR';
    }
    return 'ENOENT';
  }
  if (st.type === 'file' && /\/\.?$/.test(arg)) return 'ENOTDIR';
  return st;
}

export interface ParsedOptions {
  flags: Set<string>;
  /** The last value given for each option letter. */
  values: Map<string, string>;
  /** Every value given for each option letter, in order (grep -e a -e b). */
  all: Map<string, string[]>;
  operands: string[];
}

export interface OptionSpec {
  flags?: string; // single-letter boolean flags
  withValue?: string; // single-letter options that take a value
  long?: Record<string, string>; // --long-name → letter
  help?: string; // text for --help
  invalidExit?: number; // exit code for an invalid option, default 1
}

/**
 * getopt-style parsing: combined short flags (-la), values attached or separate (-n5, -n 5),
 * `--` ends options, `-` alone is an operand. Options and operands may be interleaved, as
 * with GNU tools. Returns a number (the exit code) after printing an error or --help.
 */
export function parseOptions(ctx: CommandContext, args: string[], spec: OptionSpec): ParsedOptions | number {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const all = new Map<string, string[]>();
  const keep = (letter: string, v: string) => {
    values.set(letter, v);
    all.set(letter, [...(all.get(letter) ?? []), v]);
  };
  const operands: string[] = [];
  const allFlags = spec.flags ?? '';
  const withValue = spec.withValue ?? '';
  const bad = spec.invalidExit ?? 1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
      if (name === 'help') {
        ctx.out(spec.help ?? `Usage: ${ctx.name} [OPTION]... [FILE]...\n`);
        return 0;
      }
      const letter = spec.long?.[name];
      if (!letter) return usage(ctx, `unrecognized option '${a}'`, bad);
      if (withValue.includes(letter)) {
        const v = inline ?? args[++i];
        if (v === undefined) return usage(ctx, `option '--${name}' requires an argument`, bad);
        keep(letter, v);
      } else {
        flags.add(letter);
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        if (withValue.includes(ch)) {
          const v = j + 1 < a.length ? a.slice(j + 1) : args[++i];
          if (v === undefined) return usage(ctx, `option requires an argument -- '${ch}'`, bad);
          keep(ch, v);
          break;
        }
        if (!allFlags.includes(ch)) return usage(ctx, `invalid option -- '${ch}'`, bad);
        flags.add(ch);
      }
      continue;
    }
    operands.push(a);
  }
  return { flags, values, all, operands };
}

/** Split text into lines, each keeping its trailing newline (the last may lack one). */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n').map((l) => l + '\n');
  const last = lines.pop()!;
  if (last !== '\n') lines.push(last.slice(0, -1));
  return lines;
}

/** Lines without their newline characters. */
export function lineTexts(text: string): string[] {
  return splitLines(text).map((l) => (l.endsWith('\n') ? l.slice(0, -1) : l));
}

/** Sort names roughly the way `ls` does in an English locale: case-insensitive, dots ignored. */
export function nameCompare(a: string, b: string): number {
  const ka = a.replace(/^\.+/, '').toLowerCase();
  const kb = b.replace(/^\.+/, '').toLowerCase();
  if (ka !== kb) return ka < kb ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function modeString(type: 'file' | 'dir', mode: number): string {
  const bits = 'rwxrwxrwx';
  let s = type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += mode & (0o400 >> i) ? bits[i] : '-';
  return s;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = MONTHS;
export const DAY_NAMES = DAYS;

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `ls -l` timestamp: "Nov 11 10:52", or "Nov 11  2025" when older than six months. UTC. */
export function lsTime(ms: number, now: number): string {
  const d = new Date(ms);
  const head = `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')}`;
  const sixMonths = 182 * 24 * 3600 * 1000;
  if (now - ms > sixMonths || ms - now > 3600 * 1000) return `${head}  ${d.getUTCFullYear()}`;
  return `${head} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
