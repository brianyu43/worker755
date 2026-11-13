// What a Linux user expects beyond files: sed, awk, find's actions, archives, the system around the home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShell } from '../src/index.ts';
import { newShell, NOW } from './helpers.ts';

type Run = (l: string) => { stdout: string; stderr: string; exitCode: number };

function expect(run: Run, line: string, stdout: string, stderr = '', exitCode = stderr ? 1 : 0) {
  const r = run(line);
  assert.equal(r.stdout, stdout, `stdout of: ${line}`);
  assert.equal(r.stderr, stderr, `stderr of: ${line}`);
  assert.equal(r.exitCode, exitCode, `exit code of: ${line}`);
}

const PEOPLE = "printf 'alice 30 NY\\nbob 25 LA\\ncarol 35 NY\\n' > people; printf 'one\\ntwo\\nthree\\n' > n";

test('sed: substitutions, addresses, ranges, hold space, in place', () => {
  const { run } = newShell();
  run(PEOPLE);
  expect(run, "sed 's/o/0/g' n", '0ne\ntw0\nthree\n');
  expect(run, "sed -n '2p' n", 'two\n');
  expect(run, "sed '$d' n", 'one\ntwo\n');
  expect(run, "sed -n '/one/,/two/p' n", 'one\ntwo\n');
  expect(run, "sed -E 's/(o)(n)/\\2\\1/' n", 'noe\ntwo\nthree\n');
  expect(run, "sed 's/\\(t\\)\\(w\\)/[\\2\\1]/' n", 'one\n[wt]o\nthree\n');
  expect(run, "sed 's/.*/\\U&/' n", 'ONE\nTWO\nTHREE\n');
  expect(run, "sed '1!G;h;$!d' n", 'three\ntwo\none\n');
  expect(run, "sed ':a;N;$!ba;s/\\n/+/g' n", 'one+two+three\n');
  expect(run, "sed -n '/e/{p;p}' n", 'one\none\nthree\nthree\n');
  expect(run, "sed '2i\\\nbefore' n", 'one\nbefore\ntwo\nthree\n');
  expect(run, "sed '2a after' n", 'one\ntwo\nafter\nthree\n');
  expect(run, "sed '=' n | head -2", '1\none\n');
  expect(run, "sed 'y/ot/OT/' n", 'One\nTwO\nThree\n');
  expect(run, "sed 2q n", 'one\ntwo\n');
  expect(run, "sed -i.bak 's/one/ONE/' n && cat n n.bak", 'ONE\ntwo\nthree\none\ntwo\nthree\n');
  expect(run, "echo abc | sed 's/b/\\n/'", 'a\nc\n');
  expect(run, "sed 's/x/' n", '', "sed: -e expression #1, char 5: unterminated `s' command\n");
  expect(run, 'sed p nope', '', "sed: can't read nope: No such file or directory\n", 2);
  expect(run, "sed 'bfoo' n", '', "sed: -e expression #1, char 0: can't find label for jump to `foo'\n");
});

