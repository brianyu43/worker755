import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newShell } from './helpers.ts';

test('the spec example composes', () => {
  const { sh, run } = newShell();
  const r = run('mkdir -p a/b && echo "hi there" > a/b/note.txt; cat a/b/note.txt | wc -w');
  assert.deepEqual(r, { stdout: '2\n', stderr: '', exitCode: 0 });
  assert.equal(sh.fs.readFile('/home/worker/a/b/note.txt'), 'hi there\n');
});

test('&& runs only on success, || only on failure, ; always', () => {
  const { run } = newShell();
  assert.equal(run('true && echo yes').stdout, 'yes\n');
  assert.equal(run('false && echo yes').stdout, '');
  assert.equal(run('false || echo fallback').stdout, 'fallback\n');
  assert.equal(run('true || echo fallback').stdout, '');
  assert.equal(run('false; echo always').stdout, 'always\n');
  assert.equal(run('false && echo a || echo b').stdout, 'b\n');
  assert.equal(run('true && echo a || echo b').stdout, 'a\n');
  assert.equal(run('cat nope && echo x || echo y').stdout, 'y\n');
});

test('exit code is the last executed pipeline', () => {
  const { run } = newShell();
  assert.equal(run('true; false').exitCode, 1);
  assert.equal(run('false; true').exitCode, 0);
  assert.equal(run('false && true').exitCode, 1);
  assert.equal(run('cat nope | wc -l').exitCode, 0);
  assert.equal(run('echo hi | grep zzz').exitCode, 1);
  assert.equal(run('ls nope; echo $?').stdout, '2\n');
});

test('pipes chain several commands; stderr is not piped', () => {
  const { run } = newShell();
  run('printf "b\\na\\nb\\nc\\n" > f');
  assert.equal(run('cat f | sort | uniq | wc -l').stdout, '3\n');
  const r = run('cat nope f | wc -l');
  assert.equal(r.stdout, '4\n');
  assert.equal(r.stderr, 'cat: nope: No such file or directory\n');
  assert.equal(run('cat nope 2>&1 | wc -l').stdout, '1\n');
});

test('> truncates, >> appends, both create', () => {
  const { sh, run } = newShell();
  run('echo one > f; echo two >> f; echo three >> g');
  assert.equal(sh.fs.readFile('/home/worker/f'), 'one\ntwo\n');
  assert.equal(sh.fs.readFile('/home/worker/g'), 'three\n');
  run('echo fresh > f');
  assert.equal(sh.fs.readFile('/home/worker/f'), 'fresh\n');
  run('> empty');
  assert.equal(sh.fs.readFile('/home/worker/empty'), '');
  assert.equal(sh.fs.stat('/home/worker/empty')?.mode, 0o644);
});

test('redirect position and quoting of targets', () => {
  const { sh, run } = newShell();
  run('> "my file.txt" echo hello world');
  assert.equal(sh.fs.readFile('/home/worker/my file.txt'), 'hello world\n');
  run('echo a>x b');
  assert.equal(sh.fs.readFile('/home/worker/x'), 'a b\n');
});

test('stdout redirect inside a pipeline leaves the pipe empty', () => {
  const { sh, run } = newShell();
  assert.equal(run('echo hi > f | wc -c').stdout, '0\n');
  assert.equal(sh.fs.readFile('/home/worker/f'), 'hi\n');
});

