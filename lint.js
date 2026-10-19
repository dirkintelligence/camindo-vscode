// Syntax check for (CMS:…) commands - no VS Code dependency, so that it can be tested
// with plain Node (test/lint.test.js).
//
// Reading and validation mirror TemplateParserTrait (parseCmsCommand, readParam,
// readToken, consumeQuoted, consumeBraces, validateCmsCommand): whatever the template
// compiler reports is reported here as an error, at the token it concerns. On top come
// a few hints the compiler cannot give in this form, because it reads on and only fails
// later (or not at all):
//
//   missingParen*     a "(CMS:" or an HTML tag outside quotes inside a command - the
//                     ")" of the command is missing
//   quoteRunaway      a quote that is closed only lines later - in the middle of a value
//                     (field=test"), glued to the next text or across PHP code / commands
//                     (filter[area]='products …)
//
// A stray quote - unclosed or running away - is reported and the command is read again
// with this quote as a plain character, so that the rest of the command is still checked
// (and the following commands are not swallowed).
//   commandInQuotes   "(CMS:…" inside a quoted value - not evaluated, mostly a missing
//                     closing quote
//   badValue          value of a switch that is neither true nor false (specialchars=ja)
'use strict';

const { choices } = require('./scanner');

const OPS2 = ['==', '!=', '!!', '<=', '>=', '<<', '>>'];
const OPS1 = ['=', '<', '>', '!'];
const HTML_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/y;

/**
 * Check all commands of a template.
 *
 * @param {string} text
 * @param {object} commands  definitions from data/commands.{lang}.json ({} = only the structure)
 * @returns {{start: number, end: number, severity: 'error'|'warning', code: string, args: any[]}[]}
 */
function lint(text, commands) {
    const diags = [];
    const lower = text.toLowerCase();
    const known = commands && Object.keys(commands).length > 0;
    let pos = 0;

    while (pos < text.length) {
        const hit = lower.indexOf('(cms:', pos);
        if (hit < 0) break;
        const cmd = parseWithStrayQuotes(text, lower, hit, diags);
        if (!cmd) { pos = hit + 1; continue; }
        if (cmd.resume !== undefined) { pos = cmd.resume; continue; }
        const def = known ? commands[cmd.name] : null;
        if (known && !def) {
            diags.push(diag(hit, cmd.nameEnd, 'error', 'unknownCommand', cmd.upper));
        } else if (def) {
            validate(cmd, def, Object.keys(def.params || {}), diags);
        }
        pos = cmd.end;
    }
    return diags;
}

function diag(start, end, severity, code, ...args) {
    return { start, end: Math.max(end, start + 1), severity, code, args };
}

// ---------------------------------------------------------------------------
// Reading (parseCmsCommand / readParam / readToken)
// ---------------------------------------------------------------------------

/** parseCommand, again without each stray quote (at most a few) */
function parseWithStrayQuotes(text, lower, start, diags) {
    const stray = new Set();
    const quoteDiags = [];
    for (let i = 0; i < 5; i++) {
        const local = [];
        const cmd = parseCommand(text, lower, start, local, stray);
        if (cmd && cmd.retry !== undefined) {
            quoteDiags.push(cmd.diag);
            stray.add(cmd.retry);
            continue;
        }
        diags.push(...quoteDiags, ...local);
        return cmd;
    }
    diags.push(...quoteDiags);
    return null;
}

/**
 * @returns null (not a command or structurally unreadable, reported),
 *          {resume} (the ")" is missing, reported - go on at resume),
 *          {retry, diag} (stray quote at retry - read again without it) or the command
 */
