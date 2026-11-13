// In-memory filesystem. All public methods take absolute paths; relative ones are rejected
// with EINVAL. Modes are stored and reported but never enforced.

import { basename, dirname, isWithin, normalize, segments } from './path.ts';
import type { NodeType, StatResult, TreeNode, Vfs, VfsErrorCode } from './types.ts';

const ERROR_TEXT: Record<VfsErrorCode, string> = {
  ENOENT: 'No such file or directory',
  EEXIST: 'File exists',
  ENOTDIR: 'Not a directory',
  EISDIR: 'Is a directory',
  ENOTEMPTY: 'Directory not empty',
  EINVAL: 'Invalid argument',
  EACCES: 'Permission denied',
  EBUSY: 'Device or resource busy',
  EFBIG: 'File too large',
  ENOSPC: 'No space left on device',
};

/**
 * Quotas. Every filesystem lives in one server process with everyone else's, so a file, the whole
 * disk and the number of entries are capped, the way a small container volume would be.
 */
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_TOTAL_BYTES = 3_000_000;
export const MAX_NODES = 10_000;

/** The strerror() text for a code, e.g. 'No such file or directory'. */
export function errorText(code: VfsErrorCode): string {
  return ERROR_TEXT[code];
}

export class VfsError extends Error {
  code: VfsErrorCode;
  path: string;

  constructor(code: VfsErrorCode, path: string) {
    super(`${code}: ${ERROR_TEXT[code]}, '${path}'`);
    this.name = 'VfsError';
    this.code = code;
    this.path = path;
  }
}

/** What a device or kernel file produces when read. */
export type Device = 'null' | 'zero' | 'random' | 'full' | 'tty' | (() => string);

/** A system directory's contents: device files and nested directories. */
export interface DeviceDir {
  [name: string]: Device | DeviceDir;
}

interface FileNode {
  type: 'file';
  mode: number;
  mtime: number;
  content: string;
  /** /dev and /proc files: read from a generator, never stored. */
  device?: Device;
}

interface DirNode {
  type: 'dir';
  mode: number;
  mtime: number;
  children: Map<string, Node>;
  /** Part of the system (/dev, /proc, /bin, /usr/bin): read-only, outside the quotas and snapshots. */
  virtual?: boolean;
}

const isVirtual = (n: Node): boolean => (n.type === 'dir' ? !!n.virtual : n.device !== undefined);

/** A file or directory as it travels between the browser and the server. */
export interface Entry {
  path: string;
  type: NodeType;
  mode: number;
  mtime: number;
  content?: string;
}

/** How a path changed since the journal was last taken: its own mode/time, or the whole thing. */
export type Mark = 'meta' | 'tree';

/** Bytes a device file yields per read, so `cat /dev/zero` ends. */
const DEVICE_CHUNK = 16 * 1024;

type Node = FileNode | DirNode;

export const DEFAULT_DIR_MODE = 0o755;
export const DEFAULT_FILE_MODE = 0o644;

const encoder = new TextEncoder();

/** Size of a string in UTF-8 bytes. */
export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

