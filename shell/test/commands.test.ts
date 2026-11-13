import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newShell } from './helpers.ts';

/** Run and assert the full result in one go. */
function expect(run: (l: string) => { stdout: string; stderr: string; exitCode: number }, line: string, stdout: string, stderr = '', exitCode = stderr ? 1 : 0) {
  const r = run(line);
  assert.equal(r.stdout, stdout, `stdout of: ${line}`);
  assert.equal(r.stderr, stderr, `stderr of: ${line}`);
  assert.equal(r.exitCode, exitCode, `exit code of: ${line}`);
}

test('pwd', () => {
  const { run } = newShell();
  expect(run, 'pwd', '/home/worker\n');
});

test('cd: home, -, .., errors', () => {
  const { sh, run } = newShell();
  run('mkdir -p a/b; touch f');
  expect(run, 'cd a/b', '');
  assert.equal(sh.cwd, '/home/worker/a/b');
  expect(run, 'cd ../..', '');
  assert.equal(sh.cwd, '/home/worker');
  run('cd /');
  expect(run, 'cd -', '/home/worker\n');
  run('cd /');
  expect(run, 'cd', '');
  assert.equal(sh.cwd, '/home/worker');
  expect(run, 'cd nope', '', 'bash: cd: nope: No such file or directory\n');
  expect(run, 'cd f', '', 'bash: cd: f: Not a directory\n');
  expect(run, 'cd a b', '', 'bash: cd: too many arguments\n');
  assert.equal(sh.cwd, '/home/worker');
});

test('ls: plain, -a, -l, -la, files and dirs, errors', () => {
  const { run } = newShell();
  run('mkdir docs; touch b.txt a.txt .hidden; echo hello > docs/readme');
  expect(run, 'ls', 'a.txt  b.txt  docs\n');
  expect(run, 'ls | cat', 'a.txt\nb.txt\ndocs\n');
  expect(run, 'ls -a', '.  ..  a.txt  b.txt  docs  .hidden\n');
  expect(run, 'ls -A', 'a.txt  b.txt  docs  .hidden\n');
  expect(run, 'ls docs', 'readme\n');
  expect(
    run,
    'ls -l',
    'total 4\n' +
      '-rw-r--r-- 1 worker worker    0 Nov 11 10:49 a.txt\n' +
      '-rw-r--r-- 1 worker worker    0 Nov 11 10:49 b.txt\n' +
      'drwxr-xr-x 2 worker worker 4096 Nov 11 10:49 docs\n',
  );
  const la = run('ls -la').stdout.split('\n');
  assert.equal(la[0], 'total 12');
  assert.match(la[1], /^drwxr-xr-x 3 worker worker 4096 Nov 11 10:49 \.$/);
  assert.match(la[2], / \.\.$/);
  assert.equal(run('ls -al').stdout, run('ls -la').stdout);
  expect(run, 'ls a.txt docs', 'a.txt\n\ndocs:\nreadme\n');
  expect(run, 'ls nope', '', "ls: cannot access 'nope': No such file or directory\n", 2);
  expect(run, 'ls -z', '', "ls: invalid option -- 'z'\nTry 'ls --help' for more information.\n", 2);
  expect(run, 'ls a.txt/', '', "ls: cannot access 'a.txt/': Not a directory\n", 2);
});

test('ls -l shows modes after chmod', () => {
  const { run } = newShell();
  run('touch run.sh && chmod 755 run.sh');
  assert.match(run('ls -l run.sh').stdout, /^-rwxr-xr-x 1 worker worker 0 Nov 11 10:49 run.sh\n$/);
});

