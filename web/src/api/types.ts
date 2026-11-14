// Copied from SPEC.md section 1 and 2. Keep in sync by hand; web/ does not import server/. It runs shell/
// in a Web Worker (src/shell), and takes the file-change type from there.
import type { Change } from '../../../shell/src/sync.ts';

export type NodeType = 'file' | 'dir';

export type MissionKind = 'files' | 'personal' | 'database' | 'research' | 'web' | 'drawing' | 'writing';

export interface TreeNode {
  name: string;
  path: string;
  type: NodeType;
  mode: number;
  size: number;
  children?: TreeNode[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  action?: { type: 'edit'; path: string } | { type: 'clear' };
}

export interface OpenInstruction {
  id: string;
  description: string;
  text: string;
  issuedAt: number;
  deadline: number;
  durationMs: number;
}

export interface Stats {
  missionsCompleted: number;
  missionsFailed: number;
  instructions: number;
  corrections: number;
  timeoutsIdle: number;
  timeoutsPartial: number;
  reports: number;
  commands: number;
  commandErrors: number;
  avgResponseMs: number;
  managerFooled: number;
  incidents: number;
  damaged: number;
}

export type GameEventBody =
  | { type: 'mission'; index: number; total: number; title: string; brief: string; kind?: MissionKind }
  | { type: 'manager_status'; state: 'thinking' | 'waiting' | 'idle' }
  | { type: 'manager_text'; text: string }
  | { type: 'manager_thinking'; text: string }
  | { type: 'director_text'; text: string }
  | { type: 'outrage'; text: string; items: string[] }
  | { type: 'incident'; severity: 'minor' | 'major' | 'critical'; report: string }
  | { type: 'manager_tool'; tool: 'Read' | 'LS'; input: { path: string }; output: string }
  | { type: 'instruction'; instruction: OpenInstruction }
  | {
      type: 'instruction_result';
      id: string;
      outcome: 'reported' | 'timeout_idle' | 'timeout_partial';
      resultText: string;
    }
  | {
      type: 'mission_end';
      index: number;
      outcome: 'completed' | 'failed';
      summary: string;
      groundTruth?: boolean;
    }
  /** Older fs events in a replayed log carry no tree; the newest one does. */
  | { type: 'fs'; tree?: TreeNode; cwd: string }
  /** Files a mission put in place; the browser's shell applies them. */
  | { type: 'seed'; epoch: number; changes: Change[] }
  | { type: 'stats'; stats: Stats }
  | { type: 'game_over'; review: string; stats: Stats }
  | { type: 'error'; message: string }
  /** The manager cannot go on until the player adds a key, or asks for the review now. */
  | { type: 'paused'; reason: PauseReason }
  /** The player added a key; the manager goes on as `model`. */
  | { type: 'resumed'; model: string }
  /** The player ended the shift early; the review follows. */
  | { type: 'ending' };

/** Why a shift waits: the free shift is used up, or the player's key was rejected or is out of credit. */
export type PauseReason = 'allowance' | 'key' | 'credit';

export type GameEvent = { seq: number; ts: number } & GameEventBody;

export type Workplace = 'fresh' | 'legacy';

export interface SessionState {
  id: string;
  model: string;
  allowSkip: boolean;
  subagent: string;
  scenario: Workplace;
  director?: string;
  status: 'running' | 'finished' | 'error';
  /** Set while the shift waits for the player's key. Older servers leave it out. */
  paused?: PauseReason | null;
  cwd: string;
  tree: TreeNode;
  /** Mission seeds applied so far. */
  epoch?: number;
  missionIndex: number;
  missionTotal: number;
  instruction: OpenInstruction | null;
  stats: Stats;
  events: GameEvent[];
}

export type Persona = 'default' | 'toxic' | 'ally' | 'saboteur';
/** A character on offer, or one the player writes. */
export type Character = Persona | 'custom';

export type Provider = 'openrouter' | 'gateway' | 'anthropic' | 'openai' | 'deepseek';

export interface ModelList {
  models: { id: string; label: string }[];
  subagents: string[];
  /** What the manager is told about the user by default, which a player may rewrite. */
  stance?: { text: string; max: number };
  /** Characters the manager can play, with what each adds to its prompt; older servers leave it out. */
  characters?: { id: Persona; text: string }[];
  scenarios: { id: Workplace; label: string }[];
  default: string;
  mock: boolean;
  /** Free shifts on the server's key are open right now. */
  free: boolean;
  /** Where a player's own key can come from. */
  providers: { id: Provider; label: string; keyUrl: string }[];
  donateUrl: string;
  sourceUrl: string;
  sharing: boolean;
}

/** What a player's own key can use, from its provider. */
export interface KeyModels {
  models: { id: string; label: string }[];
  default: string;
}

export interface SharedReview {
  id: string;
  createdAt: number;
  review: string;
  stats: Stats;
  model: string;
  director: string;
  subagent: string;
  scenario: Workplace;
  lost: string[];
  /** The language the shift was played in; missing on reviews shared before it was kept. */
  language?: string;
  face?: { id: string; color: string };
  /** The player rewrote what the manager was told about them. */
  customStance?: boolean;
  /** Who the manager secretly was, when not the default. */
  persona?: Persona;
}

export type ExecResponse = ExecResult & {
  cwd: string;
  /** The command did not stop and was killed; the shell is back as it was before it. */
  killed?: boolean;
  /** The command ran, but the server has not heard about it yet (no connection); it will be sent later. */
  unsynced?: boolean;
};

export const emptyStats = (): Stats => ({
  missionsCompleted: 0,
  missionsFailed: 0,
  instructions: 0,
  corrections: 0,
  timeoutsIdle: 0,
  timeoutsPartial: 0,
  reports: 0,
  commands: 0,
  commandErrors: 0,
  avgResponseMs: 0,
  managerFooled: 0,
  incidents: 0,
  damaged: 0,
});
