// The player's side of a shift as the browser runs it: a shell of its own, started from the server's
// snapshot, sending what each command changed and applying the files missions put in place.

import { applyChanges, collectChanges, createShell, loadSnapshot } from '../../shell/src/index.ts';
import type { Entry, VirtualShell } from '../../shell/src/index.ts';
import { WEB } from '../src/web.ts';
import type { Session } from '../src/session.ts';
import type { SyncRequest } from '../src/sync.ts';
import type { ExecResponse, GameEvent } from '../src/types.ts';

export class Machine {
  sh!: VirtualShell;
  epoch = 0;

  constructor(snap: { entries: Entry[]; cwd: string; epoch: number }) {
    this.load(snap);
  }

  /** Starts over from the server's files, as a reloaded page does. */
  load(snap: { entries: Entry[]; cwd: string; epoch: number }): void {
    this.sh = createShell({ web: WEB, system: false });
    loadSnapshot(this.sh.fs, snap.entries);
    this.sh.installSystem();
    this.sh.cwd = snap.cwd;
    this.sh.fs.record();
    this.epoch = snap.epoch;
  }

  /** Files a mission put in place. */
  onEvent(e: GameEvent): void {
    if (e.type !== 'seed' || e.epoch <= this.epoch) return;
    this.sh.fs.unrecorded(() => applyChanges(this.sh.fs, e.changes));
    this.epoch = e.epoch;
  }

  run(line: string): { result: ExecResponse; request: SyncRequest } {
    const r = this.sh.exec(line);
    const request: SyncRequest = {
      epoch: this.epoch,
      cwd: this.sh.cwd,
      changes: collectChanges(this.sh.fs),
      command: { line, output: r.stdout + r.stderr, exitCode: r.exitCode },
    };
    // As the browser does: a restart or the end of the machine goes with the command.
    if (r.action?.type === 'power') request.machine = r.action.mode;
    else if (r.action?.type === 'destroy') request.machine = r.action.cause;
    return { result: { ...r, cwd: this.sh.cwd }, request };
  }

  save(rawPath: string, content: string): SyncRequest {
    const path = this.sh.resolve(rawPath);
    this.sh.fs.writeFile(path, content);
    return { epoch: this.epoch, cwd: this.sh.cwd, changes: collectChanges(this.sh.fs), edit: { path, bytes: new TextEncoder().encode(content).length } };
  }
}

const machines = new WeakMap<Session, Machine>();

/** The browser playing `s` in this process. */
export function machineOf(s: Session): Machine {
  let m = machines.get(s);
  if (!m) {
    const made = new Machine(s.snapshot());
    s.subscribe((e) => made.onEvent(e));
    machines.set(s, made);
    m = made;
  }
  return m;
}

/** Runs a line in the player's shell and sends the server what it changed. */
export function exec(s: Session, line: string): ExecResponse {
  const m = machineOf(s);
  const { result, request } = m.run(line);
  if (s.sync(request).resync) m.load(s.snapshot());
  return result;
}

/** Saves a file from the editor. */
export function save(s: Session, path: string, content: string): void {
  const m = machineOf(s);
  if (s.sync(m.save(path, content)).resync) m.load(s.snapshot());
}