test('mkdir, -p, errors', () => {
  const { sh, run } = newShell();
  expect(run, 'mkdir x', '');
  assert.equal(sh.fs.stat('/home/worker/x')?.mode, 0o755);
  expect(run, 'mkdir x', '', 'mkdir: cannot create directory ‘x’: File exists\n');
  expect(run, 'mkdir a/b', '', 'mkdir: cannot create directory ‘a/b’: No such file or directory\n');
  expect(run, 'mkdir -p a/b/c', '');
  assert.equal(sh.fs.stat('/home/worker/a/b/c')?.type, 'dir');
  expect(run, 'mkdir -p a/b/c', '');
  run('touch f');
  expect(run, 'mkdir -p f/x', '', 'mkdir: cannot create directory ‘f’: Not a directory\n');
  expect(run, 'mkdir f/x', '', 'mkdir: cannot create directory ‘f/x’: Not a directory\n');
  expect(run, 'mkdir', '', "mkdir: missing operand\nTry 'mkdir --help' for more information.\n");
});

test('rmdir', () => {
  const { run } = newShell();
  run('mkdir -p e full/sub; touch f');
  expect(run, 'rmdir e', '');
  expect(run, 'rmdir full', '', "rmdir: failed to remove 'full': Directory not empty\n");
  expect(run, 'rmdir nope', '', "rmdir: failed to remove 'nope': No such file or directory\n");
  expect(run, 'rmdir f', '', "rmdir: failed to remove 'f': Not a directory\n");
  expect(run, 'rmdir', '', "rmdir: missing operand\nTry 'rmdir --help' for more information.\n");
});

test('touch creates empty 644 files and errors on a missing parent', () => {
  const { sh, run } = newShell();
  expect(run, 'touch a b', '');
  assert.deepEqual(sh.fs.stat('/home/worker/a'), { path: '/home/worker/a', type: 'file', mode: 0o644, size: 0, mtime: Date.UTC(2026, 10, 11, 10, 49) });
  run('echo keep > a');
  run('touch a');
  assert.equal(sh.fs.readFile('/home/worker/a'), 'keep\n');
  expect(run, 'touch q/r', '', "touch: cannot touch 'q/r': No such file or directory\n");
  expect(run, 'touch', '', "touch: missing file operand\nTry 'touch --help' for more information.\n");
});

test('cat: files, stdin, -n, errors', () => {
  const { run } = newShell();
  run('echo one > a; echo two > b; mkdir d');
  expect(run, 'cat a b', 'one\ntwo\n');
  expect(run, 'cat a | cat - b', 'one\ntwo\n');
  expect(run, 'cat -n a b', '     1\tone\n     2\ttwo\n');
  expect(run, 'cat nope', '', 'cat: nope: No such file or directory\n');
  expect(run, 'cat d', '', 'cat: d: Is a directory\n');
  expect(run, 'cat a nope b', 'one\ntwo\n', 'cat: nope: No such file or directory\n');
  expect(run, 'cat a/', '', 'cat: a/: Not a directory\n');
});

test('echo: -n, -e, joins args', () => {
  const { run } = newShell();
  expect(run, 'echo hello   world', 'hello world\n');
  expect(run, 'echo -n hi', 'hi');
  expect(run, 'echo', '\n');
  expect(run, 'echo -e "a\\tb\\nc"', 'a\tb\nc\n');
  expect(run, 'echo "a\\nb"', 'a\\nb\n');
  expect(run, 'echo -x', '-x\n');
});

test('printf: %s, %d, \\n, padding, reuse', () => {
  const { run } = newShell();
  expect(run, 'printf "%s\\n" hello', 'hello\n');
  expect(run, 'printf "%s=%d\\n" a 1 b 2', 'a=1\nb=2\n');
  expect(run, "printf '[%5s|%-5s|%03d]\\n' ab cd 7", '[   ab|cd   |007]\n');
  expect(run, 'printf "100%%\\n"', '100%\n');
  expect(run, 'printf "no newline"', 'no newline');
  expect(run, 'printf "%d\\n" abc', '0\n', 'bash: printf: abc: invalid number\n');
  expect(run, 'printf', '', 'printf: usage: printf [-v var] format [arguments]\n', 2);
});