test('awk: fields, patterns, arrays, functions, printf, getline', () => {
  const { run } = newShell();
  run(PEOPLE);
  expect(run, "awk '{print $1}' people", 'alice\nbob\ncarol\n');
  expect(run, "awk '$2 > 28 {print $1, $NF}' people", 'alice NY\ncarol NY\n');
  expect(run, "awk '{s += $2} END {print s, s/NR}' people", '90 30\n');
  expect(run, "awk '$3 == \"NY\" {n++} END {print n}' people", '2\n');
  expect(run, "awk '!seen[$3]++ {print $3}' people", 'NY\nLA\n');
  expect(run, "awk -F, -v OFS=- '{$1=$1; print}' <<< 'a,b,c'", 'a-b-c\n');
  expect(run, "awk 'BEGIN{printf \"%5.2f|%-4s|%03d|%x|%c\\n\", 3.14159, \"ab\", 7, 255, 65}'", ' 3.14|ab  |007|ff|A\n');
  expect(run, "awk 'BEGIN{print 1/3, 2^10, -2^2, int(-3.7), 7%3, 1e6}'", '0.333333 1024 -4 -3 1 1000000\n');
  expect(run, "awk 'BEGIN{x=\"hello\"; gsub(/l/,\"L\",x); print x, length(x), substr(x,2,3), index(x,\"o\"), toupper(x)}'", 'heLLo 5 eLL 5 HELLO\n');
  expect(run, "awk 'BEGIN{n=split(\"a:b:c\",p,\":\"); print n, p[3]; if (match(\"foobar\",/ob+/)) print RSTART, RLENGTH}'", '3 c\n3 2\n');
  expect(run, "awk 'function f(x){return x*2} {print f($2)}' people", '60\n50\n70\n');
  expect(run, "awk 'function fill(a){a[1]=\"x\"} BEGIN{fill(arr); print arr[1]}'", 'x\n');
  expect(run, "awk 'NR==1{next} {print NR\": \"$1}' people", '2: bob\n3: carol\n');
  expect(run, "awk '/bob/,/carol/' people", 'bob 25 LA\ncarol 35 NY\n');
  expect(run, "awk '{NF=2; print}' people | head -1", 'alice 30\n');
  expect(run, "awk '{print $1 > \"names\"} END{close(\"names\"); while ((getline l < \"names\") > 0) print \"got\", l}' people", 'got alice\ngot bob\ngot carol\n');
  expect(run, "awk 'BEGIN{while ((\"cat n\" | getline line) > 0) print \"<\" line \">\"}'", '<one>\n<two>\n<three>\n');
  expect(run, "awk '{print $2 | \"sort -rn\"}' people", '35\n30\n25\n');
  expect(run, "awk 'BEGIN{exit 3} END{print \"end\"}'", 'end\n', '', 3);
  expect(run, "awk 'BEGIN{RS=\"\"}{print NR, NF}' <<< $'a b\\n\\nc'", '1 2\n2 1\n');
  expect(run, "awk '{print ENVIRON[\"HOME\"]; exit}' people", '/home/worker\n');
  expect(run, "awk 'BEGIN{x[\"a\",\"b\"]=1; for (k in x) {split(k,p,SUBSEP); print p[1] p[2]}}'", 'ab\n');
  expect(run, "awk '{' people", '', 'awk: cmd. line:1: syntax error at source line 1 near end of program\n', 2);
  expect(run, "awk 'BEGIN{print 1/0}'", '', 'awk: cmd. line:1: fatal: division by zero attempted\n', 2);
});

test('awk and sed cannot run away', () => {
  const sh = createShell({ now: () => NOW, timeLimitMs: 300 });
  let t = Date.now();
  let r = sh.exec("awk 'BEGIN{while(1) x++}'");
  assert.match(r.stderr, /stopped/);
  assert.ok(Date.now() - t < 3000);
  r = sh.exec("awk 'BEGIN{s=\"x\"; while(1) s = s s}'");
  assert.match(r.stderr, /string too long|stopped/);
  r = sh.exec("awk 'BEGIN{while(1) a[i++]=1}'");
  assert.match(r.stderr, /too many array elements|stopped/);
  r = sh.exec("awk 'function f(n){return f(n+1)} BEGIN{f(1)}'");
  assert.match(r.stderr, /nesting too deep|nested too deeply/);
  t = Date.now();
  r = sh.exec("echo x | sed ':a;s/x/xx/;ba'");
  assert.notEqual(r.exitCode, 0);
  assert.ok(Date.now() - t < 3000);
});

test('find: operators, actions, tests', () => {
  const { run } = newShell();
  run('mkdir -p d/e; echo hi > d/a.txt; echo x > d/e/b.txt; touch d/empty; chmod 755 d/a.txt');
  expect(run, "find d -name '*.txt' -o -name empty", 'd/a.txt\nd/e/b.txt\nd/empty\n');
  expect(run, "find d \\( -name '*.txt' -a ! -path '*/e/*' \\)", 'd/a.txt\n');
  expect(run, 'find d -type f -empty', 'd/empty\n');
  expect(run, 'find d -perm -100 -type f', 'd/a.txt\n');
  expect(run, 'find d -size -1k -type f', 'd/empty\n');
  expect(run, "find d -name '*.txt' -exec cat {} \\;", 'hi\nx\n');
  expect(run, "find d -name '*.txt' -exec echo {} +", 'd/a.txt d/e/b.txt\n');
  expect(run, "find d -name '*.txt' -printf '%f %s\\n'", 'a.txt 3\nb.txt 2\n');
  expect(run, 'find d -name e -prune -o -type f -print', 'd/a.txt\nd/empty\n');
  expect(run, "find d -name '*.txt' -delete && find d", 'd\nd/e\nd/empty\n');
  expect(run, 'find d -maxdepth 0', 'd\n');
  expect(run, 'find d -bogus', '', "find: unknown predicate `-bogus'\n");
  expect(run, 'find d -exec echo', '', "find: missing argument to `-exec'\n");
});

