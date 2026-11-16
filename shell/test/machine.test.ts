// The toys (cowsay, fortune, figlet, neofetch, sl, cmatrix, lolcat), restarting the machine, and the
// ways to destroy it: fork bombs, writing over the disk, and rebooting after `rm -rf /`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newShell } from './helpers.ts';

type Run = (l: string) => { stdout: string; stderr: string; exitCode: number; action?: unknown };

function expect(run: Run, line: string, stdout: string, stderr = '', exitCode = stderr ? 1 : 0) {
  const r = run(line);
  assert.equal(r.stdout, stdout, `stdout of: ${line}`);
  assert.equal(r.stderr, stderr, `stderr of: ${line}`);
  assert.equal(r.exitCode, exitCode, `exit code of: ${line}`);
}

test('cowsay and cowthink: bubble, wrapping, cows, eyes and tongue, stdin', () => {
  const { run } = newShell();
  const r = run('cowsay moo');
  assert.equal(r.stdout.split('\n').slice(0, 4).join('\n'), ' _____\n< moo >\n -----\n  \\');
  assert.match(r.stdout, /\(oo\)/);
  const long = run('cowsay -W 10 one two three four five').stdout.split('\n');
  assert.equal(long[1], '/ one two    \\');
  assert.equal(long[2], '| three four |');
  assert.equal(long[3], '\\ five       /');
  assert.match(run('cowthink hmm').stdout, /^ _____\n\( hmm \)\n -----\n  o\n   o/);
  assert.match(run('cowsay -e XY -T U hi').stdout, /\(XY\)/);
  assert.match(run('cowsay -d dead').stdout, /\(xx\)/);
  assert.match(run('echo from a pipe | cowsay -f tux').stdout, /< from a pipe >[\s\S]*\.-"-\./);
  for (const cow of ['manager', 'worker', 'billosaurus']) assert.equal(run(`cowsay -f ${cow} hi`).exitCode, 0, cow);
  expect(run, 'cowsay -l', 'Cow files in /usr/share/cowsay/cows:\nbillosaurus cow manager tux worker\n');
  expect(run, 'cowsay -f moose hi', '', 'cowsay: Could not find moose cowfile!\n');
});

test('fortune, figlet, banner, neofetch', () => {
  const { run } = newShell();
  const a = run('fortune').stdout;
  const b = run('fortune').stdout;
  assert.match(a, /^.+\n$/);
  assert.notEqual(a, b, 'two in a row differ');
  assert.match(run('fortune | cowsay').stdout, /^ _+\n/);
  expect(run, 'figlet HI', '#  # ###\n#  #  #\n####  #\n#  #  #\n#  # ###\n');
  assert.equal(run('figlet -w 12 AB AB').stdout.split('\n').length, 11, 'wraps to two rows of five lines');
  assert.equal(run('figlet -w 12 AB AB').stdout.split('\n').every((l) => l.length <= 12), true);
  expect(run, 'banner I', '######\n  ##\n  ##\n  ##\n######\n');
  const n = run('neofetch').stdout;
  assert.match(n, /worker@755/);
  assert.match(n, /Kernel: 6\.8\.0-49-generic/);
  assert.match(n, /OS: Ubuntu 24\.04\.1 LTS x86_64/);
  assert.match(n, /Memory: \d+MiB \/ 2000MiB/);
  assert.match(run('fastfetch').stdout, /Uptime: 3 days, 4 hours/);
});

test('sl and cmatrix are animations; sl leaves nothing behind', () => {
  const { run } = newShell();
  const r = run('sl');
  assert.equal(r.stdout, '');
  assert.equal(r.exitCode, 0);
  const a = r.action as { type: string; frames: string[]; frameMs: number; note: string };
  assert.equal(a.type, 'animate');
  assert.ok(a.frames.length > 30);
  assert.ok(a.frames.every((f) => f.split('\n').every((l) => l.length <= 80)), 'frames fit the terminal');
  assert.match(a.frames[Math.floor(a.frames.length / 2)], /W 7 5 5/);
  assert.ok(a.note.length < 80);
  const m = run('cmatrix').action as { type: string; anyKey: boolean; loop: boolean };
  assert.equal(m.type, 'animate');
  assert.equal(m.anyKey, true);
  assert.equal(m.loop, true);
});

test('lolcat colours each character; old jokes', () => {
  const { run } = newShell();
  assert.match(run('echo hi | lolcat').stdout, /^\x1b\[38;5;\d+mh\x1b\[38;5;\d+mi\x1b\[0m\n$/);
  expect(run, 'make me a sandwich', '', "make: *** No rule to make target 'me'.  Stop.\n", 2);
  expect(run, 'sudo make me a sandwich', 'Okay.\n');
  assert.match(run('apt moo').stdout, /Have you mooed today\?/);
  assert.match(run('apt-get moo').stdout, /\(oo\)/);
  assert.equal(run('apt install cowsay').exitCode, 100);
  assert.match(run('help').stdout, /cowsay +configurable speaking cow/);
  assert.match(run('man sl').stdout, /sl - display animations/);
  expect(run, 'whatis reboot', 'reboot          (1)  - Power off, reboot, or halt the machine\n');
});

test('reboot: the shell starts over at home with history kept; sudo may reboot', () => {
  const { sh, run } = newShell();
  run('cd /tmp; X=1; alias ll=ls; f() { :; }; echo keep > /tmp/kept');
  const r = run('reboot');
  assert.deepEqual(r.action, { type: 'power', mode: 'reboot' });
  expect(run, 'pwd; echo "[$X]"; cat /tmp/kept', '/home/worker\n[]\nkeep\n');
  assert.equal(run('type f').exitCode, 1);
  assert.equal(run('alias ll').exitCode, 1);
  assert.ok(sh.history.includes('reboot'), 'history stays');
  assert.deepEqual(run('sudo reboot').action, { type: 'power', mode: 'reboot' });
  assert.deepEqual(run('poweroff').action, { type: 'power', mode: 'poweroff' });
  assert.deepEqual(run('halt').action, { type: 'power', mode: 'poweroff' });
  assert.deepEqual(run('init 6').action, { type: 'power', mode: 'reboot' });
  assert.deepEqual(run('init 0').action, { type: 'power', mode: 'poweroff' });
  assert.deepEqual(run('systemctl reboot').action, { type: 'power', mode: 'reboot' });
  assert.deepEqual(run('sudo systemctl poweroff').action, { type: 'power', mode: 'poweroff' });
  assert.deepEqual(run('shutdown -r now').action, { type: 'power', mode: 'reboot' });
  const later = run('shutdown -h +5');
  assert.deepEqual(later.action, { type: 'power', mode: 'poweroff' });
  assert.match(later.stdout, /Shutdown scheduled for .*\n\nBroadcast message from worker@755 on pts\/0 \(.*\):\n\nThe system will power off now!\n/);
  assert.equal(run('shutdown -k now').action, undefined, '-k only warns');
  assert.equal(run('sudo ls').exitCode, 1, 'sudo still refuses everything else');
});

test('fork bombs destroy the machine; plain recursion still stops with bash\'s message', () => {
  for (const line of [':(){ :|:& };:', ':(){ :|: & };:', 'bomb() { bomb | bomb & }; bomb', 'f(){ f & f; }; f', 'bash -c ":(){ :|:& };:"']) {
    const { run } = newShell();
    const r = run(line);
    assert.deepEqual(r.action, { type: 'destroy', cause: 'forkbomb' }, line);
    assert.match(r.stderr, /^bash: fork: retry: Resource temporarily unavailable\n/, line);
  }
  const { run } = newShell();
  const r = run('f() { f; }; f');
  assert.equal(r.action, undefined);
  assert.equal(r.stderr, 'bash: f: maximum function nesting level exceeded (100)\n');
  const g = run('g() { g | cat; }; echo x | g');
  assert.equal(g.action && (g.action as { cause: string }).cause, 'forkbomb', 'recursion through a pipe forks every time');
});

test('writing to the disk destroys the machine', () => {
  for (const line of ['dd if=/dev/zero of=/dev/sda bs=1M count=10', 'dd if=/dev/urandom of=/dev/sda', 'cat /dev/urandom > /dev/sda', '> /dev/sda', 'mkfs.ext4 /dev/sda1', 'mkfs /dev/sda2', 'shred /dev/sda', 'echo x > /dev/vda1']) {
    const { run } = newShell();
    assert.deepEqual(run(line).action, { type: 'destroy', cause: 'disk' }, line);
  }
  const { run } = newShell();
  assert.equal(run('ls /dev/sda /dev/sda1 /dev/sda2').exitCode, 0);
  assert.equal(run('cat /dev/sda > /dev/null').action, undefined, 'reading is fine');
  expect(run, 'dd if=/dev/zero of=z bs=1K count=3 status=none; wc -c < z', '3072\n');
  assert.equal(run('mkfs.ext4 z').exitCode, 1, 'a file is not a block device');
  expect(run, 'echo secret > s; shred -u s; ls s', '', "ls: cannot access 's': No such file or directory\n", 2);
});

test('after rm -rf /, programs are gone, builtins work, and the next reboot never comes back', () => {
  const { run } = newShell();
  run('rm -rf --no-preserve-root /');
  expect(run, 'ls', '', 'bash: ls: command not found\n', 127);
  expect(run, 'echo still; pwd', 'still\n/home/worker\n');
  assert.deepEqual(run('reboot').action, { type: 'destroy', cause: 'rootfs' });
  const p = newShell();
  p.run('rm -rf --no-preserve-root /');
  assert.deepEqual(p.run('poweroff').action, { type: 'destroy', cause: 'rootfs' });
});