test('rm: file, -r, -f, -rf, errors', () => {
  const { sh, run } = newShell();
  run('mkdir -p d/sub; touch f d/sub/x');
  expect(run, 'rm f', '');
  assert.equal(sh.fs.stat('/home/worker/f'), null);
  expect(run, 'rm nope', '', "rm: cannot remove 'nope': No such file or directory\n");
  expect(run, 'rm -f nope', '');
  expect(run, 'rm d', '', "rm: cannot remove 'd': Is a directory\n");
  expect(run, 'rm -r d', '');
  assert.equal(sh.fs.stat('/home/worker/d'), null);
  run('mkdir -p e/f');
  expect(run, 'rm -rf e nope', '');
  expect(run, 'rm', '', "rm: missing operand\nTry 'rm --help' for more information.\n");
  expect(run, 'rm -rf /', '', "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n");
  expect(run, 'rm -r .', '', "rm: refusing to remove '.' or '..' directory: skipping '.'\n");
});

test('mv: rename, into dir, errors', () => {
  const { sh, run } = newShell();
  run('echo data > a; mkdir dir');
  expect(run, 'mv a b', '');
  assert.equal(sh.fs.readFile('/home/worker/b'), 'data\n');
  assert.equal(sh.fs.stat('/home/worker/a'), null);
  expect(run, 'mv b dir', '');
  assert.equal(sh.fs.readFile('/home/worker/dir/b'), 'data\n');
  expect(run, 'mv dir renamed', '');
  assert.equal(sh.fs.readFile('/home/worker/renamed/b'), 'data\n');
  expect(run, 'mv nope x', '', "mv: cannot stat 'nope': No such file or directory\n");
  expect(run, 'mv', '', "mv: missing file operand\nTry 'mv --help' for more information.\n");
  expect(run, 'mv x', '', "mv: missing destination file operand after 'x'\nTry 'mv --help' for more information.\n");
  run('mkdir -p renamed/inner');
  expect(run, 'mv renamed renamed/inner', '', "mv: cannot move 'renamed' to a subdirectory of itself, 'renamed/inner/renamed'\n");
  run('touch p q');
  expect(run, 'mv p q nowhere', '', "mv: target 'nowhere': No such file or directory\n");
  expect(run, 'mv p p', '', "mv: 'p' and 'p' are the same file\n");
  expect(run, 'mv p missing/x', '', "mv: cannot move 'p' to 'missing/x': No such file or directory\n");
});

test('mv overwrites files and keeps the mode', () => {
  const { sh, run } = newShell();
  run('echo new > a; echo old > b; chmod 755 a; mv a b');
  assert.equal(sh.fs.readFile('/home/worker/b'), 'new\n');
  assert.equal(sh.fs.stat('/home/worker/b')?.mode, 0o755);
});

test('cp: file, into dir, -r, errors', () => {
  const { sh, run } = newShell();
  run('echo x > a; mkdir -p src/deep dst; echo y > src/deep/f');
  expect(run, 'cp a b', '');
  assert.equal(sh.fs.readFile('/home/worker/b'), 'x\n');
  assert.equal(sh.fs.readFile('/home/worker/a'), 'x\n');
  expect(run, 'cp a dst', '');
  assert.equal(sh.fs.readFile('/home/worker/dst/a'), 'x\n');
  expect(run, 'cp src copy', '', "cp: -r not specified; omitting directory 'src'\n");
  expect(run, 'cp -r src copy', '');
  assert.equal(sh.fs.readFile('/home/worker/copy/deep/f'), 'y\n');
  run('echo changed > copy/deep/f');
  assert.equal(sh.fs.readFile('/home/worker/src/deep/f'), 'y\n');
  expect(run, 'cp -r src dst', '');
  assert.equal(sh.fs.readFile('/home/worker/dst/src/deep/f'), 'y\n');
  expect(run, 'cp nope x', '', "cp: cannot stat 'nope': No such file or directory\n");
  expect(run, 'cp a a', '', "cp: 'a' and 'a' are the same file\n");
  expect(run, 'cp -r src src/deep', '', "cp: cannot copy a directory, 'src', into itself, 'src/deep/src'\n");
  expect(run, 'cp a nodir/x', '', "cp: cannot create regular file 'nodir/x': No such file or directory\n");
  expect(run, 'cp', '', "cp: missing file operand\nTry 'cp --help' for more information.\n");
});

