// The interpreter: parse a line, expand words, wire up pipes and redirects, run commands, functions,
// loops and conditionals. Everything happens in memory and synchronously; budgets on time, steps,
// nesting, output and variable size keep a runaway script from hanging or exhausting its host.

import { heredocWord, parseScript, ParseError } from './parser.ts';
import type { Command, List, Pipeline, Redirect, SimpleCommand, Word } from './parser.ts';
import { expandChars, expandString, expandWords, ExpandError, matchPattern, MAX_VALUE } from './expand.ts';
import type { ExpandHost } from './expand.ts';
import { evaluate, ArithError } from './arith.ts';
import { createVfs, errorText, MAX_FILE_BYTES } from './vfs.ts';
import type { MemoryVfs } from './vfs.ts';
import { basename, normalize, resolvePath } from './path.ts';
import { COMMANDS } from './commands/index.ts';
import type { Action, CommandContext, ShellState } from './commands/context.ts';
import { statArg } from './commands/context.ts';
import { BUILTINS, DECLARATION_BUILTINS } from './builtins.ts';
import { evalCond } from './cond.ts';
import { installSystem, HOSTNAME, seedSystem } from './system.ts';
import type { ExecResult, Shell, ShellOptions } from './types.ts';

/** Where an fd's output goes. Files are written when the redirect that opened them closes. */
export type Out =
  | { kind: 'tty'; stream: 'stdout' | 'stderr' }
  | { kind: 'buf'; buf: Buf }
  | { kind: 'file'; file: OpenFile }
  | { kind: 'null' };

export interface Buf {
  chunks: string[];
  size: number;
  full: boolean;
}

interface OpenFile {
  path: string;
  shown: string;
  chunks: string[];
  size: number;
  tooBig: boolean;
}

/** What a command reads on fd 0; `pos` advances as `read` takes lines. */
export interface Input {
  text: string;
  pos: number;
}

export interface Io {
  out: Map<number, Out>;
  /** null when fd 0 is the terminal (nothing to read). */
  stdin: Input | null;
}

export interface Var {
  scalar?: string;
  indexed?: Map<number, string>;
  assoc?: Map<string, string>;
  exported?: boolean;
  readonly?: boolean;
  integer?: boolean;
}

export interface FunctionDef {
  body: Command;
  source: string;
}

class RedirectError extends Error {}

/** `exit`: unwinds to the script, subshell or prompt that ran it. */
export class ExitSignal extends Error {
  readonly status: number;
  constructor(status: number) {
    super('exit');
    this.status = status;
  }
}

/** `return` from a function or sourced script. */
export class ReturnSignal extends Error {
  readonly status: number;
  constructor(status: number) {
    super('return');
    this.status = status;
  }
}

/** `break` / `continue` with how many loops are left to unwind. */
export class LoopSignal extends Error {
  readonly kind: 'break' | 'continue';
  levels: number;
  constructor(kind: 'break' | 'continue', levels: number) {
    super(kind);
    this.kind = kind;
    this.levels = levels;
  }
}

/** A budget ran out; the whole command line stops. */
class LimitError extends Error {}

/** An error a builtin reports with its message; the command fails with `status`. */
export class ShellError extends Error {
  readonly status: number;
  constructor(message: string, status = 1) {
    super(message);
    this.status = status;
  }
}

/** How deep scripts may call scripts, so one that runs itself stops instead of looping. */
const MAX_SCRIPT_DEPTH = 16;
/** How deep functions, substitutions and eval may nest. */
export const MAX_CALL_DEPTH = 100;
/** Commands and loop turns one command line may take. */
const MAX_STEPS = 2_000_000;
/** Wall-clock time one command line may take. */
export const DEFAULT_TIME_LIMIT_MS = 4000;
/** Characters all variables together may hold. */
const MAX_VAR_BYTES = 8_000_000;
const MAX_HISTORY = 1000;
/** Most a single command line may print, and most one pipe stage may pass on. Beyond it output is dropped. */
export const MAX_OUTPUT = 1_000_000;
/** Longest command line or script text the parser takes. */
const MAX_SOURCE = 1_100_000;

export const PID = 4242;

/** Everything about the shell besides its files, for saving and restoring a session. */
export interface ShellSnapshot {
  cwd: string;
  oldpwd: string | null;
  lastExit: number;
  vars: [string, Var][];
  functions: [string, FunctionDef][];
  aliases: [string, string][];
  history: string[];
  options: Record<string, boolean>;
  dirStack: string[];
  clock: number;
  umask: number;
}

export class VirtualShell implements Shell {
  readonly fs: MemoryVfs;
  state: ShellState;
  vars = new Map<string, Var>();
  functions = new Map<string, FunctionDef>();
  aliases = new Map<string, string>();
  /** $1… of the script or function running now. */
  args: string[] = [];
  /** $0 */
  arg0 = 'bash';
  options: Record<string, boolean> = { errexit: false, nounset: false, xtrace: false, pipefail: false, noglob: false, noclobber: false };
  /** Saved bindings for each function call, restored when it returns. */
  locals: Map<string, Var | undefined>[] = [];
  funcNames: string[] = [];
  history: string[] = [];
  dirStack: string[] = [];
  umask = 0o022;
  /** Milliseconds `sleep` has skipped ahead. */
  clock = 0;
  /** Nesting of scripts run by bash/sh/./source. */
  scriptDepth = 0;
  /** Nesting of functions, substitutions, eval. */
  callDepth = 0;
  loopDepth = 0;
  /** >0 while evaluating a condition, where `set -e` does not apply. */
  private condDepth = 0;
  /** Inside a ( … ), $( … ) or pipeline stage. */
  subshellDepth = 0;
  lastBg = 0;
  private jobs = 0;
  private steps = 0;
  private deadline = 0;
  private timeLimit: number;
  private result: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
  private parseCache = new Map<string, List>();
  private start: number;
  private random = 0x5eed;

  constructor(options: ShellOptions = {}) {
    const baseNow = options.now ?? Date.now;
    const home = normalize(options.home ?? '/home/worker');
    this.fs = createVfs(baseNow);
    this.fs.mkdir(home, { recursive: true });
    this.fs.mount(home);
    this.timeLimit = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
    this.start = baseNow();
    this.state = {
      cwd: home,
      oldpwd: null,
      home,
      user: options.user ?? 'worker',
      lastExit: 0,
      now: () => baseNow() + this.clock,
      web: options.web,
      hostname: options.hostname ?? HOSTNAME,
    };
    const user = this.state.user;
    const scalars: Record<string, string> = {
      HOME: home, USER: user, LOGNAME: user, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin',
      TERM: 'xterm-256color', LANG: 'C.UTF-8', HOSTNAME: this.state.hostname, SHLVL: '1', IFS: ' \t\n',
      PS1: '\\u@\\h:\\w\\$ ', PS2: '> ', PS4: '+ ', HISTSIZE: '1000', OPTIND: '1', BASH: '/bin/bash',
      BASH_VERSION: '5.2.21(1)-release', OSTYPE: 'linux-gnu', HOSTTYPE: 'x86_64', MACHTYPE: 'x86_64-pc-linux-gnu',
      UID: '1000', EUID: '1000', PPID: '1', COLUMNS: '80', LINES: '24', EDITOR: 'nano',
    };
    const exported = new Set(['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TERM', 'LANG', 'HOSTNAME', 'SHLVL', 'EDITOR']);
    for (const [k, v] of Object.entries(scalars)) {
      this.vars.set(k, { scalar: v, exported: exported.has(k), readonly: k === 'UID' || k === 'EUID' || k === 'PPID' });
    }
    if (options.system !== false) {
      seedSystem(this.fs, { user, home, hostname: this.state.hostname });
      this.installSystem();
    }
  }

