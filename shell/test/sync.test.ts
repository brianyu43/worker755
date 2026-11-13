// Two copies of a filesystem kept in step by the changes one of them records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChanges, collectChanges, createShell, loadSnapshot, validateChanges } from '../src/index.ts';

let clock = Date.UTC(2026, 10, 11, 10, 0, 0);
const now = () => (clock += 1000);

test('whatever a command does, the recorded changes rebuild it exactly elsewhere', () => {
  const a = createShell({ now });
  const b = createShell({ now, system: false });
  loadSnapshot(b.fs, a.fs.exportEntries('/'));
  b.installSystem();
  assert.deepEqual(b.fs.exportEntries('/'), a.fs.exportEntries('/'));
  a.fs.record();
  const lines = [
    'mkdir -p proj/src/deep && echo one > proj/a && echo two > proj/src/b',
    'cp -r proj copy && mv copy/src copy/moved && chmod 700 copy/a',
    'touch proj/a; seq 100 > nums; sed -i "s/1/one/" nums',
    'tar czf p.tgz proj && rm -rf proj && mkdir proj && tar xzf p.tgz',
    'rm copy/a; rmdir copy/moved/deep; mv nums /tmp/nums; echo x >> /tmp/nums',
    'mkdir -p /var/tmp/w && cd /var/tmp/w && echo hi > f && cd ~',
    'rm -rf copy; mkdir copy; echo file > copy/x; rm -r copy; echo now-a-file > copy',
    'find . -name b -delete; awk "{print}" /etc/hostname > host.txt',
    'chmod -R go-rwx proj; touch -d 2020-01-01 host.txt 2>/dev/null; true',
  ];
  for (const line of lines) {
    a.exec(line);
    const changes = validateChanges(JSON.parse(JSON.stringify(collectChanges(a.fs))));
    applyChanges(b.fs, changes);
    assert.deepEqual(b.fs.exportEntries('/'), a.fs.exportEntries('/'), line);
  }
});

test('system files are never part of the changes, and a reloaded copy has them again', () => {
  const a = createShell({ now });
  a.fs.record();
  a.exec('echo x > /dev/null; cat /proc/meminfo > mem; ls /bin > /dev/null');
  const changes = collectChanges(a.fs);
  assert.ok(changes.every((c) => !/^\/(dev|proc|bin|usr\/bin)(\/|$)/.test(c.path)));
  assert.deepEqual(changes.map((c) => c.path), ['/home/worker', '/home/worker/mem']);
  const entries = a.fs.exportEntries('/');
  assert.ok(entries.every((e) => !/^\/(dev|proc|bin|usr\/bin)(\/|$)/.test(e.path)));
  const b = createShell({ now, system: false });
  loadSnapshot(b.fs, entries);
  b.installSystem();
  assert.equal(b.exec('ls /dev/null /bin/ls; cat mem | head -1').stdout, '/bin/ls  /dev/null\nMemTotal:       2048000 kB\n');
});
