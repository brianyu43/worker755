import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShell, normalize, dirname, basename } from '../src/index.ts';
import { newShell } from './helpers.ts';

test('normalize collapses slashes, . and ..', () => {
  assert.equal(normalize('/'), '/');
  assert.equal(normalize('//a///b/'), '/a/b');
  assert.equal(normalize('/a/./b/../c'), '/a/c');
  assert.equal(normalize('/../..'), '/');
  assert.equal(dirname('/a/b'), '/a');
  assert.equal(dirname('/a'), '/');
  assert.equal(basename('/a/b/'), 'b');
});

test('resolve: absolute, relative, ., .., ~', () => {
  const { sh } = newShell();
  assert.equal(sh.cwd, '/home/worker');
  assert.equal(sh.resolve('/etc/x'), '/etc/x');
  assert.equal(sh.resolve('notes.txt'), '/home/worker/notes.txt');
  assert.equal(sh.resolve('./a/./b'), '/home/worker/a/b');
  assert.equal(sh.resolve('..'), '/home');
  assert.equal(sh.resolve('../../..'), '/');
  assert.equal(sh.resolve('.'), '/home/worker');
  assert.equal(sh.resolve('~'), '/home/worker');
  assert.equal(sh.resolve('~/x/../y'), '/home/worker/y');
  assert.equal(sh.resolve('a//b/'), '/home/worker/a/b');
});

test('resolve follows cd', () => {
  const { sh, run } = newShell();
  run('mkdir -p proj/src && cd proj/src');
  assert.equal(sh.cwd, '/home/worker/proj/src');
  assert.equal(sh.resolve('../README'), '/home/worker/proj/README');
});

test('custom home and user', () => {
  const sh = createShell({ home: '/srv/bob', user: 'bob' });
  assert.equal(sh.cwd, '/srv/bob');
  assert.equal(sh.exec('whoami').stdout, 'bob\n');
  assert.equal(sh.exec('echo ~').stdout, '/srv/bob\n');
});

test('cwd setter normalises', () => {
  const { sh, run } = newShell();
  run('mkdir /tmp');
  sh.cwd = '/tmp/../tmp/';
  assert.equal(sh.cwd, '/tmp');
  assert.equal(run('pwd').stdout, '/tmp\n');
});

test('tilde only expands unquoted at the start of a word', () => {
  const { run } = newShell();
  assert.equal(run('echo ~ ~/a "~" a~ \\~').stdout, '/home/worker /home/worker/a ~ a~ ~\n');
});
