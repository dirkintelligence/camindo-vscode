// Syntax check (lint.js) against the rules of the template compiler, plus the hints for
// a missing ")" or a stray quote - and fast enough for checking while typing.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { lint } = require('../lint');

const commands = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'commands.en_US.json'), 'utf8')).commands;
const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.cms.php'), 'utf8');

/** [code, marked text] of every message */
const check = (text, defs = commands) => lint(text, defs).map(d => [d.code, text.slice(d.start, d.end)]);
const codes = text => lint(text, commands).map(d => d.code);

test('correct commands: no message', () => {
    assert.deepStrictEqual(check(sample.split('\n').slice(1).join('\n')), []);
    assert.deepStrictEqual(check('(CMS:TEXT title specialchars=true prefix="<b>" suffix=</b>)'), []);
    assert.deepStrictEqual(check('(CMS:SELECT list filter[price] >= 100 filter[title] != "x" sort=title)'), []);
    assert.deepStrictEqual(check('(CMS:TEXT {$name} {$key}=x)'), []);   // dynamic: not checkable
});

test('missing ) before the next command', () => {
    const text = `<h2 class="h4">(CMS:TEXT icon
  prefix='<span class="icon" aria-hidden="true">'
  suffix='</span> '
(CMS:TEXT title)</h2></p>`;
    assert.deepStrictEqual(check(text), [['missingParenCmd', '(CMS:TEXT']]);
    // the inner command is checked on its own
    assert.deepStrictEqual(check('(CMS:TEXT icon (CMS:TEXT title titel=x)'),
        [['missingParenCmd', '(CMS:TEXT'], ['unknownParam', 'titel']]);
});

test('missing ) before HTML', () => {
    assert.deepStrictEqual(check('<h2>(CMS:TEXT title</h2>\n<p>x</p>'), [['missingParenHtml', '(CMS:TEXT']]);
    assert.deepStrictEqual(check('(CMS:TEXT title\n<div class="x">'), [['missingParenHtml', '(CMS:TEXT']]);
});

test('unterminated command, quote, brace, bracket', () => {
    assert.deepStrictEqual(check('(CMS:TEXT title'), [['unterminatedCommand', '(CMS:TEXT']]);
    assert.deepStrictEqual(check('(CMS:TEXT title prefix="<b>)'), [['unterminatedQuote', '"']]);
    assert.deepStrictEqual(check('(CMS:TEXT title prefix={$a)'), [['unterminatedBrace', '{']]);
    assert.deepStrictEqual(check('(CMS:SELECT list filter[a=1)'), [['missingBracket', '[']]);
});

test('stray quote in a value', () => {
    // no further quote: unterminated - the rest of the command is still checked
    assert.deepStrictEqual(check('<p>(CMS:TEXT field=test")</p>'), [['unterminatedQuote', '"']]);
    assert.deepStrictEqual(check('<p>(CMS:TEXT field=test" titel=1)</p>'),
        [['unterminatedQuote', '"'], ['unknownParam', 'titel']]);
    // a later quote would swallow the following lines - marked at the stray quote
    const text = '<p>(CMS:TEXT field=test")</p>\n<a href="x">(CMS:TEXT title titel=1)</a>';
    assert.deepStrictEqual(check(text), [['quoteRunaway', '"'], ['unknownParam', 'titel']]);
    assert.deepStrictEqual(lint(text, commands)[0].args, ['"', 2]);
    // an embedded string on one line is allowed, a quoted value across lines too
    assert.deepStrictEqual(check('(CMS:TEXT title prefix=a"b c"d)'), []);
    assert.deepStrictEqual(check('(CMS:TEXT title prefix="<div>\n  <span>")'), []);
});

