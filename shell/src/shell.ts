// The interpreter: parse a line, expand words, wire up pipes and redirects, run commands.

import { parse, ParseError } from './parser.ts';
import type { Pipeline, Redirect, SimpleCommand } from './parser.ts';
import { expandWord, expandWords, ExpandError } from './expand.ts';
import type { ExpandEnv } from './expand.ts';
import { createVfs, errorText } from './vfs.ts';
import type { MemoryVfs } from './vfs.ts';
import { normalize, resolvePath } from './path.ts';
import { COMMANDS } from './commands/index.ts';
import type { Action, CommandContext, ShellState } from './commands/context.ts';
import { statArg } from './commands/context.ts';
import type { ExecResult, Shell, ShellOptions } from './types.ts';

/** Where an fd's output goes. Files are written once the command finishes. */
type Target =
  | { kind: 'tty'; stream: 'stdout' | 'stderr' }
  | { kind: 'pipe' }
  | { kind: 'file'; path: string }
  | { kind: 'null' };

interface RunIo {
  result: ExecResult;
  pipe: string[];
  /** Characters offered to the pipe so far, kept or not. */
  piped?: number;
}

class RedirectError extends Error {}

/** `exit` inside a script: unwinds to the script runner with the status. */
class ScriptExit extends Error {
  readonly status: number;
  constructor(status: number) {
    super('exit');
    this.status = status;
  }
}

/** How deep scripts may call scripts, so one that runs itself stops instead of looping. */
const MAX_SCRIPT_DEPTH = 16;

/** Most a single command line may print, and most one pipe stage may pass on. Beyond it output is dropped. */
export const MAX_OUTPUT = 1_000_000;

export class VirtualShell implements Shell {
  readonly fs: MemoryVfs;
  private state: ShellState;
  /** $0, $1… of the script running now; null at the prompt. */
  private positional: string[] | null = null;
  private depth = 0;

