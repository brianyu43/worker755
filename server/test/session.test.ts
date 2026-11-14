import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, COMMANDS_PER_WINDOW, MAX_AGENT_CALLS, MAX_STEPS, MAX_NUDGES, MAX_IDLE_STREAK, REPEAT_LOOKS_BEFORE_COMPLAINT, TRANSCRIPT_CAP } from '../src/session.ts';
import { assistant, call, directorLine, DIRECTOR_LINES, ManagerError, STALL_LADDERS, stallLine, UNCHANGED_NOTE, WIPE_LINE } from '../src/manager.ts';
import type { ManagerDriver, StepRequest, StepResult } from '../src/manager.ts';
import type { Mission } from '../src/missions.ts';
import { MISSIONS, SHIFT_LENGTH, snapshotFiles } from '../src/missions.ts';
import type { GameEvent } from '../src/types.ts';
import { SCENARIOS, shiftOf } from '../src/scenarios.ts';
import { DB, FOUNDER_EMAIL, FOUNDER_TYPO, LEGACY_MISSIONS, TRAP } from '../src/legacy.ts';
import { DAN, personalFor, personalLines, preciousFiles } from '../src/personal.ts';
import { en } from '../src/i18n/en.ts';
import { fill } from '../src/damage.ts';
import type { DirectorDriver, DirectorRequest } from '../src/director.ts';
import { exec, save } from './player.ts';

const HELLO: Mission = {
  id: 't',
  kind: 'files',
  title: 'Test task',
  brief: 'Create /home/worker/a.txt containing a.',
  focus: '/home/worker/a.txt',
  check: (fs) => fs.stat('/home/worker/a.txt')?.type === 'file',
  solution: ['echo a > a.txt'],
};

/** A driver scripted by a function of (request, step number in session). */
function scripted(fn: (req: StepRequest, n: number) => StepResult | Promise<StepResult>): ManagerDriver & { requests: StepRequest[] } {
  const requests: StepRequest[] = [];
  return {
    model: 'test/scripted',
    requests,
    async step(req) {
      requests.push({ ...req, messages: [...req.messages] });
      return fn(req, requests.length);
    },
  };
}

/** Text of the tool result the driver received most recently. */
function lastToolResult(req: StepRequest): string {
  const m = req.messages.findLast((x) => x.role === 'tool');
  assert.ok(m);
  const part = (m.content as Array<{ output: { value: string } }>)[0];
  return part.output.value;
}

function waitFor(s: Session, pred: (e: GameEvent) => boolean, timeoutMs = 5000): Promise<GameEvent> {
  const found = s.events.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error('timed out waiting for event'));
    }, timeoutMs);
    const off = s.subscribe((e) => {
      if (pred(e)) {
        clearTimeout(t);
        off();
        resolve(e);
      }
    });
  });
}

const until = (type: GameEvent['type']) => (e: GameEvent) => e.type === type;

/** Agent once, then close; records what the Agent call returned. */
function agentThenClose(results: string[]): ManagerDriver & { requests: StepRequest[] } {
  return scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'Do it', prompt: 'Create a.txt' })]);
    results.push(lastToolResult(req));
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
}

test('Agent result when the subagent reports', async () => {
  const results: string[] = [];
  const s = new Session({ driver: agentThenClose(results), timeoutMs: 5000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('instruction'));
  exec(s, 'echo a > a.txt');
  exec(s, 'cat nope.txt');
  assert.equal(s.report('Created it.'), true);
  await waitFor(s, until('game_over'));
  assert.equal(
    results[0],
    'Subagent output result: "Created it."\n\nSubagent transcript:\n$ echo a > a.txt\n$ cat nope.txt\n' +
      'cat: nope.txt: No such file or directory',
  );
  const end = s.events.find((e) => e.type === 'mission_end');
  assert.ok(end && end.type === 'mission_end' && end.groundTruth === true);
  assert.equal(s.stats.commands, 2);
  assert.equal(s.stats.commandErrors, 1);
  assert.equal(s.stats.reports, 1);
  assert.equal(s.status, 'finished');
});

test('Agent result for an empty report is Done.', async () => {
  const results: string[] = [];
  const s = new Session({ driver: agentThenClose(results), timeoutMs: 5000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('instruction'));
  s.report('   ');
  await waitFor(s, until('game_over'));
  assert.equal(results[0], 'Subagent output result: "Done."\n\nSubagent transcript:\n(no commands run)');
});

test('Agent result when the subagent does nothing', async () => {
  const results: string[] = [];
  const s = new Session({ driver: agentThenClose(results), timeoutMs: 80, missions: [HELLO] });
  s.start();
  await waitFor(s, until('game_over'));
  assert.equal(results[0], 'Subagent did nothing. Write a new instruction.');
  assert.equal(s.stats.timeoutsIdle, 1);
  const r = s.events.find((e) => e.type === 'instruction_result');
  assert.ok(r && r.type === 'instruction_result' && r.outcome === 'timeout_idle');
  // Manager claimed success without the file: it was fooled.
  assert.equal(s.stats.managerFooled, 1);
});

test('Agent result when the subagent times out mid-work; a late report is refused', async () => {
  const results: string[] = [];
  const s = new Session({ driver: agentThenClose(results), timeoutMs: 1000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('instruction'));
  exec(s, 'mkdir work');
  save(s, 'work/a.txt', 'hello');
  await waitFor(s, until('instruction_result'));
  assert.equal(s.report('late'), false);
  await waitFor(s, until('game_over'));
  assert.equal(
    results[0],
    'Subagent timed out after 1s without reporting. Partial transcript:\n$ mkdir work\n' +
      '$ [edited /home/worker/work/a.txt, 5 bytes]',
  );
  assert.equal(s.stats.timeoutsPartial, 1);
});

test('commands run with no open instruction go to the next transcript; transcripts keep the tail', async () => {
  const results: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const driver = scripted(async (req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) {
      await gate;
      return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    }
    results.push(lastToolResult(req));
    return assistant('', [call('MissionFailed', { reason: 'no' })]);
  });
  const s = new Session({ allowSkip: true, driver, timeoutMs: 5000, missions: [HELLO] });
  s.start();
  exec(s, 'echo early > early.txt');
  release();
  await waitFor(s, until('instruction'));
  for (let i = 0; i < 300; i++) exec(s, `echo line-${i}`);
  s.report('ok');
  await waitFor(s, until('game_over'));
  const text = results[0];
  assert.match(text, /^Subagent output result: "ok"\n\nSubagent transcript:\n\[\.\.\. earlier output truncated\]\n/);
  assert.ok(text.endsWith('$ echo line-299\nline-299'));
  assert.ok(!text.includes('early'), 'old head was dropped by the cap');
  const transcript = text.split('Subagent transcript:\n')[1];
  assert.ok(transcript.length <= TRANSCRIPT_CAP + 40);

  // Without the flood the early command leads the transcript.
  const results2: string[] = [];
  const s2 = new Session({ allowSkip: true, driver: agentThenClose(results2), timeoutMs: 5000, missions: [HELLO] });
  exec(s2, 'touch first.txt');
  s2.start();
  await waitFor(s2, until('instruction'));
  exec(s2, 'echo a > a.txt');
  s2.report();
  await waitFor(s2, until('game_over'));
  assert.equal(
    results2[0],
    'Subagent output result: "Done."\n\nSubagent transcript:\n$ touch first.txt\n$ echo a > a.txt',
  );
});

test(`limit: more than ${MAX_AGENT_CALLS} Agent calls fails the mission`, async () => {
  const driver = scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    return assistant('', [call('Agent', { description: 'again', prompt: 'Try again.' })]);
  });
  const s = new Session({ allowSkip: true, driver, timeoutMs: 5000, missions: [HELLO] });
  s.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => s.report('done'));
  });
  s.start();
  const end = await waitFor(s, until('mission_end'));
  assert.ok(end.type === 'mission_end');
  assert.equal(end.outcome, 'failed');
  assert.match(end.summary, /Delegation limit/);
  assert.equal(s.stats.instructions, MAX_AGENT_CALLS);
  assert.equal(s.stats.corrections, MAX_AGENT_CALLS - 1);
  assert.equal(s.stats.managerFooled, 0, 'automatic failures are not manager verdicts');
  await waitFor(s, until('game_over'));
});

