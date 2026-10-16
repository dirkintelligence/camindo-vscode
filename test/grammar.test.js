// Grammar (syntaxes/cms.injection.tmLanguage.json) with the tokenizer of VS Code. The
// injection targets text.html.php - a minimal stand-in grammar with that scope name
// is enough, the real PHP/HTML grammars ship with VS Code and are not needed here.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const tm = require('vscode-textmate');
const onig = require('vscode-oniguruma');

const HOST = { scopeName: 'text.html.php', patterns: [] };
const GRAMMAR = path.join(__dirname, '..', 'syntaxes', 'cms.injection.tmLanguage.json');

async function grammar() {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    const registry = new tm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: p => new onig.OnigScanner(p),
            createOnigString: s => new onig.OnigString(s),
        }),
        loadGrammar: async scope => scope === 'text.html.php' ? HOST
            : scope === 'camindo.cms.injection' ? tm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR)
            : null,
        getInjections: scope => (scope === 'text.html.php' ? ['camindo.cms.injection'] : undefined),
    });
    return registry.loadGrammar('text.html.php');
}

/** [text, innermost scope] per token of the given lines */
async function tokenize(lines) {
    const g = await grammar();
    let stack = tm.INITIAL;
    const out = [];
    for (const line of lines) {
        const r = g.tokenizeLine(line, stack);
        stack = r.ruleStack;
        for (const t of r.tokens) out.push([line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]]);
    }
    return out;
}

const scopeOf = (tokens, text) => (tokens.find(([t]) => t === text) || [])[1];

test('command name, key and operator', async () => {
    const tokens = await tokenize(['(CMS:SELECT liste filter[price] > 100)']);
    assert.strictEqual(scopeOf(tokens, 'SELECT'), 'meta.cms.name');
    assert.strictEqual(scopeOf(tokens, 'filter'), 'meta.cms.key');
    assert.strictEqual(scopeOf(tokens, '>'), 'meta.cms.operator');
    assert.strictEqual(scopeOf(tokens, ')'), 'meta.cms.punctuation.end');
});

test('PHP parts inside double quotes, none inside single quotes', async () => {
    const tokens = await tokenize([`(CMS:TEXT a prefix="{$x['y']}" suffix='$no' set=$cms->title)`]);
    assert.strictEqual(scopeOf(tokens, "$x['y']"), 'meta.cms.php');
    assert.strictEqual(scopeOf(tokens, '$cms->title'), 'meta.cms.php');
    assert.strictEqual(scopeOf(tokens, '$no'), 'meta.cms.string.single');
});

test(') in a string does not end the command; text after it is outside', async () => {
    const tokens = await tokenize(['(CMS:TEXT a ifempty="x) y")<p>after</p>']);
    assert.strictEqual(scopeOf(tokens, 'x) y'), 'meta.cms.string.double');
    assert.strictEqual(scopeOf(tokens, '<p>after</p>'), 'text.html.php');
});

test('multi-line command', async () => {
    const tokens = await tokenize(['(CMS:SELECT', '  liste count=true', ')', 'after']);
    assert.strictEqual(scopeOf(tokens, 'count'), 'meta.cms.key');
    assert.strictEqual(scopeOf(tokens, 'after'), 'text.html.php');
});