function parseCommand(text, lower, start, diags, stray) {
    const m = /\(cms:([a-zA-Z0-9_]+)/iy;
    m.lastIndex = start;
    const hit = m.exec(text);
    if (!hit) return null;

    const name = hit[1].toLowerCase();
    const upper = 'CMS:' + hit[1].toUpperCase();
    const nameEnd = start + hit[0].length;
    const s = { text, lower, len: text.length, pos: nameEnd, diags, upper, cmdStart: start, nameEnd, stray };
    const params = [];

    while (true) {
        skipWs(s);
        if (s.pos >= s.len) {
            diags.push(diag(start, nameEnd, 'error', 'unterminatedCommand', upper));
            return null;
        }
        if (text[s.pos] === ')') { s.pos++; break; }
        if (openedElsewhere(s)) return { resume: s.resume };

        const param = readParam(s);
        if (s.retry !== undefined) return { retry: s.retry, diag: s.retryDiag };
        if (s.resume !== undefined) return { resume: s.resume };
        if (!param) return null;
        params.push(param);
    }
    return { start, end: s.pos, name, upper, nameEnd, params };
}

/**
 * Something that can only stand outside a command: a new "(CMS:" or an HTML tag.
 * Reports the missing ")" and sets s.resume.
 */
function openedElsewhere(s) {
    if (s.lower.startsWith('(cms:', s.pos)) {
        s.diags.push(diag(s.cmdStart, s.nameEnd, 'error', 'missingParenCmd', s.upper));
        s.resume = s.pos;
        return true;
    }
    if (s.text[s.pos] === '<') {
        HTML_TAG.lastIndex = s.pos;
        const tag = HTML_TAG.exec(s.text);
        if (tag) {
            s.diags.push(diag(s.cmdStart, s.nameEnd, 'error', 'missingParenHtml', s.upper, tag[0].slice(0, 40)));
            s.resume = s.pos;
            return true;
        }
    }
    return false;
}

function readParam(s) {
    const key = readToken(s, 'key');
    if (s.resume !== undefined) return null;
    if (!key) {
        if (!s.failed) s.diags.push(diag(s.pos, s.pos + 1, 'error', 'unexpectedChar', s.text[s.pos] || '', s.upper));
        return null;
    }

    const subs = [];
    while (s.pos < s.len && s.text[s.pos] === '[') {
        const sub = readSub(s);
        if (!sub) return null;
        subs.push(sub);
    }

    skipWs(s);
    const opStart = s.pos;
    const op = readOperator(s);
    let value = null;

    if (op !== null) {
        // "title</h2>": the key ends before "<" - an HTML tag, not a comparison
        if (op === '<' || op === '<<' || op === '<=') {
            s.pos = opStart;
            if (openedElsewhere(s)) return null;
            readOperator(s);
        }
        skipWs(s);
        value = readToken(s, 'value');      // a bare HTML value (prefix=<b>) is allowed
        if (s.resume !== undefined) return null;
        if (!value) {
            if (!s.failed) s.diags.push(diag(opStart, opStart + op.length, 'error', 'missingValue', op, s.upper));
            return null;
        }
    } else if (subs.length) {
        s.diags.push(diag(key.start, key.end, 'error', 'subsNoValue', key.text, s.upper));
        return null;
    }
    return { standalone: value === null, key, subs, op, opStart, value };
}

function readOperator(s) {
    const two = s.text.substr(s.pos, 2);
    if (OPS2.includes(two)) { s.pos += 2; return two; }
    const one = s.text[s.pos] || '';
    if (OPS1.includes(one)) { s.pos++; return one; }
    return null;
}

/** Token (key, sub-key or value): {text, quote, start, end} or null */
function readToken(s, mode) {
    if (s.pos >= s.len) return null;
    const text = s.text;
    const start = s.pos;
    const c = text[start];

    if ((c === '"' || c === "'") && !s.stray.has(start)) {
        if (!consumeQuoted(s)) return null;
        if (runaway(s, start, s.pos, true)) return null;
        const tok = { text: text.slice(start, s.pos), quote: c, start, end: s.pos };
        if (/\(cms:[a-z0-9_]/i.test(tok.text)) {
            s.diags.push(diag(start, start + 1, 'warning', 'commandInQuotes', s.upper));
        }
        return tok;
    }

    const stop = mode === 'key' ? ' \t\r\n)=[' : mode === 'sub' ? ']\n' : ' \t\r\n)';
    while (s.pos < s.len) {
        const ch = text[s.pos];
        if (stop.includes(ch)) break;
        // a key also ends before a comparison operator - not at the start, not in $obj->name
        if (mode === 'key' && s.pos > start && (ch === '<' || ch === '!'
            || (ch === '>' && text[s.pos - 1] !== '-'))) break;
        if (ch === '(' && s.lower.startsWith('(cms:', s.pos)) {
            s.diags.push(diag(s.cmdStart, s.nameEnd, 'error', 'missingParenCmd', s.upper));
            s.resume = s.pos;
            return null;
        }
        if (ch === '{') {
            if (!consumeBraces(s)) return null;
            continue;
        }
        if ((ch === '"' || ch === "'") && !s.stray.has(s.pos)) {
            const q = s.pos;
            if (!consumeQuoted(s)) return null;
            if (runaway(s, q, s.pos, q === start)) return null;
            continue;
        }
        s.pos++;
    }
    if (s.pos === start) return null;
    return { text: text.slice(start, s.pos), quote: null, start, end: s.pos };
}

/**
 * A quoted string from q to end that most likely lacks a quote: it runs across line
 * breaks and stands in the middle of a value (field=test"), or - for a whole token - it
 * contains PHP tags or a command, or the next text is glued to its closing quote.
 * Reported at the opening quote; the command is then read again without it.
 */
function runaway(s, q, end, whole) {
    const body = s.text.slice(q, end);
    if (!body.includes('\n')) return false;
    if (whole && !/<\?php|\?>|\(cms:/i.test(body) && !/^[^\s)]/.test(s.text.slice(end, end + 1))) return false;
    let line = 1;
    for (let i = s.text.indexOf('\n'); i >= 0 && i < end; i = s.text.indexOf('\n', i + 1)) line++;
    strayQuote(s, diag(q, q + 1, 'error', 'quoteRunaway', s.text[q], line));
    return true;
}

function strayQuote(s, d) {
    s.diags.push(d);
    if (s.retry === undefined) {
        s.retry = d.start;
        s.retryDiag = d;
    }
    s.failed = true;
}

function readSub(s) {
    const open = s.pos;
    s.pos++; // '['
    if (s.text[s.pos] === ']') {
        s.pos++;
        return { empty: true };
    }
    const tok = readToken(s, 'sub');
    if (s.resume !== undefined) return null;
    if (!tok || s.pos >= s.len || s.text[s.pos] !== ']') {
        if (!s.failed) s.diags.push(diag(open, open + 1, 'error', 'missingBracket', s.upper));
        s.failed = true;
        return null;
    }
    s.pos++;
    return { empty: false, ...tok };
}

function skipWs(s) {
    while (s.pos < s.len) {
        const c = s.text[s.pos];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n') s.pos++;
        else break;
    }
}

function consumeQuoted(s) {
    const open = s.pos;
    const q = s.text[s.pos++];
    while (s.pos < s.len) {
        const c = s.text[s.pos];
        if (c === '\\' && s.pos + 1 < s.len) { s.pos += 2; continue; }
        s.pos++;
        if (c === q && !s.stray.has(s.pos - 1)) return true;
    }
    strayQuote(s, diag(open, open + 1, 'error', 'unterminatedQuote', q, s.upper));
    return false;
}

function consumeBraces(s) {
    const open = s.pos;
    let depth = 0;
    while (s.pos < s.len) {
        const c = s.text[s.pos];
        if ((c === '"' || c === "'") && !s.stray.has(s.pos)) {
            if (!consumeQuoted(s)) return false;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { s.pos++; return true; }
        s.pos++;
    }
    s.diags.push(diag(open, open + 1, 'error', 'unterminatedBrace', s.upper));
    s.failed = true;
    return false;
}

// ---------------------------------------------------------------------------
// Validation (validateCmsCommand)
// ---------------------------------------------------------------------------

/** PHP part in a token: {$…} or $var - not inside single quotes */
function hasPhp(tok) {
    return tok.quote !== "'" && /\{\$|\$[A-Za-z_]/.test(tok.text);
}

function unquote(tok) {
    return tok.quote ? tok.text.slice(1, -1) : tok.text;
}

function validate(cmd, def, names, diags) {
    const params = def.params || {};
    const seen = new Set();
    let keyless = false;

    for (const p of cmd.params) {
        const k = p.key;
        if (p.standalone) {
            if (!def.do) {
                diags.push(diag(k.start, k.end, 'error', 'noKeyless', cmd.upper));
            } else if (keyless) {
                diags.push(diag(k.start, k.end, 'error', 'keylessTwice', cmd.upper));
            } else {
                keyless = true;
                seen.add(def.do);
            }
            continue;
        }
        if (hasPhp(k)) continue;                 // dynamic key: not checkable
        const name = unquote(k);
        const pdef = params[name];
        if (!pdef) {
            diags.push(diag(k.start, k.end, 'error', 'unknownParam', name, cmd.upper, suggest(name, names)));
            continue;
        }
        seen.add(name);

        if (p.op !== '=' && !pdef.operator) {
            diags.push(diag(p.opStart, p.opStart + p.op.length, 'error', 'operatorNotAllowed', name, p.op));
            continue;
        }
        const depth = p.subs.filter(sub => !sub.empty).length;
        if (depth > (pdef.subparam || 0)) {
            diags.push(diag(k.start, p.subs[p.subs.length - 1].end || k.end, 'error', 'subDepth', name, pdef.subparam || 0, depth));
        }
        if (p.op === '=') checkValue(p.value, name, pdef, diags);
    }

    for (const [name, pdef] of Object.entries(params)) {
        if (pdef.mandatory && !seen.has(name)) {
            diags.push(diag(cmd.start, cmd.nameEnd, 'error', 'mandatoryMissing', name, cmd.upper));
        }
    }
    if (def.oneof) {
        const list = def.oneof.split(',').map(x => x.trim()).filter(Boolean);
        if (list.length && !list.some(x => seen.has(x))) {
            diags.push(diag(cmd.start, cmd.nameEnd, 'error', 'oneOfMissing', cmd.upper, list.join(', ')));
        }
    }
}

/**
 * Value of a switch (value hint with true / false): the compiler reads it with
 * FILTER_VALIDATE_BOOLEAN, so "ja" or "yes please" silently become false. Further
 * choices of the hint ("true / false / encrypt") and numbers ("… / seconds") pass.
 * Not checked: hints with a placeholder ("false / true / Dateiname", translated words)
 * and the other hints - they are not complete lists (subfield takes every property of
 * the file).
 */
const BOOL_WORDS = ['true', 'false', '1', '0', 'on', 'off', 'yes', 'no'];

function checkValue(tok, name, pdef, diags) {
    const opts = choices(pdef.value).map(o => o.toLowerCase());
    if (!opts.includes('true') || !opts.includes('false')) return;
    if (!choices(pdef.value).every(o => /^[a-z][a-z0-9_]*$/.test(o))) return;
    if (hasPhp(tok)) return;
    const v = unquote(tok).trim().toLowerCase();
    if (v === '' || /^-?\d+(\.\d+)?$/.test(v) || BOOL_WORDS.includes(v) || opts.includes(v)) return;
    diags.push(diag(tok.start, tok.end, 'warning', 'badValue', unquote(tok).trim(), name, choices(pdef.value).join(' / ')));
}

/** Closest parameter name (typing errors), '' if none is close enough */
function suggest(name, names) {
    let best = '';
    let bestDist = name.length <= 4 ? 1 : 2;
    const lower = name.toLowerCase();
    for (const n of names) {
        if (n === lower) return n;
        const d = distance(lower, n, bestDist);
        if (d <= bestDist && (!best || d < distance(lower, best, bestDist))) {
            best = n;
            bestDist = d;
        }
    }
    return best;
}

/** Levenshtein distance, aborted above max */
function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            rowMin = Math.min(rowMin, cur[j]);
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}

module.exports = { lint };
