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

/** Most a single command line may print, and most one pipe stage may pass on. Beyond it output is dropped. */
export const MAX_OUTPUT = 1_000_000;

export class VirtualShell implements Shell {
  readonly fs: MemoryVfs;
  private state: ShellState;

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
          default: return null;
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

export function createShell(options?: ShellOptions): VirtualShell {
  return new VirtualShell(options);
}