test('chmod: octal, symbolic, errors', () => {
  const { sh, run } = newShell();
  run('touch run.sh; mkdir d');
  expect(run, 'chmod 755 run.sh', '');
  assert.equal(sh.fs.stat('/home/worker/run.sh')?.mode, 0o755);
  expect(run, 'chmod 600 run.sh', '');
  assert.equal(sh.fs.stat('/home/worker/run.sh')?.mode, 0o600);
  expect(run, 'chmod +x run.sh', '');
  assert.equal(sh.fs.stat('/home/worker/run.sh')?.mode, 0o711);
  expect(run, 'chmod u-x,go=r run.sh', '');
  assert.equal(sh.fs.stat('/home/worker/run.sh')?.mode, 0o644);
  expect(run, 'chmod -R 700 d', '');
  assert.equal(sh.fs.stat('/home/worker/d')?.mode, 0o700);
  expect(run, 'chmod 999 run.sh', '', "chmod: invalid mode: ‘999’\nTry 'chmod --help' for more information.\n");
  expect(run, 'chmod 755', '', "chmod: missing operand after ‘755’\nTry 'chmod --help' for more information.\n");
  expect(run, 'chmod', '', "chmod: missing operand\nTry 'chmod --help' for more information.\n");
  expect(run, 'chmod 755 nope', '', "chmod: cannot access 'nope': No such file or directory\n");
});