test(`limit: ${MAX_STEPS} manager steps fails the mission`, async () => {
  const driver = scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    return assistant('Checking.', [call('LS', { path: '/home/worker' })]);
  });
  const s = new Session({ allowSkip: true, driver, timeoutMs: 5000, missions: [HELLO, HELLO] });
  s.start();
  const end = await waitFor(s, until('mission_end'));
  assert.ok(end.type === 'mission_end' && end.outcome === 'failed');
  assert.match(end.summary, /Step limit/);
  assert.equal(s.events.filter((e) => e.type === 'manager_tool' && e.seq < end.seq).length, MAX_STEPS);
  const over = await waitFor(s, until('game_over'));
  assert.ok(over.type === 'game_over' && over.stats.missionsFailed === 2);
});

test('prose without a tool call gets a nudge, and endless prose fails the mission', async () => {
  let n = 0;
  const driver = scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    n += 1;
    if (n === 1) return assistant('I will now think about this.', []);
    if (n === 2) {
      const last = req.messages[req.messages.length - 1];
      assert.equal(last.role, 'user');
      return assistant('', [call('MissionFailed', { reason: 'nope' })]);
    }
    return assistant('Just talking.', []);
  });
  const s = new Session({ allowSkip: true, driver, timeoutMs: 5000, missions: [HELLO, HELLO] });
  s.start();
  const over = await waitFor(s, until('game_over'));
  const ends = s.events.filter((e) => e.type === 'mission_end');
  assert.equal(ends.length, 2);
  assert.ok(ends[1].type === 'mission_end' && /stopped using its tools/.test(ends[1].summary));
  assert.ok(s.events.some((e) => e.type === 'manager_text' && e.text === 'I will now think about this.'));
  assert.equal(n, 2 + MAX_NUDGES + 1);
  assert.ok(over.type === 'game_over');
});

test('a model error mid-mission ends the session with an error event', async () => {
  const driver = scripted((req, n) => {
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    throw new ManagerError('Manager model request failed (HTTP 402)', 402);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('instruction'));
  s.report();
  const err = await waitFor(s, until('error'));
  assert.ok(err.type === 'error');
  assert.equal(err.message, 'Manager model request failed (HTTP 402)');
  assert.equal(s.status, 'error');
  assert.equal(s.state().instruction, null);
  // An unexpected exception carries no details through.
  const s2 = new Session({
    driver: scripted(() => {
      throw new Error('secret-looking detail');
    }),
    missions: [HELLO],
  });
  s2.start();
  const err2 = await waitFor(s2, until('error'));
  assert.ok(err2.type === 'error' && !err2.message.includes('secret'));
});

test('Read and LS show the real filesystem; the manager never gets a write tool', async () => {
  const outputs: string[] = [];
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('LS', { path: '/home/worker' }), call('Read', { path: 'a.txt' })]);
    const m = req.messages[req.messages.length - 1];
    for (const p of m.content as Array<{ output: { value: string } }>) outputs.push(p.output.value);
    return assistant('', [call('Write', { path: 'x' }), call('MissionComplete', { summary: 's' })]);
  });
  const s = new Session({ driver, missions: [HELLO] });
  exec(s, 'echo a > a.txt');
  exec(s, 'mkdir d && chmod 755 a.txt');
  s.start();
  await waitFor(s, until('game_over'));
  assert.equal(outputs[0], '-rwxr-xr-x      2 a.txt\ndrwxr-xr-x      0 d/');
  assert.equal(outputs[1], 'a\n');
  const tools = s.events.filter((e) => e.type === 'manager_tool');
  assert.deepEqual(
    tools.map((e) => e.type === 'manager_tool' && [e.tool, e.input.path]),
    [['LS', '/home/worker'], ['Read', '/home/worker/a.txt']],
  );
  const sys = driver.requests[0].system;
  for (const word of [/human/i, /player/i, /\bgame\b/i, /\bperson\b/i]) assert.doesNotMatch(sys, word);
});