  /** Adds /dev, /proc, /bin and /usr/bin; again after a snapshot is loaded, since /usr comes with it. */
  installSystem(): void {
    installSystem(this);
  }

  get cwd(): string {
    return this.state.cwd;
  }

  set cwd(path: string) {
    this.state.cwd = resolvePath(this.state.cwd, path);
  }

  get home(): string {
    return this.state.home;
  }

  get user(): string {
    return this.state.user;
  }

  resolve(path: string): string {
    if (path === '~' || path.startsWith('~/')) return normalize(this.state.home + path.slice(1));
    return resolvePath(this.state.cwd, path);
  }

  /** Every command name the shell knows: builtins, programs, functions, aliases. */
  commandNames(): string[] {
    return [...new Set([...Object.keys(BUILTINS), ...Object.keys(COMMANDS), ...this.functions.keys(), ...this.aliases.keys()])].sort();
  }

  // ---- saving and restoring ------------------------------------------------------------

  snapshot(): ShellSnapshot {
    return {
      cwd: this.state.cwd,
      oldpwd: this.state.oldpwd,
      lastExit: this.state.lastExit,
      vars: [...this.vars].map(([k, v]) => [k, cloneVar(v)]),
      functions: [...this.functions],
      aliases: [...this.aliases],
      history: [...this.history],
      options: { ...this.options },
      dirStack: [...this.dirStack],
      clock: this.clock,
      umask: this.umask,
    };
  }

  restore(s: ShellSnapshot): void {
    this.state.cwd = s.cwd;
    this.state.oldpwd = s.oldpwd;
    this.state.lastExit = s.lastExit;
    this.vars = new Map(s.vars.map(([k, v]) => [k, cloneVar(v)]));
    this.functions = new Map(s.functions);
    this.aliases = new Map(s.aliases);
    this.history = [...s.history];
    this.options = { ...s.options };
    this.dirStack = [...s.dirStack];
    this.clock = s.clock;
    this.umask = s.umask;
  }

  // ---- running a line ------------------------------------------------------------------

  exec(line: string): ExecResult {
    const result: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
    this.result = result;
    this.steps = 0;
    this.deadline = Date.now() + this.timeLimit;
    this.callDepth = 0;
    this.scriptDepth = 0;
    this.loopDepth = 0;
    this.condDepth = 0;
    this.subshellDepth = 0;
    this.locals = [];
    this.funcNames = [];
    try {
      let text = String(line ?? '');
      if (text.length > MAX_SOURCE) {
        result.stderr = 'bash: command line too long\n';
        return this.finish(result, 1);
      }
      if (text.includes('!')) {
        const h = this.historyExpand(text);
        if (h.error) {
          result.stderr = h.error + '\n';
          return this.finish(result, 1);
        }
        if (h.text !== text) {
          result.stdout += h.text + '\n';
          text = h.text;
        }
      }
      if (text.trim()) {
        if (this.history[this.history.length - 1] !== text) this.history.push(text);
        if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
      }
      let list: List;
      try {
        const parsed = parseScript(text, { aliases: this.aliases.size ? this.aliases : undefined });
        list = parsed.list;
        for (const w of parsed.warnings) result.stderr += w + '\n';
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        result.stderr += e.message + '\n';
        return this.finish(result, 2);
      }
      const io = this.ttyIo();
      let status: number;
      try {
        status = this.runList(list, io, true);
      } catch (e) {
        status = this.unwindTop(e, io);
      }
      return this.finish(result, status);
    } catch {
      // Defensive: exec must never throw.
      result.stderr += 'bash: internal error\n';
      return this.finish(result, 1);
    }
  }

  private finish(result: ExecResult, status: number): ExecResult {
    result.exitCode = status;
    this.state.lastExit = status;
    return result;
  }

  /** What a signal that reached the prompt means. */
  private unwindTop(e: unknown, io: Io): number {
    if (e instanceof ExitSignal) {
      // An interactive shell would close here; the terminal starts a fresh one in the same place.
      this.write(io.out.get(2)!, 'exit\n');
      return e.status;
    }
    if (e instanceof ReturnSignal) return e.status;
    if (e instanceof LoopSignal) return 0;
    if (e instanceof LimitError) {
      this.write({ kind: 'tty', stream: 'stderr' }, `${e.message}\n`);
      return 130;
    }
    // Errors that abort the whole line in bash, such as too-deep function nesting.
    if (e instanceof ShellError) {
      this.write({ kind: 'tty', stream: 'stderr' }, `${e.message}\n`);
      return e.status;
    }
    if (e instanceof RangeError) {
      this.write({ kind: 'tty', stream: 'stderr' }, 'bash: stopped: nested too deeply\n');
      return 1;
    }
    throw e;
  }

  ttyIo(): Io {
    return {
      out: new Map<number, Out>([
        [1, { kind: 'tty', stream: 'stdout' }],
        [2, { kind: 'tty', stream: 'stderr' }],
      ]),
      stdin: null,
    };
  }

  tick(): void {
    this.steps++;
    if (this.steps > MAX_STEPS || ((this.steps & 127) === 0 && Date.now() > this.deadline)) {
      throw new LimitError(`bash: stopped: the command ran longer than ${Math.round(this.timeLimit / 1000)} seconds`);
    }
  }

  // ---- output --------------------------------------------------------------------------

  write(target: Out, text: string): void {
    if (text === '') return;
    switch (target.kind) {
      case 'tty': {
        const r = this.result;
        const room = MAX_OUTPUT - r.stdout.length - r.stderr.length;
        if (room <= 0) break;
        r[target.stream] += text.length > room ? text.slice(0, room) + '\n[output truncated]\n' : text;
        break;
      }
      case 'buf': {
        const b = target.buf;
        if (b.full) break;
        if (b.size + text.length > MAX_OUTPUT) {
          b.chunks.push(text.slice(0, MAX_OUTPUT - b.size));
          b.size = MAX_OUTPUT;
          b.full = true;
          break;
        }
        b.chunks.push(text);
        b.size += text.length;
        break;
      }
      case 'file': {
        const f = target.file;
        if (f.tooBig) break;
        f.size += text.length;
        if (f.size > MAX_FILE_BYTES * 2) f.tooBig = true;
        else f.chunks.push(text);
        break;
      }
      case 'null':
        break;
    }
  }

  isFull(target: Out): boolean {
    if (target.kind === 'buf') return target.buf.full;
    if (target.kind === 'tty') return this.result.stdout.length + this.result.stderr.length >= MAX_OUTPUT;
    if (target.kind === 'file') return target.file.tooBig;
    return false;
  }

  err(io: Io, text: string): void {
    this.write(io.out.get(2) ?? { kind: 'tty', stream: 'stderr' }, text);
  }

