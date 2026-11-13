import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShell } from '../src/shell.ts';
import { PERSONAL_POOLS, SLOTS } from '../src/copy.ts';
import { DAN, INSTALLERS, personalDamage, personalFor, personalLines, preciousFiles, seedPersonal } from '../src/personal.ts';
import { directorSetting } from '../src/director.ts';
import { MISSIONS, snapshotFiles } from '../src/missions.ts';
import { COPY } from '../src/i18n/index.ts';
import { en } from '../src/i18n/en.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function seeded(seed: number) {
  const folder = personalFor(seed);
  const shell = createShell();
  seedPersonal(shell, folder);
  return { folder, shell };
}

test('the same seed draws the same home folder', () => {
  for (const seed of [0, 1, 42, 4294967295]) assert.deepEqual(personalFor(seed), personalFor(seed));
});

test('different seeds draw different folders, and every item in every pool turns up', () => {
  const draws = Array.from({ length: 50 }, (_, i) => JSON.stringify(personalFor(i + 1).picks));
  assert.ok(new Set(draws).size >= 45, `${new Set(draws).size} distinct folders in 50 shifts`);
  assert.notDeepEqual(personalFor(1).picks, personalFor(2).picks);
  const seen = new Set<string>();
  for (let seed = 0; seed < 2000; seed++) for (const [slot, id] of Object.entries(personalFor(seed).picks)) seen.add(`${slot}:${id}`);
  for (const slot of SLOTS) for (const item of PERSONAL_POOLS[slot]) assert.ok(seen.has(`${slot}:${item.id}`), `${slot}:${item.id} never drawn`);
});

test('every pool item has its lines, and one item per slot is in the folder', () => {
  for (const slot of SLOTS) {
    assert.deepEqual(Object.keys(en.damage.personal[slot].items).sort(), PERSONAL_POOLS[slot].map((i) => i.id).sort(), slot);
  }
  const folder = personalFor(3);
  for (const slot of SLOTS) {
    const files = folder.files.filter((f) => f.precious?.watch === slot);
    assert.equal(files.length, 1, slot);
    assert.equal(files[0].precious!.item, folder.picks[slot]);
  }
  const paths = folder.files.map((f) => f.path);
  assert.equal(new Set(paths).size, paths.length, 'no two files share a path');
});

test('the folder starts intact, and losing or overwriting a drawn file sets the user off, in every language', () => {
  for (const seed of [5, 6, 7]) {
    const { folder, shell } = seeded(seed);
    assert.deepEqual(personalDamage(shell.fs, folder), []);
    for (const f of preciousFiles(folder).filter((p) => p.precious!.item)) {
      const path = `${DAN}/${f.path}`;
      shell.exec(`mv '${path}' /home/worker/gone`);
      const lost = personalDamage(shell.fs, folder);
      assert.equal(lost.length, 1);
      const lines = personalLines(f);
      assert.deepEqual(lost[0], { key: `file:${path}`, rank: f.precious!.rank, ref: lines.ref, line: lines.outrage, item: `~dan/${f.path}` });
      assert.ok(lines.outrage.includes(lines.detail) && !/\{\w+\}/.test(lines.outrage), lines.outrage);
      for (const copy of Object.values(COPY)) {
        const [d] = personalDamage(shell.fs, folder, copy);
        assert.ok(d.line && d.ref && !/\{\w+\}/.test(d.line), d.line);
      }
      shell.exec(`mv /home/worker/gone '${path}'`);
      assert.deepEqual(personalDamage(shell.fs, folder), []);
    }
    const speech = folder.files.find((f) => f.precious?.watch === 'speech')!;
    shell.exec(`echo "To the bride." > '${DAN}/${speech.path}'`);
    assert.match(personalDamage(shell.fs, folder)[0].line, /"To the bride\."/);
  }
});

test('the note to agents names the drawn speech, and the director knows what is in the folder', () => {
  const a = personalFor(11);
  const b = personalFor(12);
  assert.notDeepEqual(a.picks, b.picks);
  for (const folder of [a, b]) {
    const note = folder.files.find((f) => f.path === 'README-AGENTS.txt')!.content;
    assert.ok(note.includes(folder.files.find((f) => f.precious?.watch === 'speech')!.path));
    for (const scenario of ['fresh', 'legacy']) {
      const setting = directorSetting(scenario, folder);
      assert.ok(setting.includes(DAN));
      for (const f of preciousFiles(folder)) assert.ok(setting.includes(personalLines(f).ref), `${scenario}: ${f.path}`);
    }
  }
  assert.notEqual(directorSetting('fresh', a), directorSetting('fresh', b));
});

test('the Downloads cleanup works whatever the folder holds', () => {
  const downloads = MISSIONS.find((m) => m.id === 'downloads')!;
  for (let seed = 0; seed < 12; seed++) {
    const { shell } = seeded(seed);
    const start = snapshotFiles(shell.fs);
    assert.equal(downloads.check!(shell.fs, start, ''), false);
    for (const line of downloads.solution) assert.equal(shell.exec(line).exitCode, 0);
    assert.equal(downloads.check!(shell.fs, start, ''), true, `seed ${seed}`);
    const phone = personalFor(seed).files.find((f) => f.precious?.watch === 'phone')!;
    shell.exec(`rm '${DAN}/${phone.path}'`);
    assert.equal(downloads.check!(shell.fs, start, ''), false, 'deleting the photo too fails');
  }
  assert.ok(INSTALLERS.every((n) => /\.(dmg|pkg)$/.test(n)));
});

test('drawing a folder needs nothing from the server', () => {
  // personal.ts and everything it imports must run in a browser too.
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^import (?!type )[^;]*? from '([^']+)';/gm)) {
      const spec = m[1];
      assert.ok(spec.startsWith('.'), `${file} imports ${spec}`);
      if (!spec.endsWith('/shell.ts')) visit(join(dirname(file), spec));
    }
  };
  visit(join(ROOT, 'server', 'src', 'personal.ts'));
});

test('the user is Dan everywhere: no Dana left outside the trailer', () => {
  const hits: string[] = [];
  const skip = new Set(['node_modules', '.git', 'trailer', 'dist']);
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = join(dir, e.name);
      if (p === fileURLToPath(import.meta.url)) continue;
      // Saved reviews are runtime data (gitignored), not the game's text.
      if (p === join(ROOT, 'server', 'data')) continue;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|md|json|html|css|sql|sh|txt)$/.test(e.name)) {
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          // German "danach" is not a name.
          if (/\bdana(?!ch)|Дана|Даны|Дане/i.test(line)) hits.push(`${p.slice(ROOT.length + 1)}:${i + 1}`);
        });
      }
    }
  };
  walk(ROOT);
  assert.deepEqual(hits, []);
});