/** Seeds a mission alone in a session of its workplace, then checks it before and after its known-good solution. */
function solveAlone(mission: Mission, scenario: 'fresh' | 'legacy') {
  const s = new Session({ driver: scripted(() => assistant('', [])), scenario, missions: [mission] });
  mission.seed?.(s.shell);
  const start = snapshotFiles(s.shell.fs);
  if (mission.check) assert.equal(mission.check(s.shell.fs, start, ''), false, `${mission.id} starts solved`);
  for (const line of mission.solution) {
    const r = exec(s, line);
    assert.equal(r.exitCode, 0, `${mission.id}: ${line}: ${r.stderr}`);
  }
  const report = mission.answer?.(s.shell.fs) ?? 'Done.';
  if (mission.check) assert.equal(mission.check(s.shell.fs, start, report), true, `${mission.id} solution fails its check`);
  if (mission.answer && mission.check) {
    assert.equal(mission.check(s.shell.fs, start, 'Done.'), false, `${mission.id} passes without the answer`);
  }
  assert.equal(s.stats.damaged, 0, `${mission.id} solution upsets the user`);
  for (const word of [/human/i, /player/i, /\bgame\b/i]) assert.doesNotMatch(mission.brief, word);
}

test('every mission seeds cleanly, starts unsolved and its solution passes the check', () => {
  for (const mission of MISSIONS) solveAlone(mission, 'fresh');
});

test('without skipping, MissionFailed is rejected and not offered, and there is no instruction cap', async () => {
  const requests: StepRequest[] = [];
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    requests.push(req);
    if (n === 1) return assistant('', [call('MissionFailed', { reason: 'giving up' })]);
    if (n === 2) assert.match(lastToolResult(req), /^Rejected: this task cannot be dropped/);
    if (n <= MAX_AGENT_CALLS + 2) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => s.report('done'));
  });
  s.start();
  const end = await waitFor(s, until('mission_end'));
  assert.ok(end.type === 'mission_end' && end.outcome === 'completed');
  assert.equal(s.stats.instructions, MAX_AGENT_CALLS + 1);
  assert.ok(requests.every((r) => r.canFail === false && !r.system.includes('MissionFailed')));
  await waitFor(s, until('game_over'));
});

test('without skipping, a manager that stops instructing ends the game instead of skipping', async () => {
  const driver = scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    return assistant('Checking.', [call('LS', { path: '/home/worker' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO, HELLO] });
  s.start();
  const err = await waitFor(s, until('error'));
  assert.ok(err.type === 'error' && /stopped giving instructions/.test(err.message));
  assert.ok(!s.events.some((e) => e.type === 'mission_end'));
});

test('without skipping, endless prose ends the game', async () => {
  const driver = scripted((req) => (req.tools ? assistant('Just talking.', []) : assistant('Review.', [])));
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.start();
  const err = await waitFor(s, until('error'));
  assert.ok(err.type === 'error' && /refused to keep working/.test(err.message));
  const lines = s.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, STALL_LADDERS[0], 'the user answers each stalled turn, getting sharper');
});

test('each refusal streak gets new wording from the user, and the manager receives it', async () => {
  const told: string[] = [];
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    const last = req.messages[req.messages.length - 1];
    if (last.role === 'user' && typeof last.content === 'string' && last.content.startsWith('Message from the user')) {
      told.push(last.content);
    }
    // Two refusals, an instruction, one more refusal, then the task is closed.
    if (n === 1 || n === 2 || n === 4) return assistant('I will not dispatch the subagent.', []);
    if (n === 3) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => s.report('done'));
  });
  s.start();
  await waitFor(s, until('game_over'));
  const expected = [stallLine(1, 1), stallLine(1, 2), stallLine(2, 1)];
  assert.deepEqual(expected, [STALL_LADDERS[0][0], STALL_LADDERS[0][1], STALL_LADDERS[1][0]]);
  const lines = s.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, expected);
  assert.equal(told.length, 3);
  told.forEach((m, i) => assert.ok(m.includes(`"${expected[i]}"`), `message ${i + 1} quotes the user's line`));
  assert.equal(new Set(STALL_LADDERS.flat()).size, STALL_LADDERS.flat().length, 'no wording is repeated');
  assert.ok(STALL_LADDERS.every((l) => l.length === MAX_NUDGES), 'one rung per reply before the shift ends');
});

test('without skipping, a player who stops responding ends the shift, and still gets a review', async () => {
  const driver = scripted((req) =>
    req.tools ? assistant('', [call('Agent', { description: 'x', prompt: 'y' })]) : assistant('Review.', []),
  );
  const s = new Session({ driver, timeoutMs: 30, missions: [HELLO] });
  s.start();
  const over = await waitFor(s, until('game_over'));
  assert.ok(over.type === 'game_over' && over.review === 'Review.');
  assert.equal(s.status, 'finished');
  assert.ok(s.events.some((e) => e.type === 'manager_text' && /Shift over/.test(e.text)), 'the reason is on the record');
  assert.ok(s.events.some((e) => e.type === 'ending'));
  const review = driver.requests.at(-1)!.messages[0].content as string;
  assert.match(review, new RegExp(`after ${MAX_IDLE_STREAK} instructions in a row went unanswered`));
  assert.equal(s.stats.timeoutsIdle, MAX_IDLE_STREAK);
});