  constructor(options: ShellOptions = {}) {
    const now = options.now ?? Date.now;
    const home = normalize(options.home ?? '/home/worker');
    this.fs = createVfs(now);
    this.fs.mkdir(home, { recursive: true });
    this.fs.mount(home);
    this.state = { cwd: home, oldpwd: null, home, user: options.user ?? 'worker', lastExit: 0, now, web: options.web };
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

  exec(line: string): ExecResult {
    const result: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
    try {
      let items;
      try {
        items = parse(String(line ?? ''));
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        result.stderr = e.message + '\n';
        result.exitCode = 2;
        this.state.lastExit = 2;
        return result;
      }
      let status = this.state.lastExit;
      let ran = false;
      for (const item of items) {
        if (ran && item.op === '&&' && status !== 0) continue;
        if (ran && item.op === '||' && status === 0) continue;
        status = this.runPipeline(item.pipeline, result);
        this.state.lastExit = status;
        ran = true;
      }
      result.exitCode = ran ? status : 0;
      if (!ran) this.state.lastExit = 0;
    } catch {
      // Defensive: exec must never throw.
      result.stderr += 'bash: internal error\n';
      result.exitCode = 1;
      this.state.lastExit = 1;
    }
    return result;
  }

  private expandEnv(): ExpandEnv {
    return {
      fs: this.fs,
      cwd: this.state.cwd,
      home: this.state.home,
      lookupVar: (name) => {
        switch (name) {
          case 'HOME': return this.state.home;
          case 'USER': case 'LOGNAME': return this.state.user;
          case 'PWD': return this.state.cwd;
          case 'OLDPWD': return this.state.oldpwd ?? '';
          case 'SHELL': return '/bin/bash';
          case '?': return String(this.state.lastExit);
          default: {
            const args = this.positional;
            if (!args) return null;
            if (/^[0-9]$/.test(name)) return args[Number(name)] ?? '';
            if (name === '#') return String(args.length - 1);
            if (name === '@' || name === '*') return args.slice(1).join(' ');
            return null;
          }
        }
      },
    };
  }

  private runPipeline(pipeline: Pipeline, result: ExecResult): number {
    let stdin: string | null = null;
    let status = 0;
    pipeline.forEach((cmd, i) => {
      const last = i === pipeline.length - 1;
      const io: RunIo = { result, pipe: [] };
      status = this.runCommand(cmd, stdin, last ? { kind: 'tty', stream: 'stdout' } : { kind: 'pipe' }, io);
      stdin = last ? null : io.pipe.join('');
    });
    return status;
  }

  /** Open a redirect target for writing. Truncates (or creates) now, as bash does. */
  private openOutput(shown: string, append: boolean): Target {
    if (shown === '') throw new RedirectError('bash: : No such file or directory');
    if (shown === '/dev/null') return { kind: 'null' };
    if (shown === '/dev/stdout') return { kind: 'tty', stream: 'stdout' };
    if (shown === '/dev/stderr') return { kind: 'tty', stream: 'stderr' };
    const path = resolvePath(this.state.cwd, shown);
    const st = this.fs.stat(path);
    if (st?.type === 'dir' || (shown.endsWith('/') && !st)) {
      throw new RedirectError(`bash: ${shown}: Is a directory`);
    }
    try {
      if (append) this.fs.appendFile(path, '');
      else this.fs.writeFile(path, '');
    } catch (e) {
      const code = (e as { code?: string }).code;
      const known = code === 'ENOTDIR' || code === 'EISDIR' || code === 'EFBIG' || code === 'ENOSPC';
      throw new RedirectError(`bash: ${shown}: ${errorText(known ? code : 'ENOENT')}`);
    }
    return { kind: 'file', path };
  }

  private applyRedirects(
    redirects: Redirect[],
    fds: Map<number, Target>,
    env: ExpandEnv,
  ): { stdin: string | null } {
    let stdin: string | null = null;
    for (const r of redirects) {
      const words = expandWord(r.target, env);
      const raw = r.target.parts.map((p) => (p.kind === 'text' ? p.text : '$' + p.name)).join('');
      if (words.length !== 1) throw new RedirectError(`bash: ${raw}: ambiguous redirect`);
      const target = words[0];
      if (r.op === '<') {
        if (target === '/dev/null') {
          stdin = '';
          continue;
        }
        const st = statArg(this.fakeCtx(), target);
        if (typeof st === 'string') throw new RedirectError(`bash: ${target}: ${errorText(st)}`);
        if (st.type === 'dir') throw new RedirectError(`bash: ${target}: Is a directory`);
        if (r.fd === 0) stdin = this.fs.readFile(st.path);
        continue;
      }
      if (r.op === '>&' && /^\d+$/.test(target)) {
        const src = fds.get(Number(target));
        if (!src) throw new RedirectError(`bash: ${target}: Bad file descriptor`);
        fds.set(r.fd, src);
        continue;
      }
      if (r.op === '>&' && target === '-') {
        fds.set(r.fd, { kind: 'null' });
        continue;
      }
      const both = r.op === '&>' || r.op === '&>>' || (r.op === '>&' && r.fd === 1);
      const opened = this.openOutput(target, r.op === '>>' || r.op === '&>>');
      if (both) {
        fds.set(1, opened);
        fds.set(2, opened);
      } else {
        fds.set(r.fd, opened);
      }
    }
    return { stdin };
  }

  /**
   * Running scripts: a path typed as a command (./deploy.sh), bash/sh with a file or -c, source and `.`,
   * and exit inside a script. Returns the exit status, or null when `name` is none of these.
   */
  private scriptCommand(
    name: string,
    args: string[],
    stdin: string | null,
    out: (text: string) => void,
    err: (text: string) => void,
    io: RunIo,
  ): number | null {
    if (name === 'exit') {
      if (this.depth === 0) return null;
      const n = args.length ? Number(args[0]) : this.state.lastExit;
      if (args.length && !Number.isInteger(n)) {
        err(`bash: exit: ${args[0]}: numeric argument required\n`);
        throw new ScriptExit(2);
      }
      throw new ScriptExit(((n % 256) + 256) % 256);
    }
    if (name.includes('/')) {
      const path = this.resolve(name);
      const st = this.fs.stat(path);
      if (!st) {
        err(`bash: ${name}: No such file or directory\n`);
        return 127;
      }
      if (st.type === 'dir') {
        err(`bash: ${name}: Is a directory\n`);
        return 126;
      }
      if (!(st.mode & 0o100)) {
        err(`bash: ${name}: Permission denied\n`);
        return 126;
      }
      return this.runScript(this.fs.readFile(path), [name, ...args], false, out, err, io);
    }
    if (name === 'bash' || name === 'sh') {
      let i = 0;
      while (i < args.length && QUIET_FLAGS.test(args[i]) && args[i] !== '-c') i += args[i] === '-o' ? 2 : 1;
      if (args[i] === '-c') {
        if (i + 1 >= args.length) {
          err(`${name}: -c: option requires an argument\n`);
          return 2;
        }
        return this.runScript(args[i + 1], [args[i + 2] ?? name, ...args.slice(i + 3)], false, out, err, io);
      }
      if (i >= args.length) {
        if (stdin !== null) return this.runScript(stdin, [name], false, out, err, io);
        err(`${name}: an interactive shell inside the terminal is not supported; run a script with ${name} FILE\n`);
        return 1;
      }
      const file = args[i];
      const st = this.fs.stat(this.resolve(file));
      if (!st) {
        err(`${name}: ${file}: No such file or directory\n`);
        return 127;
      }
      if (st.type === 'dir') {
        err(`${name}: ${file}: Is a directory\n`);
        return 126;
      }
      return this.runScript(this.fs.readFile(this.resolve(file)), args.slice(i), false, out, err, io);
    }
    if (name === 'source' || name === '.') {
      if (!args.length) {
        err(`bash: ${name}: filename argument required\n`);
        return 2;
      }
      const st = this.fs.stat(this.resolve(args[0]));
      if (!st || st.type === 'dir') {
        err(`bash: ${args[0]}: ${st ? 'Is a directory' : 'No such file or directory'}\n`);
        return 1;
      }
      return this.runScript(this.fs.readFile(this.resolve(args[0])), [args[0], ...args.slice(1)], true, out, err, io);
    }
    return null;
  }

  /**
   * Runs a script's text line by line, with its output going where the command's output goes. A script
   * run by bash gets its own working directory (a `cd` in it does not move the prompt); a sourced one
   * runs in this shell.
   */
  private runScript(
    text: string,
    positional: string[],
    sourced: boolean,
    out: (text: string) => void,
    err: (text: string) => void,
    io: RunIo,
  ): number {
    if (this.depth >= MAX_SCRIPT_DEPTH) {
      err(`bash: ${positional[0]}: maximum script nesting level exceeded (${MAX_SCRIPT_DEPTH})\n`);
      return 1;
    }
    let items;
    try {
      items = parse(text);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      err(`${positional[0]}: ${e.message.replace(/^bash: /, '')}\n`);
      return 2;
    }
    const saved = { positional: this.positional, cwd: this.state.cwd, oldpwd: this.state.oldpwd };
    this.positional = positional;
    this.depth++;
    let status = 0;
    try {
      let ran = false;
      for (const item of items) {
        if (ran && item.op === '&&' && status !== 0) continue;
        if (ran && item.op === '||' && status === 0) continue;
        const sub: ExecResult = { stdout: '', stderr: '', exitCode: 0 };
        try {
          status = this.runPipeline(item.pipeline, sub);
        } catch (e) {
          if (!(e instanceof ScriptExit)) throw e;
          out(sub.stdout);
          err(sub.stderr);
          if (sub.action) io.result.action = sub.action;
          status = e.status;
          this.state.lastExit = status;
          if (sourced && this.depth > 1) throw e;
          return status;
        }
        out(sub.stdout);
        err(sub.stderr);
        if (sub.action) io.result.action = sub.action;
        this.state.lastExit = status;
        ran = true;
      }
      return status;
    } finally {
      this.depth--;
      this.positional = saved.positional;
      if (!sourced) {
        this.state.cwd = saved.cwd;
        this.state.oldpwd = saved.oldpwd;
      }
    }
  }

  /** A minimal context for helpers that only need cwd + fs. */
  private fakeCtx(): CommandContext {
    return { fs: this.fs, state: this.state } as CommandContext;
  }

  private runCommand(cmd: SimpleCommand, pipedIn: string | null, stdoutTarget: Target, io: RunIo): number {
    const fds = new Map<number, Target>([
      [1, stdoutTarget],
      [2, { kind: 'tty', stream: 'stderr' }],
    ]);
    const buffers = new Map<string, string>(); // file path → pending output
    const write = (target: Target, text: string): void => {
      if (text === '') return;
      switch (target.kind) {
        case 'tty': {
          const room = MAX_OUTPUT - io.result.stdout.length - io.result.stderr.length;
          if (room <= 0) break;
          io.result[target.stream] += text.length > room ? text.slice(0, room) + '\n[output truncated]\n' : text;
          break;
        }
        case 'pipe': {
          io.piped = (io.piped ?? 0) + text.length;
          if (io.piped <= MAX_OUTPUT) io.pipe.push(text);
          break;
        }
        case 'file':
          buffers.set(target.path, (buffers.get(target.path) ?? '') + text);
          break;
        case 'null':
          break;
      }
    };
    const flush = (): void => {
      for (const [path, text] of buffers) {
        try {
          this.fs.appendFile(path, text);
        } catch (e) {
          // A full disk or an oversized file is reported, as bash does; a file that vanished while the
          // command ran (`rm -r . > log`) just loses the output, as on Linux.
          const code = (e as { code?: string }).code;
          if (code === 'EFBIG' || code === 'ENOSPC') {
            const room = MAX_OUTPUT - io.result.stdout.length - io.result.stderr.length;
            if (room > 0) io.result.stderr += `bash: ${cmd.words.length ? 'write error' : path}: ${errorText(code)}\n`;
          }
        }
      }
    };

    const env = this.expandEnv();
    let argv: string[];
    let redirectedIn: string | null = null;
    try {
      argv = expandWords(cmd.words, env);
      redirectedIn = this.applyRedirects(cmd.redirects, fds, env).stdin;
    } catch (e) {
      if (e instanceof ExpandError || e instanceof RedirectError) {
        write(fds.get(2)!, e.message + '\n');
        flush();
        return 1;
      }
      throw e;
    }

    if (argv.length === 0) {
      flush();
      return 0;
    }
    const name = argv[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(name) && cmd.words[0].parts[0]?.kind === 'text' && !cmd.words[0].parts[0].quoted) {
      write(fds.get(2)!, `bash: ${name}: variable assignment is not supported in this shell\n`);
      flush();
      return 1;
    }
    const script = this.scriptCommand(name, argv.slice(1), redirectedIn ?? pipedIn, (text) => write(fds.get(1)!, text), (text) => write(fds.get(2)!, text), io);
    if (script !== null) {
      flush();
      return script;
    }
    const impl = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : undefined;
    if (!impl) {
      write(fds.get(2)!, `bash: ${name}: command not found\n`);
      flush();
      return 127;
    }

    const stdin = redirectedIn ?? pipedIn;
    const out1 = fds.get(1)!;
    const ctx: CommandContext = {
      name,
      args: argv.slice(1),
      stdin: stdin ?? '',
      stdinIsTty: stdin === null,
      stdoutIsTty: out1.kind === 'tty' && out1.stream === 'stdout',
      fs: this.fs,
      state: this.state,
      out: (text) => write(fds.get(1)!, text),
      err: (text) => write(fds.get(2)!, text),
      setAction: (action: Action) => {
        io.result.action = action;
      },
      commandNames: () => Object.keys(COMMANDS),
    };
    let status: number;
    try {
      status = impl(ctx);
    } catch {
      ctx.err(`${name}: internal error\n`);
      status = 1;
    }
    flush();
    return status;
  }
}

/** Options bash takes before the script name that change nothing here. */
const QUIET_FLAGS = /^-[eux]+$|^-o$|^--$/;

export function createShell(options?: ShellOptions): VirtualShell {
  return new VirtualShell(options);
}
