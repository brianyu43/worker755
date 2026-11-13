// The player's shell runs here in the browser, in a Web Worker. This side keeps the last good state (the
// files and the shell's variables, history and cwd after the last command that finished), so a command
// that will not stop can be killed: the worker is terminated and a new one starts from that state.
import { MemoryVfs } from '../../../shell/src/vfs.ts';
import { applyChanges, loadSnapshot } from '../../../shell/src/sync.ts';
import type { ExecResult } from '../../../shell/src/index.ts';
import type { Change, Entry, Request, Response, ShellSnapshot, WebAccess } from './protocol';

/**
 * The shell stops a command itself after 4 seconds; this catches what it cannot stop, such as a
 * regular expression that backtracks forever.
 */
const WATCHDOG_MS = 7000;

export interface Snapshot {
  entries: Entry[];
  cwd: string;
  epoch: number;
}

export interface LocalExec {
  result: ExecResult;
  cwd: string;
  changes: Change[];
  /** The command did not finish and was killed; nothing it did was kept. */
  killed: boolean;
  /** The mission seed the files included when the command ran. */
  epoch: number;
}

type Body = Request extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

class Killed extends Error {}

export class LocalShell {
  epoch: number;
  private worker: Worker | null = null;
  /** The files after the last command that finished. */
  private files = new MemoryVfs();
  private state: ShellSnapshot | null = null;
  private cwd: string;
  private web: WebAccess | null;
  private next = 1;
  private waiting = new Map<number, { resolve(r: Response): void; reject(e: Error): void }>();
  /** One thing at a time: commands, seeds and reloads run in the order they came. */
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(snap: Snapshot, web: WebAccess | null) {
    loadSnapshot(this.files, snap.entries);
    this.cwd = snap.cwd;
    this.epoch = snap.epoch;
    this.web = web;
  }

  static async start(snap: Snapshot, web: WebAccess | null): Promise<LocalShell> {
    const shell = new LocalShell(snap, web);
    await shell.spawn();
    return shell;
  }

  /** Runs `fn` after everything queued before it. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async spawn(): Promise<void> {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Response>) => {
      const w = this.waiting.get(e.data.id);
      if (!w) return;
      this.waiting.delete(e.data.id);
      w.resolve(e.data);
    };
    worker.onerror = () => this.fail(new Killed('the shell stopped'));
    this.worker = worker;
    await this.call({ type: 'init', entries: this.files.exportEntries('/'), cwd: this.cwd, state: this.state, web: this.web });
  }

  private fail(err: Error): void {
    for (const w of this.waiting.values()) w.reject(err);
    this.waiting.clear();
  }

  private call(body: Body, timeoutMs?: number): Promise<Response> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Killed('no shell'));
    const id = this.next++;
    return new Promise<Response>((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => this.fail(new Killed('too long')), timeoutMs) : null;
      this.waiting.set(id, {
        resolve: (r) => {
          if (timer) clearTimeout(timer);
          if (r.type === 'error') reject(new Error(r.message));
          else resolve(r);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      });
      worker.postMessage({ id, ...body } as Request);
    });
  }

  /** Throws away the worker and starts a new one from the last good state. */
  private async restart(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Killed('restarted'));
    await this.spawn();
  }

  /**
   * Runs one command line; call inside exclusive(). A command that will not stop is killed, and the shell
   * comes back as it was before it.
   */
  async execNow(line: string): Promise<LocalExec> {
    const epoch = this.epoch;
    try {
      const r = await this.call({ type: 'exec', line }, WATCHDOG_MS);
      if (r.type !== 'exec') throw new Error('unexpected reply');
      applyChanges(this.files, r.changes);
      this.state = r.state;
      this.cwd = r.cwd;
      return { result: r.result, cwd: r.cwd, changes: r.changes, killed: false, epoch };
    } catch (err) {
      if (!(err instanceof Killed)) throw err;
      await this.restart();
      return { result: { stdout: '', stderr: 'Killed\n', exitCode: 137 }, cwd: this.cwd, changes: [], killed: true, epoch };
    }
  }

  /** Files a mission put in place on the server. */
  applySeed(epoch: number, changes: Change[]): Promise<void> {
    return this.exclusive(async () => {
      if (epoch <= this.epoch) return;
      applyChanges(this.files, changes);
      await this.call({ type: 'apply', changes });
      this.epoch = epoch;
    });
  }

  /** Replaces the files with the server's (variables and history stay). Call inside exclusive(). */
  async reload(snap: Snapshot): Promise<void> {
    this.files = new MemoryVfs();
    loadSnapshot(this.files, snap.entries);
    this.epoch = snap.epoch;
    await this.call({ type: 'reload', entries: snap.entries, cwd: snap.cwd });
    if (this.files.stat(snap.cwd)?.type === 'dir') this.cwd = snap.cwd;
  }

  read(path: string): Promise<{ path: string; content: string }> {
    return this.exclusive(async () => {
      const r = await this.call({ type: 'read', path });
      if (r.type !== 'read') throw new Error('unexpected reply');
      return { path: r.path, content: r.content };
    });
  }

  /** Saves a file from the editor and returns what changed, for the server; call inside exclusive(). */
  async writeNow(path: string, content: string): Promise<{ path: string; changes: Change[]; epoch: number; cwd: string }> {
    const r = await this.call({ type: 'write', path, content });
    if (r.type !== 'write') throw new Error('unexpected reply');
    applyChanges(this.files, r.changes);
    return { path: r.path, changes: r.changes, epoch: this.epoch, cwd: this.cwd };
  }

  /** Every command name the shell knows, for Tab completion. */
  async names(): Promise<string[]> {
    const r = await this.call({ type: 'names' });
    return r.type === 'names' ? r.names : [];
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Killed('closed'));
  }
}