function sortedNames(dir: DirNode): string[] {
  return [...dir.children.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}

/**
 * The concrete filesystem behind every shell. Implements the spec's `Vfs` and adds the
 * mutating operations the commands need (mkdir, remove, rename, copy, chmod, touch).
 */
export class MemoryVfs implements Vfs {
  private root: DirNode;
  private now: () => number;
  /** Directories that behave like mounted volumes: they can be emptied, never removed or moved. */
  private mounts = new Set<string>();
  /** Bytes in all files, and entries (files and directories, the root included). */
  private bytes = 0;
  private nodes = 1;
  /** Paths changed since the journal was last taken; null while not recording. */
  private journal: Map<string, Mark> | null = null;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.root = { type: 'dir', mode: DEFAULT_DIR_MODE, mtime: now(), children: new Map() };
  }

  // ---- lookup -------------------------------------------------------------------------

  private abs(path: string): string {
    if (typeof path !== 'string' || !path.startsWith('/')) throw new VfsError('EINVAL', String(path));
    return normalize(path);
  }

  /** Walk to a node. Throws ENOENT / ENOTDIR on the way. */
  private lookup(path: string): Node {
    let node: Node = this.root;
    for (const part of segments(path)) {
      if (node.type !== 'dir') throw new VfsError('ENOTDIR', path);
      const next = node.children.get(part);
      if (!next) throw new VfsError('ENOENT', path);
      node = next;
    }
    return node;
  }

  private tryLookup(path: string): Node | null {
    try {
      return this.lookup(path);
    } catch {
      return null;
    }
  }

  /** The parent directory of `path`, which must exist and be a directory. */
  private parentOf(path: string): DirNode {
    if (path === '/') throw new VfsError('EINVAL', path);
    const parent = this.lookup(dirname(path));
    if (parent.type !== 'dir') throw new VfsError('ENOTDIR', path);
    return parent;
  }

  private statNode(path: string, node: Node): StatResult {
    return {
      path,
      type: node.type,
      mode: node.mode,
      size: node.type === 'file' ? byteLength(node.content) : 0,
      mtime: node.mtime,
    };
  }

  // ---- spec interface -----------------------------------------------------------------

  stat(path: string): StatResult | null {
    try {
      const p = this.abs(path);
      return this.statNode(p, this.lookup(p));
    } catch {
      return null;
    }
  }

  readFile(path: string): string {
    const p = this.abs(path);
    const node = this.lookup(p);
    if (node.type === 'dir') throw new VfsError('EISDIR', p);
    return node.device !== undefined ? readDevice(node.device) : node.content;
  }

  writeFile(path: string, content: string): void {
    const p = this.abs(path);
    const parent = this.parentOf(p);
    const name = basename(p);
    const existing = parent.children.get(name);
    if (existing && existing.type === 'dir') throw new VfsError('EISDIR', p);
    if (existing?.device !== undefined) return this.writeDevice(p, existing.device);
    if (parent.virtual) throw new VfsError('EACCES', p);
    this.mark(p, 'tree');
    const text = String(content);
    this.reserve(p, byteLength(text), existing ? byteLength(existing.content) : 0, existing ? 0 : 1);
    const t = this.now();
    if (existing) {
      existing.content = text;
      existing.mtime = t;
    } else {
      parent.children.set(name, { type: 'file', mode: DEFAULT_FILE_MODE, mtime: t, content: text });
      parent.mtime = t;
    }
  }

  list(path: string): StatResult[] {
    const p = this.abs(path);
    const node = this.lookup(p);
    if (node.type !== 'dir') throw new VfsError('ENOTDIR', p);
    return sortedNames(node).map((name) => this.statNode(p === '/' ? '/' + name : p + '/' + name, node.children.get(name)!));
  }

  tree(path: string = '/'): TreeNode {
    const p = this.abs(path);
    return this.treeOf(p, this.lookup(p));
  }

  private treeOf(path: string, node: Node): TreeNode {
    const name = path === '/' ? '' : basename(path);
    if (node.type === 'file') {
      return { name, path, type: 'file', mode: node.mode, size: byteLength(node.content) };
    }
    return {
      name,
      path,
      type: 'dir',
      mode: node.mode,
      size: 0,
      children: sortedNames(node)
        .filter((child) => !isVirtual(node.children.get(child)!))
        .map((child) => this.treeOf(path === '/' ? '/' + child : path + '/' + child, node.children.get(child)!)),
    };
  }

  // ---- extensions ---------------------------------------------------------------------

  exists(path: string): boolean {
    return this.stat(path) !== null;
  }

  isDir(path: string): boolean {
    return this.stat(path)?.type === 'dir';
  }

  appendFile(path: string, content: string): void {
    const p = this.abs(path);
    const node = this.tryLookup(p);
    if (node && node.type === 'file' && node.device !== undefined) return this.writeDevice(p, node.device);
    if (node && node.type === 'file') {
      this.mark(p, 'tree');
      const old = byteLength(node.content);
      this.reserve(p, old + byteLength(content), old, 0);
      node.content += content;
      node.mtime = this.now();
      return;
    }
    this.writeFile(p, content);
  }

  /** Create a directory. With `recursive`, missing parents are created and an existing dir is fine. */
  mkdir(path: string, options: MkdirOptions = {}): void {
    const p = this.abs(path);
    const mode = options.mode ?? DEFAULT_DIR_MODE;
    if (options.recursive) {
      let node: Node = this.root;
      let sofar = '';
      for (const part of segments(p)) {
        sofar += '/' + part;
        if (node.type !== 'dir') throw new VfsError('ENOTDIR', sofar);
        let next = node.children.get(part);
        if (!next) {
          if (node.virtual) throw new VfsError('EACCES', sofar);
          this.reserve(sofar, 0, 0, 1);
          this.mark(sofar, 'tree');
          next = { type: 'dir', mode, mtime: this.now(), children: new Map() };
          node.children.set(part, next);
          node.mtime = this.now();
        }
        node = next;
      }
      if (node.type !== 'dir') throw new VfsError('EEXIST', p);
      return;
    }
    if (p === '/') throw new VfsError('EEXIST', p);
    const parent = this.parentOf(p);
    const name = basename(p);
    if (parent.children.has(name)) throw new VfsError('EEXIST', p);
    if (parent.virtual) throw new VfsError('EACCES', p);
    this.reserve(p, 0, 0, 1);
    this.mark(p, 'tree');
    parent.children.set(name, { type: 'dir', mode, mtime: this.now(), children: new Map() });
    parent.mtime = this.now();
  }

  /** Bytes and entries in a subtree. */
  private measure(node: Node): { bytes: number; nodes: number } {
    if (isVirtual(node)) return { bytes: 0, nodes: 0 };
    if (node.type === 'file') return { bytes: byteLength(node.content), nodes: 1 };
    let bytes = 0;
    let nodes = 1;
    for (const c of node.children.values()) {
      const m = this.measure(c);
      bytes += m.bytes;
      nodes += m.nodes;
    }
    return { bytes, nodes };
  }

  /** Checks a change against the quotas, then books it: `size` replaces `oldSize`, plus `newNodes` entries. */
  private reserve(path: string, size: number, oldSize: number, newNodes: number): void {
    if (size > MAX_FILE_BYTES) throw new VfsError('EFBIG', path);
    if (this.bytes - oldSize + size > MAX_TOTAL_BYTES || this.nodes + newNodes > MAX_NODES) {
      throw new VfsError('ENOSPC', path);
    }
    this.bytes += size - oldSize;
    this.nodes += newNodes;
  }

  /** Books a subtree as gone. */
  private release(node: Node): void {
    const m = this.measure(node);
    this.bytes -= m.bytes;
    this.nodes -= m.nodes;
  }

  /** Bytes and entries in use, for tests and diagnostics. */
  usage(): { bytes: number; nodes: number } {
    return { bytes: this.bytes, nodes: this.nodes };
  }

  /** Mark a directory as a mount point, like a container's volume. */
  mount(path: string): void {
    const p = this.abs(path);
    if (this.lookup(p).type !== 'dir') throw new VfsError('ENOTDIR', p);
    this.mounts.add(p);
  }

  /** The mount point at or under `path`, if any. */
  private mountWithin(path: string): string | null {
    for (const m of this.mounts) if (isWithin(path, m)) return m;
    return null;
  }

  /** Delete everything under `dir` except the way down to mount points, as `rm -rf` does around a volume. */
  private clearAround(dir: string): void {
    const node = this.lookup(dir) as DirNode;
    for (const name of [...node.children.keys()]) {
      const child = dir === '/' ? `/${name}` : `${dir}/${name}`;
      const c = node.children.get(name)!;
      if (isVirtual(c)) continue;
      if (this.mountWithin(child) || this.virtualWithin(c)) this.clearAround(child);
      else {
        this.mark(child, 'tree');
        this.release(node.children.get(name)!);
        node.children.delete(name);
      }
    }
    node.mtime = this.now();
  }

  /** Remove an empty directory. */
  rmdir(path: string): void {
    const p = this.abs(path);
    const node = this.lookup(p);
    if (node.type !== 'dir') throw new VfsError('ENOTDIR', p);
    if (p === '/') throw new VfsError('EACCES', p);
    if (this.mounts.has(p)) throw new VfsError('EBUSY', p);
    if (node.children.size > 0) throw new VfsError('ENOTEMPTY', p);
    const parent = this.parentOf(p);
    if (node.virtual || parent.virtual) throw new VfsError('EACCES', p);
    this.mark(p, 'tree');
    this.release(node);
    parent.children.delete(basename(p));
    parent.mtime = this.now();
  }

  /** Remove a file, or a directory and everything in it when `recursive`. */
  remove(path: string, recursive = false): void {
    const p = this.abs(path);
    const node = this.lookup(p);
    if (node.type === 'dir' && !recursive) throw new VfsError('EISDIR', p);
    if (p === '/') throw new VfsError('EACCES', p);
    if (isVirtual(node) || this.parentOf(p).virtual) throw new VfsError('EACCES', p);
    const mount = this.mountWithin(p);
    if (mount) {
      this.clearAround(p);
      throw new VfsError('EBUSY', mount);
    }
    if (this.virtualWithin(node)) {
      this.clearAround(p);
      throw new VfsError('EACCES', p);
    }
    const parent = this.parentOf(p);
    this.mark(p, 'tree');
    this.release(node);
    parent.children.delete(basename(p));
    parent.mtime = this.now();
  }

  /**
   * `rm -rf --no-preserve-root /`: everything goes except the way down to mount points, which are
   * emptied. Throws EBUSY for the first mount, as rm reports it.
   */
  removeAll(): void {
    this.clearAround('/');
    const mount = [...this.mounts].sort()[0];
    if (mount) throw new VfsError('EBUSY', mount);
    const sys = [...this.root.children.entries()].find(([, n]) => isVirtual(n));
    if (sys) throw new VfsError('EACCES', '/' + sys[0]);
  }

  /** True when a virtual node lies at or below `node`. */
  private virtualWithin(node: Node): boolean {
    if (isVirtual(node)) return true;
    if (node.type === 'file') return false;
    for (const c of node.children.values()) if (this.virtualWithin(c)) return true;
    return false;
  }

  /** rename(2): move `from` to exactly `to`, replacing a file or an empty directory there. */
  rename(from: string, to: string): void {
    const src = this.abs(from);
    const dst = this.abs(to);
    const node = this.lookup(src);
    if (src === dst) return;
    if (src === '/') throw new VfsError('EINVAL', src);
    if (this.mountWithin(src)) throw new VfsError('EBUSY', src);
    if (node.type === 'dir' && isWithin(src, dst)) throw new VfsError('EINVAL', dst);
    const dstParent = this.parentOf(dst);
    const existing = dstParent.children.get(basename(dst));
    if (this.virtualWithin(node) || this.parentOf(src).virtual || dstParent.virtual || (existing && isVirtual(existing))) {
      throw new VfsError('EACCES', this.virtualWithin(node) || this.parentOf(src).virtual ? src : dst);
    }
    this.mark(src, 'tree');
    this.mark(dst, 'tree');
    if (existing) {
      if (existing.type === 'dir' && node.type !== 'dir') throw new VfsError('EISDIR', dst);
      if (existing.type !== 'dir' && node.type === 'dir') throw new VfsError('ENOTDIR', dst);
      if (existing.type === 'dir' && existing.children.size > 0) throw new VfsError('ENOTEMPTY', dst);
    }
    if (existing) this.release(existing);
    const srcParent = this.parentOf(src);
    srcParent.children.delete(basename(src));
    dstParent.children.set(basename(dst), node);
    srcParent.mtime = dstParent.mtime = this.now();
  }

  /** Copy a file, or a directory tree when `recursive`, to exactly `to`. */
  copy(from: string, to: string, recursive = false): void {
    const src = this.abs(from);
    const dst = this.abs(to);
    const node = this.lookup(src);
    if (node.type === 'dir') {
      if (!recursive) throw new VfsError('EISDIR', src);
      if (isWithin(src, dst)) throw new VfsError('EINVAL', dst);
      const clone = this.cloneNode(node);
      const parent = this.parentOf(dst);
      const existing = parent.children.get(basename(dst));
      if (existing && existing.type !== 'dir') throw new VfsError('ENOTDIR', dst);
      if (parent.virtual || (existing && isVirtual(existing))) throw new VfsError('EACCES', dst);
      if (existing && existing.type === 'dir') {
        // Merge into the existing directory, like `cp -r src existing-dir-name` onto itself.
        for (const [name] of (clone as DirNode).children) {
          this.copy(src + '/' + name, dst + '/' + name, true);
        }
        return;
      }
      const add = this.measure(clone);
      this.reserve(dst, add.bytes, 0, add.nodes);
      this.mark(dst, 'tree');
      parent.children.set(basename(dst), clone);
      parent.mtime = this.now();
      return;
    }
    const isNew = this.tryLookup(dst) === null;
    this.writeFile(dst, node.device !== undefined ? readDevice(node.device) : node.content);
    if (isNew) this.chmod(dst, node.mode); // cp keeps the source's mode on new files
  }

  private cloneNode(node: Node): Node {
    const t = this.now();
    if (node.type === 'file') {
      const content = node.device !== undefined ? readDevice(node.device) : node.content;
      return { type: 'file', mode: node.device !== undefined ? DEFAULT_FILE_MODE : node.mode, mtime: t, content };
    }
    const children = new Map<string, Node>();
    for (const [name, child] of node.children) children.set(name, this.cloneNode(child));
    return { type: 'dir', mode: node.mode, mtime: t, children };
  }

  chmod(path: string, mode: number): void {
    const p = this.abs(path);
    const node = this.lookup(p);
    if (isVirtual(node)) throw new VfsError('EACCES', p);
    node.mode = mode & 0o7777;
    this.mark(p, 'meta');
  }

  /** Create an empty file, or update the timestamp of an existing file or directory. */
  touch(path: string): void {
    const p = this.abs(path);
    const node = this.tryLookup(p);
    if (node) {
      if (isVirtual(node)) return;
      node.mtime = this.now();
      this.mark(p, 'meta');
      return;
    }
    this.writeFile(p, '');
  }

  private writeDevice(p: string, device: Device): void {
    if (device === 'full') throw new VfsError('ENOSPC', p);
    if (typeof device === 'function') throw new VfsError('EACCES', p);
  }

  // ---- system directories -------------------------------------------------------------

  /**
   * Adds a read-only system directory (/dev, /proc, /bin, /usr/bin) whose files are generated on read.
   * It takes no quota, never shows in tree() or snapshots, and cannot be changed.
   */
  addSystemDir(path: string, files: DeviceDir, mode = DEFAULT_DIR_MODE): void {
    const p = this.abs(path);
    const parent = this.parentOf(p);
    const build = (spec: DeviceDir): DirNode => {
      const children = new Map<string, Node>();
      for (const [name, v] of Object.entries(spec)) {
        if (typeof v === 'string' || typeof v === 'function') {
          const devMode = typeof v === 'function' ? 0o444 : v === 'tty' ? 0o620 : 0o666;
          children.set(name, { type: 'file', mode: devMode, mtime: this.now(), content: '', device: v });
        } else children.set(name, build(v));
      }
      return { type: 'dir', mode: 0o555, mtime: this.now(), children, virtual: true };
    };
    const dir = build(files);
    dir.mode = mode;
    const existing = parent.children.get(basename(p));
    if (existing) this.release(existing);
    parent.children.set(basename(p), dir);
  }

  /** True when `path` is inside a system directory. */
  isSystem(path: string): boolean {
    const node = this.tryLookup(this.abs(path));
    return node !== null && isVirtual(node);
  }

  // ---- journal and snapshots ----------------------------------------------------------

  private mark(path: string, how: Mark): void {
    if (!this.journal) return;
    if (how === 'meta' && this.journal.has(path)) return;
    this.journal.set(path, how);
  }

  /** Starts recording which paths change. */
  record(): void {
    this.journal = new Map();
  }

  /** The paths changed since record() or the last takeJournal(), and starts over. */
  takeJournal(): Map<string, Mark> {
    const j = this.journal ?? new Map<string, Mark>();
    if (this.journal) this.journal = new Map();
    return j;
  }

  /** Runs `fn` without recording its changes. */
  unrecorded<T>(fn: () => T): T {
    const saved = this.journal;
    this.journal = null;
    try {
      return fn();
    } finally {
      this.journal = saved;
    }
  }

  /** Every ordinary file and directory at and below `path`, parents first; system directories left out. */
  exportEntries(path = '/'): Entry[] {
    const p = this.abs(path);
    const out: Entry[] = [];
    const walk = (at: string, node: Node): void => {
      if (isVirtual(node)) return;
      if (node.type === 'file') {
        out.push({ path: at, type: 'file', mode: node.mode, mtime: node.mtime, content: node.content });
        return;
      }
      out.push({ path: at, type: 'dir', mode: node.mode, mtime: node.mtime });
      for (const name of sortedNames(node)) walk(at === '/' ? '/' + name : at + '/' + name, node.children.get(name)!);
    };
    walk(p, this.lookup(p));
    return out;
  }

  /** Sets a node's mode and time as they were elsewhere, without touching its parent. */
  setMeta(path: string, mode: number, mtime: number): void {
    const p = this.abs(path);
    const node = this.lookup(p);
    if (isVirtual(node)) return;
    node.mode = mode & 0o7777;
    node.mtime = mtime;
  }

  /**
   * Puts entries in place (parents first, as exportEntries gives them): directories are created or
   * kept, files written, modes and times set. Quotas apply. Throws VfsError.
   */
  importEntries(entries: Entry[]): void {
    for (const e of entries) {
      const p = this.abs(e.path);
      const node = this.tryLookup(p);
      if (e.type === 'dir') {
        if (node && node.type !== 'dir') this.remove(p, true);
        if (p !== '/') this.mkdir(p, { recursive: true });
      } else {
        if (node && node.type === 'dir') this.remove(p, true);
        this.writeFile(p, e.content ?? '');
      }
      this.setMeta(p, e.mode, e.mtime);
    }
  }

  /** Empties the filesystem down to its mount points and system directories. */
  clear(): void {
    this.clearAround('/');
  }

  typeOf(path: string): NodeType | null {
    return this.stat(path)?.type ?? null;
  }
}

let seed = 0x2545f491;

/** What reading a device or kernel file gives. */
function readDevice(device: Device): string {
  switch (device) {
    case 'null':
    case 'tty':
      return '';
    case 'zero':
    case 'full':
      return '\0'.repeat(DEVICE_CHUNK);
    case 'random': {
      let out = '';
      for (let i = 0; i < DEVICE_CHUNK; i++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        out += String.fromCharCode((seed >>> 0) & 0xff);
      }
      return out;
    }
    default:
      return device();
  }
}

export function createVfs(now?: () => number): MemoryVfs {
  return new MemoryVfs(now);
}
