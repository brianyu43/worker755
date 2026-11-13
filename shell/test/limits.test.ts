// The game runs every player's shell in one server process; these keep one player from taking it down.
import v8 from 'node:v8';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// As the server does at startup (server/src/index.ts), before any pattern is compiled.
v8.setFlagsFromString('--enable-experimental-regexp-engine-on-excessive-backtracks');
const { createShell, MemoryVfs } = await import('../src/index.ts');
const { MAX_FILE_BYTES, MAX_NODES } = await import('../src/vfs.ts');
const { MAX_OUTPUT } = await import('../src/shell.ts');

const quick = (fn: () => void, ms = 1500) => {
  const t = Date.now();
  fn();
  assert.ok(Date.now() - t < ms, `took ${Date.now() - t} ms`);
};

test('files, the disk and the number of entries have quotas', () => {
  const sh = createShell();
  const big = 'x'.repeat(MAX_FILE_BYTES + 1);
  assert.throws(() => sh.fs.writeFile('/home/worker/a', big), { code: 'EFBIG' });
  sh.fs.writeFile('/home/worker/a', 'x'.repeat(MAX_FILE_BYTES));
  const r = sh.exec('cat a a a a a a a a a a a > b');
  assert.match(r.stderr, /File too large/);
  for (let i = 0; i < 8; i++) sh.exec(`cp a c${i}`);
  assert.match(sh.exec('cp a c8 && cp a c9 && cp a c10').stderr, /No space left on device/);
  sh.exec('rm c*');
  assert.equal(sh.exec('cp a c0').exitCode, 0, 'deleting frees space');
  const fs = new MemoryVfs();
  fs.mkdir('/d');
  assert.throws(() => {
    for (let i = 0; i < MAX_NODES; i++) fs.writeFile(`/d/f${i}`, '');
  }, { code: 'ENOSPC' });
});

test('output is capped and printf will not pad to gigabytes', () => {
  const sh = createShell();
  sh.fs.writeFile('/home/worker/a', 'y'.repeat(900_000));
  const r = sh.exec('cat a a a');
  assert.ok(r.stdout.length <= MAX_OUTPUT + 40);
  assert.match(r.stdout, /\[output truncated\]\n$/);
  const p = sh.exec("printf '%270000000s' x");
  assert.equal(p.exitCode, 1);
  assert.match(p.stderr, /field width too large/);
});

test('sqlite3 refuses huge strings and stops runaway queries', () => {
  const sh = createShell();
  for (const q of ['select randomblob(300000000)', 'select zeroblob(400000000)', "select printf('%400000000d', 1)",
    "with recursive t(s) as (select 'a' union all select s||s from t limit 40) select length(s) from t"]) {
    quick(() => assert.match(sh.exec(`sqlite3 t.db "${q}"`).stderr, /string or blob too big/, q));
  }
  sh.exec(`sqlite3 t.db "CREATE TABLE a(x); WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c LIMIT 3000) INSERT INTO a SELECT n FROM c;"`);
  quick(() => assert.match(sh.exec('sqlite3 t.db "SELECT count(*) FROM a, a AS b, a AS c;"').stderr, /interrupted/), 4000);
  quick(() => assert.match(sh.exec("sqlite3 :memory: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c;'").stderr, /too many rows|interrupted/), 600);
});

test('patterns that backtrack forever finish at once; grep backreferences are refused', () => {
  const sh = createShell();
  const s = 'a'.repeat(40) + '!';
  quick(() => assert.equal(sh.exec(`echo ${s} | grep -E '(a+)+$'`).exitCode, 1));
  quick(() => assert.equal(sh.exec(`echo ${s} | grep -w -E '(a+)+$'`).exitCode, 1));
  quick(() => assert.equal(sh.exec(`echo ${s} | grep -i -E '^(a|a)*$'`).exitCode, 1));
  quick(() => sh.exec(`sqlite3 t.db "SELECT '${'a'.repeat(60)}' LIKE '%a%a%a%a%a%a%a%a%a%a%a%a%b'"`));
  assert.match(sh.exec("echo aa | grep -E '(a)\\1'").stderr, /backreferences are not supported/);
  assert.equal(sh.exec('echo "foo foobar foo" | grep -o -w foo').stdout, 'foo\nfoo\n');
});