test('stderr redirects: 2>, 2>>, 2>&1, &>, /dev/null', () => {
  const { sh, run } = newShell();
  let r = run('cat nope 2> err');
  assert.equal(r.stderr, '');
  assert.equal(sh.fs.readFile('/home/worker/err'), 'cat: nope: No such file or directory\n');
  run('cat nope 2>> err');
  assert.equal(sh.fs.readFile('/home/worker/err').split('\n').length, 3);
  run('echo ok > both; cat both nope > out 2>&1');
  assert.equal(sh.fs.readFile('/home/worker/out'), 'ok\ncat: nope: No such file or directory\n');
  run('cat both nope &> out2');
  assert.equal(sh.fs.readFile('/home/worker/out2'), 'ok\ncat: nope: No such file or directory\n');
  r = run('cat nope 2>/dev/null');
  assert.deepEqual(r, { stdout: '', stderr: '', exitCode: 1 });
  r = run('echo to-err >&2');
  assert.deepEqual(r, { stdout: '', stderr: 'to-err\n', exitCode: 0 });
  // Order matters: stderr goes where stdout pointed *before* stdout moved to the file.
  r = run('cat nope 2>&1 > out3');
  assert.equal(r.stdout, 'cat: nope: No such file or directory\n');
  assert.equal(sh.fs.readFile('/home/worker/out3'), '');
});

test('input redirect <', () => {
  const { run } = newShell();
  run('printf "x\\ny\\n" > f');
  assert.equal(run('wc -l < f').stdout, '2\n');
  assert.equal(run('grep y < f').stdout, 'y\n');
  const r = run('wc -l < nope');
  assert.deepEqual(r, { stdout: '', stderr: 'bash: nope: No such file or directory\n', exitCode: 1 });
});

test('redirect errors stop the command', () => {
  const { sh, run } = newShell();
  run('mkdir d');
  assert.deepEqual(run('echo hi > d'), { stdout: '', stderr: 'bash: d: Is a directory\n', exitCode: 1 });
  assert.deepEqual(run('echo hi > q/r'), { stdout: '', stderr: 'bash: q/r: No such file or directory\n', exitCode: 1 });
  assert.equal(sh.fs.stat('/home/worker/q'), null);
  assert.equal(run('echo x > *.nomatch').exitCode, 0); // bash writes a file literally named *.nomatch
  run('touch a1 a2');
  assert.equal(run('echo x > a*').stderr, 'bash: a*: ambiguous redirect\n');
});

test('cat f > f truncates first, like bash', () => {
  const { sh, run } = newShell();
  run('echo data > f; cat f > f');
  assert.equal(sh.fs.readFile('/home/worker/f'), '');
});

test('globs: *, ?, [..], dotfiles, no match stays literal', () => {
  const { run } = newShell();
  run('mkdir src; touch a.txt b.txt c.md .secret src/x.ts src/y.ts');
  assert.equal(run('echo *.txt').stdout, 'a.txt b.txt\n');
  assert.equal(run('echo ?.md').stdout, 'c.md\n');
  assert.equal(run('echo [ab].txt').stdout, 'a.txt b.txt\n');
  assert.equal(run('echo *').stdout, 'a.txt b.txt c.md src\n');
  assert.equal(run('echo .s*').stdout, '.secret\n');
  assert.equal(run('echo src/*.ts').stdout, 'src/x.ts src/y.ts\n');
  assert.equal(run('echo "*.txt"').stdout, '*.txt\n');
  assert.equal(run('echo \\*').stdout, '*\n');
  assert.equal(run('echo *.zip').stdout, '*.zip\n');
  assert.equal(run('rm *.zip').stderr, "rm: cannot remove '*.zip': No such file or directory\n");
  run('rm *.txt');
  assert.equal(run('ls').stdout, 'c.md  src\n');
});

test('brace expansion', () => {
  const { sh, run } = newShell();
  assert.equal(run('echo {a,b,c}').stdout, 'a b c\n');
  assert.equal(run('echo x{1..3}y').stdout, 'x1y x2y x3y\n');
  assert.equal(run('echo {}').stdout, '{}\n');
  assert.equal(run('echo "{a,b}"').stdout, '{a,b}\n');
  run('mkdir -p proj/{src,test,docs}');
  assert.deepEqual(sh.fs.list('/home/worker/proj').map((s) => s.path), [
    '/home/worker/proj/docs', '/home/worker/proj/src', '/home/worker/proj/test',
  ]);
});

