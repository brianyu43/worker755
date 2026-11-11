import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShell, createVfs, VfsError } from '../src/index.ts';

test('createShell starts in an existing /home/worker', () => {
  const sh = createShell();
  assert.equal(sh.cwd, '/home/worker');
  assert.equal(sh.fs.stat('/home/worker')?.type, 'dir');
  assert.equal(sh.fs.stat('/home')?.mode, 0o755);
});

test('stat returns null for missing paths and never throws', () => {
  const fs = createVfs(() => 1);
  assert.equal(fs.stat('/nope'), null);
  assert.equal(fs.stat('relative'), null);
  assert.deepEqual(fs.stat('/'), { path: '/', type: 'dir', mode: 0o755, size: 0, mtime: 1 });
});

test('writeFile / readFile, sizes in bytes', () => {
  const fs = createVfs(() => 5);
  fs.writeFile('/a.txt', 'héllo');
  assert.equal(fs.readFile('/a.txt'), 'héllo');
  assert.deepEqual(fs.stat('/a.txt'), { path: '/a.txt', type: 'file', mode: 0o644, size: 6, mtime: 5 });
  fs.writeFile('/a.txt', 'x');
  assert.equal(fs.readFile('/a.txt'), 'x');
});

test('VfsError codes', () => {
  const fs = createVfs();
  fs.mkdir('/d');
  fs.writeFile('/f', '');
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof VfsError);
      assert.ok(e instanceof Error);
      return e.code;
    }
    return 'no error';
  };
  assert.equal(code(() => fs.readFile('/missing')), 'ENOENT');
  assert.equal(code(() => fs.readFile('/d')), 'EISDIR');
  assert.equal(code(() => fs.writeFile('/missing/x', '')), 'ENOENT');
  assert.equal(code(() => fs.writeFile('/f/x', '')), 'ENOTDIR');
  assert.equal(code(() => fs.writeFile('/d', '')), 'EISDIR');
  assert.equal(code(() => fs.list('/f')), 'ENOTDIR');
  assert.equal(code(() => fs.mkdir('/d')), 'EEXIST');
  assert.equal(code(() => fs.readFile('rel')), 'EINVAL');
  fs.writeFile('/d/x', '');
  assert.equal(code(() => fs.rmdir('/d')), 'ENOTEMPTY');
});

test('list and tree are sorted and shaped per the spec', () => {
  const sh = createShell({ now: () => 0 });
  sh.exec('mkdir -p b a/inner && echo hi > a/z.txt && touch a/inner/.k && chmod 700 b');
  assert.deepEqual(sh.fs.list('/home/worker').map((s) => [s.path, s.type, s.mode]), [
    ['/home/worker/a', 'dir', 0o755],
    ['/home/worker/b', 'dir', 0o700],
  ]);
  const t = sh.fs.tree();
  assert.equal(t.name, '');
  assert.equal(t.path, '/');
  assert.equal(t.size, 0);
  const a = sh.fs.tree('/home/worker/a');
  assert.deepEqual(a, {
    name: 'a',
    path: '/home/worker/a',
    type: 'dir',
    mode: 0o755,
    size: 0,
    children: [
      {
        name: 'inner', path: '/home/worker/a/inner', type: 'dir', mode: 0o755, size: 0,
        children: [{ name: '.k', path: '/home/worker/a/inner/.k', type: 'file', mode: 0o644, size: 0 }],
      },
      { name: 'z.txt', path: '/home/worker/a/z.txt', type: 'file', mode: 0o644, size: 3 },
    ],
  });
  // The snapshot is detached from the live filesystem.
  sh.exec('rm -r a');
  assert.equal(a.children!.length, 2);
});

test('writes through fs show up in the shell and vice versa', () => {
  const sh = createShell();
  sh.fs.writeFile('/home/worker/seed.txt', 'planted\n');
  assert.equal(sh.exec('cat seed.txt').stdout, 'planted\n');
  sh.exec('echo back > out.txt');
  assert.equal(sh.fs.readFile('/home/worker/out.txt'), 'back\n');
});

test('mkdir recursive, rename, copy, remove extensions', () => {
  const fs = createVfs();
  fs.mkdir('/a/b/c', { recursive: true });
  fs.writeFile('/a/b/c/f', 'x');
  fs.copy('/a', '/copy', true);
  assert.equal(fs.readFile('/copy/b/c/f'), 'x');
  fs.rename('/copy', '/moved');
  assert.equal(fs.stat('/copy'), null);
  assert.equal(fs.readFile('/moved/b/c/f'), 'x');
  fs.remove('/moved', true);
  assert.equal(fs.stat('/moved'), null);
});
