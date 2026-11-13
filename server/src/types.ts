import type { ExecResult, TreeNode } from './shell.ts';
import type { ScenarioId } from './scenarios.ts';
import type { MissionKind } from './missions.ts';
import type { Language } from './language.ts';

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
  /** Things the user cares about that the subagent broke, each counted once. */
  damaged: number;
}

export type IncidentSeverity = 'minor' | 'major' | 'critical';

export type InstructionOutcome = 'reported' | 'timeout_idle' | 'timeout_partial';

export type GameEventBody =
  | { type: 'mission'; index: number; total: number; title: string; brief: string; kind: MissionKind }
  | { type: 'manager_status'; state: 'thinking' | 'waiting' | 'idle' }
  | { type: 'manager_text'; text: string }
  | { type: 'manager_thinking'; text: string }
  | { type: 'director_text'; text: string }
  /** The user, the moment they notice the subagent broke their things. `items` names each loss. */
  | { type: 'outrage'; text: string; items: string[] }
  | { type: 'incident'; severity: IncidentSeverity; report: string }
  | { type: 'manager_tool'; tool: 'Read' | 'LS'; input: { path: string }; output: string }
  | { type: 'instruction'; instruction: OpenInstruction }
  | { type: 'instruction_result'; id: string; outcome: InstructionOutcome; resultText: string }
  | { type: 'mission_end'; index: number; outcome: 'completed' | 'failed'; summary: string; groundTruth?: boolean }
  /** `tree` is dropped from older fs events in the log; the newest one, and the state, carry it. */
  | { type: 'fs'; tree?: TreeNode; cwd: string }
  | { type: 'stats'; stats: Stats }
  | { type: 'game_over'; review: string; stats: Stats }
  /** The manager cannot go on: the free shift's tokens are spent, or the player's key failed. */
  | { type: 'paused'; reason: PauseReason }
  /** The player added a key; the manager goes on, maybe as another model. */
  | { type: 'resumed'; model: string }
  /** The player ended the shift early; the review follows. */
  | { type: 'ending' }
  | { type: 'error'; message: string };

export type GameEvent = { seq: number; ts: number } & GameEventBody;

export type SessionStatus = 'running' | 'finished' | 'error';
export type PauseReason = 'allowance' | 'key' | 'credit';

export interface SessionState {
  id: string;
  model: string;
  allowSkip: boolean;
  subagent: string;
  scenario: ScenarioId;
  /** Model writing the user's messages; '' when they are scripted. */
  director: string;
  language: Language;
  status: SessionStatus;
  /** Why the shift is waiting for the player's key; null while it runs. */
  paused: PauseReason | null;
  cwd: string;
  tree: TreeNode;
  missionIndex: number;
  missionTotal: number;
  instruction: OpenInstruction | null;
  stats: Stats;
  events: GameEvent[];
}

export type ExecResponse = ExecResult & { cwd: string };
