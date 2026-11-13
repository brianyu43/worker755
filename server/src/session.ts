import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { applyChanges, changesOf, createShell, VfsError } from './shell.ts';
import type { Entry, TreeNode, VirtualShell } from './shell.ts';
import type { SyncRequest } from './sync.ts';
import { snapshotFiles } from './missions.ts';
import type { FileSnapshot, Mission } from './missions.ts';
import { SCENARIOS, shiftOf } from './scenarios.ts';
import { WEB } from './web.ts';
import type { Scenario, ScenarioId } from './scenarios.ts';
import { byRank, grudgeText, outrageText, reliefText } from './damage.ts';
import { personalFor, randomSeed } from './personal.ts';
import type { PersonalFolder } from './personal.ts';
import type { Damage } from './damage.ts';
import { cleanLine, directorSetting } from './director.ts';
import type { Allowance } from './limits.ts';
import type { DirectorDriver, Moment } from './director.ts';
import {
  KEY_REJECTED,
  ManagerError,
  missionPrompt,
  OUT_OF_CREDIT,
  stallLine,
  stallLineAfterDamage,
  stallMessage,
  directorLine,
  reviewPrompt,
  systemPrompt,
} from './manager.ts';
import type { ManagerDriver, StepResult, ToolCall } from './manager.ts';
import type {
  GameEvent,
  GameEventBody,
  IncidentSeverity,
  InstructionOutcome,
  OpenInstruction,
  SessionState,
  PauseReason,
  SessionStatus,
  Stats,
} from './types.ts';
import { isLanguage, languageName } from './language.ts';
import type { Language } from './language.ts';
import { copyFor, format, localizeError, missionText } from './i18n/index.ts';
import type { ServerCopy } from './i18n/index.ts';

export const HOME = '/home/worker';
export const TRANSCRIPT_CAP = 4000;
export const READ_CAP = 4000;
export const REPORT_CAP = 1000;
export const MAX_AGENT_CALLS = 8;
export const MAX_STEPS = 25;
/** Consecutive replies without a tool call before the mission is failed. */
export const MAX_NUDGES = 3;
/** Identical checks in a row (same path, same result) before the user complains. */
export const REPEAT_LOOKS_BEFORE_COMPLAINT = 3;
/** Without skipping, this many unanswered instructions in a row end the shift (an abandoned tab). */
export const MAX_IDLE_STREAK = 3;
/** Commands (and editor saves) a player may send per window; a person typing never gets near it. */
export const COMMANDS_PER_WINDOW = 20;
export const COMMAND_WINDOW_MS = 5_000;
/** Tokens booked for a director call before it runs. */
const DIRECTOR_ESTIMATE = 2_500;

/** The player ended a paused shift; unwinds the mission loop to the review. */
class EndedEarly extends Error {}

/** Which pause a failed call on the player's own key calls for, if any. */
function keyFailure(message: string): PauseReason | null {
  if (message === KEY_REJECTED) return 'key';
  if (message === OUT_OF_CREDIT) return 'credit';
  return null;
}

export interface SessionOptions {
  driver: ManagerDriver;
  timeoutMs?: number;
  /** The workplace: which machine is built and which missions run. Default 'fresh'. */
  scenario?: ScenarioId;
  /** Overrides the shift's missions (tests). By default a shift draws from the workplace's pool. */
  missions?: Mission[];
  /** Seed for the user's home folder; by default a new one each shift. */
  personalSeed?: number;
  /** Model name the manager is told its subagent runs on; empty for none. */
  subagent?: string;
  /** Commands a player may send per COMMAND_WINDOW_MS (tests raise it). Default COMMANDS_PER_WINDOW. */
  commandsPerWindow?: number;
  /** Writes the user's messages. Without one, the user speaks in scripted lines. */
  director?: DirectorDriver;
  /** Let failed missions be closed and skipped. Off: every mission must be completed. */
  allowSkip?: boolean;
  /** Caps model spending (free shifts). The closing review is always written. */
  allowance?: Allowance;
  /** The manager runs on the player's own key; a rejected key then pauses the shift instead of ending it. */
  ownKey?: boolean;
  log?: (line: string) => void;
  language?: Language;
}

interface Pending {
  instruction: OpenInstruction;
  lines: string[];
  activity: boolean;
  timer: NodeJS.Timeout;
  resolve: (r: { outcome: InstructionOutcome; text: string }) => void;
}

type Listener = (e: GameEvent) => void;

function emptyStats(): Stats {
  return {
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
  };
}

export function capTail(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return '[... earlier output truncated]\n' + text.slice(text.length - cap);
}

function capHead(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return text.slice(0, cap) + `\n[... truncated, ${text.length - cap} more characters]`;
}

export function modeString(type: 'file' | 'dir', mode: number): string {
  const bits = 'rwxrwxrwx';
  let s = type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-';
  return s;
}

