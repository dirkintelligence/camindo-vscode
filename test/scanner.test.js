// Scanner (scanner.js) against the rules of the template compiler: quotes with
// backslash escapes, {…} blocks, PHP parts only in double quotes and bare tokens.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { scanAll, scanCommand, usedKeys, choices } = require('../scanner');

const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.cms.php'), 'utf8');
const slice = (text, c) => text.slice(c.start, c.end);

test('finds every command, also inside attributes and PHP comments', () => {
    const names = scanAll(sample).map(c => c.name);
    assert.deepStrictEqual(names, ['text', 'url', 'text', 'text', 'date', 'select']);
});

test(') inside quotes does not end a command', () => {
    const select = scanAll(sample).find(c => c.name === 'select');
    assert.match(slice(sample, select), /\$cms->title"\n\)$/);
});

test('PHP parts: {$…} and $var->x in double quotes, not in single quotes', () => {
    const cmds = scanAll(sample);
    const php = cmds.flatMap(c => c.php.map(([s, e]) => sample.slice(s, e)));
    assert.deepStrictEqual(php, ["{$this->cms->snippet('custom.x')}", '$cms->title']);
});

test('keys of a command', () => {
    const select = scanAll(sample).find(c => c.name === 'select');
    assert.deepStrictEqual([...usedKeys(select.masked)].sort(), ['filter', 'noresult', 'set']);
});

test('unterminated command: state at the cursor', () => {
    const text = '(CMS:SELECT liste filter[a]="x';
    const state = scanCommand(text, 0, text.length);
    assert.strictEqual(state.end, -1);
    assert.strictEqual(state.name, 'select');
    assert.strictEqual(state.quote, '"');
    assert.strictEqual(scanAll(text).length, 0);
});

test('fixed choices of a value hint', () => {
    assert.deepStrictEqual(choices('true / false'), ['true', 'false']);
    assert.deepStrictEqual(choices('desc / asc'), ['desc', 'asc']);
    assert.deepStrictEqual(choices('Feldname(n), kommasepariert'), []);
});
