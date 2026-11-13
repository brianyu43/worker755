// Keeping two copies of a filesystem in step: the browser runs the shell, the server keeps a mirror
// that the manager, damage checks and mission checks read. After each command the browser sends the
// paths that changed, as they are now; the server checks their shape and size and puts them in place.

import { MAX_FILE_BYTES, MAX_NODES, MAX_TOTAL_BYTES, VfsError } from './vfs.ts';
import type { Entry, MemoryVfs } from './vfs.ts';
import { dirname, isWithin, normalize } from './path.ts';

export type { Entry } from './vfs.ts';

export type Change =
  /** The path and everything below it, replaced by `entries` (the path itself first). */
  | { op: 'put'; path: string; entries: Entry[] }
  /** Only the mode and time of the path changed. */
  | { op: 'meta'; path: string; mode: number; mtime: number }
  /** The path is gone. */
  | { op: 'rm'; path: string };

/** Longest path accepted. */
const MAX_PATH = 4096;

/** What changed since the journal was last taken, as Change records. */
export function collectChanges(fs: MemoryVfs): Change[] {
  const journal = fs.takeJournal();
  const paths = [...journal.keys()].sort();
  // A path below another whole-tree change travels with it.
  const covered = (p: string) => {
    for (let at = dirname(p); at !== '/'; at = dirname(at)) if (journal.get(at) === 'tree') return true;
    return journal.get('/') === 'tree' && p !== '/';
  };
  const out: Change[] = [];
  for (const path of paths) {
    if (covered(path)) continue;
    if (fs.isSystem(path)) continue;
    const st = fs.stat(path);
    if (!st) {
      out.push({ op: 'rm', path });
      continue;
    }
    if (journal.get(path) === 'meta') out.push({ op: 'meta', path, mode: st.mode, mtime: st.mtime });
    else out.push({ op: 'put', path, entries: fs.exportEntries(path) });
  }
  return out;
}

/** Runs `fn` and returns what it changed, without leaving the journal on. */
export function changesOf(fs: MemoryVfs, fn: () => void): Change[] {
  fs.record();
  try {
    fn();
    return collectChanges(fs);
  } finally {
    fs.stopRecording();
  }
}

/** Puts changes in place. Throws VfsError when they break a quota or do not fit the tree. */
export function applyChanges(fs: MemoryVfs, changes: Change[]): void {
  const order = (c: Change) => (c.op === 'rm' ? 0 : c.op === 'put' ? 1 : 2);
  const sorted = [...changes].sort((a, b) => order(a) - order(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const c of sorted) {
    if (c.op === 'rm') {
      removeQuietly(fs, c.path);
    } else if (c.op === 'meta') {
      if (fs.stat(c.path)) fs.setMeta(c.path, c.mode, c.mtime);
    } else {
      removeQuietly(fs, c.path);
      fs.importEntries(c.entries);
    }
  }
}

/** Remove a path; a mount point is emptied instead. */
function removeQuietly(fs: MemoryVfs, path: string): void {
  if (!fs.stat(path)) return;
  try {
    fs.remove(path, true);
  } catch (e) {
    if (!(e instanceof VfsError && (e.code === 'EBUSY' || e.code === 'EACCES'))) throw e;
  }
}

/** Replace the whole filesystem with a snapshot. */
export function loadSnapshot(fs: MemoryVfs, entries: Entry[]): void {
  fs.clear();
  fs.importEntries(entries);
}

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

function checkPath(p: unknown): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > MAX_PATH || p.includes('\0')) throw new SyncError('bad path');
  if (normalize(p) !== p) throw new SyncError('path is not normalised');
  return p;
}

function checkEntry(e: unknown, within: string): Entry {
  if (!e || typeof e !== 'object' || Array.isArray(e)) throw new SyncError('bad entry');
  const o = e as Record<string, unknown>;
  const path = checkPath(o.path);
  if (!isWithin(within, path)) throw new SyncError('entry outside its change');
  if (o.type !== 'file' && o.type !== 'dir') throw new SyncError('bad type');
  if (typeof o.mode !== 'number' || !Number.isInteger(o.mode) || o.mode < 0 || o.mode > 0o7777) throw new SyncError('bad mode');
  if (typeof o.mtime !== 'number' || !Number.isFinite(o.mtime)) throw new SyncError('bad time');
  if (o.type === 'file') {
    if (typeof o.content !== 'string') throw new SyncError('file without content');
    if (o.content.length > MAX_FILE_BYTES) throw new SyncError('file too large');
    return { path, type: 'file', mode: o.mode, mtime: o.mtime, content: o.content };
  }
  if (o.content !== undefined) throw new SyncError('directory with content');
  return { path, type: 'dir', mode: o.mode, mtime: o.mtime };
}

/** Counts that bound what a sync may carry, whatever it claims. */
function budget() {
  let nodes = 0;
  let chars = 0;
  return (e: Entry) => {
    nodes++;
    chars += e.content?.length ?? 0;
    if (nodes > MAX_NODES) throw new SyncError('too many entries');
    // UTF-16 length never exceeds UTF-8 bytes, so this is a safe first cut; the filesystem checks bytes.
    if (chars > MAX_TOTAL_BYTES) throw new SyncError('too much data');
  };
}

/** Checks the shape of changes received from a client. Throws SyncError; never evaluates anything. */
export function validateChanges(raw: unknown): Change[] {
  if (!Array.isArray(raw)) throw new SyncError('changes must be a list');
  if (raw.length > MAX_NODES) throw new SyncError('too many changes');
  const count = budget();
  return raw.map((c): Change => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new SyncError('bad change');
    const o = c as Record<string, unknown>;
    const path = checkPath(o.path);
    if (path === '/' && o.op !== 'meta') throw new SyncError('cannot replace the root');
    if (o.op === 'rm') return { op: 'rm', path };
    if (o.op === 'meta') {
      if (typeof o.mode !== 'number' || !Number.isInteger(o.mode) || o.mode < 0 || o.mode > 0o7777) throw new SyncError('bad mode');
      if (typeof o.mtime !== 'number' || !Number.isFinite(o.mtime)) throw new SyncError('bad time');
      return { op: 'meta', path, mode: o.mode, mtime: o.mtime };
    }
    if (o.op === 'put') {
      if (!Array.isArray(o.entries) || o.entries.length === 0) throw new SyncError('put without entries');
      const entries = o.entries.map((e) => {
        const entry = checkEntry(e, path);
        count(entry);
        return entry;
      });
      if (entries[0].path !== path) throw new SyncError('put must start with its path');
      return { op: 'put', path, entries };
    }
    throw new SyncError('unknown change');
  });
}

/** Checks a whole-filesystem snapshot received from a client. */
export function validateSnapshot(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) throw new SyncError('entries must be a list');
  if (raw.length > MAX_NODES) throw new SyncError('too many entries');
  const count = budget();
  return raw.map((e) => {
    const entry = checkEntry(e, '/');
    count(entry);
    return entry;
  });
}