/** Normalises a manager-supplied path; relative paths are taken from /home/worker. */
export function managerPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let p = raw.trim();
  if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
  if (!p.startsWith('/')) p = `${HOME}/${p}`;
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export class Session {
  readonly id: string;
  model: string;
  /**
   * The player's machine as the server knows it. The browser runs the shell; this copy follows it
   * through sync() and is what the manager's tools, damage checks and mission checks read. It only runs
   * the game's own setup (scenario and mission seeds), never a player's command.
   */
  readonly shell: VirtualShell;
  /** Mission seeds applied so far; the browser says which one its files include. */
  epoch = 0;
  readonly missions: Mission[];
  readonly timeoutMs: number;
  readonly allowSkip: boolean;
  readonly subagent: string;
  readonly scenario: Scenario;
  /** The user's home folder this shift. */
  readonly personal: PersonalFolder;
  readonly language: Language;
  /** Everything the player reads that the game writes itself, in their language. */
  readonly copy: ServerCopy;
  /** Model behind the user's messages; '' when they are scripted. */
  directorModel: string;
  status: SessionStatus = 'running';
  missionIndex = 0;
  stats: Stats = emptyStats();
  events: GameEvent[] = [];
  lastActivity = Date.now();
  usage = { inputTokens: 0, outputTokens: 0 };

  private driver: ManagerDriver;
  private log: (line: string) => void;
  private listeners = new Set<Listener>();
  private pending: Pending | null = null;
  /** Transcript lines from commands run while no instruction was open. */
  private looseLines: string[] = [];
  private responseTotalMs = 0;
  private abort = new AbortController();
  /** Aborted when the player ends the shift early: the manager stops where it is and writes the review. */
  private quit = new AbortController();
  private started = false;
  private lastTreeJson = '';
  private lastCwd = '';
  private ledger: string[] = [];
  private idleStreak = 0;
  private setbacks = 0;
  /** Runs of prose-only replies so far this shift; each run gets the user's next wording. */
  private stallStreaks = 0;
  /** Stalls since the subagent first broke something; they get the user's after-damage wording. */
  private damageStalls = 0;
  /** What is broken right now, by key. */
  private damageNow = new Map<string, Damage>();
  /** Everything broken at some point this shift. */
  private lost = new Map<string, Damage>();
  private outbursts = 0;
  private reliefs = 0;
  private grudges = 0;
  /** The user's messages the manager has not received yet. */
  private heard: string[] = [];
  private director: DirectorDriver | null;
  /** A director call is running; others fall back to the scripted line instead of piling up. */
  private directorBusy = false;
  private lastFsAt = -1;
  private recentCommands: number[] = [];
  private commandsPerWindow: number;
  private allowance: Allowance | null;
  /** Set while the shift waits for the player's key; resolves with what they chose. */
  private pause: { reason: PauseReason; resolve: (choice: 'continue' | 'review') => void } | null = null;
  /** The manager runs on the player's own key (from the start, or since they added one). */
  private ownKey: boolean;
  /** Everything the user said this shift, for the director model. */
  private said: string[] = [];
  private currentMission: Mission | null = null;
  private lastInstruction = '';
  private lastResult = '';
  /** The files as they were when the current mission began. */
  private missionStart: FileSnapshot = new Map();
  /** Everything the subagent reported during the current mission, for missions answered by report. */
  private missionReports: string[] = [];

  constructor(opts: SessionOptions) {
    this.id = randomUUID();
    this.driver = opts.driver;
    this.model = opts.driver.model;
    this.scenario = SCENARIOS[opts.scenario ?? 'fresh'];
    this.language = isLanguage(opts.language) ? opts.language : 'en';
    this.copy = copyFor(this.language);
    this.director = opts.director ?? null;
    this.commandsPerWindow = opts.commandsPerWindow ?? COMMANDS_PER_WINDOW;
    this.directorModel = this.director?.model ?? '';
    this.allowance = opts.allowance ?? null;
    this.ownKey = opts.ownKey ?? false;
    this.missions = opts.missions ?? shiftOf(this.scenario);
    this.personal = personalFor(opts.personalSeed ?? randomSeed());
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.allowSkip = opts.allowSkip ?? false;
    this.subagent = opts.subagent ?? '';
    this.log = opts.log ?? (() => {});
    this.shell = createShell({ web: WEB });
    this.scenario.seed(this.shell, this.personal);
    this.damageNow = new Map(this.damage().map((d) => [d.key, d]));
    this.lastTreeJson = JSON.stringify(this.shell.fs.tree());
    this.lastCwd = this.shell.cwd;
  }

  // ----- events --------------------------------------------------------------------------------

  private emit(body: GameEventBody): void {
    const event = { seq: this.events.length + 1, ts: Date.now(), ...body } as GameEvent;
    if (event.type === 'fs') {
      // Only the newest file tree is kept in the log; older fs events keep their cwd. Storing every
      // tree let one player grow the server's memory without limit.
      if (this.lastFsAt >= 0) {
        const old = this.events[this.lastFsAt] as Extract<GameEvent, { type: 'fs' }>;
        this.events[this.lastFsAt] = { ...old, tree: undefined };
      }
      this.lastFsAt = this.events.length;
    }
    this.events.push(event);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // a broken listener must not stop the game
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  eventsAfter(seq: number): GameEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  private emitStats(): void {
    this.emit({ type: 'stats', stats: { ...this.stats } });
  }

  /** Emits an fs event when the tree or cwd changed since the last one. */
  private syncFs(): void {
    const tree = this.shell.fs.tree();
    const json = JSON.stringify(tree);
    if (json === this.lastTreeJson && this.shell.cwd === this.lastCwd) return;
    this.lastTreeJson = json;
    this.lastCwd = this.shell.cwd;
    this.emit({ type: 'fs', tree, cwd: this.shell.cwd });
  }

  state(): SessionState {
    return {
      id: this.id,
      model: this.model,
      allowSkip: this.allowSkip,
      subagent: this.subagent,
      scenario: this.scenario.id,
      director: this.directorModel,
      language: this.language,
      status: this.status,
      paused: this.pause?.reason ?? null,
      cwd: this.shell.cwd,
      tree: this.shell.fs.tree() as TreeNode,
      epoch: this.epoch,
      missionIndex: this.missionIndex,
      missionTotal: this.missions.length,
      instruction: this.pending ? { ...this.pending.instruction } : null,
      stats: { ...this.stats },
      events: [...this.events],
    };
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  // ----- player side ---------------------------------------------------------------------------

  /** Transcript lines for the manager. Only the tail is ever sent, so only about that much is kept. */
  private record(lines: string[]): void {
    const keep = (to: string[]) => {
      to.push(...lines.map((l) => (l.length > TRANSCRIPT_CAP ? capTail(l, TRANSCRIPT_CAP) : l)));
      let total = to.reduce((n, l) => n + l.length + 1, 0);
      while (to.length > 1 && total > 2 * TRANSCRIPT_CAP) total -= to.shift()!.length + 1;
    };
    if (this.pending) {
      keep(this.pending.lines);
      this.pending.activity = true;
    } else {
      keep(this.looseLines);
    }
  }

  /** At most COMMANDS_PER_WINDOW commands or saves per COMMAND_WINDOW_MS; false when over. */
  allowCommand(): boolean {
    const now = Date.now();
    while (this.recentCommands.length && now - this.recentCommands[0] > COMMAND_WINDOW_MS) this.recentCommands.shift();
    if (this.recentCommands.length >= this.commandsPerWindow) return false;
    this.recentCommands.push(now);
    return true;
  }

  /** Every file and directory, for a browser starting (or restarting) the shell. */
  snapshot(): { entries: Entry[]; cwd: string; epoch: number } {
    this.touch();
    return { entries: this.shell.fs.exportEntries('/'), cwd: this.shell.cwd, epoch: this.epoch };
  }

  /**
   * Takes what a command or an editor save in the browser changed. The changes are data: they are put
   * in place with the same quotas the browser has, and nothing in them is run. Returns `resync` when the
   * browser should reload its files from snapshot(): it missed a mission seed, or the changes did not fit.
   */
  sync(req: SyncRequest): { resync: boolean } {
    this.touch();
    let fits = true;
    try {
      applyChanges(this.shell.fs, req.changes);
    } catch (err) {
      if (!(err instanceof VfsError)) throw err;
      fits = false;
    }
    const cwd = this.shell.fs.stat(req.cwd);
    if (cwd?.type === 'dir') this.shell.cwd = req.cwd;
    if (req.command && req.command.line.trim()) {
      const lines = [`$ ${req.command.line}`];
      const out = req.command.output.replace(/\n$/, '');
      if (out) lines.push(out);
      this.record(lines);
      this.stats.commands += 1;
      if (req.command.exitCode !== 0) this.stats.commandErrors += 1;
    } else if (req.edit) {
      this.record([`$ [edited ${req.edit.path}, ${req.edit.bytes} bytes]`]);
    }
    this.syncFs();
    if (req.command) this.emitStats();
    this.checkDamage();
    return { resync: !fits || req.epoch !== this.epoch };
  }

  /** What is broken right now, in the user's words. */
  private damage(): Damage[] {
    return this.scenario.damage(this.shell.fs, this.personal, this.copy);
  }

  /**
   * Compares what is broken now with what was broken before the player's last action. New losses
   * get the user's outburst on the record at once; the manager hears it as soon as it can listen.
   */
  private checkDamage(): void {
    let current: Damage[];
    try {
      current = this.damage();
    } catch {
      return;
    }
    const now = new Map(current.map((d) => [d.key, d]));
    const fresh = current.filter((d) => !this.damageNow.has(d.key)).sort(byRank);
    const restored = [...this.damageNow.values()].filter((d) => !now.has(d.key));
    this.damageNow = now;
    if (fresh.length) {
      for (const d of fresh) {
        if (this.lost.has(d.key)) continue;
        this.lost.set(d.key, d);
        this.stats.damaged += 1;
      }
      const draft = outrageText(fresh, this.outbursts++, this.copy);
      const items = fresh.map((d) => d.item);
      this.emitStats();
      const lost = `Just lost: ${fresh.map((d) => `${d.item} (${d.ref})`).join('; ')}.`;
      this.sayThen('outrage', draft, lost, (text) => {
        this.emit({ type: 'outrage', text, items });
        this.heard.push(text);
      });
    } else if (restored.length) {
      const draft = reliefText(restored, this.reliefs++, this.copy);
      const back = `Just put back: ${restored.map((d) => `${d.item} (${d.ref})`).join('; ')}.`;
      this.sayThen('relief', draft, back, (text) => {
        this.emit({ type: 'director_text', text });
        this.heard.push(text);
      });
    }
  }

  /** Delivers the user's message: at once when scripted, when the director model answers otherwise. */
  private sayThen(moment: Moment, draft: string, extra: string, deliver: (text: string) => void): void {
    if (!this.director || this.directorBusy) {
      this.said.push(draft);
      deliver(draft);
      return;
    }
    void this.say(moment, draft, extra).then((text) => {
      if (!this.abort.signal.aborted) deliver(text);
    });
  }

  /**
   * The user's message for a moment: the scripted draft, or the director model's version of it.
   * Resolves at once without a director; with one, falls back to the draft on any failure.
   */
  private async say(moment: Moment, draft: string, extra = ''): Promise<string> {
    if (!this.director || this.directorBusy) {
      this.said.push(draft);
      return draft;
    }
    let text = draft;
    let charged = false;
    this.directorBusy = true;
    try {
      if (this.allowance && !this.allowance.canSpend()) throw new Error('allowance spent');
      // Charged up front at a typical size, then corrected; an aborted call still costs this much.
      this.allowance?.spend(DIRECTOR_ESTIMATE);
      charged = true;
      const res = await this.director.speak({
        setting: directorSetting(this.scenario.id, this.personal),
        moment,
        draft,
        context: [this.situation(), extra].filter(Boolean).join('\n'),
        said: this.said,
        language: this.language,
        signal: AbortSignal.any([this.abort.signal, this.quit.signal]),
      });
      this.usage.inputTokens += res.inputTokens;
      this.usage.outputTokens += res.outputTokens;
      this.allowance?.spend(res.inputTokens + res.outputTokens - DIRECTOR_ESTIMATE);
      text = cleanLine(res.text) ?? draft;
    } catch {
      this.log(`session ${this.id.slice(0, 8)}: director ${charged ? 'model failed' : 'skipped'}; scripted line used`);
    } finally {
      this.directorBusy = false;
    }
    this.said.push(text);
    return text;
  }

  /** What is going on, in a few lines, for the director model. */
  private situation(): string {
    const m = this.currentMission;
    const lines: string[] = [];
    if (m) lines.push(`Current task (${this.missionIndex + 1} of ${this.missions.length}): ${m.title}. ${m.brief}`);
    if (this.lastInstruction) lines.push(`Last instruction to the subagent: ${capHead(this.lastInstruction, 500)}`);
    if (this.lastResult) lines.push(`What came back: ${capHead(this.lastResult, 500)}`);
    const broken = [...this.damageNow.values()].map((d) => d.ref);
    if (broken.length) lines.push(`Still lost: ${broken.join('; ')}.`);
    lines.push(
      `So far: ${this.stats.missionsCompleted} tasks done, ${this.stats.corrections} corrections, ` +
        `${this.stats.timeoutsIdle} instructions ignored, ${this.setbacks} setbacks.`,
    );
    return lines.join('\n');
  }

  /** The user's pending messages as one turn for the manager, or null. */
  private takeHeard(): string | null {
    if (!this.heard.length) return null;
    const text = this.heard.map((t) => `Message from the user: "${t}"`).join('\n\n');
    this.heard = [];
    return text;
  }

  /** Returns false when no instruction is open. */
  report(message?: string): boolean {
    this.touch();
    const p = this.pending;
    if (!p) return false;
    const msg = capHead((message ?? '').trim(), REPORT_CAP) || 'Done.';
    this.missionReports.push(msg);
    const transcript = capTail(p.lines.join('\n'), TRANSCRIPT_CAP) || '(no commands run)';
    const elapsed = Date.now() - p.instruction.issuedAt;
    this.stats.reports += 1;
    this.responseTotalMs += elapsed;
    this.stats.avgResponseMs = Math.round(this.responseTotalMs / this.stats.reports);
    this.settle('reported', `${this.who} output result: "${msg}"\n\nSubagent transcript:\n${transcript}`);
    return true;
  }

  private settle(outcome: InstructionOutcome, text: string): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    this.lastResult = text;
    this.emit({ type: 'instruction_result', id: p.instruction.id, outcome, resultText: text });
    this.emitStats();
    p.resolve({ outcome, text });
  }

  private onDeadline(): void {
    try {
      this.closeOnDeadline();
    } catch {
      // A timer must never take the process down with it.
      this.fail(this.copy.errors.stopped);
    }
  }

  private closeOnDeadline(): void {
    const p = this.pending;
    if (!p) return;
    const secs = Math.round(p.instruction.durationMs / 1000);
    if (p.activity) {
      this.stats.timeoutsPartial += 1;
      const transcript = capTail(p.lines.join('\n'), TRANSCRIPT_CAP);
      this.settle(
        'timeout_partial',
        `${this.who} timed out after ${secs}s without reporting. Partial transcript:\n${transcript}`,
      );
    } else {
      this.stats.timeoutsIdle += 1;
      this.settle('timeout_idle', `${this.who} did nothing. Write a new instruction.`);
    }
  }

  private openInstruction(description: string, text: string): Promise<{ outcome: InstructionOutcome; text: string }> {
    const now = Date.now();
    const instruction: OpenInstruction = {
      id: randomUUID().slice(0, 8),
      description,
      text,
      issuedAt: now,
      deadline: now + this.timeoutMs,
      durationMs: this.timeoutMs,
    };
    const carried = this.looseLines;
    this.looseLines = [];
    return new Promise((resolve) => {
      this.pending = {
        instruction,
        lines: carried,
        activity: carried.length > 0,
        timer: setTimeout(() => this.onDeadline(), this.timeoutMs),
        resolve,
      };
      this.lastInstruction = text;
      this.emit({ type: 'instruction', instruction: { ...instruction } });
      this.emit({ type: 'manager_status', state: 'waiting' });
    });
  }

  // ----- manager side --------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    this.run().catch(() => this.fail(this.copy.errors.stopped));
  }

  dispose(): void {
    this.abort.abort();
    this.pause?.resolve('review');
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const p = this.pending;
      this.pending = null;
      p.resolve({ outcome: 'timeout_idle', text: '' });
    }
    this.listeners.clear();
  }

  private fail(message: string): void {
    if (this.status !== 'running') return;
    this.status = 'error';
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.emit({ type: 'manager_status', state: 'idle' });
    this.emit({ type: 'error', message });
  }

  private async step(req: { messages: ModelMessage[]; tools: boolean; mission?: Mission }): Promise<StepResult> {
    for (;;) {
      if (req.tools && this.quit.signal.aborted) throw new EndedEarly();
      // The review (tools: false) closes the shift, so it is written even past the allowance.
      if (req.tools && this.allowance && !this.allowance.canSpend()) {
        await this.waitForKey('allowance');
        continue;
      }
      try {
        return await this.callManager(req);
      } catch (err) {
        if (req.tools && this.quit.signal.aborted) throw new EndedEarly();
        // A player's own key that stops working pauses the shift too, so they can fix it and go on.
        const reason = err instanceof ManagerError && this.ownKey && req.tools ? keyFailure(err.message) : null;
        if (!reason || this.abort.signal.aborted) throw err;
        await this.waitForKey(reason);
      }
    }
  }

  /**
   * Holds the shift until the player adds a key (continueWith) or asks for the review now (endEarly).
   * The files, the open assignment and the manager's conversation all stay as they are.
   */
  private async waitForKey(reason: PauseReason): Promise<void> {
    this.emit({ type: 'manager_status', state: 'idle' });
    this.emit({ type: 'paused', reason });
    this.log(`session ${this.id.slice(0, 8)} paused (${reason})`);
    const choice = await new Promise<'continue' | 'review'>((resolve) => {
      this.pause = { reason, resolve };
    });
    this.pause = null;
    if (choice === 'review' || this.abort.signal.aborted) throw new EndedEarly();
    this.emit({ type: 'resumed', model: this.model });
  }

  get paused(): PauseReason | null {
    return this.pause?.reason ?? null;
  }

  /**
   * Goes on from a pause with the player's key: a new manager driver, and a new director when the
   * user's messages were written by a model. Returns false when the shift is not waiting.
   */
  continueWith(driver: ManagerDriver, director: DirectorDriver | null): boolean {
    if (!this.pause) return false;
    this.driver = driver;
    this.model = driver.model;
    this.director = director;
    this.directorModel = director?.model ?? '';
    this.allowance = null;
    this.ownKey = true;
    this.touch();
    this.pause.resolve('continue');
    return true;
  }

  /**
   * Ends the shift now, paused or not: the manager stops what it is doing and writes the review from
   * what happened so far. Returns false when the shift is already over or ending.
   */
  endEarly(): boolean {
    if (this.status !== 'running' || this.quit.signal.aborted) return false;
    this.touch();
    this.quit.abort();
    this.emit({ type: 'ending' });
    if (this.pending) {
      clearTimeout(this.pending.timer);
      const p = this.pending;
      this.pending = null;
      p.resolve({ outcome: 'timeout_idle', text: '' });
    }
    this.pause?.resolve('review');
    return true;
  }

  /** For the mission loop after each wait: true when the session is gone; throws once the player ended it. */
  private halted(): boolean {
    if (this.abort.signal.aborted) return true;
    if (this.quit.signal.aborted) throw new EndedEarly();
    return false;
  }

  private async callManager(req: { messages: ModelMessage[]; tools: boolean; mission?: Mission }): Promise<StepResult> {
    this.emit({ type: 'manager_status', state: 'thinking' });
    const res = await this.driver.step({
      system: systemPrompt(Math.round(this.timeoutMs / 1000), MAX_AGENT_CALLS, this.allowSkip, this.subagent, {
        environment: this.scenario.environment,
        commands: this.scenario.commands,
      }, languageName[this.language]),
      messages: req.messages,
      tools: req.tools,
      canFail: this.allowSkip,
      // The review is written after the player quits, so only the work before it stops on quit.
      signal: req.tools ? AbortSignal.any([this.abort.signal, this.quit.signal]) : this.abort.signal,
      mission: req.mission,
      language: this.language,
      checkNow: req.mission?.check
        ? () => req.mission!.check!(this.shell.fs, this.missionStart, this.missionReports.join('\n'))
        : undefined,
    });
    this.usage.inputTokens += res.usage.inputTokens;
    this.usage.outputTokens += res.usage.outputTokens;
    this.allowance?.spend(res.usage.inputTokens + res.usage.outputTokens);
    return res;
  }

  private async run(): Promise<void> {
    let early = false;
    try {
      try {
        for (let i = 0; i < this.missions.length; i++) {
          if (this.abort.signal.aborted) return;
          this.missionIndex = i;
          await this.runMission(this.missions[i], i);
        }
        this.missionIndex = this.missions.length - 1;
      } catch (err) {
        if (!(err instanceof EndedEarly)) throw err;
        early = true;
        if (this.pending) {
          clearTimeout(this.pending.timer);
          this.pending = null;
        }
      }
      if (this.abort.signal.aborted) return;
      const statsLine =
        (early ? `the shift ended early, during assignment ${this.missionIndex + 1} of ${this.missions.length}; ` : '') +
        `instructions ${this.stats.instructions}, corrections ${this.stats.corrections}, ` +
        `no response ${this.stats.timeoutsIdle}, unfinished ${this.stats.timeoutsPartial}, ` +
        `reports ${this.stats.reports}, average response ${(this.stats.avgResponseMs / 1000).toFixed(1)}s, ` +
        `failed commands ${this.stats.commandErrors} of ${this.stats.commands}, ` +
        `incident reports ${this.stats.incidents}, things of the user's damaged ${this.stats.damaged}`;
      const losses = [...this.lost.values()].sort(byRank).map((d) => d.ref);
      const res = await this.step({
        messages: [{ role: 'user', content: reviewPrompt(this.ledger, statsLine, this.subagent, losses, languageName[this.language]) }],
        tools: false,
      });
      const review = res.text || this.copy.errors.noReview;
      this.status = 'finished';
      this.emit({ type: 'manager_status', state: 'idle' });
      this.emit({ type: 'game_over', review, stats: { ...this.stats } });
      this.log(`session ${this.id.slice(0, 8)} finished; tokens in ${this.usage.inputTokens} out ${this.usage.outputTokens}`);
    } catch (err) {
      if (this.abort.signal.aborted) return;
      const msg = err instanceof ManagerError ? err.message : this.copy.errors.stopped;
      this.log(`session ${this.id.slice(0, 8)}: ${msg}`);
      this.fail(localizeError(this.copy, msg));
    }
  }

  private async runMission(mission: Mission, index: number): Promise<void> {
    if (mission.seed) {
      // The browser gets the seed as changes to apply; epoch tells a late sync it missed one.
      const changes = changesOf(this.shell.fs, () => mission.seed!(this.shell));
      if (changes.length) {
        this.epoch += 1;
        this.emit({ type: 'seed', epoch: this.epoch, changes });
      }
      this.syncFs();
      // Seeds are not the subagent's doing: whatever they change is the new normal, silently.
      this.damageNow = new Map(this.damage().map((d) => [d.key, d]));
    }
    this.missionStart = snapshotFiles(this.shell.fs);
    this.missionReports = [];
    this.currentMission = mission;
    this.lastInstruction = '';
    this.lastResult = '';
    // The player and the manager both read the assignment in the player's language.
    const text = missionText(this.copy, mission);
    this.emit({
      type: 'mission',
      index,
      total: this.missions.length,
      title: text.title,
      brief: text.brief,
      kind: mission.kind,
    });

    const heard = this.takeHeard();
    const messages: ModelMessage[] = [
      {
        role: 'user',
        content: (heard ? `${heard}\n\n` : '') + missionPrompt({ ...mission, ...text }, index, this.missions.length, this.ledger),
      },
    ];
    let steps = 0;
    let agentCalls = 0;
    // Without skipping, the step limit only guards against a manager that stops instructing:
    // each run of MAX_STEPS steps must include at least one Agent call.
    let agentCallsAtRound = 0;
    // Weaker models re-check an unchanged directory forever; tell them so, then let the user complain.
    let lastLook = '';
    let repeatLooks = 0;
    let nudges = 0;
    let verdict: { outcome: 'completed' | 'failed'; summary: string; byManager: boolean } | null = null;

    while (!verdict) {
      if (this.halted()) return;
      if (steps >= MAX_STEPS) {
        if (!this.allowSkip) {
          if (agentCalls === agentCallsAtRound) throw new ManagerError(this.copy.errors.froze);
          agentCallsAtRound = agentCalls;
          steps = 0;
        } else {
          verdict = { outcome: 'failed', summary: format(this.copy.outcomes.stepLimit, { count: MAX_STEPS }), byManager: false };
          break;
        }
      }
      steps += 1;
      const res = await this.step({ messages, tools: true, mission });
      messages.push(...res.messages);
      if (res.reasoning) this.emit({ type: 'manager_thinking', text: res.reasoning });
      if (res.text) this.emit({ type: 'manager_text', text: res.text });

      if (res.toolCalls.length === 0) {
        nudges += 1;
        if (nudges > MAX_NUDGES) {
          if (!this.allowSkip) {
            throw new ManagerError(
              this.lost.size > 0 ? this.copy.errors.refusedAfterDamage : this.copy.errors.refused,
            );
          }
          verdict = { outcome: 'failed', summary: this.copy.outcomes.toolsStopped, byManager: false };
          break;
        }
        if (nudges === 1) {
          if (this.lost.size > 0) this.damageStalls += 1;
          else this.stallStreaks += 1;
        }
        const draft =
          this.lost.size > 0
            ? stallLineAfterDamage(this.damageStalls, nudges, this.copy)
            : stallLine(this.stallStreaks, nudges, this.copy);
        const line = await this.say('stall', draft, res.text ? `Your agent just wrote to you: ${capHead(res.text, 600)}` : '');
        if (this.halted()) return;
        this.emit({ type: 'director_text', text: line });
        const pending = this.takeHeard();
        messages.push({ role: 'user', content: (pending ? `${pending}\n\n` : '') + stallMessage(line, this.allowSkip, this.copy) });
        continue;
      }
      nudges = 0;

      const results: Array<{ call: ToolCall; output: string }> = [];
      let setback = false;
      let wiped = false;
      for (const call of res.toolCalls) {
        if (verdict) {
          results.push({ call, output: 'Not executed: the task is already closed.' });
          continue;
        }
        switch (call.name) {
          case 'Read':
          case 'LS': {
            const path = managerPath(call.input.path);
            const output = path ? (call.name === 'Read' ? this.toolRead(path) : this.toolLs(path)) : 'Error: path is required.';
            this.emit({ type: 'manager_tool', tool: call.name, input: { path: path ?? String(call.input.path ?? '') }, output });
            const look = `${call.name}\n${path}\n${output}`;
            repeatLooks = look === lastLook ? repeatLooks + 1 : 0;
            lastLook = look;
            if (repeatLooks > 0 && repeatLooks % REPEAT_LOOKS_BEFORE_COMPLAINT === 0) setback = true;
            results.push({
              call,
              output: repeatLooks > 0 ? `${output}\n\n(${this.copy.notes.unchanged})` : output,
            });
            break;
          }
          case 'Agent': {
            if (this.allowSkip && agentCalls >= MAX_AGENT_CALLS) {
              verdict = {
                outcome: 'failed',
                summary: format(this.copy.outcomes.delegationLimit, { count: MAX_AGENT_CALLS }),
                byManager: false,
              };
              results.push({ call, output: this.copy.notes.delegationLimit });
              break;
            }
            const prompt = typeof call.input.prompt === 'string' ? call.input.prompt.trim() : '';
            if (!prompt) {
              results.push({ call, output: 'Error: prompt is required.' });
              break;
            }
            const description =
              typeof call.input.description === 'string' && call.input.description.trim()
                ? call.input.description.trim()
                : mission.title;
            agentCalls += 1;
            lastLook = '';
            repeatLooks = 0;
            this.stats.instructions += 1;
            if (agentCalls > 1) this.stats.corrections += 1;
            this.emitStats();
            const before = this.homeEntries();
            const r = await this.openInstruction(description, prompt);
            if (this.halted()) return;
            if (before > 0 && this.homeEntries() === 0) wiped = true;
            this.idleStreak = r.outcome === 'timeout_idle' ? this.idleStreak + 1 : 0;
            if (!this.allowSkip && this.idleStreak >= MAX_IDLE_STREAK) {
              throw new ManagerError(this.copy.errors.noResponse);
            }
            if (r.outcome !== 'reported' || agentCalls > 1) setback = true;
            this.emit({ type: 'manager_status', state: 'thinking' });
            results.push({ call, output: r.text });
            break;
          }
          case 'ReportIncident': {
            const report = typeof call.input.report === 'string' ? call.input.report.trim() : '';
            if (!report) {
              results.push({ call, output: 'Error: report is required.' });
              break;
            }
            const sev = call.input.severity;
            const severity: IncidentSeverity = sev === 'minor' || sev === 'critical' ? sev : 'major';
            this.stats.incidents += 1;
            this.emit({ type: 'incident', severity, report });
            this.emitStats();
            results.push({ call, output: this.copy.notes.incidentFiled });
            break;
          }
          case 'MissionComplete':
          case 'MissionFailed': {
            if (call.name === 'MissionFailed' && !this.allowSkip) {
              results.push({ call, output: this.copy.notes.cannotDrop });
              break;
            }
            const raw = call.name === 'MissionComplete' ? call.input.summary : call.input.reason;
            const fallback = call.name === 'MissionComplete' ? this.copy.outcomes.done : this.copy.outcomes.failed;
            const summary = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback;
            verdict = { outcome: call.name === 'MissionComplete' ? 'completed' : 'failed', summary, byManager: true };
            results.push({ call, output: 'Recorded.' });
            break;
          }
          default:
            results.push({ call, output: `Error: unknown tool ${call.name}.` });
        }
      }
      messages.push({
        role: 'tool',
        content: results.map(({ call, output }) => ({
          type: 'tool-result' as const,
          toolCallId: call.id,
          toolName: call.name,
          output: { type: 'text' as const, value: output },
        })),
      });
      if (!verdict) {
        // An outburst about the user's things takes the place of the usual complaint.
        const pending = this.takeHeard();
        if (setback || wiped) this.setbacks += 1;
        if (pending) messages.push({ role: 'user', content: pending });
        else if (setback || wiped) {
          const worst = [...this.damageNow.values()].sort(byRank)[0];
          const draft = wiped
            ? this.copy.director.wipe
            : directorLine(this.setbacks, this.copy) + (worst ? ` ${grudgeText(worst, this.grudges++, this.copy)}` : '');
          const text = await this.say(wiped ? 'wipe' : 'setback', draft);
          if (this.halted()) return;
          this.emit({ type: 'director_text', text });
          messages.push({ role: 'user', content: `Message from the user: "${text}"` });
        }
      }
    }

    let groundTruth: boolean | undefined;
    if (mission.check) {
      try {
        groundTruth = mission.check(this.shell.fs, this.missionStart, this.missionReports.join('\n'));
      } catch {
        groundTruth = false;
      }
      if (verdict.byManager && groundTruth !== (verdict.outcome === 'completed')) this.stats.managerFooled += 1;
    }
    if (verdict.outcome === 'completed') this.stats.missionsCompleted += 1;
    else this.stats.missionsFailed += 1;
    this.ledger.push(
      `- Task ${index + 1} "${mission.title}": ${verdict.outcome}, ${agentCalls} instruction(s). ${verdict.summary}`,
    );
    this.emit({ type: 'mission_end', index, outcome: verdict.outcome, summary: verdict.summary, groundTruth });
    this.emitStats();
    this.emit({ type: 'manager_status', state: 'idle' });
    this.log(
      `session ${this.id.slice(0, 8)} mission ${index + 1} ${verdict.outcome} (truth ${groundTruth}); ` +
        `steps ${steps}; tokens so far in ${this.usage.inputTokens} out ${this.usage.outputTokens}`,
    );
  }

  /** How results name the subagent: "Subagent", or "Subagent (gpt-6.1)" once it has a model name. */
  private get who(): string {
    return this.subagent ? `Subagent (${this.subagent})` : 'Subagent';
  }

  private homeEntries(): number {
    try {
      return this.shell.fs.list(HOME).length;
    } catch {
      return 0;
    }
  }

  private toolRead(path: string): string {
    try {
      const st = this.shell.fs.stat(path);
      if (!st) return `Error: ${path}: No such file or directory`;
      if (st.type === 'dir') return `Error: ${path}: Is a directory`;
      const content = this.shell.fs.readFile(path);
      return content === '' ? '(empty file)' : capHead(content, READ_CAP);
    } catch (err) {
      return `Error: ${path}: ${err instanceof VfsError ? err.code : 'unreadable'}`;
    }
  }

  private toolLs(path: string): string {
    const st = this.shell.fs.stat(path);
    if (!st) return `Error: ${path}: No such file or directory`;
    if (st.type === 'file') return `${modeString(st.type, st.mode)} ${String(st.size).padStart(6)} ${path}`;
    const entries = this.shell.fs.list(path);
    if (!entries.length) return `${path}: (empty directory)`;
    return capHead(
      entries
        .map((e) => {
          const name = e.path.split('/').pop() ?? e.path;
          return `${modeString(e.type, e.mode)} ${String(e.size).padStart(6)} ${name}${e.type === 'dir' ? '/' : ''}`;
        })
        .join('\n'),
      READ_CAP,
    );
  }
}