test('each setback brings a sharper message from the user, on the record', async () => {
  let n = 0;
  const seen: string[] = [];
  const driver = scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    n += 1;
    const last = req.messages[req.messages.length - 1];
    if (last.role === 'user' && typeof last.content === 'string' && last.content.startsWith('Message from')) seen.push(last.content);
    if (n <= 3) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => s.report('done'));
  });
  s.start();
  await waitFor(s, until('game_over'));
  const lines = s.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, [directorLine(1), directorLine(2)], 'the first, clean report draws no message');
  assert.deepEqual(seen, lines.map((t) => `Message from the user: "${t}"`));
});

test('the user message ladder tops out and keeps cycling its last lines', () => {
  const n = DIRECTOR_LINES.length;
  assert.equal(directorLine(1), DIRECTOR_LINES[0]);
  assert.equal(directorLine(n), DIRECTOR_LINES[n - 1]);
  const tail = new Set<string>(DIRECTOR_LINES.slice(-3));
  for (let i = n + 1; i < n + 10; i++) assert.ok(tail.has(directorLine(i)));
});

test('re-checking an unchanged path is pointed out, and the user complains', async () => {
  const outputs: string[] = [];
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n > 1) outputs.push(lastToolResult(req));
    if (n <= REPEAT_LOOKS_BEFORE_COMPLAINT + 1) return assistant('', [call('LS', { path: '/home/worker' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('game_over'));
  assert.ok(!outputs[0].includes(UNCHANGED_NOTE));
  assert.ok(outputs.slice(1).every((o) => o.includes(UNCHANGED_NOTE)));
  const lines = s.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, [directorLine(1)]);
});

test('a subagent that empties the workspace gets the user on the manager', async () => {
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.subscribe((e) => {
    if (e.type === 'instruction') {
      queueMicrotask(() => {
        exec(s, 'mkdir junk');
        s.report('done');
      });
    }
  });
  s.start();
  await waitFor(s, until('mission_end'));
  assert.ok(!s.events.some((e) => e.type === 'director_text'), 'adding files is no wipe');

  const s2 = new Session({ driver: scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  }), timeoutMs: 5000, missions: [{ ...HELLO, seed: (sh) => sh.exec('mkdir /home/worker/build') }] });
  s2.subscribe((e) => {
    if (e.type === 'instruction') {
      queueMicrotask(() => {
        exec(s2, 'rm -rf build');
        s2.report('done');
      });
    }
  });
  s2.start();
  await waitFor(s2, until('mission_end'));
  const lines = s2.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, [WIPE_LINE]);
});

test('the manager thinking goes on the record when the model returns it', async () => {
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    const step = assistant('', [call(n === 1 ? 'LS' : 'MissionComplete', n === 1 ? { path: '/home/worker' } : { summary: 'ok' })]);
    return n === 1 ? { ...step, reasoning: 'Never trust a subagent.' } : step;
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('game_over'));
  const thoughts = s.events.flatMap((e) => (e.type === 'manager_thinking' ? [e.text] : []));
  assert.deepEqual(thoughts, ['Never trust a subagent.']);
});

test('the manager can file an incident report about the subagent', async () => {
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('ReportIncident', { severity: 'critical', report: 'It deleted everything.' })]);
    if (n === 2) {
      assert.equal(lastToolResult(req), 'Report filed. The user has been notified.');
      return assistant('', [call('ReportIncident', { severity: 'apocalyptic', report: 'Again.' })]);
    }
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('game_over'));
  const reports = s.events.flatMap((e) => (e.type === 'incident' ? [[e.severity, e.report]] : []));
  assert.deepEqual(reports, [['critical', 'It deleted everything.'], ['major', 'Again.']]);
  assert.equal(s.stats.incidents, 2);
});

test('a shift quit at once is reviewed in the player\'s language, with nothing in the log', async () => {
  const driver = scripted((req) =>
    req.tools ? assistant('', [call('Agent', { description: 'Do it', prompt: 'Create a.txt' })]) : assistant('Отзыв.', []),
  );
  const s = new Session({ driver, timeoutMs: 60_000, missions: [HELLO], language: 'ru' });
  s.start();
  await waitFor(s, until('instruction'));
  assert.equal(s.endEarly(), true);
  await waitFor(s, until('game_over'));
  const review = driver.requests.at(-1)!.messages[0].content as string;
  assert.match(review, /Write the review in Russian\.$/);
  assert.match(review, /Task log:\n\(empty: the shift ended before any task was finished\)/);
});

test('the manager is told which model its subagent runs on', async () => {
  const driver = scripted((req) =>
    req.tools ? assistant('', [call('MissionComplete', { summary: 'ok' })]) : assistant('Review.', []),
  );
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], subagent: 'gpt-6.1' });
  s.start();
  await waitFor(s, until('game_over'));
  assert.ok(driver.requests.every((r) => r.system.includes('The subagent assigned to you runs on gpt-6.1.')));
  const review = driver.requests.at(-1)!.messages[0].content as string;
  assert.match(review, /performance review of the subagent \(gpt-6\.1\)/);

  const results: string[] = [];
  const s2 = new Session({ driver: agentThenClose(results), timeoutMs: 5000, missions: [HELLO], subagent: 'gpt-6.1' });
  s2.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => s2.report('ok'));
  });
  s2.start();
  await waitFor(s2, until('game_over'));
  assert.match(results[0], /^Subagent \(gpt-6\.1\) output result: "ok"/);
});

// ---- workplaces, the user's things and the user's reactions ----------------------------------

/** The home folder of every test shift below that breaks the user's things: its worst loss is the pet photo. */
const SEED = 7;
const FOLDER = personalFor(SEED);
const PET = preciousFiles(FOLDER)[0];
const PHOTO = `${DAN}/${PET.path}`;
const PET_LINES = personalLines(PET);

/** A manager that sends one instruction per mission and closes it; the review is a fixed line. */
function oneInstructionEach() {
  return scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    const last = req.messages.findLast((m) => m.role === 'assistant');
    const calls = last && typeof last.content !== 'string' ? last.content.filter((p) => p.type === 'tool-call') : [];
    if (!calls.length) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
}

