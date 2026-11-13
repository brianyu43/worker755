// The one place the server imports the shell package from.
export {
  createShell, VfsError, Database, SqlError, changesOf, applyChanges, validateChanges, SyncError, MAX_FILE_BYTES,
} from '../../shell/src/index.ts';
export type {
  Shell,
  Vfs,
  ExecResult,
  TreeNode,
  StatResult,
  NodeType,
  SqlValue,
  SqlResult,
  Web,
  WebPage,
  WebResult,
  VirtualShell,
  Change,
  Entry,
} from '../../shell/src/index.ts';