test('head and tail: default 10, -n, -N, +N, errors', () => {
  const { run } = newShell();
  run('printf "%s\\n" 1 2 3 4 5 6 7 8 9 10 11 12 > n');
  expect(run, 'head n', '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
  expect(run, 'head -n 2 n', '1\n2\n');
  expect(run, 'head -3 n', '1\n2\n3\n');
  expect(run, 'tail n', '3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n');
  expect(run, 'tail -n 2 n', '11\n12\n');
  expect(run, 'tail -n +11 n', '11\n12\n');
  expect(run, 'cat n | tail -1', '12\n');
  run('echo a > m');
  expect(run, 'head -n 1 m n', '==> m <==\na\n\n==> n <==\n1\n');
  expect(run, 'head nope', '', "head: cannot open 'nope' for reading: No such file or directory\n");
  expect(run, 'tail nope', '', "tail: cannot open 'nope' for reading: No such file or directory\n");
  expect(run, 'head -n abc n', '', 'head: invalid number of lines: ‘abc’\n');
  run('mkdir d');
  expect(run, 'head d', '', "head: error reading 'd': Is a directory\n");
});

test('wc: -l, -w, -c, defaults, formatting, errors', () => {
  const { run } = newShell();
  run('echo "hello big world" > f; echo two > g');
  expect(run, 'wc -l f', '1 f\n');
  expect(run, 'wc -w f', '3 f\n');
  expect(run, 'wc -c f', '16 f\n');
  expect(run, 'wc f', ' 1  3 16 f\n');
  expect(run, 'cat f | wc -w', '3\n');
  expect(run, 'cat f | wc', '      1       3      16\n');
  expect(run, 'wc -l f g', ' 1 f\n 1 g\n 2 total\n');
  expect(run, 'wc nope', '', 'wc: nope: No such file or directory\n');
  expect(run, 'echo "привет" | wc -c', '13\n');
});

test('grep: plain, -i, -n, -v, -r, regex, errors', () => {
  const { run } = newShell();
  run('printf "apple\\nBanana\\ncherry\\nbanana split\\n" > fruit; mkdir -p d/e; echo "a banana" > d/e/x; echo none > d/y');
  expect(run, 'grep banana fruit', 'banana split\n');
  expect(run, 'grep -i banana fruit', 'Banana\nbanana split\n');
  expect(run, 'grep -n an fruit', '2:Banana\n4:banana split\n');
  expect(run, 'grep -v an fruit', 'apple\ncherry\n');
  expect(run, 'grep -c an fruit', '2\n');
  expect(run, 'grep "^b.*t$" fruit', 'banana split\n');
  expect(run, 'grep -E "^(apple|cherry)$" fruit', 'apple\ncherry\n');
  expect(run, 'grep "a(" fruit', '', '', 1);
  expect(run, 'grep -r banana d', 'd/e/x:a banana\n');
  expect(run, 'grep -rl banana .', './d/e/x\n./fruit\n');
  expect(run, 'cat fruit | grep -in BANANA', '2:Banana\n4:banana split\n');
  expect(run, 'grep kiwi fruit', '', '', 1);
  expect(run, 'grep x nope', '', 'grep: nope: No such file or directory\n', 2);
  expect(run, 'grep x d', '', 'grep: d: Is a directory\n', 2);
  expect(run, 'grep -E "a(" fruit', '', 'grep: Unmatched ( or \\(\n', 2);
  expect(run, 'grep', '', "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n", 2);
});

test('find: all, -name, -type, errors', () => {
  const { run } = newShell();
  run('mkdir -p src/lib; touch src/a.ts src/lib/b.ts README.md');
  expect(run, 'find', '.\n./README.md\n./src\n./src/a.ts\n./src/lib\n./src/lib/b.ts\n');
  expect(run, 'find . -name "*.ts"', './src/a.ts\n./src/lib/b.ts\n');
  expect(run, 'find src -type d', 'src\nsrc/lib\n');
  expect(run, 'find . -type f -name "*.md"', './README.md\n');
  expect(run, 'find . -maxdepth 1 -type d', '.\n./src\n');
  expect(run, 'find nope', '', 'find: ‘nope’: No such file or directory\n');
  expect(run, 'find . -foo', '', "find: unknown predicate `-foo'\n");
  expect(run, 'find . -type z', '', 'find: Unknown argument to -type: z\n');
  expect(run, 'find . -name', '', "find: missing argument to `-name'\n");
});

test('tree', () => {
  const { run } = newShell();
  run('mkdir -p a/b; touch a/b/c a/d e');
  expect(run, 'tree', '.\n├── a\n│   ├── b\n│   │   └── c\n│   └── d\n└── e\n\n2 directories, 3 files\n');
  expect(run, 'tree a/b', 'a/b\n└── c\n\n0 directories, 1 file\n');
  expect(run, 'tree nope', 'nope  [error opening dir]\n\n0 directories, 0 files\n', '', 2);
});

test('stat', () => {
  const { run } = newShell();
  run('echo hi > f; chmod 755 f');
  const out = run('stat f').stdout;
  assert.match(out, /^ {2}File: f\n/);
  assert.match(out, /Size: 3 .*regular file/);
  assert.match(out, /Access: \(0755\/-rwxr-xr-x\) {2}Uid: \( 1000\/ {2}worker\)/);
  assert.match(out, /Modify: 2026-11-11 10:49:00\.000000000 \+0000/);
  assert.match(run('stat .').stdout, /directory/);
  expect(run, 'stat nope', '', "stat: cannot statx 'nope': No such file or directory\n");
});

test('whoami, date, help', () => {
  const { run } = newShell();
  expect(run, 'whoami', 'worker\n');
  expect(run, 'date', 'Wed Nov 11 10:49:00 UTC 2026\n');
  expect(run, 'date +%Y-%m-%d', '2026-11-11\n');
  const help = run('help').stdout;
  for (const c of ['pwd', 'cd', 'ls', 'mkdir', 'grep', 'find', 'tree', 'chmod', 'nano', 'clear']) assert.match(help, new RegExp(`\\b${c}\\b`));
});

test('clear returns the clear action', () => {
  const { run } = newShell();
  assert.deepEqual(run('clear'), { stdout: '', stderr: '', exitCode: 0, action: { type: 'clear' } });
});

test('nano / edit / vi return the edit action and do not create the file', () => {
  const { sh, run } = newShell();
  run('mkdir notes');
  for (const ed of ['nano', 'edit', 'vi']) {
    const r = run(`${ed} notes/todo.txt`);
    assert.deepEqual(r, { stdout: '', stderr: '', exitCode: 0, action: { type: 'edit', path: '/home/worker/notes/todo.txt' } });
  }
  assert.equal(sh.fs.stat('/home/worker/notes/todo.txt'), null);
  expect(run, 'nano', '', 'nano: missing file operand\n');
  expect(run, 'nano notes', '', 'nano: notes: Is a directory\n');
  expect(run, 'vi nope/x', '', 'vi: nope/x: No such file or directory\n');
  assert.equal(run('nano ~/a.txt').action?.type, 'edit');
});

test('sort and uniq', () => {
  const { run } = newShell();
  run('printf "b\\na\\nc\\na\\n" > l');
  expect(run, 'sort l', 'a\na\nb\nc\n');
  expect(run, 'sort -r l', 'c\nb\na\na\n');
  expect(run, 'sort -u l', 'a\nb\nc\n');
  expect(run, 'sort l | uniq -c', '      2 a\n      1 b\n      1 c\n');
  expect(run, 'printf "10\\n9\\n100\\n" | sort -n', '9\n10\n100\n');
  expect(run, 'sort nope', '', 'sort: cannot read: nope: No such file or directory\n', 2);
});

test('unknown command', () => {
  const { run } = newShell();
  expect(run, 'frobnicate --now', '', 'bash: frobnicate: command not found\n', 127);
  expect(run, 'apt install cowsay', '', 'bash: apt: command not found\n', 127);
  expect(run, 'sudo ls', '', 'worker is not in the sudoers file.  This incident will be reported.\n', 1);
});

test('--help prints usage', () => {
  const { run } = newShell();
  const r = run('ls --help');
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage: ls/);
});

