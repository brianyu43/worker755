import test from 'node:test';
import assert from 'node:assert/strict';
import { isLanguage, translate } from '../src/language.ts';
import { systemPrompt } from '../src/manager.ts';

test('language validation accepts exactly the nine supported codes', () => {
  for (const code of ['en', 'es', 'pt-BR', 'fr', 'de', 'ru', 'zh-CN', 'ja', 'hi']) assert.equal(isLanguage(code), true);
  for (const code of ['pt', 'zh', 'de-DE', 'xx', '', null]) assert.equal(isLanguage(code), false);
});

test('scripted mission and director copy is localized and manager setup instructs agent language', () => {
  assert.equal(translate('Backup first', 'de'), 'Erst sichern');
  assert.equal(translate('Is this done yet? I need it in the next few minutes.', 'ja'), 'もう終わりましたか？あと数分で必要です。');
  assert.match(systemPrompt(90, 8, true, '', {}, 'Hindi'), /every instruction.*Hindi/);
});
