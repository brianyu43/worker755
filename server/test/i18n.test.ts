import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES } from '../src/language.ts';
import { en } from '../src/i18n/en.ts';
import { MISSIONS } from '../src/missions.ts';
import { LEGACY_MISSIONS } from '../src/legacy.ts';
import { AREAS, check, filesOnDisk, load, verbatim } from '../scripts/i18n-check.ts';

test('there is one language file per supported language, in the web and on the server', () => {
  for (const area of ['web', 'server'] as const) {
    assert.deepEqual(filesOnDisk(area).sort(), [...LANGUAGES].sort(), `${area} language files`);
  }
  const web = readFileSync(join(AREAS.web, 'index.ts'), 'utf8');
  const list = /export const LANGUAGES = \[([^\]]*)\]/.exec(web)?.[1].match(/'[^']+'/g)?.map((s) => s.slice(1, -1));
  assert.deepEqual(list, [...LANGUAGES], 'the web and the server offer the same languages');
});

test('every mission has its text in the language files, and nothing else is there', () => {
  const ids = [...MISSIONS, ...LEGACY_MISSIONS].map((m) => m.id).sort();
  assert.deepEqual(Object.keys(en.missions).sort(), ids);
});

test('translations keep the keys, placeholders, tags and verbatim text of English', async () => {
  const english = await load('en');
  const all: string[] = [];
  for (const language of LANGUAGES) {
    if (language === 'en') continue;
    const r = await check(language, english);
    all.push(...r.problems.map((p) => `${language} ${p}`));
  }
  assert.deepEqual(all, []);
});

test('paths, quoted file contents and result prefixes count as verbatim', () => {
  assert.deepEqual(verbatim('Create the file /home/worker/hello.txt now.'), ['/home/worker/hello.txt']);
  assert.ok(verbatim('The first line is "Subject: " followed by it.').includes('Subject: '));
  assert.ok(verbatim('told: <q>Subagent did nothing. Write a new instruction.</q>').includes('Subagent did nothing. Write a new instruction.'));
  assert.deepEqual(verbatim('Why does {name} now say "{first_line}"?'), []);
});

// Off in `npm test`: it fails until translators are done. Run it with I18N_CHECK=1 npm test, or see
// one language with npm run i18n:check -- <code>.
test('every language is fully translated', { skip: !process.env.I18N_CHECK && 'set I18N_CHECK=1 to run' }, async () => {
  const english = await load('en');
  const left: string[] = [];
  for (const language of LANGUAGES) {
    if (language === 'en') continue;
    const r = await check(language, english);
    if (!r.untranslated.length) continue;
    left.push(`${language}: ${r.untranslated.length} untranslated`);
    for (const e of r.untranslated) left.push(`  ${e.id}`);
  }
  assert.equal(left.length, 0, `Still identical to English:\n${left.join('\n')}`);
});
