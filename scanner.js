// Scanner for (CMS:…) commands - no VS Code dependency, so that it can be tested with
// plain Node (test/scanner.test.js).
'use strict';

const MAX_COMMAND_LENGTH = 20000;   // an unterminated command is not scanned further

// ---------------------------------------------------------------------------
// Scanner - mirrors TemplateParserTrait (readToken, consumeQuoted, findPhpSpans):
// quotes with backslash escapes, {…} blocks, PHP parts {$…} and $var(->name)*
// in double-quoted and bare tokens, never in single quotes.
// ---------------------------------------------------------------------------

/** Is text[i] the start of $name? */
function isVarStart(text, i) {
    return text[i] === '$' && /[A-Za-z_]/.test(text[i + 1] || '');
}

/** End of $name(->name)* starting at i */
function varEnd(text, i) {
    let j = i + 1;
    while (j < text.length && /\w/.test(text[j])) j++;
    while (text[j] === '-' && text[j + 1] === '>' && /[A-Za-z_]/.test(text[j + 2] || '')) {
        j += 2;
        while (j < text.length && /\w/.test(text[j])) j++;
    }
    return j;
}

/** End of a {…} block starting at i (nested braces counted, like the parser) */
function braceEnd(text, i, limit) {
    let depth = 0;
    for (let j = i; j < limit; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}' && --depth === 0) return j + 1;
    }
    return -1;
}

/**
 * Scan one command whose "(CMS:" starts at start.
 * stopAt: scan only up to this offset and report the state there (completion).
 *
 * @returns {{start, name, nameStart, nameEnd, end, php: number[][], masked: string,
 *            quote: string|null, inBrace: boolean}}
 *          end = offset after ")" or -1 (not closed / not reached)
 */
function scanCommand(text, start, stopAt) {
    const m = /^\(cms:([A-Za-z_][A-Za-z0-9_]*)?/i.exec(text.slice(start, start + 80));
    const nameStart = start + 5;
    const nameEnd = nameStart + (m && m[1] ? m[1].length : 0);
    const limit = Math.min(text.length, start + MAX_COMMAND_LENGTH, stopAt ?? Infinity);
    const php = [];
    // command text with quoted strings and {…} blocked out - for finding the keys
    let masked = '';
    let quote = null;
    let j = nameEnd;
    let end = -1;
    let inBrace = false;

    const blank = (from, to) => { masked += ' '.repeat(Math.max(0, to - from)); };

    while (j < limit) {
        const c = text[j];
        if (quote) {
            if (c === '\\') { blank(j, j + 2); j += 2; continue; }
            if (c === quote) { quote = null; masked += ' '; j++; continue; }
            if (quote === '"' && c === '{' && text[j + 1] === '$') {
                const e = braceEnd(text, j, limit);
                if (e < 0) { inBrace = true; blank(j, limit); j = limit; break; }
                php.push([j, e]); blank(j, e); j = e; continue;
            }
            if (quote === '"' && isVarStart(text, j)) {
                const e = varEnd(text, j);
                php.push([j, e]); blank(j, e); j = e; continue;
            }
            masked += ' '; j++; continue;
        }
        if (c === '"' || c === "'") { quote = c; masked += ' '; j++; continue; }
        if (c === '{') {
            const e = braceEnd(text, j, limit);
            if (e < 0) { inBrace = true; blank(j, limit); j = limit; break; }
            if (text[j + 1] === '$') php.push([j, e]);
            blank(j, e); j = e; continue;
        }
        if (isVarStart(text, j)) {
            const e = varEnd(text, j);
            php.push([j, e]); masked += text.slice(j, e); j = e; continue;
        }
        if (c === ')') { end = j + 1; break; }
        masked += c; j++;
    }
    return {
        start, name: m && m[1] ? m[1].toLowerCase() : '', nameStart, nameEnd,
        end, php, masked, quote, inBrace,
    };
}

/** All commands of a text (decorations, hover) */
function scanAll(text) {
    const found = [];
    const re = /\(cms:/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const cmd = scanCommand(text, m.index);
        if (cmd.end < 0) continue;           // unterminated: the parser reports it
        found.push(cmd);
        re.lastIndex = cmd.end;
    }
    return found;
}

/** Keys used in a (masked) command text */
function usedKeys(masked) {
    const keys = new Set();
    const re = /(?:^|\s)([A-Za-z_]\w*)(?=\s*(?:\[|==|!=|!!|<=|>=|<<|>>|=|<|>))/g;
    let m;
    while ((m = re.exec(masked)) !== null) keys.add(m[1]);
    return keys;
}

/** Fixed choices from a value hint such as "true / false" or "desc / asc" */
function choices(hint) {
    if (!/^[\w.-]+(\s*\/\s*[\w.-]+)+$/.test(hint || '')) return [];
    return hint.split('/').map(s => s.trim());
}

module.exports = { MAX_COMMAND_LENGTH, scanCommand, scanAll, usedKeys, choices };
