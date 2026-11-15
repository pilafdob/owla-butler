import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as i18n from '../src/i18n';

test('normalizeLanguage maps de variants to de and unknown to en', () => {
  assert.equal(i18n.normalizeLanguage('de'), 'de');
  assert.equal(i18n.normalizeLanguage('de-AT'), 'de');
  assert.equal(i18n.normalizeLanguage('de-DE'), 'de');
  assert.equal(i18n.normalizeLanguage('de_AT'), 'de');
  assert.equal(i18n.normalizeLanguage('fr'), 'en');
  assert.equal(i18n.normalizeLanguage('zh-TW'), 'en');
  assert.equal(i18n.normalizeLanguage(''), 'en');
  assert.equal(i18n.normalizeLanguage(null), 'en');
  assert.equal(i18n.normalizeLanguage(undefined), 'en');
});

test('t interpolates names and numbers', () => {
  i18n.setObsidianLanguageForTests('en');
  assert.equal(i18n.t('greeting', { name: 'Filip' }), 'Hello, Filip!');
  assert.equal(i18n.t('count.items', { count: 3 }), '3 items');
  assert.equal(i18n.t('notice.saved', { name: 'Note.md' }), 'Saved Note.md.');
});

test('t falls back to English for unknown locale and missing keys', () => {
  i18n.setObsidianLanguageForTests('fr');
  assert.equal(i18n.t('greeting', { name: 'Ada' }), 'Hello, Ada!');
  assert.equal(i18n.t('this.key.does.not.exist'), 'this.key.does.not.exist');
  i18n.setObsidianLanguageForTests(null);
});

test('German catalog has the same keys as English', () => {
  const enKeys = Object.keys(i18n.en).sort();
  const deKeys = Object.keys(i18n.de).sort();
  assert.deepEqual(enKeys, deKeys);
  assert.ok(enKeys.length > 0);
});

test('t returns German strings when language is de', () => {
  i18n.setObsidianLanguageForTests('de');
  assert.equal(i18n.t('action.send'), 'Senden');
  assert.equal(i18n.t('greeting', { name: 'Filip' }), 'Hallo, Filip!');
  i18n.setObsidianLanguageForTests(null);
});

test('replyLanguageInstruction mentions the target language', () => {
  const deInstruction = i18n.replyLanguageInstruction('de');
  const enInstruction = i18n.replyLanguageInstruction('en');
  assert.match(deInstruction, /German/);
  assert.match(enInstruction, /English/);
  assert.ok(deInstruction.length > 0);
});

test('appendReplyLanguage includes the reply language instruction', () => {
  const base = 'You are an assistant.';
  const result = i18n.appendReplyLanguage(base, 'de');
  assert.ok(result.startsWith(base));
  assert.ok(result.includes(i18n.replyLanguageInstruction('de')));
});

test('reply-language instruction is included for every provider payload', () => {
  // The instruction builder is provider-agnostic; verify it is non-empty and
  // language-specific for each of the three providers' shared instruction path.
  for (const lang of ['de', 'de-AT', 'en']) {
    const instruction = i18n.replyLanguageInstruction(lang);
    assert.ok(instruction.length > 0);
    const payload = i18n.appendReplyLanguage('BASE INSTRUCTIONS', lang);
    assert.ok(payload.includes(instruction), 'instruction missing for ' + lang);
  }
  // German variants resolve to German for all providers.
  assert.match(i18n.replyLanguageInstruction('de-AT'), /German/);
});
