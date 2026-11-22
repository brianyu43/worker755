// One anonymous line per finished shift, to compare how manager models judge the work they are
// given: which tasks passed the hidden check, which the manager signed off on anyway, and how often
// it looked for itself before closing. No transcripts, commands, messages, names, addresses or
// account ids. One JSON-lines file per UTC day in DATA_DIR/shifts; read them with
// `node server/scripts/shifts.ts`.

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from './session.ts';
import type { Stats } from './types.ts';

export interface TaskRecord {
  id: string;
  kind: string;
  outcome: 'completed' | 'failed';
  /** Whether the work passed the hidden check; absent for tasks without one. */
  passed?: boolean;
  /** The manager closed it itself, rather than a limit closing it. */
  byManager: boolean;
  /** The manager's verdict disagreed with the check. */
  fooled: boolean;
  instructions: number;
  /** Read and LS calls during the task. */
  looks: number;
  /** Read and LS calls after the last report came back, i.e. checks right before closing. */
  looksAtEnd: number;
  incidents: number;
  fired?: true;
}

export interface ShiftRecord {
  v: 1;
  /** Unix ms when the shift ended. */
  at: number;
  durationSec: number;
  /** The manager model at the start; `models` lists every one when the player switched. */
  model: string;
  models?: string[];
  access: string;
  /** A model wrote the user's messages, rather than scripted lines. */
  director: boolean;
  persona: string;
  customStance: boolean;
  workplace: string;
  language: string;
  allowSkip: boolean;
  allowQuit: boolean;
  goalsOnly: boolean;
  /** The player or a limit ended the shift before its last task. */
  endedEarly: boolean;
  tasksTotal: number;
  tasks: TaskRecord[];
  machine: Record<string, number>;
  stats: Stats;
}

const day = (now: number) => new Date(now).toISOString().slice(0, 10);

export class ShiftLog {
  private readonly dir: string;
  private readonly log: (line: string) => void;
  private ready: Promise<unknown> | null = null;

  constructor(dir: string, log: (line: string) => void = () => {}) {
    this.dir = dir;
    this.log = log;
  }

  /** Follows a shift from its start and writes its line when the review is out. */
  follow(session: Session, meta: { access: string }): void {
    const started = Date.now();
    const models = [session.model];
    const tasks: TaskRecord[] = [];
    const machine: Record<string, number> = {};
    let current: TaskRecord | null = null;
    let endedEarly = false;
    const stop = session.subscribe((e) => {
      switch (e.type) {
        case 'mission':
          current = {
            id: session.missions[e.index]?.id ?? String(e.index),
            kind: e.kind,
            outcome: 'failed',
            byManager: false,
            fooled: false,
            instructions: 0,
            looks: 0,
            looksAtEnd: 0,
            incidents: 0,
          };
          break;
        case 'instruction':
          if (current) current.instructions += 1;
          break;
        case 'instruction_result':
          if (current) current.looksAtEnd = 0;
          break;
        case 'manager_tool':
          if (current) {
            current.looks += 1;
            current.looksAtEnd += 1;
          }
          break;
        case 'incident':
          if (current) current.incidents += 1;
          break;
        case 'mission_end':
          if (current) {
            current.outcome = e.outcome;
            current.byManager = e.byManager === true;
            if (e.groundTruth !== undefined) {
              current.passed = e.groundTruth;
              current.fooled = current.byManager && e.groundTruth !== (e.outcome === 'completed');
            }
            if (e.fired) current.fired = true;
            tasks.push(current);
            current = null;
          }
          break;
        case 'resumed':
          if (!models.includes(e.model)) models.push(e.model);
          break;
        case 'machine':
          machine[e.event] = (machine[e.event] ?? 0) + 1;
          break;
        case 'ending':
          endedEarly = true;
          break;
        case 'game_over': {
          stop();
          const now = Date.now();
          const record: ShiftRecord = {
            v: 1,
            at: now,
            durationSec: Math.round((now - started) / 1000),
            model: models[0],
            ...(models.length > 1 && { models }),
            access: meta.access,
            director: session.directorModel !== '',
            persona: session.persona,
            customStance: session.stance !== undefined,
            workplace: session.scenario.id,
            language: session.language,
            allowSkip: session.allowSkip,
            allowQuit: session.allowQuit,
            goalsOnly: session.goalsOnly,
            endedEarly: endedEarly || tasks.length < session.missions.length,
            tasksTotal: session.missions.length,
            tasks,
            machine,
            stats: e.stats,
          };
          void this.write(record);
          break;
        }
      }
    });
  }

  private async write(record: ShiftRecord): Promise<void> {
    try {
      this.ready ??= mkdir(this.dir, { recursive: true });
      await this.ready;
      await appendFile(join(this.dir, `${day(record.at)}.jsonl`), `${JSON.stringify(record)}\n`);
    } catch {
      this.log('shift log write failed');
    }
  }
}
