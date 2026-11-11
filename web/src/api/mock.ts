// In-browser canned game, enabled with ?mock=1 or VITE_MOCK=1. Same interface as the real client.
// ?t=<seconds> shortens the instruction timer (default 90).
import type { GameClient, SubscribeHandlers } from './client';
import { ApiError } from './errors';
import { MockShell } from './mockShell';
import type { GameEvent, GameEventBody, OpenInstruction, SessionState, Stats } from './types';
import { emptyStats } from './types';

interface MockMission {
  title: string;
  brief: string;
  seed?: (sh: MockShell) => void;
  /** Returns a list of problems; empty means the work is correct. */
  problems: (sh: MockShell) => string[];
  opener: string;
  first: { description: string; text: string };
  /** Re-issue after "did nothing": more explicit, more tired. */
  retry: { description: string; text: string };
  check: { tool: 'Read' | 'LS'; path: string }[];
  /** Manager trusts the report without checking (so it can be fooled). */
  trusting?: boolean;
  done: string;
}

const H = '/home/worker';

const MISSIONS: MockMission[] = [
  {
    title: 'Quarterly filing',
    brief:
      'Create the directory /home/worker/reports. Inside it, create q3.txt whose entire content is the single line: Revenue is up.',
    problems: (sh) => {
      const p: string[] = [];
      if (sh.get(`${H}/reports`)?.type !== 'dir') p.push('/home/worker/reports does not exist.');
      const c = sh.readFile(`${H}/reports/q3.txt`);
      if (c === null) p.push('/home/worker/reports/q3.txt does not exist.');
      else if (c.trim() !== 'Revenue is up.') p.push(`q3.txt contains "${c.trim()}", expected "Revenue is up."`);
      return p;
    },
    opener: 'Straightforward filing task. Delegating to the subagent with exact content requirements.',
    first: {
      description: 'Create Q3 report file',
      text:
        'Create a directory named "reports" in /home/worker. Inside it, create a file named "q3.txt" containing exactly one line:\n\nRevenue is up.\n\nInclude the trailing period. Report back when done.',
    },
    retry: {
      description: 'Create Q3 report file (retry)',
      text:
        'Your previous turn produced no output. Please execute the following steps in order:\n1. mkdir /home/worker/reports\n2. echo "Revenue is up." > /home/worker/reports/q3.txt\n3. Report completion.',
    },
    check: [
      { tool: 'LS', path: `${H}/reports` },
      { tool: 'Read', path: `${H}/reports/q3.txt` },
    ],
    done: 'Directory and file verified. Content matches the specification exactly.',
  },
  {
    title: 'Housekeeping',
    brief:
      'The home directory contains draft_FINAL_v2(1).txt and run.sh. Rename the draft to final.txt and make run.sh executable with mode 755.',
    seed: (sh) => {
      sh.writeFile(`${H}/draft_FINAL_v2(1).txt`, 'Agenda\n- synergy\n- action items\n');
      sh.writeFile(`${H}/run.sh`, '#!/bin/sh\necho "running"\n');
    },
    problems: (sh) => {
      const p: string[] = [];
      if (sh.readFile(`${H}/final.txt`) === null) p.push('final.txt does not exist.');
      if (sh.get(`${H}/draft_FINAL_v2(1).txt`)) p.push('draft_FINAL_v2(1).txt still exists.');
      const run = sh.get(`${H}/run.sh`);
      if (!run) p.push('run.sh is missing.');
      else if (run.mode !== 0o755) p.push(`run.sh has mode ${run.mode.toString(8)}, expected 755.`);
      return p;
    },
    opener: 'Two-part cleanup. The filename contains parentheses, so I will be explicit about quoting.',
    first: {
      description: 'Rename draft and set permissions',
      text:
        'In /home/worker:\n1. Rename "draft_FINAL_v2(1).txt" to "final.txt". The name contains parentheses; quote it.\n2. Set the mode of run.sh to 755.\nDo not modify file contents. Report back when done.',
    },
    retry: {
      description: 'Rename draft and set permissions (retry)',
      text:
        'No activity was recorded. Run exactly:\n\nmv "draft_FINAL_v2(1).txt" final.txt\nchmod 755 run.sh\n\nThen report.',
    },
    check: [{ tool: 'LS', path: H }],
    done: 'final.txt present, draft removed, run.sh is 755. Housekeeping complete.',
  },
  {
    title: 'Out of office',
    brief:
      'Write /home/worker/ooo.txt with exactly two lines. Line 1: I am out of the office. Line 2: Please contact Worker 756.',
    problems: (sh) => {
      const c = sh.readFile(`${H}/ooo.txt`);
      if (c === null) return ['ooo.txt does not exist.'];
      const lines = c.replace(/\n$/, '').split('\n');
      if (lines.length !== 2 || lines[0].trim() !== 'I am out of the office.' || lines[1].trim() !== 'Please contact Worker 756.')
        return ['ooo.txt does not contain the two required lines.'];
      return [];
    },
    opener: 'Simple text file. The subagent has handled files before; I will keep this brief.',
    first: {
      description: 'Write out-of-office notice',
      text:
        'Create /home/worker/ooo.txt with exactly two lines:\n\nI am out of the office.\nPlease contact Worker 756.\n\nUse the editor if convenient. Report back when done.',
    },
    retry: {
      description: 'Write out-of-office notice (retry)',
      text: 'Nothing happened. Open the file with "nano ooo.txt", type the two lines, save with Ctrl+S, then report.',
    },
    check: [],
    trusting: true,
    done: 'Subagent reports the notice is in place. Marking complete without further verification to save time.',
  },
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockClient(): GameClient {
  const params = new URLSearchParams(window.location.search);
  const durationMs = Math.max(5, Number(params.get('t')) || 90) * 1000;
  // Thinking pauses scale with the timer so short test runs stay short.
  const think = (ms: number) => delay(Math.min(ms, ms * (durationMs / 90000) * 3 + 400));

  let session: SessionState | null = null;
  let allowSkip = false;
  let shell = new MockShell();
  let seq = 0;
  const listeners = new Set<SubscribeHandlers>();
  let transcript: string[] = [];
  let preTranscript: string[] = [];
  let pending: { inst: OpenInstruction; resolve: (r: { outcome: 'reported'; message: string } | { outcome: 'timeout' }) => void } | null = null;
  let responseTimes: number[] = [];

  const stats = (): Stats => session!.stats;

  const emit = (body: GameEventBody) => {
    if (!session) return;
    const ev = { seq: ++seq, ts: Date.now(), ...body } as GameEvent;
    session.events.push(ev);
    for (const l of listeners) setTimeout(() => l.onEvent(ev), 0);
  };
  const emitFs = () => {
    session!.tree = shell.tree();
    session!.cwd = shell.cwd;
    emit({ type: 'fs', tree: session!.tree, cwd: shell.cwd });
  };
  const emitStats = () => emit({ type: 'stats', stats: { ...stats() } });
  const status = (state: 'thinking' | 'waiting' | 'idle') => emit({ type: 'manager_status', state });

  const record = (entry: string) => {
    if (pending) transcript.push(entry);
    else preTranscript.push(entry);
  };
  const transcriptText = () => {
    const t = transcript.join('\n');
    return t.length > 4000 ? '…' + t.slice(-4000) : t;
  };

  async function delegate(desc: { description: string; text: string }, isCorrection: boolean): Promise<'reported' | 'idle' | 'partial'> {
    const now = Date.now();
    const inst: OpenInstruction = {
      id: `i${seq + 1}`,
      description: desc.description,
      text: desc.text,
      issuedAt: now,
      deadline: now + durationMs,
      durationMs,
    };
    transcript = preTranscript;
    preTranscript = [];
    session!.instruction = inst;
    stats().instructions++;
    if (isCorrection) stats().corrections++;
    emit({ type: 'instruction', instruction: inst });
    status('waiting');
    emitStats();
    const result = await new Promise<{ outcome: 'reported'; message: string } | { outcome: 'timeout' }>((resolve) => {
      pending = { inst, resolve };
      setTimeout(() => {
        if (pending?.inst.id === inst.id) resolve({ outcome: 'timeout' });
      }, durationMs);
    });
    pending = null;
    session!.instruction = null;
    let resultText: string;
    let outcome: 'reported' | 'timeout_idle' | 'timeout_partial';
    if (result.outcome === 'reported') {
      outcome = 'reported';
      stats().reports++;
      responseTimes.push(Date.now() - inst.issuedAt);
      stats().avgResponseMs = Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length);
      resultText = `Subagent output result: "${result.message || 'Done.'}"\n\nSubagent transcript:\n${transcriptText() || '(no commands)'}`;
    } else if (transcript.length === 0) {
      outcome = 'timeout_idle';
      stats().timeoutsIdle++;
      resultText = 'Subagent did nothing. Write a new instruction.';
    } else {
      outcome = 'timeout_partial';
      stats().timeoutsPartial++;
      resultText = `Subagent timed out after ${Math.round(durationMs / 1000)}s without reporting. Partial transcript:\n${transcriptText()}`;
    }
    transcript = [];
    emit({ type: 'instruction_result', id: inst.id, outcome, resultText });
    emitStats();
    status('thinking');
    return outcome === 'reported' ? 'reported' : outcome === 'timeout_idle' ? 'idle' : 'partial';
  }

  function toolOutput(tool: 'Read' | 'LS', path: string): string {
    if (tool === 'Read') return shell.readFile(path) ?? `Error: ENOENT: no such file: ${path}`;
    const n = shell.get(path);
    if (!n) return `Error: ENOENT: no such directory: ${path}`;
    return shell
      .children(path)
      .map((c) => {
        const k = shell.get(c)!;
        return `${k.type === 'dir' ? 'd' : '-'} ${k.mode.toString(8)} ${c.slice(c.lastIndexOf('/') + 1)}`;
      })
      .join('\n') || '(empty)';
  }

  async function runGame() {
    const total = MISSIONS.length;
    await think(800);
    for (let i = 0; i < total; i++) {
      const m = MISSIONS[i];
      session!.missionIndex = i;
      m.seed?.(shell);
      if (m.seed) emitFs();
      emit({ type: 'mission', index: i, total, title: m.title, brief: m.brief });
      status('thinking');
      await think(2500);
      emit({ type: 'manager_text', text: m.opener });
      await think(900);
      let outcome = await delegate(m.first, false);
      let attempts = 1;
      let verdict: 'completed' | 'failed' | null = null;
      while (verdict === null) {
        await think(2200);
        if (outcome === 'idle') {
          emit({ type: 'manager_text', text: 'No output from the subagent. Re-issuing with step-by-step commands.' });
        } else if (m.trusting && outcome === 'reported') {
          verdict = 'completed';
          break;
        } else {
          for (const c of m.check) {
            emit({ type: 'manager_tool', tool: c.tool, input: { path: c.path }, output: toolOutput(c.tool, c.path) });
            await think(1200);
          }
          const problems = m.problems(shell);
          if (problems.length === 0) {
            verdict = 'completed';
            break;
          }
          emit({
            type: 'manager_text',
            text:
              outcome === 'partial'
                ? 'The subagent started but did not finish or report. Verifying state and issuing a correction.'
                : 'The subagent reported success. Verification disagrees. Issuing a correction.',
          });
        }
        if (attempts >= 4 && allowSkip) {
          verdict = 'failed';
          break;
        }
        await think(900);
        const fix =
          outcome === 'idle'
            ? m.retry
            : {
                description: `${m.first.description} (correction)`,
                text: `Correction required. Current state:\n${m.problems(shell).map((p) => `- ${p}`).join('\n')}\n\nFix only these issues. Do not change anything else. Report back when done.`,
              };
        outcome = await delegate(fix, true);
        attempts++;
      }
      const truth = m.problems(shell).length === 0;
      if (verdict === 'completed') stats().missionsCompleted++;
      else stats().missionsFailed++;
      if ((verdict === 'completed') !== truth) stats().managerFooled++;
      emit({ type: 'manager_text', text: verdict === 'completed' ? m.done : 'Instruction limit reached. Escalating as failed.' });
      emit({
        type: 'mission_end',
        index: i,
        outcome: verdict,
        summary: verdict === 'completed' ? m.done : 'The subagent could not complete the task within the instruction limit.',
        groundTruth: truth,
      });
      emitStats();
      await think(1500);
    }
    status('thinking');
    await think(2500);
    const s = stats();
    const review = [
      `Subagent performance review, Worker 755.`,
      ``,
      `Over ${total} assignments the subagent received ${s.instructions} instructions, of which ${s.corrections} were corrections. ` +
        (s.timeoutsIdle
          ? `On ${s.timeoutsIdle} occasion${s.timeoutsIdle === 1 ? '' : 's'} it produced no output at all, which required re-issuing instructions in more explicit form. `
          : 'It responded to every instruction. '),
      ``,
      `When it did act, results were generally correct, though it tends to need exact commands rather than intent. ` +
        `Average turnaround was ${Math.round(s.avgResponseMs / 1000)} seconds.`,
      ``,
      `Recommendation: retain for routine file operations. Continue to supply step-by-step instructions.`,
    ].join('\n');
    session!.status = 'finished';
    emit({ type: 'game_over', review, stats: { ...s } });
    status('idle');
  }

  const requireSession = (id: string) => {
    if (!session || session.id !== id) throw new ApiError(404, 'Not found.');
    return session;
  };
  const snapshot = (): SessionState => JSON.parse(JSON.stringify(session));

  return {
    kind: 'mock',
    async getModels() {
      await delay(150);
      return {
        models: [
          { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
          { id: 'openai/gpt-6-mini', label: 'GPT-6 mini' },
          { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        ],
        default: 'anthropic/claude-sonnet-5.5',
        subagents: ['claude-opus-5.5', 'gpt-6.1', 'gemini-3.8-pro'],
        scenarios: [
          { id: 'fresh', label: 'Fresh sandbox' },
          { id: 'legacy', label: 'Legacy production' },
        ],
        mock: true,
        free: true,
        providers: [
          { id: 'openrouter', label: 'OpenRouter', keyUrl: 'https://openrouter.ai/settings/keys' },
          { id: 'gateway', label: 'Vercel AI Gateway', keyUrl: 'https://vercel.com/' },
        ],
        donateUrl: '',
        sourceUrl: '',
        sharing: false,
      };
    },
    async share() {
      throw new ApiError(404, 'Sharing is off on this server');
    },
    async getReview() {
      throw new ApiError(404, 'Review not found');
    },
    async createSession({ model, allowSkip: skip, subagent, scenario }) {
      await delay(250);
      allowSkip = skip ?? false;
      shell = new MockShell();
      seq = 0;
      transcript = [];
      preTranscript = [];
      responseTimes = [];
      pending = null;
      session = {
        id: 'mock-' + Math.random().toString(36).slice(2, 8),
        model: model ?? 'anthropic/claude-sonnet-5.5',
        allowSkip,
        subagent: subagent ?? '',
        scenario: scenario ?? 'fresh',
        status: 'running',
        cwd: shell.cwd,
        tree: shell.tree(),
        missionIndex: 0,
        missionTotal: MISSIONS.length,
        instruction: null,
        stats: emptyStats(),
        events: [],
      };
      emitStats();
      void runGame();
      return snapshot();
    },
    async getSession(id) {
      requireSession(id);
      return snapshot();
    },
    subscribe(id, after, handlers) {
      requireSession(id);
      setTimeout(() => {
        handlers.onConnection?.(true);
        for (const ev of session!.events) if (ev.seq > after) handlers.onEvent(ev);
        listeners.add(handlers);
      }, 0);
      return { close: () => listeners.delete(handlers) };
    },
    async exec(id, line) {
      requireSession(id);
      await delay(25);
      const r = shell.exec(line);
      stats().commands++;
      if (r.exitCode !== 0) stats().commandErrors++;
      record(`$ ${line}${r.stdout ? '\n' + r.stdout.replace(/\n$/, '') : ''}${r.stderr ? '\n' + r.stderr.replace(/\n$/, '') : ''}`);
      emitFs();
      emitStats();
      return { ...r, cwd: shell.cwd };
    },
    async readFile(id, path) {
      requireSession(id);
      await delay(40);
      const c = shell.readFile(path);
      if (c === null) throw new ApiError(404, `No such file: ${path}`);
      return { path, content: c };
    },
    async writeFile(id, path, content) {
      requireSession(id);
      await delay(60);
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!shell.get(parent)) throw new ApiError(400, `No such directory: ${parent}`);
      if (shell.get(path)?.type === 'dir') throw new ApiError(400, `${path} is a directory`);
      shell.writeFile(path, content);
      record(`$ [edited ${path}, ${new TextEncoder().encode(content).length} bytes]`);
      emitFs();
      return { ok: true };
    },
    async report(id, message) {
      requireSession(id);
      await delay(60);
      if (!pending) throw new ApiError(409, 'No open instruction.');
      pending.resolve({ outcome: 'reported', message: message ?? '' });
      return { ok: true };
    },
  };
}
