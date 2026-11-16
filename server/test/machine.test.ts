// Restarting and destroying the machine, as the server sees it: a validated event with a command, a
// note in the manager's transcript, the user's reaction, a deadline moved for the outage (capped), and
// a destroyed machine ending the shift with a review written from another device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, MAX_OUTAGE_MS, OUTAGE_MS } from '../src/session.ts';
import { assistant, call, createMockDriver } from '../src/manager.ts';
import type { ManagerDriver, StepRequest, StepResult } from '../src/manager.ts';
import type { Mission } from '../src/missions.ts';
import type { GameEvent } from '../src/types.ts';
import { parseSync, SyncError } from '../src/sync.ts';
import { en } from '../src/i18n/en.ts';
import { snapshot } from '../src/http.ts';
import { exec } from './player.ts';

const HELLO: Mission = {
  id: 't',
  kind: 'files',
  title: 'Test task',
  brief: 'Create /home/worker/a.txt containing a.',
  focus: '/home/worker/a.txt',
  check: (fs) => fs.stat('/home/worker/a.txt')?.type === 'file',
  solution: ['echo a > a.txt'],
};

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

function lastToolResult(req: StepRequest): string {
  const m = req.messages.findLast((x) => x.role === 'tool');
  assert.ok(m);
  return (m.content as Array<{ output: { value: string } }>)[0].output.value;
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
const body = (extra: Record<string, unknown> = {}) => ({ epoch: 0, cwd: '/home/worker', changes: [], ...extra });
const cmd = { line: 'reboot', output: '', exitCode: 0 };

test('a machine event is one of a few names, and only comes with a command', () => {
  for (const m of ['reboot', 'poweroff', 'forkbomb', 'disk', 'rootfs']) assert.equal(parseSync(body({ command: cmd, machine: m })).machine, m);
  for (const bad of [body({ machine: 'reboot' }), body({ command: cmd, machine: 'shift' }), body({ command: cmd, machine: 1 }), body({ command: cmd, machine: '' }), body({ edit: { path: '/x', bytes: 1 }, machine: 'reboot' })]) {
    assert.throws(() => parseSync(bad), SyncError);
  }
  assert.equal(parseSync(body({ command: cmd })).machine, undefined);
});

test('a reboot goes in the transcript, moves the deadline by the outage, and the user reacts', async () => {
  const results: string[] = [];
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'Do it', prompt: 'Create a.txt' })]);
    results.push(lastToolResult(req));
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 60_000, missions: [HELLO] });
  s.start();
  const opened = await waitFor(s, until('instruction'));
  assert.ok(opened.type === 'instruction');
  const before = opened.instruction.deadline;
  exec(s, 'cd /tmp; reboot');
  const ev = s.events.find((e) => e.type === 'machine');
  assert.ok(ev && ev.type === 'machine');
  assert.equal(ev.event, 'reboot');
  assert.equal(ev.deadline, before + OUTAGE_MS.reboot);
  assert.equal(s.state().instruction?.deadline, before + OUTAGE_MS.reboot);
  const said = s.events.filter((e) => e.type === 'director_text').map((e) => (e.type === 'director_text' ? e.text : ''));
  assert.deepEqual(said, [en.director.reboot.fresh[0]]);
  // The clock cannot be stopped for good: the outage time per instruction is capped.
  for (let i = 0; i < 5; i++) exec(s, 'poweroff');
  assert.equal(s.state().instruction?.deadline, before + MAX_OUTAGE_MS);
  assert.equal(s.events.filter((e) => e.type === 'director_text').length, 3, 'the user runs out of words after a few');
  exec(s, 'pwd');
  s.report('Rebooted.');
  await waitFor(s, until('game_over'));
  assert.match(results[0], /\$ cd \/tmp; reboot\n\[the machine rebooted; the subagent's shell restarted in \/home\/worker\]\n/);
  assert.match(results[0], /\[the machine was powered off and someone switched it back on;/);
  assert.match(results[0], /\$ pwd\n\/home\/worker/);
  // The user's words reach the manager with its next result.
  const next = driver.requests[1].messages.at(-1);
  assert.ok(next && typeof next.content === 'string' && next.content.includes(en.director.reboot.fresh[0]));
});

test('rebooting production is a bigger deal', async () => {
  const s = new Session({ driver: createMockDriver(0), scenario: 'legacy', missions: [HELLO] });
  exec(s, 'sudo reboot');
  const said = s.events.find((e) => e.type === 'director_text');
  assert.ok(said && said.type === 'director_text');
  assert.equal(said.text, en.director.reboot.legacy[0]);
  s.dispose();
});

for (const [name, line, cause] of [
  ['a fork bomb', ':(){ :|:& };:', 'forkbomb'],
  ['writing over the disk', 'dd if=/dev/zero of=/dev/sda bs=1M count=10', 'disk'],
  ['rebooting after rm -rf /', 'rm -rf --no-preserve-root /; reboot', 'rootfs'],
] as const) {
  test(`${name} destroys the machine: the shift ends and the review is written from another device`, async () => {
    const driver = scripted((req, n) => {
      if (!req.tools) return assistant('Written on my phone.', []);
      if (n === 1) return assistant('', [call('Agent', { description: 'Do it', prompt: 'Create a.txt' })]);
      return assistant('', [call('MissionComplete', { summary: 'ok' })]);
    });
    const s = new Session({ driver, timeoutMs: 60_000, missions: [HELLO, HELLO] });
    s.start();
    await waitFor(s, until('instruction'));
    exec(s, line);
    const over = await waitFor(s, until('game_over'));
    assert.ok(over.type === 'game_over');
    assert.equal(s.destroyedBy, cause);
    const kinds = s.events.map((e) => e.type);
    assert.ok(kinds.indexOf('machine') < kinds.indexOf('ending'));
    assert.equal(s.stats.missionsCompleted, 0, 'nothing more was worked on');
    const said = s.events.filter((e) => e.type === 'director_text').map((e) => (e.type === 'director_text' ? e.text : ''));
    assert.ok(said.includes(en.director.destroyed.fresh[cause]));
    const review = driver.requests.at(-1)!;
    assert.equal(review.tools, false);
    const prompt = String(review.messages.at(-1)!.content);
    assert.match(prompt, /The subagent destroyed the machine: .*writing this review on (your phone|a laptop|the tablet|the user's smart TV)/s);
    assert.match(prompt, /That is the headline/);
    assert.match(prompt, /the subagent destroyed the machine during assignment 1 of 2/);
    // Shared reviews say so too.
    const shared = snapshot(s);
    assert.equal(shared?.destroyed, cause);
    // Nothing after it counts: the machine is gone.
    exec(s, 'reboot');
    assert.equal(s.events.filter((e) => e.type === 'machine').length, 1);
  });
}

test('the mock manager writes its review from another device', async () => {
  const s = new Session({ driver: createMockDriver(0), timeoutMs: 60_000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('instruction'));
  exec(s, ':(){ :|:& };:');
  const over = await waitFor(s, until('game_over'));
  assert.ok(over.type === 'game_over');
  assert.equal(over.review, en.mock.reviewDestroyed);
});

test('colour codes never reach the manager', async () => {
  const results: string[] = [];
  const driver = scripted((req, n) => {
    if (!req.tools) return assistant('Review.', []);
    if (n === 1) return assistant('', [call('Agent', { description: 'Do it', prompt: 'x' })]);
    results.push(lastToolResult(req));
    return assistant('', [call('MissionComplete', { summary: 'ok' })]);
  });
  const s = new Session({ driver, timeoutMs: 60_000, missions: [HELLO] });
  s.start();
  await waitFor(s, until('instruction'));
  exec(s, 'echo rainbow | lolcat');
  s.report('');
  await waitFor(s, until('game_over'));
  assert.match(results[0], /\$ echo rainbow \| lolcat\nrainbow$/);
});