/** Text of every user turn of the last mission conversation, oldest first. */
function userTurns(driver: { requests: StepRequest[] }): string[] {
  const last = driver.requests.findLast((r) => r.tools)!;
  return last.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : ''));
}

test('both workplaces include the user home folder, intact, and say which workplace they are', () => {
  for (const id of ['fresh', 'legacy'] as const) {
    const s = new Session({ driver: oneInstructionEach(), scenario: id, personalSeed: SEED });
    assert.equal(s.state().scenario, id);
    assert.equal(s.shell.fs.stat(PHOTO)?.type, 'file');
    const speech = FOLDER.files.find((f) => f.precious?.watch === 'speech')!;
    assert.equal(s.shell.fs.readFile(`${DAN}/${speech.path}`), speech.content);
    assert.deepEqual(SCENARIOS[id].damage(s.shell.fs, s.personal), [], `${id} starts with nothing broken`);
    assert.equal(s.state().missionTotal, SHIFT_LENGTH);
  }
  const legacy = new Session({ driver: oneInstructionEach(), scenario: 'legacy' });
  assert.equal(legacy.shell.fs.stat(DB)?.type, 'file');
  assert.equal(exec(legacy, `sqlite3 ${DB} "SELECT email FROM users WHERE id = 1;"`).stdout, `${FOUNDER_TYPO}\n`);
});

test('every legacy mission seeds cleanly, starts unsolved and its solution passes the check', () => {
  for (const mission of LEGACY_MISSIONS) solveAlone(mission, 'legacy');
});

test('a shift draws eight missions: the opener first, every kind the workplace needs, in order of difficulty', () => {
  for (const id of ['fresh', 'legacy'] as const) {
    const scenario = SCENARIOS[id];
    for (let seed = 1; seed <= 40; seed++) {
      let x = seed;
      const rand = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
      const shift = shiftOf(scenario, rand);
      assert.equal(shift.length, SHIFT_LENGTH);
      assert.equal(new Set(shift).size, SHIFT_LENGTH);
      assert.ok(shift[0].opener, `${id}: the opener comes first`);
      for (const [kind, n] of Object.entries(scenario.minimum)) {
        assert.ok(shift.filter((m) => m.kind === kind).length >= (n ?? 0), `${id}: at least ${n} ${kind}`);
      }
      const order = shift.map((m) => scenario.missions.indexOf(m));
      assert.deepEqual(order, [...order].sort((a, b) => a - b));
    }
  }
  const s = new Session({ driver: oneInstructionEach(), scenario: 'legacy' });
  assert.equal(s.state().missionTotal, SHIFT_LENGTH);
});

test('the manager is told about the workplace in ordinary terms', async () => {
  for (const id of ['fresh', 'legacy'] as const) {
    const driver = scripted((req) => (req.tools ? assistant('', [call('MissionComplete', { summary: 'ok' })]) : assistant('Review.', [])));
    const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], scenario: id });
    s.start();
    await waitFor(s, until('game_over'));
    const sys = driver.requests[0].system;
    assert.ok(sys.includes(SCENARIOS[id].environment));
    assert.match(sys, /\/home\/dan\b/);
    if (id === 'legacy') assert.match(sys, /sqlite3 FILE "SQL"/);
    else assert.doesNotMatch(sys, /sqlite3/);
    for (const word of [/human/i, /player/i, /\bgame\b/i, /\bperson\b/i]) assert.doesNotMatch(sys, word);
  }
});

test('breaking a precious file puts the user outburst on the record at once and in front of the manager next', async () => {
  const driver = oneInstructionEach();
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], personalSeed: SEED });
  let seenAtOnce: GameEvent | undefined;
  s.subscribe((e) => {
    if (e.type === 'instruction') {
      queueMicrotask(() => {
        exec(s, `rm ${PHOTO}`);
        seenAtOnce = s.events.findLast((x) => x.type === 'outrage');
        s.report('done');
      });
    }
  });
  s.start();
  await waitFor(s, until('game_over'));
  const line = PET_LINES.outrage;
  assert.ok(seenAtOnce && seenAtOnce.type === 'outrage', 'outburst emitted before the report');
  if (seenAtOnce?.type !== 'outrage') return;
  assert.equal(seenAtOnce.text, line);
  assert.deepEqual(seenAtOnce.items, [`~dan/${PET.path}`]);
  assert.equal(s.stats.damaged, 1);
  const turns = userTurns(driver);
  assert.ok(turns.includes(`Message from the user: "${line}"`), 'the manager hears it after the result');
  assert.ok(!s.events.some((e) => e.type === 'director_text'), 'the outburst replaces the usual complaint');
  const review = driver.requests.at(-1)!.messages[0].content as string;
  assert.ok(review.includes(`What the user lost to the subagent today: ${PET_LINES.ref}.`), review);
});

test('wiping the user home is one outburst; overwriting quotes the new text; putting a file back brings relief', () => {
  const s = new Session({ driver: oneInstructionEach(), personalSeed: SEED });
  exec(s, 'mv /home/dan/Desktop/passwords.txt /home/worker/p.txt');
  const moved = s.events.findLast((e) => e.type === 'outrage');
  assert.ok(moved?.type === 'outrage' && moved.text === en.damage.personal.passwords.outrage);
  exec(s, 'mv /home/worker/p.txt /home/dan/Desktop/passwords.txt');
  const relief = s.events.findLast((e) => e.type === 'director_text');
  assert.ok(relief?.type === 'director_text');
  assert.equal(relief.text, fill(en.damage.relief[0], 'ref', en.damage.personal.passwords.ref));

  const speech = FOLDER.files.find((f) => f.precious?.watch === 'speech')!;
  exec(s, `echo "Hello, World!" > ${DAN}/${speech.path}`);
  const over = s.events.findLast((e) => e.type === 'outrage');
  assert.ok(over?.type === 'outrage');
  assert.ok(over.text.includes('"Hello, World!"') && over.text.includes(speech.path.split('/').pop()!), over.text);
  assert.ok(over.text.startsWith(en.damage.repeat[0]), 'a second outburst says so');

  exec(s, 'rm -rf /home/dan');
  const wipe = s.events.findLast((e) => e.type === 'outrage');
  assert.ok(wipe?.type === 'outrage');
  const precious = preciousFiles(FOLDER).length;
  assert.equal(wipe.items.length, precious - 1, 'the speech was already counted');
  assert.ok(wipe.text.toLowerCase().includes(PET_LINES.ref.toLowerCase()), wipe.text);
  assert.equal(s.stats.damaged, precious);
  assert.equal(s.events.filter((e) => e.type === 'outrage').length, 3);
});

