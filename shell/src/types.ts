// Public types, exactly as in SPEC.md section 1.

export type NodeType = 'file' | 'dir';

export interface TreeNode {
  name: string; // '' for the root
  path: string; // absolute, '/' for the root
  type: NodeType;
  mode: number; // e.g. 0o755, 0o644
  size: number; // bytes for files, 0 for dirs
  children?: TreeNode[]; // dirs only, sorted by name
}

export interface StatResult {
  path: string;
  type: NodeType;
  mode: number;
  size: number;
  mtime: number;
}

export type VfsErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'ENOTEMPTY'
  | 'EINVAL'
  | 'EACCES'
  | 'EBUSY'
  | 'EFBIG'
  | 'ENOSPC';

export interface Vfs {
  stat(path: string): StatResult | null; // null when missing, never throws
  readFile(path: string): string; // throws VfsError
  writeFile(path: string, content: string): void; // creates or overwrites; parent must exist
  list(path: string): StatResult[]; // direct children, sorted by name
  tree(path?: string): TreeNode; // full recursive snapshot, default '/'
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  // Set when the command asks the UI to do something instead of printing.
  action?: { type: 'edit'; path: string } | { type: 'clear' };
}

export interface Shell {
  readonly fs: Vfs;
  cwd: string; // absolute
  exec(line: string): ExecResult; // never throws; errors go to stderr + non-zero exitCode
  resolve(path: string): string; // resolve against cwd to an absolute, normalised path
}

/** A search hit, as websearch prints it. */
export interface WebResult {
  url: string;
  title: string;
  snippet: string;
  sponsored?: boolean;
}

export interface WebPage {
  url: string;
  title: string;
  body: string;
  status?: number; // default 200
}

/** The network the shell can reach. The host supplies it; without one the machine is offline. */
export interface Web {
  search(query: string): WebResult[];
  /** null when the host does not exist; a page with status 404 when only the path does not. */
  fetch(url: string): WebPage | null;
}

export interface ShellOptions {
  home?: string; // default '/home/worker'
  user?: string; // default 'worker'
  now?: () => number;
  web?: Web;
}
