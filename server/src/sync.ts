// What the browser sends after each command it ran. The browser runs the shell; the server keeps an
// in-memory copy of the files for the manager's tools, damage checks and mission checks. Everything
// here is checked for shape and size and only ever stored as data, never run.

import { validateChanges, SyncError } from './shell.ts';
import type { Change } from './shell.ts';

/** Longest command line kept for the manager. */
export const SYNC_LINE_CAP = 10_000;
/** Most output kept per command; the manager only ever sees the tail of it. */
export const SYNC_OUTPUT_CAP = 16_000;
/** Largest sync request body. A 1 MB file of control characters is about 6 MB as JSON. */
export const SYNC_BODY_CAP = 8_000_000;

export interface SyncRequest {
  /** The last mission seed the browser had applied when it ran the command. */
  epoch: number;
  /** The working directory after the command. */
  cwd: string;
  changes: Change[];
  /** The command the player ran and what it printed. Absent for an editor save. */
  command?: { line: string; output: string; exitCode: number };
  /** An editor save. */
  edit?: { path: string; bytes: number };
}

export { SyncError };

function absPath(v: unknown, what: string): string {
  if (typeof v !== 'string' || !v.startsWith('/') || v.length > 4096 || v.includes('\0')) throw new SyncError(`${what} must be an absolute path`);
  return v;
}

/** Checks a sync request's shape and sizes. Throws SyncError. */
export function parseSync(body: Record<string, unknown>): SyncRequest {
  const epoch = body.epoch;
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) throw new SyncError('epoch must be a whole number');
  const cwd = absPath(body.cwd, 'cwd');
  const changes = validateChanges(body.changes ?? []);
  const req: SyncRequest = { epoch, cwd, changes };
  if (body.command !== undefined) {
    const c = body.command as Record<string, unknown>;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new SyncError('bad command');
    if (typeof c.line !== 'string' || c.line.length > SYNC_LINE_CAP) throw new SyncError('bad command line');
    if (typeof c.output !== 'string') throw new SyncError('bad command output');
    if (typeof c.exitCode !== 'number' || !Number.isInteger(c.exitCode) || c.exitCode < 0 || c.exitCode > 255) throw new SyncError('bad exit code');
    // Only the tail matters to the manager; keep that much.
    const output = c.output.length > SYNC_OUTPUT_CAP ? c.output.slice(c.output.length - SYNC_OUTPUT_CAP) : c.output;
    req.command = { line: c.line, output, exitCode: c.exitCode };
  }
  if (body.edit !== undefined) {
    const e = body.edit as Record<string, unknown>;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new SyncError('bad edit');
    const bytes = e.bytes;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0 || bytes > 10_000_000) throw new SyncError('bad edit size');
    req.edit = { path: absPath(e.path, 'edit path'), bytes };
  }
  if (req.command && req.edit) throw new SyncError('a sync is a command or an edit, not both');
  return req;
}
