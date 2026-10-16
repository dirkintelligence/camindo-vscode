// Shipped data: one command file per backend language with the same commands and
// parameters, and the texts of the extension (l10n.js) complete in every language.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { TEXTS, LANGUAGES, resolveLanguage, t } = require('../l10n');

const load = lang => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `commands.${lang}.json`), 'utf8'));

test('a command file per language with the same commands and parameters', () => {
    const en = load('en_US');
    const shape = data => Object.entries(data.commands).map(([n, c]) => n + ':' + Object.keys(c.params).join(','));
    for (const lang of LANGUAGES) {
        const data = load(lang);
        assert.strictEqual(data.lang, lang);
        assert.strictEqual(data.version, en.version, lang);
        assert.deepStrictEqual(shape(data), shape(en), lang);
        for (const [name, cmd] of Object.entries(data.commands)) {
            assert.ok(!cmd.note.startsWith('#'), `${lang} ${name}: unresolved snippet ${cmd.note}`);
        }
    }
});

test('texts of the extension complete in every language', () => {
    const keys = Object.keys(TEXTS.en_US).sort();
    for (const lang of LANGUAGES) assert.deepStrictEqual(Object.keys(TEXTS[lang]).sort(), keys, lang);
    assert.strictEqual(t('de_DE', 'loaded', 62), '62 Befehle geladen.');
});

test('language: setting first, then the VS Code display language, else English', () => {
    assert.strictEqual(resolveLanguage('ja_JP', 'de'), 'ja_JP');
    assert.strictEqual(resolveLanguage('', 'pt-br'), 'pt_BR');
    assert.strictEqual(resolveLanguage('', 'zh-cn'), 'zh_CN');
    assert.strictEqual(resolveLanguage('', 'it'), 'en_US');
});