test('tar and gzip round-trip files, modes and directories', () => {
  const { run } = newShell();
  run('mkdir -p proj/src; echo "print(1)" > proj/src/main.py; chmod 700 proj/src/main.py; seq 2000 > proj/nums');
  expect(run, 'tar czf proj.tgz proj && file proj.tgz', 'proj.tgz: gzip compressed data, from Unix\n');
  expect(run, 'tar tzf proj.tgz', 'proj/\nproj/nums\nproj/src/\nproj/src/main.py\n');
  expect(run, 'mkdir out && tar xzf proj.tgz -C out && cat out/proj/src/main.py && stat -c %a out/proj/src/main.py', 'print(1)\n700\n');
  expect(run, 'cmp proj/nums out/proj/nums && echo same', 'same\n');
  expect(run, 'tar xOf proj.tgz proj/src/main.py', 'print(1)\n');
  expect(run, 'gzip proj/nums && ls proj', 'nums.gz  src\n');
  const size = Number(run('stat -c %s proj/nums.gz').stdout);
  assert.ok(size < 8893, `compressed ${size} bytes`);
  expect(run, 'zcat proj/nums.gz | tail -1', '2000\n');
  expect(run, 'gunzip proj/nums.gz && wc -l < proj/nums', '2000\n');
  expect(run, 'echo hello | gzip | gunzip', 'hello\n');
  expect(run, 'gunzip proj/nums', '', 'gunzip: proj/nums: unknown suffix -- ignored\n', 2);
  expect(run, 'tar cf x.tar', '', "tar: Cowardly refusing to create an empty archive\nTry 'tar --help' or 'tar --usage' for more information.\n", 2);
  expect(run, 'echo junk > j.tar; tar tf j.tar', '', 'tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n', 2);
});

test('the machine: /dev, /proc, /etc, identity, processes, disks', () => {
  const { run } = newShell();
  expect(run, 'echo hi > /dev/null; cat /dev/null; echo $?', '0\n');
  expect(run, 'head -c 4 /dev/zero | od -An -c', '  \\0  \\0  \\0  \\0\n');
  expect(run, 'head -c 16 /dev/urandom | wc -c', '16\n');
  expect(run, 'echo x > /dev/full', '', 'bash: /dev/full: No space left on device\n');
  expect(run, 'cat /etc/hostname; grep ^worker /etc/passwd', '755\nworker:x:1000:1000:worker:/home/worker:/bin/bash\n');
  expect(run, 'grep -c processor /proc/cpuinfo; cat /proc/sys/kernel/hostname', '2\n755\n');
  expect(run, 'uname -sr; hostname; whoami; id', 'Linux 6.8.0-49-generic\n755\nworker\nuid=1000(worker) gid=1000(worker) groups=1000(worker)\n');
  expect(run, 'echo $$; ps | tail -n +2 | wc -l', '4242\n2\n');
  expect(run, 'kill $$; echo $?', '0\n');
  expect(run, 'kill 1', '', 'bash: kill: (1) - Operation not permitted\n');
  expect(run, 'kill -l 9', 'KILL\n');
  expect(run, 'rm /dev/null', '', "rm: cannot remove '/dev/null': Permission denied\n");
  expect(run, 'touch /proc/x', '', "touch: cannot touch '/proc/x': Permission denied\n");
  expect(run, 'ls -l /etc/hostname | cut -d" " -f3', 'root\n');
  expect(run, 'touch mine; ls -l mine | cut -d" " -f3', 'worker\n');
  expect(run, 'df -h ~ | tail -1', '/dev/vda1  2.9M 2.0K  2.9M   1% /home/worker\n');
  expect(run, 'mkdir -p d; echo hi > d/f; du -s d', '8\td\n');
  expect(run, 'sudo rm -rf /', '', 'worker is not in the sudoers file.  This incident will be reported.\n');
  expect(run, 'env | grep ^HOME=; env FOO=bar printenv FOO; env -i A=1 env | head -1', 'HOME=/home/worker\nbar\nA=1\n');
  expect(run, 'man ls | head -4', 'LS(1)                            User Commands                    LS(1)\n\nNAME\n       ls - list directory contents\n');
  expect(run, 'man frobnicate', '', 'No manual entry for frobnicate\n', 16);
  expect(run, 'type ls; command -v sed; which awk', 'ls is /usr/bin/ls\n/usr/bin/sed\n/usr/bin/awk\n');
});

test('a function that calls itself forever stops the line with bash\'s message', () => {
  const { run } = newShell();
  const r = run('f() { f; }; f; echo after');
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'bash: f: maximum function nesting level exceeded (100)\n');
  assert.equal(r.exitCode, 1);
});
