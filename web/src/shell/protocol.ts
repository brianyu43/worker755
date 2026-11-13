// Messages between the page and the Web Worker that runs the player's shell.
import type { Change, Entry, ExecResult, ShellSnapshot } from '../../../shell/src/index.ts';

export type { Change, Entry, ShellSnapshot };

/** Where the shell's simulated web lives: the game server, for this shift. */
export interface WebAccess {
  base: string;
  token: string;
}

export type Request =
  | { id: number; type: 'init'; entries: Entry[]; cwd: string; state: ShellSnapshot | null; web: WebAccess | null }
  | { id: number; type: 'exec'; line: string }
  | { id: number; type: 'apply'; changes: Change[] }
  | { id: number; type: 'reload'; entries: Entry[]; cwd: string }
  | { id: number; type: 'read'; path: string }
  | { id: number; type: 'write'; path: string; content: string }
  | { id: number; type: 'names' };

export type Response =
  | { id: number; type: 'ready' }
  | { id: number; type: 'exec'; result: ExecResult; cwd: string; changes: Change[]; state: ShellSnapshot }
  | { id: number; type: 'read'; path: string; content: string }
  | { id: number; type: 'write'; path: string; changes: Change[] }
  | { id: number; type: 'names'; names: string[] }
  | { id: number; type: 'error'; message: string };