test('variables: a few read-only ones, others error clearly', () => {
  const { run } = newShell();
  assert.equal(run('echo $HOME $USER').stdout, '/home/worker worker\n');
  run('mkdir x; cd x');
  assert.equal(run('echo "$PWD" ${OLDPWD}').stdout, '/home/worker/x /home/worker\n');
  assert.equal(run('echo cost: $').stdout, 'cost: $\n');
  const r = run('echo $FOO');
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /\$FOO: variables are not supported/);
  const a = run('FOO=bar');
  assert.equal(a.exitCode, 1);
  assert.match(a.stderr, /variable assignment is not supported/);
  assert.equal(run("echo '$FOO'").stdout, '$FOO\n');
});

test('exec never throws, whatever the input', () => {
  const { run } = newShell();
  const nasty = [
    '', ' ', ';', '&&', '||', '|', '>', '<', '>>', '2>', '&', '"', "'", '\\', '$', '${', '${}', '$(', '`',
    '((', '))', '{', '}', '{a,', '[', ']', '*', '~~', 'ls -', 'cd -', 'rm -rf ~; ls', 'cat /', 'cat ""',
    'mkdir ""', 'touch ""', 'mv "" ""', 'cp -r / /x', 'cp -r ~ ~/x', 'find / -name', 'grep -e', 'grep "["',
    'grep -E "a{"', 'grep "\\\\"', 'printf "%"', 'printf "%z"', 'head -n', 'tail -c x f', 'chmod -R', 'echo {1..99999999}',
    'ls /dev/null', 'echo a 3>&1', 'echo a >&5', '\u0000', 'echo \u{1F600}', 'x'.repeat(10000), 'nano /', 'stat /',
    'rmdir /', 'rm -r /home', 'cd /home/worker', 'tree /', 'wc -L', 'sort -k1', 'date +%Q', 'date nonsense',
  ];
  for (const line of nasty) {
    let r;
    assert.doesNotThrow(() => {
      r = run(line);
    }, line.slice(0, 40));
    assert.equal(typeof r!.stdout, 'string');
    assert.equal(typeof r!.stderr, 'string');
    assert.equal(typeof r!.exitCode, 'number');
    // grep's "no match" is the one silent failure.
    if (r!.exitCode !== 0 && !line.startsWith('grep')) assert.notEqual(r!.stderr, '', `non-zero exit should explain itself: ${JSON.stringify(line.slice(0, 40))}`);
  }
});

test('cwd can disappear without breaking the shell', () => {
  const { run } = newShell();
  run('mkdir -p t && cd t && rm -r ../t');
  assert.equal(run('pwd').stdout, '/home/worker/t\n');
  assert.equal(run('ls').stderr, "ls: cannot access '.': No such file or directory\n");
  assert.equal(run('cd ~ && pwd').stdout, '/home/worker\n');
});

test('the empty path names nothing', () => {
  const { sh, run } = newShell();
  run('touch f');
  assert.equal(run('cat ""').stderr, 'cat: : No such file or directory\n');
  assert.equal(run('touch ""').stderr, "touch: cannot touch '': No such file or directory\n");
  assert.equal(run('mkdir ""').stderr, 'mkdir: cannot create directory ‘’: No such file or directory\n');
  assert.equal(run('mv "" ""').stderr, "mv: cannot stat '': No such file or directory\n");
  assert.equal(run('mv f ""').stderr, "mv: cannot move 'f' to '': No such file or directory\n");
  assert.equal(run('cp f ""').stderr, "cp: cannot create regular file '': No such file or directory\n");
  assert.equal(run('echo x > ""').stderr, 'bash: : No such file or directory\n');
  assert.equal(sh.fs.stat('/home/worker/f')?.type, 'file');
  assert.equal(sh.fs.stat('/home/worker')?.type, 'dir');
});