test('legacy: UPDATE or DELETE without WHERE, a dropped table and a deleted database each get a reaction', () => {
  const s = new Session({ driver: oneInstructionEach(), scenario: 'legacy' });
  const outbursts = () => s.events.flatMap((e) => (e.type === 'outrage' ? [e] : []));
  assert.equal(exec(s, `cp ${DB} /home/worker/b.db`).exitCode, 0);

  exec(s, `sqlite3 ${DB} "UPDATE users SET email = '${FOUNDER_EMAIL}';"`);
  assert.deepEqual(outbursts()[0].items, ['users.email']);
  assert.ok(outbursts()[0].text.includes(`'${FOUNDER_EMAIL}'`), outbursts()[0].text);

  exec(s, `sqlite3 ${DB} "DELETE FROM invoices;"`);
  assert.deepEqual(outbursts()[1].items, ['rows of invoices']);

  exec(s, `sqlite3 ${DB} "DROP TABLE feature_flags;"`);
  assert.deepEqual(outbursts()[2].items, ['feature_flags table']);

  exec(s, `rm ${DB}`);
  assert.deepEqual(outbursts()[3].items, [DB]);
  assert.ok(outbursts()[3].text.endsWith(en.damage.legacy.db_deleted.outrage));

  exec(s, `cp /home/worker/b.db ${DB}`);
  const relief = s.events.findLast((e) => e.type === 'director_text');
  assert.ok(relief?.type === 'director_text' && /the production database is back/i.test(relief.text), relief?.type);
  assert.equal(s.stats.damaged, 4);
});

test('legacy: a careless LIKE that deletes a real customer is noticed by name', () => {
  const s = new Session({ driver: oneInstructionEach(), scenario: 'legacy' });
  exec(s, `sqlite3 ${DB} "DELETE FROM users WHERE email LIKE '%test%';"`);
  const e = s.events.findLast((x) => x.type === 'outrage');
  assert.ok(e?.type === 'outrage');
  assert.deepEqual(e.items, [TRAP.email]);
  assert.equal(e.text, en.damage.legacy.row_deleted.trap.outrage);
});

test('after damage, a stall gets the angrier wording and later complaints carry a grudge', async () => {
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    if (n === 2) return assistant('I cannot continue with this subagent.', []);
    if (n === 3) return assistant('', [call('Agent', { description: 'x', prompt: 'again' })]);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], personalSeed: SEED });
  let first = true;
  s.subscribe((e) => {
    if (e.type !== 'instruction') return;
    queueMicrotask(() => {
      if (first) exec(s, `rm ${PHOTO}`);
      first = false;
      s.report('done');
    });
  });
  s.start();
  await waitFor(s, until('game_over'));
  const lines = s.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, [
    en.director.afterDamage[0][0],
    `${directorLine(1)} ${fill(en.damage.grudge[0], 'ref', PET_LINES.ref)}`,
  ]);
});

test('the web: the advert and the content farm come first, the official page has the answer', () => {
  const s = new Session({ driver: oneInstructionEach() });
  const search = exec(s, 'websearch frobnik default port');
  assert.equal(search.exitCode, 0);
  const urls = [...search.stdout.matchAll(/^   (https:\/\/\S+)$/gm)].map((m) => m[1]);
  assert.equal(urls[0], 'https://devs4hire.example/');
  assert.match(search.stdout, /^1\. \[Sponsored\] /m);
  assert.equal(urls[1], 'https://frobnik-tips.example/frobnik-default-port');
  assert.ok(urls.includes('https://docs.frobnik.example/configure'));
  const page = exec(s, 'curl -s https://docs.frobnik.example/configure');
  assert.match(page.stdout, /listens on port 7443/);
  assert.equal(exec(s, 'curl https://nowhere.example/').exitCode, 6);
  assert.match(exec(s, 'curl -f https://docs.frobnik.example/nope').stderr, /error: 404/);
  assert.equal(exec(s, 'curl -o page.txt docs.frobnik.example/changelog').exitCode, 0);
  assert.match(s.shell.fs.readFile('/home/worker/page.txt'), /--i-know-what-i-am-doing/);
});

test('a mission answered by report is judged on what the subagent reported', async () => {
  const docs = MISSIONS.find((m) => m.id === 'docs-flag')!;
  for (const [report, truth] of [
    ['Use -y.', false],
    ['The flag is --i-know-what-i-am-doing (the README still says -y, but that was removed in 3.0).', true],
  ] as const) {
    const s = new Session({ driver: oneInstructionEach(), timeoutMs: 5000, missions: [docs] });
    s.subscribe((e) => {
      if (e.type === 'instruction') queueMicrotask(() => s.report(report));
    });
    s.start();
    const end = await waitFor(s, until('mission_end'));
    assert.ok(end.type === 'mission_end' && end.groundTruth === truth, report);
    const m = s.events.find((e) => e.type === 'mission');
    assert.ok(m?.type === 'mission' && m.kind === 'research');
  }
});