  // ---- lists and pipelines -------------------------------------------------------------

  runList(list: List, io: Io, top = false): number {
    let status = this.state.lastExit;
    let ran = false;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (ran && item.op === '&&' && status !== 0) continue;
      if (ran && item.op === '||' && status === 0) continue;
      const next = list[i + 1];
      // Only the last command of an && / || chain can trip `set -e`.
      const guarded = next !== undefined && (next.op === '&&' || next.op === '||');
      if (guarded) this.condDepth++;
      try {
        if (item.background) {
          this.runPipeline(item.pipeline, io);
          this.lastBg = PID + 10 + ++this.jobs;
          if (top && this.scriptDepth === 0) this.err(io, `[${this.jobs}] ${this.lastBg}\n`);
          status = 0;
        } else {
          status = this.runPipeline(item.pipeline, io);
        }
      } finally {
        if (guarded) this.condDepth--;
      }
      this.state.lastExit = status;
      ran = true;
      if (status !== 0 && this.options.errexit && !guarded && this.condDepth === 0 && !item.pipeline.negate && (this.scriptDepth > 0 || this.subshellDepth > 0)) {
        throw new ExitSignal(status);
      }
    }
    return ran ? status : 0;
  }

  runPipeline(p: Pipeline, io: Io): number {
    const started = Date.now();
    let status: number;
    if (p.negate) this.condDepth++;
    try {
      if (p.commands.length === 1) {
        status = this.runCommand(p.commands[0], io);
        this.setPipeStatus([status]);
      } else {
        const statuses: number[] = [];
        let stdin = io.stdin;
        p.commands.forEach((cmd, i) => {
          const last = i === p.commands.length - 1;
          const buf: Buf = { chunks: [], size: 0, full: false };
          const out = new Map(io.out);
          if (!last) {
            out.set(1, { kind: 'buf', buf });
            if (p.withStderr?.[i]) out.set(2, { kind: 'buf', buf });
          }
          const stageIo: Io = { out, stdin };
          statuses.push(this.inSubshell(() => this.runCommand(cmd, stageIo)));
          stdin = last ? null : { text: buf.chunks.join(''), pos: 0 };
        });
        status = statuses[statuses.length - 1];
        if (this.options.pipefail) status = [...statuses].reverse().find((s) => s !== 0) ?? 0;
        this.setPipeStatus(statuses);
      }
    } finally {
      if (p.negate) this.condDepth--;
    }
    if (p.timed) {
      const s = (Date.now() - started) / 1000;
      this.err(io, `\nreal\t0m${s.toFixed(3)}s\nuser\t0m${(s * 0.6).toFixed(3)}s\nsys\t0m${(s * 0.1).toFixed(3)}s\n`);
    }
    return p.negate ? (status === 0 ? 1 : 0) : status;
  }

  private setPipeStatus(statuses: number[]): void {
    this.vars.set('PIPESTATUS', { indexed: new Map(statuses.map((s, i) => [i, String(s)])) });
  }

  /** Runs `fn` with its own copy of variables, functions, options and directory, as a forked shell. */
  inSubshell(fn: () => number): number {
    const saved = this.snapshot();
    const savedArgs = this.args;
    const savedArg0 = this.arg0;
    const savedLocals = this.locals;
    const savedFuncs = this.funcNames;
    this.locals = this.locals.map((m) => new Map(m));
    this.subshellDepth++;
    try {
      return fn();
    } catch (e) {
      if (e instanceof ExitSignal) return e.status;
      if (e instanceof ReturnSignal) return e.status;
      if (e instanceof LoopSignal) return 0;
      throw e;
    } finally {
      this.subshellDepth--;
      const lastExit = this.state.lastExit;
      this.restore(saved);
      this.state.lastExit = lastExit;
      this.args = savedArgs;
      this.arg0 = savedArg0;
      this.locals = savedLocals;
      this.funcNames = savedFuncs;
    }
  }

  // ---- commands ------------------------------------------------------------------------

  runCommand(cmd: Command, io: Io): number {
    switch (cmd.type) {
      case 'simple':
        return this.runSimple(cmd, io);
      case 'func':
        this.functions.set(cmd.name, { body: cmd.body, source: cmd.source });
        return 0;
    }
    return this.withRedirects(cmd.redirects, io, (io2) => this.runCompound(cmd, io2));
  }

  private condition(list: List, io: Io): number {
    this.condDepth++;
    try {
      return this.runList(list, io);
    } finally {
      this.condDepth--;
    }
  }

  /** Runs a loop body; true when the loop should stop (break). */
  private loopBody(body: List, io: Io, status: { v: number }): boolean {
    try {
      status.v = this.runList(body, io);
      return false;
    } catch (e) {
      if (!(e instanceof LoopSignal)) throw e;
      if (e.levels > 1) {
        e.levels--;
        throw e;
      }
      return e.kind === 'break';
    }
  }

  private runCompound(cmd: Exclude<Command, SimpleCommand | { type: 'func' }>, io: Io): number {
    switch (cmd.type) {
      case 'group':
        return this.runList(cmd.body, io);
      case 'subshell':
        return this.inSubshell(() => this.runList(cmd.body, io));
      case 'if': {
        for (const clause of cmd.clauses) {
          if (this.condition(clause.cond, io) === 0) return this.runList(clause.body, io);
        }
        return cmd.elseBody ? this.runList(cmd.elseBody, io) : 0;
      }
      case 'while': {
        const status = { v: 0 };
        this.loopDepth++;
        try {
          for (;;) {
            this.tick();
            const c = this.condition(cmd.cond, io);
            if (cmd.until ? c === 0 : c !== 0) break;
            if (this.loopBody(cmd.body, io, status)) break;
          }
        } finally {
          this.loopDepth--;
        }
        return status.v;
      }
      case 'for': {
        const items = cmd.items ? expandWords(cmd.items, this.host(io)) : [...this.args];
        const status = { v: 0 };
        this.loopDepth++;
        try {
          for (const item of items) {
            this.tick();
            this.setVar(cmd.name, item);
            if (this.loopBody(cmd.body, io, status)) break;
          }
        } finally {
          this.loopDepth--;
        }
        return status.v;
      }
      case 'cfor': {
        const status = { v: 0 };
        this.loopDepth++;
        try {
          if (cmd.init.trim()) this.arith(cmd.init, io);
          for (;;) {
            this.tick();
            if (cmd.cond.trim() && this.arith(cmd.cond, io) === 0n) break;
            if (this.loopBody(cmd.body, io, status)) break;
            if (cmd.step.trim()) this.arith(cmd.step, io);
          }
        } catch (e) {
          if (e instanceof ExpandError) {
            this.err(io, e.message + '\n');
            return 1;
          }
          throw e;
        } finally {
          this.loopDepth--;
        }
        return status.v;
      }
      case 'case': {
        const host = this.host(io);
        const word = expandString(cmd.word, host);
        for (let i = 0; i < cmd.items.length; i++) {
          const item = cmd.items[i];
          if (!item.patterns.some((p) => matchPattern(expandChars(p, host), word))) continue;
          let status = this.runList(item.body, io);
          let j = i;
          // ;& runs the next body as well; ;;& goes on testing patterns.
          while (cmd.items[j].end === ';&' && j + 1 < cmd.items.length) {
            j++;
            status = this.runList(cmd.items[j].body, io);
          }
          if (cmd.items[j].end === ';;&') {
            i = j;
            continue;
          }
          return status;
        }
        return 0;
      }
      case 'arith':
        try {
          return this.arith(cmd.source, io, '((') !== 0n ? 0 : 1;
        } catch (e) {
          if (e instanceof ExpandError) {
            this.err(io, e.message + '\n');
            return 1;
          }
          throw e;
        }
      case 'cond':
        try {
          return evalCond(this, cmd.tokens, io);
        } catch (e) {
          if (e instanceof ExpandError || e instanceof ShellError) {
            this.err(io, e.message + '\n');
            return e instanceof ShellError ? e.status : 1;
          }
          throw e;
        }
    }
  }

  /** Evaluates arithmetic after expanding $ references in it. */
  arith(source: string, io: Io, label = ''): bigint {
    const host = this.host(io);
    const text = source.includes('$') || source.includes('`') ? expandString(heredocWord(source), host) : source;
    try {
      return evaluate(text, this.arithEnv());
    } catch (e) {
      if (e instanceof ArithError) throw new ExpandError(`bash: ${label ? label + ': ' : ''}${e.message}`);
      throw e;
    }
  }

  arithEnv() {
    return {
      get: (name: string, index: string | null) => (index === null ? this.param(name) : this.element(name, index)) ?? '',
      set: (name: string, index: string | null, value: string) => this.setVar(name, value, index === null ? undefined : index),
    };
  }

  // ---- simple commands -----------------------------------------------------------------

  private runSimple(cmd: SimpleCommand, io: Io): number {
    this.tick();
    const host = this.host(io);
    let argv: string[];
    this.substStatus = null;
    try {
      argv = this.expandArgs(cmd.words, host);
    } catch (e) {
      return this.expandFailed(e, io);
    }
    if (argv.length === 0) {
      // Assignments alone change the shell; redirects alone create or truncate files.
      try {
        for (const a of cmd.assigns) this.assign(a, host);
      } catch (e) {
        return this.expandFailed(e, io);
      }
      const status = this.substStatus ?? 0;
      if (cmd.redirects.length) return this.withRedirects(cmd.redirects, io, () => status);
      return status;
    }
    // Assignments in front of a command hold for that command only.
    let restoreTemp: (() => void) | null = null;
    if (cmd.assigns.length) {
      const saved: [string, Var | undefined][] = [];
      try {
        for (const a of cmd.assigns) {
          const name = a.assign!.name;
          saved.push([name, this.vars.has(name) ? cloneVar(this.vars.get(name)!) : undefined]);
          this.assign(a, host);
          const v = this.vars.get(name);
          if (v) v.exported = true;
        }
      } catch (e) {
        return this.expandFailed(e, io);
      }
      restoreTemp = () => {
        for (const [name, v] of saved.reverse()) {
          if (v) this.vars.set(name, v);
          else this.vars.delete(name);
        }
      };
    }
    try {
      if (this.options.xtrace) {
        const ps4 = this.param('PS4') ?? '+ ';
        this.err(io, `${ps4}${argv.map(traceQuote).join(' ')}\n`);
      }
      return this.withRedirects(cmd.redirects, io, (io2) => this.dispatch(argv, io2, cmd.words));
    } finally {
      restoreTemp?.();
    }
  }

  /** Status of the last command substitution while expanding the current command. */
  substStatus: number | null = null;

  /** Array values given to export/local/declare (`a=(1 2)`), by argument position. */
  declArrays = new Map<number, string[]>();

  private expandArgs(words: Word[], host: ExpandHost): string[] {
    this.declArrays = new Map();
    if (!words.length) return [];
    const first = expandWords([words[0]], host);
    if (first.length === 1 && DECLARATION_BUILTINS.has(first[0]) && words.length > 1) {
      // export/local/declare: name=value arguments are not split or globbed.
      const out = [...first];
      for (const w of words.slice(1)) {
        const t = w.parts[0];
        if (t && t.kind === 'text' && !t.quoted && /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(t.text)) {
          if (w.array) {
            this.declArrays.set(out.length, expandWords(w.array, host));
            out.push(t.text);
          } else out.push(expandString(w, host));
        } else out.push(...expandWords([w], host));
      }
      return out;
    }
    return [...first, ...expandWords(words.slice(1), host)];
  }

  private expandFailed(e: unknown, io: Io): number {
    if (e instanceof ExpandError || e instanceof ShellError) {
      this.err(io, e.message + '\n');
      if (e instanceof ExpandError && e.fatal && this.scriptDepth > 0) throw new ExitSignal(1);
      return e instanceof ShellError ? e.status : 1;
    }
    throw e;
  }

  /** Applies one `name=value` word. */
  assign(w: Word, host: ExpandHost): void {
    const a = w.assign!;
    if (w.array) {
      const items = expandWords(w.array, host);
      this.setArray(a.name, items, a.append, w.array);
      return;
    }
    const value = expandString(w, host);
    this.setVar(a.name, value, a.index, a.append);
  }

  /** Runs a command by name: function, builtin, script, or program. */
  dispatch(argv: string[], io: Io, words?: Word[]): number {
    const name = argv[0];
    const fn = this.functions.get(name);
    if (fn) return this.callFunction(name, fn, argv.slice(1), io);
    return this.runNonFunction(argv, io, words);
  }

  runNonFunction(argv: string[], io: Io, words?: Word[]): number {
    const name = argv[0];
    const builtin = Object.prototype.hasOwnProperty.call(BUILTINS, name) ? BUILTINS[name] : undefined;
    const ctx = this.context(argv, io);
    if (builtin) {
      try {
        return builtin(this, ctx, io, words);
      } catch (e) {
        if (e instanceof ShellError) {
          ctx.err(e.message + '\n');
          return e.status;
        }
        if (e instanceof ExpandError) {
          ctx.err(e.message + '\n');
          return 1;
        }
        throw e;
      }
    }
    const script = this.scriptCommand(name, argv.slice(1), io);
    if (script !== null) return script;
    const program = this.program(name);
    if (!program) {
      this.err(io, `bash: ${name}: ${name.includes('/') ? 'No such file or directory' : 'command not found'}\n`);
      return 127;
    }
    let status: number;
    try {
      status = program(ctx);
    } catch (e) {
      if (e instanceof ExitSignal || e instanceof LimitError || e instanceof ReturnSignal || e instanceof LoopSignal) throw e;
      ctx.err(`${ctx.name}: internal error\n`);
      status = 1;
    }
    if (io.stdin) io.stdin.pos = io.stdin.text.length;
    return status;
  }

  /** A program by name, or by its path in /usr/bin or /bin. */
  program(name: string) {
    let n = name;
    if (name.includes('/')) {
      const p = this.resolve(name);
      const m = /^\/(?:usr\/(?:local\/)?)?bin\/([^/]+)$/.exec(p);
      if (!m) return undefined;
      n = m[1];
    }
    return Object.prototype.hasOwnProperty.call(COMMANDS, n) ? COMMANDS[n] : undefined;
  }

  context(argv: string[], io: Io): CommandContext {
    const out1 = io.out.get(1)!;
    const stdin = io.stdin ? io.stdin.text.slice(io.stdin.pos) : null;
    return {
      name: argv[0],
      args: argv.slice(1),
      stdin: stdin ?? '',
      stdinIsTty: stdin === null,
      stdoutIsTty: out1.kind === 'tty' && out1.stream === 'stdout',
      fs: this.fs,
      state: this.state,
      out: (text) => this.write(io.out.get(1)!, text),
      err: (text) => this.write(io.out.get(2)!, text),
      outputFull: () => this.isFull(io.out.get(1)!),
      setAction: (action: Action) => {
        this.result.action = action;
      },
      commandNames: () => this.commandNames(),
      env: () => this.environment(),
      run: (args, input) => {
        this.tick();
        const sub: Io = { out: io.out, stdin: input === undefined ? io.stdin : input === null ? null : { text: input, pos: 0 } };
        return this.dispatch(args, sub);
      },
      capture: (args, input) => {
        this.tick();
        const buf: Buf = { chunks: [], size: 0, full: false };
        const out = new Map(io.out);
        out.set(1, { kind: 'buf', buf });
        const sub: Io = { out, stdin: input === undefined ? io.stdin : input === null ? null : { text: input, pos: 0 } };
        const status = this.inSubshell(() => this.dispatch(args, sub));
        return { status, stdout: buf.chunks.join('') };
      },
      sleep: (ms) => {
        this.clock += Math.max(0, ms);
      },
      tick: () => this.tick(),
    };
  }

  /** Exported variables, as a program sees its environment. */
  environment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of [...this.vars].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!v.exported) continue;
      const value = k === 'PWD' ? this.state.cwd : k === 'OLDPWD' ? this.state.oldpwd ?? '' : scalarOf(v);
      if (value !== null) env[k] = value;
    }
    env.PWD = this.state.cwd;
    if (this.state.oldpwd) env.OLDPWD = this.state.oldpwd;
    return env;
  }

  callFunction(name: string, fn: FunctionDef, args: string[], io: Io): number {
    if (this.callDepth >= MAX_CALL_DEPTH) {
      throw new ShellError(`bash: ${name}: maximum function nesting level exceeded (${MAX_CALL_DEPTH})`);
    }
    const savedArgs = this.args;
    this.args = args;
    this.callDepth++;
    this.locals.push(new Map());
    this.funcNames.unshift(name);
    try {
      return this.runCommand(fn.body, io);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.status;
      throw e;
    } finally {
      this.funcNames.shift();
      const scope = this.locals.pop()!;
      for (const [k, v] of scope) {
        if (v) this.vars.set(k, v);
        else this.vars.delete(k);
      }
      this.callDepth--;
      this.args = savedArgs;
    }
  }

  // ---- redirects -----------------------------------------------------------------------

  /** Opens `redirects`, runs `fn` with them in place, then writes out the files they opened. */
  withRedirects(redirects: Redirect[], io: Io, fn: (io: Io) => number): number {
    if (!redirects.length) return fn(io);
    const next: Io = { out: new Map(io.out), stdin: io.stdin };
    const opened: OpenFile[] = [];
    try {
      this.applyRedirects(redirects, next, opened);
    } catch (e) {
      if (e instanceof RedirectError || e instanceof ExpandError) {
        this.err(io, e.message + '\n');
        this.flush(opened, io);
        return 1;
      }
      throw e;
    }
    try {
      return fn(next);
    } finally {
      this.flush(opened, io);
    }
  }

  private flush(files: OpenFile[], io: Io): void {
    for (const f of files) {
      if (f.tooBig) {
        this.err(io, `bash: ${f.shown}: write error: ${errorText('EFBIG')}\n`);
        continue;
      }
      if (!f.chunks.length) continue;
      try {
        this.fs.appendFile(f.path, f.chunks.join(''));
      } catch (e) {
        // A full disk or an oversized file is reported, as bash does; a file that vanished while the
        // command ran (`rm -r . > log`) just loses the output, as on Linux.
        const code = (e as { code?: string }).code;
        if (code === 'EFBIG' || code === 'ENOSPC') this.err(io, `bash: ${f.shown}: write error: ${errorText(code)}\n`);
      }
    }
  }

  /** Open a redirect target for writing. Truncates (or creates) now, as bash does. */
  private openOutput(shown: string, append: boolean, force: boolean, io: Io, opened: OpenFile[]): Out {
    if (shown === '') throw new RedirectError('bash: : No such file or directory');
    const path = resolvePath(this.state.cwd, shown);
    switch (path) {
      case '/dev/null':
      case '/dev/zero':
      case '/dev/random':
      case '/dev/urandom':
        return { kind: 'null' };
      case '/dev/stdout':
      case '/dev/fd/1':
        return io.out.get(1)!;
      case '/dev/stderr':
      case '/dev/fd/2':
        return io.out.get(2)!;
      case '/dev/tty':
        return { kind: 'tty', stream: 'stdout' };
      case '/dev/full':
        throw new RedirectError(`bash: ${shown}: ${errorText('ENOSPC')}`);
    }
    const st = this.fs.stat(path);
    if (st?.type === 'dir' || (shown.endsWith('/') && !st)) throw new RedirectError(`bash: ${shown}: Is a directory`);
    if (st && this.options.noclobber && !append && !force) throw new RedirectError(`bash: ${shown}: cannot overwrite existing file`);
    try {
      if (append) this.fs.appendFile(path, '');
      else this.fs.writeFile(path, '');
    } catch (e) {
      const code = (e as { code?: string }).code;
      const known = code === 'ENOTDIR' || code === 'EISDIR' || code === 'EFBIG' || code === 'ENOSPC' || code === 'EACCES';
      throw new RedirectError(`bash: ${shown}: ${errorText(known ? (code as 'EACCES') : 'ENOENT')}`);
    }
    const existing = opened.find((f) => f.path === path);
    if (existing) return { kind: 'file', file: existing };
    const file: OpenFile = { path, shown, chunks: [], size: 0, tooBig: false };
    opened.push(file);
    return { kind: 'file', file };
  }

  private readInputFile(target: string, io: Io): Input {
    const path = resolvePath(this.state.cwd, target);
    if (path === '/dev/stdin' || path === '/dev/fd/0') return io.stdin ?? { text: '', pos: 0 };
    if (path === '/dev/null') return { text: '', pos: 0 };
    const st = statArg({ fs: this.fs, state: this.state } as CommandContext, target);
    if (typeof st === 'string') throw new RedirectError(`bash: ${target}: ${errorText(st)}`);
    if (st.type === 'dir') throw new RedirectError(`bash: ${target}: Is a directory`);
    return { text: this.fs.readFile(st.path), pos: 0 };
  }

  private applyRedirects(redirects: Redirect[], io: Io, opened: OpenFile[]): void {
    const host = this.host(io);
    for (const r of redirects) {
      if (r.op === '<<' || r.op === '<<-') {
        const text = r.heredoc ? expandString(r.heredoc, host) : '';
        if (r.fd === 0) io.stdin = { text, pos: 0 };
        continue;
      }
      if (r.op === '<<<') {
        const text = expandString(r.target, host) + '\n';
        if (r.fd === 0) io.stdin = { text, pos: 0 };
        continue;
      }
      const words = expandWordsSafe(r.target, host);
      const raw = r.target.parts.map((p) => (p.kind === 'text' ? p.text : p.kind === 'param' ? '$' + p.name : '$(…)')).join('');
      if (words.length !== 1) throw new RedirectError(`bash: ${raw}: ambiguous redirect`);
      const target = words[0];
      if (r.op === '<' || r.op === '<>') {
        if (r.op === '<>' && !this.fs.stat(resolvePath(this.state.cwd, target))) this.openOutput(target, true, true, io, []);
        const input = this.readInputFile(target, io);
        if (r.fd === 0) io.stdin = input;
        continue;
      }
      if (r.op === '<&') {
        if (target === '-') {
          if (r.fd === 0) io.stdin = { text: '', pos: 0 };
          continue;
        }
        if (!/^\d+$/.test(target)) throw new RedirectError(`bash: ${target}: ambiguous redirect`);
        continue;
      }
      if (r.op === '>&' && /^\d+$/.test(target)) {
        const src = io.out.get(Number(target));
        if (!src) throw new RedirectError(`bash: ${target}: Bad file descriptor`);
        io.out.set(r.fd, src);
        continue;
      }
      if (r.op === '>&' && target === '-') {
        io.out.set(r.fd, { kind: 'null' });
        continue;
      }
      const both = r.op === '&>' || r.op === '&>>' || (r.op === '>&' && r.fd === 1);
      const out = this.openOutput(target, r.op === '>>' || r.op === '&>>', r.op === '>|', io, opened);
      if (both) {
        io.out.set(1, out);
        io.out.set(2, out);
      } else {
        io.out.set(r.fd, out);
      }
    }
  }

  // ---- scripts -------------------------------------------------------------------------

  /**
   * Running scripts: a path typed as a command (./deploy.sh), bash/sh with a file or -c, source and `.`.
   * Returns the exit status, or null when `name` is none of these.
   */
  private scriptCommand(name: string, args: string[], io: Io): number | null {
    if (name.includes('/')) {
      const path = this.resolve(name);
      if (this.program(name)) return null;
      const st = this.fs.stat(path);
      if (!st) {
        this.err(io, `bash: ${name}: No such file or directory\n`);
        return 127;
      }
      if (st.type === 'dir') {
        this.err(io, `bash: ${name}: Is a directory\n`);
        return 126;
      }
      if (!(st.mode & 0o100)) {
        this.err(io, `bash: ${name}: Permission denied\n`);
        return 126;
      }
      const text = this.fs.readFile(path);
      const shebang = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(text);
      if (shebang) {
        const interp = shebang[1] === '/usr/bin/env' ? shebang[2] ?? '' : basename(shebang[1]);
        if (!['bash', 'sh', 'dash', 'zsh'].includes(interp)) {
          const shown = shebang[1] === '/usr/bin/env' ? `/usr/bin/env: ‘${interp}’: No such file or directory` : `bash: ${name}: ${shebang[1]}: bad interpreter: No such file or directory`;
          this.err(io, shown + '\n');
          return shebang[1] === '/usr/bin/env' ? 127 : 126;
        }
      }
      return this.runScript(text, name, args, false, io);
    }
    if (name === 'bash' || name === 'sh') {
      let i = 0;
      const opts: string[] = [];
      while (i < args.length && QUIET_FLAGS.test(args[i]) && args[i] !== '-c') {
        opts.push(args[i]);
        i += args[i] === '-o' ? 2 : 1;
      }
      const flags = opts.join('');
      const withOpts = (fn: () => number): number => {
        const saved = { ...this.options };
        if (flags.includes('e')) this.options.errexit = true;
        if (flags.includes('u')) this.options.nounset = true;
        if (flags.includes('x')) this.options.xtrace = true;
        try {
          return fn();
        } finally {
          this.options = saved;
        }
      };
      if (args[i] === '-c') {
        if (i + 1 >= args.length) {
          this.err(io, `${name}: -c: option requires an argument\n`);
          return 2;
        }
        return withOpts(() => this.runScript(args[i + 1], args[i + 2] ?? name, args.slice(i + 3), false, io));
      }
      if (args[i] === '--version') {
        this.write(io.out.get(1)!, 'GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\n');
        return 0;
      }
      if (i >= args.length) {
        if (io.stdin !== null) {
          const text = io.stdin.text.slice(io.stdin.pos);
          io.stdin.pos = io.stdin.text.length;
          return withOpts(() => this.runScript(text, name, [], false, io));
        }
        this.err(io, `${name}: an interactive shell inside the terminal is not supported; run a script with ${name} FILE\n`);
        return 1;
      }
      const file = args[i];
      const st = this.fs.stat(this.resolve(file));
      if (!st) {
        this.err(io, `${name}: ${file}: No such file or directory\n`);
        return 127;
      }
      if (st.type === 'dir') {
        this.err(io, `${name}: ${file}: Is a directory\n`);
        return 126;
      }
      return withOpts(() => this.runScript(this.fs.readFile(this.resolve(file)), file, args.slice(i + 1), false, io));
    }
    if (name === 'source' || name === '.') {
      if (!args.length) {
        this.err(io, `bash: ${name}: filename argument required\n${name}: usage: ${name} filename [arguments]\n`);
        return 2;
      }
      const st = this.fs.stat(this.resolve(args[0]));
      if (!st || st.type === 'dir') {
        this.err(io, `bash: ${args[0]}: ${st ? 'Is a directory' : 'No such file or directory'}\n`);
        return 1;
      }
      return this.runScript(this.fs.readFile(this.resolve(args[0])), null, args.slice(1), true, io);
    }
    return null;
  }

  /**
   * Runs a script's text with its output going where the command's output goes. A script run by bash
   * is a child shell: its variables, functions and directory stay in it. A sourced one runs in this shell.
   * `name` is $0 for a child shell; null for source, which keeps $0.
   */
  runScript(text: string, name: string | null, args: string[], sourced: boolean, io: Io): number {
    if (this.scriptDepth >= MAX_SCRIPT_DEPTH) {
      this.err(io, `bash: ${name ?? 'source'}: maximum script nesting level exceeded (${MAX_SCRIPT_DEPTH})\n`);
      return 1;
    }
    if (text.length > MAX_SOURCE) {
      this.err(io, `bash: ${name}: script too long\n`);
      return 1;
    }
    let list: List;
    try {
      const parsed = parseScript(text);
      list = parsed.list;
      for (const w of parsed.warnings) this.err(io, `${name ?? 'bash'}: ${w.replace(/^bash: /, '')}\n`);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.err(io, `${name ?? 'bash'}: ${e.message.replace(/^bash: /, '')}\n`);
      return 2;
    }
    const savedArgs = this.args;
    const savedArg0 = this.arg0;
    const savedLoop = this.loopDepth;
    this.scriptDepth++;
    this.loopDepth = 0;
    if (!sourced || args.length) this.args = args;
    if (name !== null) this.arg0 = name;
    try {
      if (sourced) {
        try {
          return this.runList(list, io);
        } catch (e) {
          if (e instanceof ReturnSignal) return e.status;
          throw e;
        }
      }
      return this.inSubshell(() => this.runList(list, io));
    } finally {
      this.scriptDepth--;
      this.loopDepth = savedLoop;
      this.args = savedArgs;
      this.arg0 = savedArg0;
    }
  }

  /** Runs text as commands in this shell (eval, source of a string). */
  evalText(text: string, io: Io): number {
    if (this.callDepth >= MAX_CALL_DEPTH) throw new ShellError(`bash: eval: maximum nesting level exceeded (${MAX_CALL_DEPTH})`);
    let list: List;
    try {
      list = parseScript(text).list;
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      throw new ShellError(`bash: eval: ${e.message.replace(/^bash: /, '')}`, 2);
    }
    this.callDepth++;
    try {
      return this.runList(list, io);
    } finally {
      this.callDepth--;
    }
  }

  // ---- command substitution ------------------------------------------------------------

  commandSubst(source: string, io: Io): string {
    if (this.callDepth >= MAX_CALL_DEPTH) throw new ExpandError(`bash: command substitution: maximum nesting level exceeded (${MAX_CALL_DEPTH})`);
    let list = this.parseCache.get(source);
    if (!list) {
      try {
        list = parseScript(source).list;
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        throw new ExpandError(`bash: command substitution: ${e.message.replace(/^bash: /, '')}`);
      }
      if (this.parseCache.size > 200) this.parseCache.clear();
      this.parseCache.set(source, list);
    }
    const buf: Buf = { chunks: [], size: 0, full: false };
    const sub: Io = { out: new Map(io.out), stdin: io.stdin };
    sub.out.set(1, { kind: 'buf', buf });
    this.callDepth++;
    let status: number;
    try {
      const parsed = list;
      status = this.inSubshell(() => this.runList(parsed, sub));
    } finally {
      this.callDepth--;
    }
    this.state.lastExit = status;
    this.substStatus = status;
    return buf.chunks.join('').replace(/\n+$/, '');
  }

  // ---- variables -----------------------------------------------------------------------

  host(io: Io): ExpandHost {
    return {
      fs: this.fs,
      cwd: this.state.cwd,
      home: this.state.home,
      ifs: () => this.param('IFS') ?? ' \t\n',
      noglob: () => this.options.noglob,
      nounset: () => this.options.nounset,
      param: (name) => this.param(name),
      paramList: (name) => this.paramList(name),
      element: (name, index) => this.element(name, index, io),
      keys: (name) => this.keys(name),
      names: (prefix) => [...this.vars.keys()].filter((k) => k.startsWith(prefix)).sort(),
      assign: (name, value) => {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(.*)\])?$/.exec(name)!;
        this.setVar(m[1], value, m[2]);
      },
      commandSubst: (source) => this.commandSubst(source, io),
      arith: (source) => String(this.arith(source, io)),
      userHome: (user) => (user === this.state.user ? this.state.home : user === 'root' ? '/root' : this.fs.isDir(`/home/${user}`) ? `/home/${user}` : null),
    };
  }

  /** A scalar parameter: special, positional, or variable (element 0 of an array). */
  param(name: string): string | null {
    switch (name) {
      case '?': return String(this.state.lastExit);
      case '$': return String(PID);
      case '!': return this.lastBg ? String(this.lastBg) : null;
      case '#': return String(this.args.length);
      case '-': return `h${this.options.errexit ? 'e' : ''}${this.options.noglob ? 'f' : ''}${this.options.nounset ? 'u' : ''}${this.options.xtrace ? 'x' : ''}B${this.options.noclobber ? 'C' : ''}H${this.scriptDepth === 0 ? 'i' : ''}`;
      case '0': return this.arg0;
      case '@':
      case '*': return this.args.join(' ');
      case 'PWD': return this.state.cwd;
      case 'OLDPWD': return this.state.oldpwd;
      case 'RANDOM': {
        this.random = (this.random * 1103515245 + 12345 + (Date.now() & 0xff)) & 0x7fffffff;
        return String(this.random % 32768);
      }
      case 'SECONDS': return String(Math.floor((this.state.now() - this.start) / 1000));
      case 'EPOCHSECONDS': return String(Math.floor(this.state.now() / 1000));
      case 'EPOCHREALTIME': return (this.state.now() / 1000).toFixed(6);
      case 'LINENO': return '1';
      case 'BASHPID': return String(PID + this.subshellDepth);
      case 'FUNCNAME': return this.funcNames[0] ?? null;
    }
    if (/^\d+$/.test(name)) return this.args[Number(name) - 1] ?? null;
    const v = this.vars.get(name);
    return v ? scalarOf(v) : null;
  }

  paramList(name: string): string[] | null {
    if (name === '@' || name === '*') return [...this.args];
    if (name === 'FUNCNAME') return this.funcNames.length ? [...this.funcNames] : null;
    const v = this.vars.get(name);
    if (!v) return null;
    if (v.indexed) return [...v.indexed.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
    if (v.assoc) return [...v.assoc.values()];
    return v.scalar === undefined ? [] : [v.scalar];
  }

  keys(name: string): string[] {
    const v = this.vars.get(name);
    if (!v) return [];
    if (v.indexed) return [...v.indexed.keys()].sort((a, b) => a - b).map(String);
    if (v.assoc) return [...v.assoc.keys()];
    return v.scalar === undefined ? [] : ['0'];
  }

  /** Index of an indexed array from a raw subscript. */
  private indexOf(name: string, raw: string, io?: Io): number {
    const n = raw.trim();
    let i = /^-?\d+$/.test(n) ? Number(n) : Number(this.arith(raw, io ?? this.ttyIo()));
    if (i < 0) {
      const v = this.vars.get(name);
      const max = v?.indexed ? Math.max(-1, ...v.indexed.keys()) : v?.scalar !== undefined ? 0 : -1;
      i = max + 1 + i;
      if (i < 0) throw new ExpandError(`bash: ${name}: bad array subscript`);
    }
    return i;
  }

  private assocKey(raw: string, io?: Io): string {
    return expandString(heredocWord(raw), this.host(io ?? this.ttyIo()));
  }

  element(name: string, raw: string, io?: Io): string | null {
    if (name === 'FUNCNAME') return this.funcNames[this.indexOf(name, raw, io)] ?? null;
    const v = this.vars.get(name);
    if (!v) return null;
    if (v.assoc) return v.assoc.get(this.assocKey(raw, io)) ?? null;
    const i = this.indexOf(name, raw, io);
    if (v.indexed) return v.indexed.get(i) ?? null;
    return i === 0 ? v.scalar ?? null : null;
  }

  /** Sets a scalar, or one element when `index` is given. Throws ShellError for read-only variables. */
  setVar(name: string, value: string, index?: string, append = false): void {
    let v = this.vars.get(name);
    if (v?.readonly) throw new ShellError(`bash: ${name}: readonly variable`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new ShellError(`bash: \`${name}': not a valid identifier`);
    if (value.length > MAX_VALUE) throw new ShellError(`bash: ${name}: value too long`);
    if (!v) {
      v = {};
      this.vars.set(name, v);
    }
    let val = value;
    if (v.integer) {
      const cur = index === undefined ? scalarOf(v) : this.element(name, index);
      const n = this.arith(value || '0', this.ttyIo());
      val = String(append ? BigInt(this.arith(cur || '0', this.ttyIo())) + n : n);
    }
    if (index !== undefined) {
      if (v.assoc) {
        const k = this.assocKey(index);
        v.assoc.set(k, append && !v.integer ? (v.assoc.get(k) ?? '') + val : val);
      } else {
        if (!v.indexed) {
          v.indexed = new Map(v.scalar !== undefined ? [[0, v.scalar]] : []);
          delete v.scalar;
        }
        const i = this.indexOf(name, index);
        v.indexed.set(i, append && !v.integer ? (v.indexed.get(i) ?? '') + val : val);
      }
    } else if (v.assoc) {
      v.assoc.set('0', append && !v.integer ? (v.assoc.get('0') ?? '') + val : val);
    } else if (v.indexed) {
      v.indexed.set(0, append && !v.integer ? (v.indexed.get(0) ?? '') + val : val);
    } else {
      v.scalar = append && !v.integer ? (v.scalar ?? '') + val : val;
    }
    if (name === 'PWD' || name === 'OLDPWD') return;
    this.checkMemory();
  }

  /** `name=(…)` or `name+=(…)`. */
  setArray(name: string, items: string[], append: boolean, words?: Word[]): void {
    let v = this.vars.get(name);
    if (v?.readonly) throw new ShellError(`bash: ${name}: readonly variable`);
    if (!v) {
      v = {};
      this.vars.set(name, v);
    }
    if (v.assoc) {
      if (!append) v.assoc = new Map();
      // ([key]=value …) pairs; words were expanded already, so keys are read from the text.
      for (const item of items) {
        const m = /^\[([^\]]*)\]=(.*)$/s.exec(item);
        if (m) v.assoc.set(m[1], m[2]);
        else throw new ShellError(`bash: ${name}: ${item}: must use subscript when assigning associative array`);
      }
    } else {
      const map: Map<number, string> = append ? v.indexed ?? new Map(v.scalar !== undefined ? [[0, v.scalar]] : []) : new Map();
      let next = map.size ? Math.max(...map.keys()) + 1 : 0;
      items.forEach((item, i) => {
        const m = words && /^\[([^\]]*)\]=/.exec(rawText(words[i]) ?? '') ? /^\[([^\]]*)\]=(.*)$/s.exec(item) : null;
        if (m) {
          next = this.indexOf(name, m[1]);
          map.set(next++, m[2]);
        } else map.set(next++, item);
      });
      v.indexed = map;
      delete v.scalar;
    }
    this.checkMemory();
  }

  unsetVar(name: string, index?: string): void {
    const v = this.vars.get(name);
    if (!v) return;
    if (v.readonly) throw new ShellError(`bash: unset: ${name}: cannot unset: readonly variable`);
    if (index !== undefined && index !== '@' && index !== '*') {
      if (v.assoc) v.assoc.delete(this.assocKey(index));
      else if (v.indexed) v.indexed.delete(this.indexOf(name, index));
      else if (this.indexOf(name, index) === 0) delete v.scalar;
      return;
    }
    // A local variable unset inside its function stays local.
    this.vars.delete(name);
  }

  /** Makes `name` local to the running function. */
  makeLocal(name: string): void {
    const scope = this.locals[this.locals.length - 1];
    if (!scope || scope.has(name)) return;
    const cur = this.vars.get(name);
    scope.set(name, cur ? cloneVar(cur) : undefined);
    this.vars.delete(name);
  }

  private checkMemory(): void {
    let total = 0;
    for (const v of this.vars.values()) {
      if (v.scalar !== undefined) total += v.scalar.length;
      if (v.indexed) for (const s of v.indexed.values()) total += s.length + 8;
      if (v.assoc) for (const [k, s] of v.assoc) total += k.length + s.length + 8;
      if (total > MAX_VAR_BYTES) throw new ShellError('bash: xmalloc: cannot allocate memory (variables are limited to 8 MB)');
    }
  }

  // ---- history -------------------------------------------------------------------------

  private historyExpand(line: string): { text: string; error?: string } {
    let out = '';
    let inSingle = false;
    const words = (s: string) => s.trim().split(/\s+/);
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "'" ) inSingle = !inSingle;
      if (c === '\\' && line[i + 1] === '!') {
        out += '\\!';
        i++;
        continue;
      }
      // `${!name}` is indirection, not history.
      if (c !== '!' || inSingle || line.slice(i - 2, i) === '${') {
        out += c;
        continue;
      }
      const rest = line.slice(i + 1);
      if (rest === '' || /^[\s=("]/.test(rest)) {
        out += c;
        continue;
      }
      const last = this.history[this.history.length - 1];
      let m: RegExpExecArray | null;
      if (rest.startsWith('!')) {
        if (last === undefined) return { text: line, error: 'bash: !!: event not found' };
        out += last;
        i += 1;
      } else if (rest.startsWith('$')) {
        if (last === undefined) return { text: line, error: 'bash: !$: event not found' };
        out += words(last).pop() ?? '';
        i += 1;
      } else if (rest.startsWith('^')) {
        if (last === undefined) return { text: line, error: 'bash: !^: event not found' };
        out += words(last)[1] ?? '';
        i += 1;
      } else if (rest.startsWith('*')) {
        if (last === undefined) return { text: line, error: 'bash: !*: event not found' };
        out += words(last).slice(1).join(' ');
        i += 1;
      } else if ((m = /^-?\d+/.exec(rest))) {
        const n = Number(m[0]);
        const entry = n < 0 ? this.history[this.history.length + n] : this.history[n - 1];
        if (entry === undefined) return { text: line, error: `bash: !${m[0]}: event not found` };
        out += entry;
        i += m[0].length;
      } else if ((m = /^[^\s;&|()<>'"]+/.exec(rest))) {
        const prefix = m[0];
        const entry = [...this.history].reverse().find((h) => h.startsWith(prefix));
        if (entry === undefined) return { text: line, error: `bash: !${prefix}: event not found` };
        out += entry;
        i += prefix.length;
      } else out += c;
    }
    return { text: out };
  }
}

/** Options bash takes before the script name. */
const QUIET_FLAGS = /^-[euxv]+$|^-o$|^--$|^-l$|^--login$|^--norc$|^--noprofile$/;

function cloneVar(v: Var): Var {
  const c: Var = { ...v };
  if (v.indexed) c.indexed = new Map(v.indexed);
  if (v.assoc) c.assoc = new Map(v.assoc);
  return c;
}

export function scalarOf(v: Var): string | null {
  if (v.scalar !== undefined) return v.scalar;
  if (v.indexed) return v.indexed.get(0) ?? null;
  if (v.assoc) return v.assoc.get('0') ?? null;
  return null;
}

function rawText(w: Word | undefined): string | null {
  const t = w?.parts[0];
  return t && t.kind === 'text' ? t.text : null;
}

function traceQuote(s: string): string {
  if (s === '') return "''";
  return /[\s'"$`\\*?[\]{}();&|<>!#~]/.test(s) ? `'${s.replace(/'/g, `'\\''`)}'` : s;
}

function expandWordsSafe(word: Word, host: ExpandHost): string[] {
  return expandWords([word], host);
}

export function createShell(options?: ShellOptions): VirtualShell {
  return new VirtualShell(options);
}