test('home is a volume: rm -rf empties it but cannot remove it, so mkdir keeps working', () => {
  const { sh, run } = newShell();
  run('mkdir -p build/out && touch build/out/a.js notes.txt');
  const busy = "rm: cannot remove '/home/worker': Device or resource busy\n";
  expect(run, 'rm -rf ~', '', busy);
  assert.deepEqual(sh.fs.list('/home/worker'), []);
  expect(run, 'mkdir foo', '');
  assert.equal(sh.fs.stat('/home/worker/foo')?.type, 'dir');

  run('touch x');
  expect(run, 'cd .. && rm -rf /home', '', busy);
  assert.deepEqual(sh.fs.list('/home/worker'), []);
  expect(run, 'rmdir /home/worker', '', "rmdir: failed to remove '/home/worker': Device or resource busy\n");
  expect(run, 'mv /home/worker /tmp-worker', '', "mv: cannot move '/home/worker' to '/tmp-worker': Device or resource busy\n");
  expect(run, 'cd ~ && mkdir again', '');
});

test('rm -rf --no-preserve-root / takes everything but the mounted home, which it empties', () => {
  const { sh, run } = newShell();
  run('mkdir -p /srv/app /home/worker/project && touch /srv/app/x /home/worker/a');
  assert.match(run('rm -rf /').stderr, /dangerous to operate recursively/);
  const r = run('rm -rf --no-preserve-root /');
  assert.deepEqual([r.stderr, r.exitCode], ["rm: cannot remove '/home/worker': Device or resource busy\n", 1]);
  // System directories survive; nothing a player made does.
  assert.deepEqual(sh.fs.list('/').map((e) => e.path), ['/bin', '/dev', '/home', '/proc', '/usr']);
  assert.deepEqual(sh.fs.list('/usr').map((e) => e.path), ['/usr/bin']);
  assert.deepEqual(sh.fs.list('/home/worker'), []);
  assert.match(run('rm -rf -no-preserve-root /').stderr, /invalid option -- 'n'/);
});