test('missing closing quote of a whole value, PHP around it', () => {
    const text = `<?php
$set['nl_found'] = 0;
if ($id > 0) {
    ?>(CMS:SELECT store_templates.nl_found filter[area]='products filter[record_id]="$id" limit=1)<?php
}
?>
<?php if (!empty($set['nl_found'])) { ?>
(CMS:TEXT title titel=1)
<?php } ?>`;
    const found = lint(text, commands);
    assert.deepStrictEqual(found.map(d => [d.code, text.slice(d.start, d.start + 9)]),
        [['quoteRunaway', "'products"], ['unknownParam', 'titel=1)\n']]);
    assert.strictEqual(text.slice(0, found[0].start).split('\n').length, 4);   // marked in line 4
    // the same with a second parameter without a key: still found
    const two = text.replace('nl_found filter', 'nl_found other filter');
    assert.deepStrictEqual(lint(two, commands).map(d => d.code), ['quoteRunaway', 'keylessTwice', 'unknownParam']);
});

test('command inside quotes', () => {
    assert.deepStrictEqual(check('(CMS:TEXT title prefix="<b>(CMS:TEXT x)</b>")'), [['commandInQuotes', '"']]);
});

test('validation like validateCmsCommand', () => {
    assert.deepStrictEqual(codes('(CMS:FOO x)'), ['unknownCommand']);
    assert.deepStrictEqual(codes('(CMS:TEXT a b)'), ['keylessTwice']);
    assert.deepStrictEqual(codes('(CMS:PDF_LINE x)'), ['noKeyless']);
    assert.deepStrictEqual(codes('(CMS:TEXT title specialchars>1)'), ['operatorNotAllowed']);
    assert.deepStrictEqual(codes('(CMS:TEXT title prefix[a]=1)'), ['subDepth']);
    assert.deepStrictEqual(codes('(CMS:TEXT title prefix[]=1)'), []);     // [] is not a level
    assert.deepStrictEqual(codes('(CMS:TEXT prefix=x)'), ['oneOfMissing']);
    assert.deepStrictEqual(codes('(CMS:TEXT title prefix=)'), ['missingValue']);
    assert.deepStrictEqual(codes('(CMS:SELECT list filter[a])'), ['subsNoValue']);
    assert.deepStrictEqual(codes('(CMS:TEXT [a]=1)'), ['unexpectedChar']);
    const mandatory = Object.entries(commands).find(([, c]) => Object.values(c.params).some(p => p.mandatory));
    assert.ok(codes(`(CMS:${mandatory[0]})`).includes('mandatoryMissing'));
});

test('unknown parameter with suggestion', () => {
    const [d] = lint('(CMS:TEXT title specialchar=true)', commands);
    assert.strictEqual(d.code, 'unknownParam');
    assert.deepStrictEqual(d.args, ['specialchar', 'CMS:TEXT', 'specialchars']);
    assert.strictEqual(lint('(CMS:TEXT title xyzzy=1)', commands)[0].args[2], '');
});

test('switches: true / false, else warning', () => {
    for (const v of ['true', 'false', '1', '0', 'yes', '"true"', '{$x}']) {
        assert.deepStrictEqual(codes(`(CMS:TEXT title specialchars=${v})`), [], v);
    }
    const [d] = lint('(CMS:TEXT title specialchars=ja)', commands);
    assert.deepStrictEqual([d.code, d.severity, d.args[0]], ['badValue', 'warning', 'ja']);
});

test('without command definitions only the structure is checked', () => {
    assert.deepStrictEqual(check('(CMS:FOO bar=1)', {}), []);
    assert.deepStrictEqual(check('(CMS:FOO bar', {}), [['unterminatedCommand', '(CMS:FOO']]);
});

test('fast: a large template well below a millisecond per kilobyte', () => {
    const big = sample.repeat(2000);              // ≈ 400 KB, 12 000 commands
    lint(big, commands);                          // warm up
    const t0 = process.hrtime.bigint();
    lint(big, commands);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < big.length / 1024 / 2, `${ms.toFixed(1)} ms for ${(big.length / 1024).toFixed(0)} KB`);
});

test('switch with a placeholder in the hint is not checked', () => {
    const defs = { pdf_print: { do: 'name', oneof: '', params: {
        name: { value: '', subparam: 0 }, download: { value: 'false / true / Dateiname', subparam: 0 } } } };
    assert.deepStrictEqual(check('(CMS:PDF_PRINT test.pdf download=invoice.pdf)', defs), []);
});