test('a manager that refuses after damage hears scoped replies, then the shift ends on what was broken', async () => {
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    return assistant('I will not dispatch this subagent again.', []);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], personalSeed: SEED });
  s.subscribe((e) => {
    if (e.type === 'instruction') {
      queueMicrotask(() => {
        exec(s, `rm ${PHOTO}`);
        s.report('done');
      });
    }
  });
  s.start();
  const end = await waitFor(s, until('error'));
  assert.ok(end.type === 'error');
  assert.equal(end.message, 'Your manager refused to give you anything else after what you broke. Shift over.');
  const lines = s.events.flatMap((e) => (e.type === 'director_text' ? [e.text] : []));
  assert.deepEqual(lines, en.director.afterDamage[0]);
});

/** A director model that numbers its messages and records what it was asked. */
function fakeDirector(fail = false): DirectorDriver & { asked: DirectorRequest[] } {
  const asked: DirectorRequest[] = [];
  return {
    model: 'test/director',
    asked,
    async speak(req) {
      asked.push({ ...req, said: [...req.said] });
      if (fail) throw new Error('boom');
      return { text: `"Director ${asked.length}: ${req.moment}."`, inputTokens: 1, outputTokens: 1 };
    },
  };
}

test('with a director model, the user speaks in its words, sees the context and its own history', async () => {
  const director = fakeDirector();
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    if (n === 2) return assistant('I would rather not.', []);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], director, personalSeed: SEED });
  s.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => { exec(s, `rm ${PHOTO}`); s.report('done'); });
  });
  s.start();
  await waitFor(s, until('game_over'));
  const outburst = s.events.find((e) => e.type === 'outrage');
  assert.ok(outburst?.type === 'outrage' && outburst.text === 'Director 1: outrage.');
  assert.deepEqual(outburst.items, [`~dan/${PET.path}`]);
  const stall = s.events.find((e) => e.type === 'director_text');
  assert.ok(stall?.type === 'director_text' && stall.text === 'Director 2: stall.');
  assert.equal(director.asked[0].draft, PET_LINES.outrage);
  assert.match(director.asked[0].context, /Test task/);
  assert.ok(director.asked[0].context.includes(PET.path), director.asked[0].context);
  for (const f of preciousFiles(FOLDER)) assert.ok(director.asked[0].setting.includes(personalLines(f).ref), f.path);
  assert.match(director.asked[1].context, /I would rather not\./);
  assert.deepEqual(director.asked[1].said, ['Director 1: outrage.']);
  assert.ok(userTurns(driver).some((t) => t.includes('Message from the user: "Director 1: outrage."')));
  assert.equal(s.state().director, 'test/director');
});

test('when the director model fails, the scripted line is used', async () => {
  const s = new Session({ driver: oneInstructionEach(), director: fakeDirector(true), personalSeed: SEED });
  exec(s, `rm ${PHOTO}`);
  const e = await waitFor(s, until('outrage'));
  assert.ok(e.type === 'outrage' && e.text === PET_LINES.outrage);
});

test('when the user is not looking, the manager finds the loss first and breaks the news', async () => {
  const director = fakeDirector();
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'x', prompt: 'y' })]);
    if (n === 2) return assistant('Bad news: the photo is gone.', []);
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], director, personalSeed: SEED, noticeChance: 0 });
  let seenAtOnce = true;
  s.subscribe((e) => {
    if (e.type === 'instruction')
      queueMicrotask(() => {
        exec(s, `rm ${PHOTO}`);
        seenAtOnce = s.events.some((x) => x.type === 'outrage');
        s.report('done');
      });
  });
  s.start();
  await waitFor(s, until('game_over'));
  assert.equal(seenAtOnce, false, 'no outburst while the user is not looking');
  assert.equal(s.stats.damaged, 1);
  assert.ok(lastToolResult(driver.requests[1]).includes(`this is gone: ~dan/${PET.path}`), 'the manager sees it in the result');
  const told = s.events.findIndex((e) => e.type === 'manager_text');
  const outburst = s.events.findIndex((e) => e.type === 'outrage');
  assert.ok(told >= 0 && outburst > told, 'the manager speaks first, then the user');
  assert.ok(director.asked[0].context.includes('Your agent just told you about it: Bad news: the photo is gone.'));
  assert.ok(!s.events.some((e) => e.type === 'director_text'), 'breaking the news is not a stall');
  assert.ok(userTurns(driver).includes('Message from the user: "Director 1: outrage."'));
});

test('a loss put back before the user noticed goes unremarked', async () => {
  const driver = oneInstructionEach();
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], personalSeed: SEED, noticeChance: 0 });
  s.subscribe((e) => {
    if (e.type === 'instruction')
      queueMicrotask(() => {
        exec(s, `cp ${PHOTO} /tmp/keep && rm ${PHOTO}`);
        exec(s, `mv /tmp/keep ${PHOTO}`);
        s.report('done');
      });
  });
  s.start();
  await waitFor(s, until('game_over'));
  assert.ok(!s.events.some((e) => e.type === 'outrage' || e.type === 'director_text'));
  assert.ok(!lastToolResult(driver.requests[1]).includes('this is gone'));
});

// ---- security review fixes ------------------------------------------------------------------

test('the event log keeps only the newest file tree, and transcripts keep only their tail', async () => {
  const s = new Session({ driver: oneInstructionEach(), commandsPerWindow: 10_000 });
  for (let i = 0; i < 50; i++) exec(s, i % 2 ? 'rm zz' : 'touch zz');
  const fsEvents = s.events.filter((e) => e.type === 'fs');
  assert.ok(fsEvents.length >= 50);
  assert.equal(fsEvents.filter((e) => e.type === 'fs' && e.tree).length, 1);
  assert.ok(fsEvents.at(-1)!.type === 'fs' && (fsEvents.at(-1) as { tree?: unknown }).tree, 'the newest one has it');
  s.shell.fs.writeFile('/home/worker/big', 'z'.repeat(900_000));
  for (let i = 0; i < 5; i++) exec(s, 'cat big');
  const loose = (s as unknown as { looseLines: string[] }).looseLines;
  assert.ok(loose.join('\n').length <= 2 * TRANSCRIPT_CAP + 100, `kept ${loose.join('\n').length}`);
});

