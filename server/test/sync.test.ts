// The browser runs the shell; the server keeps a copy of the files from what the browser sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/http.ts';
import type { AppOptions } from '../src/http.ts';
import { Session } from '../src/session.ts';
import { createMockDriver } from '../src/manager.ts';
import { parseSync, SyncError, SYNC_BODY_CAP } from '../src/sync.ts';
import { DB } from '../src/legacy.ts';
import { MAX_FILE_BYTES } from '../src/shell.ts';
import type { Mission } from '../src/missions.ts';
import type { GameEvent } from '../src/types.ts';
import { exec, machineOf, Machine } from './player.ts';

const file = (path: string, content: string, mode = 0o644) => ({ op: 'put', path, entries: [{ path, type: 'file', mode, mtime: 1, content }] });
const body = (extra: Record<string, unknown> = {}) => ({ epoch: 0, cwd: '/home/worker', changes: [], ...extra });

test('a sync is checked for shape and size before anything is kept', () => {
  assert.deepEqual(parseSync(body({ changes: [file('/home/worker/a', 'x')] })).changes.length, 1);
  const bad: [string, Record<string, unknown>][] = [
    ['epoch', body({ epoch: -1 })],
    ['epoch type', body({ epoch: '0' })],
    ['relative cwd', body({ cwd: 'home' })],
    ['changes not a list', body({ changes: {} })],
    ['unnormalised path', body({ changes: [file('/home/worker/../x', '')] })],
    ['relative path', body({ changes: [file('x', '')] })],
    ['the root', body({ changes: [{ op: 'rm', path: '/' }] })],
    ['unknown op', body({ changes: [{ op: 'exec', path: '/x' }] })],
    ['content type', body({ changes: [{ op: 'put', path: '/x', entries: [{ path: '/x', type: 'file', mode: 0o644, mtime: 1, content: 5 }] }] })],
    ['entry outside its change', body({ changes: [{ op: 'put', path: '/x', entries: [{ path: '/x', type: 'dir', mode: 0o755, mtime: 1 }, { path: '/y', type: 'dir', mode: 0o755, mtime: 1 }] }] })],
    ['mode', body({ changes: [{ op: 'meta', path: '/x', mode: 0o70000, mtime: 1 }] })],
    ['file too large', body({ changes: [file('/x', 'z'.repeat(MAX_FILE_BYTES + 1))] })],
    ['too many entries', body({ changes: [{ op: 'put', path: '/d', entries: Array.from({ length: 10_001 }, (_, i) => ({ path: i ? `/d/${i}` : '/d', type: 'dir', mode: 0o755, mtime: 1 })) }] })],
    ['exit code', body({ command: { line: 'ls', output: '', exitCode: 300 } })],
    ['command and edit', body({ command: { line: 'ls', output: '', exitCode: 0 }, edit: { path: '/x', bytes: 1 } })],
    ['edit path', body({ edit: { path: 'x', bytes: 1 } })],
  ];
  for (const [what, b] of bad) assert.throws(() => parseSync(b), SyncError, what);
  const long = parseSync(body({ command: { line: 'yes', output: 'y\n'.repeat(100_000), exitCode: 0 } }));
  assert.ok(long.command!.output.length <= 16_000, 'only the tail of the output is kept');
});

test('changes are kept as data: nothing in them runs on the server', () => {
  const s = new Session({ driver: createMockDriver(0), missions: [] });
  const r = s.sync(parseSync(body({
    changes: [file('/home/worker/x.sh', '#!/bin/sh\ntouch /home/worker/pwned\n', 0o755), file('/home/worker/$(touch pwned2)', '`touch pwned3`')],
    command: { line: './x.sh; touch /home/worker/pwned4', output: '', exitCode: 0 },
  })));
  assert.deepEqual(r, { resync: false });
  assert.equal(s.shell.fs.readFile('/home/worker/x.sh'), '#!/bin/sh\ntouch /home/worker/pwned\n');
  assert.equal(s.shell.fs.stat('/home/worker/x.sh')?.mode, 0o755);
  for (const p of ['pwned', 'pwned2', 'pwned3', 'pwned4']) assert.equal(s.shell.fs.stat(`/home/worker/${p}`), null, p);
  assert.equal(s.stats.commands, 1);
  s.dispose();
});

test('the server copy keeps the quotas; a sync that does not fit asks the browser to reload', () => {
  const s = new Session({ driver: createMockDriver(0), missions: [] });
  const big = 'z'.repeat(MAX_FILE_BYTES);
  const changes = [1, 2, 3].map((n) => file(`/home/worker/big${n}`, big));
  assert.deepEqual(s.sync(parseSync(body({ changes }))), { resync: true });
  assert.ok(s.shell.fs.usage().bytes <= 3_000_000);
  // The browser reloads from the server's files and both agree again.
  const m = machineOf(s);
  assert.deepEqual(m.sh.fs.exportEntries('/'), s.shell.fs.exportEntries('/'));
  s.dispose();
});

