import test from 'node:test';
import assert from 'node:assert/strict';
import { isLanguage } from '../src/language.ts';
import { directorLine, systemPrompt } from '../src/manager.ts';
import { copyFor, localizeError, missionText } from '../src/i18n/index.ts';
import { en } from '../src/i18n/en.ts';
import { LEGACY_MISSIONS } from '../src/legacy.ts';

test('language validation accepts exactly the nine supported codes', () => {
  for (const code of ['en', 'es', 'pt-BR', 'fr', 'de', 'ru', 'zh-CN', 'ja', 'hi']) assert.equal(isLanguage(code), true);
  for (const code of ['pt', 'zh', 'de-DE', 'xx', '', null]) assert.equal(isLanguage(code), false);
});

test('scripted mission and director copy is localized and manager setup instructs agent language', () => {
  const backup = LEGACY_MISSIONS.find((m) => m.id === 'backup')!;
  assert.equal(missionText(copyFor('de'), backup).title, 'Erst sichern');
  assert.equal(missionText(copyFor('en'), backup).title, 'Backup first');
  assert.equal(directorLine(1, copyFor('ja')), 'もう終わりましたか？あと数分で必要です。');
  assert.match(systemPrompt(90, 8, true, '', {}, 'Hindi'), /every instruction.*Hindi/);
});

test('mission placeholders are filled in every language', () => {
  const migration = LEGACY_MISSIONS.find((m) => m.id === 'migration')!;
  assert.ok(!migration.brief.includes('{today}'));
  assert.ok(migration.brief.includes(migration.vars!.today));
  assert.equal(missionText(copyFor('de'), migration).brief.includes('{today}'), false);
});

test('errors raised in English reach the player in their language', () => {
  const copy = { ...copyFor('de'), errors: { ...copyFor('de').errors, keyRejected: 'Schlüssel abgelehnt.', requestFailedStatus: 'Fehler (HTTP {status})' } };
  assert.equal(localizeError(copy, en.errors.keyRejected), 'Schlüssel abgelehnt.');
  assert.equal(localizeError(copy, 'Manager model request failed (HTTP 503)'), 'Fehler (HTTP 503)');
  assert.equal(localizeError(copy, 'Something else'), 'Something else');
});
