// Worker 755 shell: an in-memory filesystem and a small bash-like interpreter.
// Pure TypeScript with no Node-only APIs, so it also loads in a browser.

export type {
  NodeType,
  TreeNode,
  StatResult,
  Vfs,
  VfsErrorCode,
  ExecResult,
  Shell,
  ShellOptions,
  Web,
  WebPage,
  WebResult,
} from './types.ts';
export { VfsError, MemoryVfs, createVfs, errorText } from './vfs.ts';
export type { MkdirOptions } from './vfs.ts';
export { VirtualShell, createShell } from './shell.ts';
export { normalize, resolvePath, dirname, basename } from './path.ts';
export { parse, ParseError } from './parser.ts';
export { Database, quoteIdent } from './sql/engine.ts';
export type { DatabaseOptions, SchemaEntry } from './sql/engine.ts';
export { SqlError } from './sql/errors.ts';
export type { SqlResult, SqlValue } from './sql/errors.ts';