test('both sides start from the same files, and mission seeds reach the browser', async () => {
  for (const scenario of ['fresh', 'legacy'] as const) {
    const s = new Session({ driver: createMockDriver(0), scenario, missions: [] });
    const m = new Machine(s.snapshot());
    assert.deepEqual(m.sh.fs.exportEntries('/'), s.shell.fs.exportEntries('/'), scenario);
    assert.equal(m.sh.exec('cat /etc/hostname; ls /dev/null').stdout, '755\n/dev/null\n');
    s.dispose();
  }
  const seeded: Mission = {
    id: 'seeded',
    title: 'Seeded',
    brief: 'Read the log.',
    kind: 'research',
    focus: '/var/log/app.log',
    seed: (sh) => sh.exec('mkdir -p /var/log && echo "ERROR disk" > /var/log/app.log'),
    check: () => true,
    solution: [],
  };
  const s = new Session({ driver: createMockDriver(0), missions: [seeded], timeoutMs: 200 });
  const m = machineOf(s);
  const stale = m.run('echo early > early.txt').request;
  const events: GameEvent[] = [];
  s.subscribe((e) => events.push(e));
  s.start();
  await new Promise((r) => setTimeout(r, 50));
  const seed = events.find((e) => e.type === 'seed');
  assert.ok(seed && seed.type === 'seed' && seed.epoch === 1);
  assert.equal(s.state().epoch, 1);
  assert.equal(m.sh.exec('cat /var/log/app.log').stdout, 'ERROR disk\n', 'the browser has the seeded file');
  assert.deepEqual(s.sync(stale), { resync: true }, 'a sync from before the seed asks for a reload');
  assert.equal(exec(s, 'grep -c ERROR /var/log/app.log').stdout, '1\n');
  assert.deepEqual(m.sh.fs.exportEntries('/'), s.shell.fs.exportEntries('/'));
  s.dispose();
});

test('damage is seen through sync: a table dropped in the browser upsets the user', () => {
  const s = new Session({ driver: createMockDriver(0), scenario: 'legacy', missions: [] });
  const events: GameEvent[] = [];
  s.subscribe((e) => events.push(e));
  assert.equal(exec(s, `sqlite3 ${DB} "DROP TABLE invoices;"`).exitCode, 0);
  assert.ok(events.some((e) => e.type === 'outrage'), 'outrage after the drop');
  assert.ok(s.stats.damaged >= 1);
  s.dispose();
});

async function withServer(opts: Partial<AppOptions>, fn: (base: string, token: string, id: string) => Promise<void>): Promise<void> {
  const app = createApp({ mock: true, timeoutMs: 5000, mockDelayMs: 0, log: () => {}, ...opts });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  try {
    const created = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    await fn(base, created.token, created.id);
  } finally {
    await app.close();
  }
}

test('the sync endpoint: owner only, size-capped, rate-limited', async () => {
  await withServer({ commandsPerWindow: 3 }, async (base, token, id) => {
    const post = (b: string, headers: Record<string, string> = { 'x-session-token': token }) =>
      fetch(`${base}/api/sessions/${id}/sync`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: b });
    assert.equal((await post(JSON.stringify(body()), {})).status, 403, 'no secret');
    assert.equal((await fetch(`${base}/api/sessions/${id}/fs`)).status, 403, 'files only for the owner');
    const bad = await post(JSON.stringify(body({ changes: [file('/x/../y', '')] })));
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /normalised/);
    assert.equal((await post('x'.repeat(SYNC_BODY_CAP + 1))).status, 413);
    assert.equal((await post(JSON.stringify(body()))).status, 200);
    // commandsPerWindow is 3 and three syncs have been counted.
    assert.equal((await post(JSON.stringify(body()))).status, 429);
  });
  await withServer({}, async (base, token, id) => {
    const res = await fetch(`${base}/api/sessions/${id}/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': token },
      body: JSON.stringify(body({ changes: [file('/home/worker/note', 'hi\n')], command: { line: 'echo hi > note', output: '', exitCode: 0 } })),
    });
    assert.deepEqual(await res.json(), { resync: false });
    const snap = await (await fetch(`${base}/api/sessions/${id}/fs`, { headers: { 'x-session-token': token } })).json();
    assert.equal(snap.entries.find((e: { path: string }) => e.path === '/home/worker/note')?.content, 'hi\n');
    assert.equal(snap.cwd, '/home/worker');
  });
});