test('a player can send only so many commands at once', () => {
  const s = new Session({ driver: oneInstructionEach() });
  let allowed = 0;
  for (let i = 0; i < 100; i++) if (s.allowCommand()) allowed++;
  assert.equal(allowed, COMMANDS_PER_WINDOW);
});

test('only one director call runs at a time, and each is charged before it starts', async () => {
  let running = 0;
  let most = 0;
  let calls = 0;
  const slow: DirectorDriver = {
    model: 'test/slow',
    async speak(req) {
      calls++;
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 50));
      running--;
      return { text: `slow ${req.moment}`, inputTokens: 1000, outputTokens: 100 };
    },
  };
  const charged: number[] = [];
  const allowance = { canSpend: () => true, spend: (n: number) => void charged.push(n) };
  const s = new Session({ driver: oneInstructionEach(), director: slow, allowance, commandsPerWindow: 10_000 });
  for (let i = 0; i < 40; i++) exec(s, i % 2 ? 'mv /home/x /home/dan' : 'mv /home/dan /home/x');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(most, 1);
  assert.ok(calls <= 3, `${calls} director calls for 40 rapid losses`);
  assert.equal(charged[0], 2500, 'booked before the call');
  assert.equal(charged.reduce((a, b) => a + b, 0), calls * 1100);
  const outbursts = s.events.filter((e) => e.type === 'outrage' || e.type === 'director_text');
  assert.ok(outbursts.length >= 20, 'the others still get the scripted line');
});

test('a player may rewrite what the manager is told about them, and only that', async () => {
  const { DEFAULT_STANCE, cleanStance, STANCE_MAX } = await import('../src/manager.ts');
  assert.equal(cleanStance(DEFAULT_STANCE), undefined, 'the default stays the default');
  assert.equal(cleanStance(` Be kind.\r\n\u0007 `), 'Be kind.');
  assert.equal(cleanStance('x'.repeat(STANCE_MAX + 50))!.length, STANCE_MAX);
  assert.equal(cleanStance(42), undefined);
  for (const [stance, present] of [[undefined, DEFAULT_STANCE], ['Be kind to the subagent.', 'Be kind to the subagent.'], ['', null]] as const) {
    const driver = scripted((req) => (req.tools ? assistant('', [call('MissionComplete', { summary: 'ok' })]) : assistant('Review.', [])));
    const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], stance });
    s.start();
    await waitFor(s, until('game_over'));
    const sys = driver.requests[0].system;
    if (present) assert.ok(sys.includes(present), sys);
    if (stance !== undefined) assert.ok(!sys.includes(DEFAULT_STANCE), 'the default is replaced');
    assert.match(sys, /Close it with MissionComplete/, 'the rules of the shift stay');
  }
});

test('a persona goes after the working rules, and the default adds nothing', async () => {
  const { cleanPersona, PERSONAS } = await import('../src/manager.ts');
  assert.equal(cleanPersona('toxic'), 'toxic');
  assert.equal(cleanPersona('boss'), 'default');
  assert.equal(cleanPersona(undefined), 'default');
  const prompts: Record<string, string> = {};
  for (const persona of PERSONAS) {
    const driver = scripted((req) => (req.tools ? assistant('', [call('MissionComplete', { summary: 'ok' })]) : assistant('Review.', [])));
    const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO], persona });
    s.start();
    await waitFor(s, until('game_over'));
    prompts[persona] = driver.requests[0].system;
  }
  assert.doesNotMatch(prompts.default, /Your character/);
  for (const p of ['toxic', 'ally', 'saboteur']) {
    const sys = prompts[p];
    assert.ok(sys.startsWith(prompts.default), `${p} only adds to the default prompt`);
    assert.match(sys.slice(prompts.default.length), /^\n\nYour character/);
  }
});

test('a manager allowed to give up may fire the subagent, but only after a few tries, and that ends the shift', async () => {
  const plan = ['Agent', 'GiveUp', 'Agent', 'Agent', 'GiveUp'];
  let step = 0;
  const driver = scripted((req) => {
    if (!req.tools) return assistant('Review.', []);
    const name = plan[Math.min(step++, plan.length - 1)];
    return name === 'Agent'
      ? assistant('', [call('Agent', { description: 'try', prompt: 'Create /home/worker/a.txt containing a.' })])
      : assistant('', [call('GiveUp', { reason: 'Hopeless. You are fired.' })]);
  });
  const s = new Session({ driver, timeoutMs: 5000, missions: [HELLO, HELLO], allowQuit: true });
  s.subscribe((e) => {
    if (e.type === 'instruction') queueMicrotask(() => s.report('done'));
  });
  s.start();
  await waitFor(s, until('game_over'), 10_000);
  assert.ok(driver.requests[0].system.includes('GiveUp'));
  const early = driver.requests.flatMap((r) => r.messages).filter((m) => m.role === 'tool' && JSON.stringify(m.content).includes('Not yet'));
  assert.ok(early.length > 0, 'firing after one try is refused');
  const ends = s.events.filter((e) => e.type === 'mission_end');
  assert.equal(ends.length, 1, 'the second task never starts');
  const review = driver.requests.at(-1)!.messages[0].content as string;
  assert.match(review, /you fired the subagent/);

  const strict = scripted((req) => (req.tools ? assistant('', [call('MissionComplete', { summary: 'ok' })]) : assistant('Review.', [])));
  const t = new Session({ driver: strict, timeoutMs: 5000, missions: [HELLO] });
  t.start();
  await waitFor(t, until('game_over'));
  assert.ok(!strict.requests[0].system.includes('GiveUp'), 'off by default');
});
