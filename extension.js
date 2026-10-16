// camindo CMS templates for VS Code: colors, completion and hover for (CMS:…) commands
// in *.cms.php files. No dependencies; the command definitions come from
// data/commands.json (tools/export-commands.php) or the file in the setting
// camindo.commandsFile.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const SELECTOR = [{ pattern: '**/*.cms.php' }];
const MAX_COMMAND_LENGTH = 20000;   // an unterminated command is not scanned further

let commands = {};
let version = '';

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

const cache = new Map();   // uri -> {version, list}
function commandsOf(doc) {
    const key = doc.uri.toString();
    const hit = cache.get(key);
    if (hit && hit.version === doc.version) return hit.list;
    const list = scanAll(doc.getText());
    cache.set(key, { version: doc.version, list });
    return list;
}

/** Keys used in a (masked) command text */
function usedKeys(masked) {
    const keys = new Set();
    const re = /(?:^|\s)([A-Za-z_]\w*)(?=\s*(?:\[|==|!=|!!|<=|>=|<<|>>|=|<|>))/g;
    let m;
    while ((m = re.exec(masked)) !== null) keys.add(m[1]);
    return keys;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

function loadCommands() {
    const setting = (vscode.workspace.getConfiguration('camindo').get('commandsFile') || '').trim();
    let file = path.join(__dirname, 'data', 'commands.json');
    if (setting) {
        const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        file = path.isAbsolute(setting) || !folder ? setting : path.join(folder.uri.fsPath, setting);
    }
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        commands = data.commands || {};
        version = data.version || '';
    } catch (e) {
        vscode.window.showWarningMessage(`camindo: cannot read command definitions (${file}): ${e.message}`);
    }
}

/** Fixed choices from a value hint such as "true / false" or "desc / asc" */
function choices(hint) {
    if (!/^[\w.-]+(\s*\/\s*[\w.-]+)+$/.test(hint || '')) return [];
    return hint.split('/').map(s => s.trim());
}

function paramDoc(name, p) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${name}**${p.mandatory ? ' *(Pflicht)*' : ''}`);
    if (p.subparam > 0) md.appendMarkdown(` – Schlüssel: ${'`[…]`'.repeat(p.subparam)}`);
    if (p.operator) md.appendMarkdown(' – Vergleichsoperator erlaubt');
    md.appendMarkdown('\n\n');
    if (p.description) md.appendText(p.description + '\n\n');
    if (p.value) md.appendMarkdown('Wert: `' + p.value.replace(/`/g, "'") + '`  \n');
    if (p.default) md.appendMarkdown('Standard: `' + p.default.replace(/`/g, "'") + '`');
    return md;
}

function commandDoc(name, def) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**CMS:${name.toUpperCase()}**\n\n`);
    if (def.note) md.appendText(def.note + '\n\n');
    const params = Object.entries(def.params || {});
    if (params.length) {
        md.appendMarkdown(params.map(([p, d]) =>
            `- \`${p}${'[…]'.repeat(d.subparam)}\`${d.mandatory ? ' *' : ''}`).join('\n'));
    }
    if (def.oneof) md.appendMarkdown(`\n\nmindestens einer von: \`${def.oneof}\``);
    if (version) md.appendMarkdown(`\n\n_camindo ${version}_`);
    return md;
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const completionProvider = {
    provideCompletionItems(doc, position) {
        const text = doc.getText();
        const offset = doc.offsetAt(position);
        const lower = text.slice(Math.max(0, offset - MAX_COMMAND_LENGTH), offset).toLowerCase();
        const rel = lower.lastIndexOf('(cms:');
        if (rel < 0) return undefined;
        const start = offset - lower.length + rel;
        const state = scanCommand(text, start, offset);
        if (state.end >= 0) return undefined;              // command closed before the cursor

        // 1. Command name
        if (offset <= state.nameEnd) {
            const range = new vscode.Range(doc.positionAt(state.nameStart), doc.positionAt(state.nameEnd));
            return Object.entries(commands).map(([name, def]) => {
                const item = new vscode.CompletionItem(name.toUpperCase(), vscode.CompletionItemKind.Function);
                item.range = range;
                item.detail = def.note;
                item.documentation = commandDoc(name, def);
                return item;
            });
        }
        if (state.quote || state.inBrace) return undefined;

        const def = commands[state.name];
        if (!def) return undefined;
        const before = text.slice(state.nameEnd, offset);

        // 2. Value after "key=" / "key[…] >= ": fixed choices of the value hint
        const value = /([A-Za-z_]\w*)(?:\[[^\]\s]*\])*\s*(?:==|!=|!!|<=|>=|<<|>>|=|<|>)\s*([\w.-]*)$/.exec(before);
        if (value) {
            const p = def.params[value[1]];
            if (!p) return undefined;
            return choices(p.value).map(c => {
                const item = new vscode.CompletionItem(c, vscode.CompletionItemKind.EnumMember);
                item.documentation = paramDoc(value[1], p);
                return item;
            });
        }

        // 3. Parameter name (at the start of a token)
        const token = /(?:^|\s)([A-Za-z_]\w*)?$/.exec(before);
        if (!token) return undefined;
        const used = usedKeys(state.masked);
        const items = [];
        for (const [name, p] of Object.entries(def.params || {})) {
            if (used.has(name) && p.subparam === 0) continue;
            const item = new vscode.CompletionItem(name, p.mandatory ? vscode.CompletionItemKind.Field : vscode.CompletionItemKind.Property);
            const opts = choices(p.value);
            const val = opts.length ? '${' + (p.subparam + 1) + '|' + opts.join(',') + '|}' : '$0';
            let keys = '';
            for (let i = 1; i <= p.subparam; i++) keys += '[$' + i + ']';
            item.insertText = new vscode.SnippetString(name + keys + '=' + val);
            item.detail = (p.mandatory ? 'Pflicht · ' : '') + (p.value || '');
            item.documentation = paramDoc(name, p);
            item.sortText = (p.mandatory ? '0' : '1') + name;
            items.push(item);
        }
        return items;
    }
};

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

const hoverProvider = {
    provideHover(doc, position) {
        const offset = doc.offsetAt(position);
        const cmd = commandsOf(doc).find(c => c.start <= offset && offset < c.end);
        if (!cmd) return undefined;
        const def = commands[cmd.name];
        if (!def) return undefined;
        if (offset <= cmd.nameEnd) {
            return new vscode.Hover(commandDoc(cmd.name, def),
                new vscode.Range(doc.positionAt(cmd.start), doc.positionAt(cmd.nameEnd)));
        }
        // a key: only outside quotes and {…} (masked keeps exactly those characters)
        const rel = offset - cmd.nameEnd;
        if (cmd.masked[rel] === ' ' || cmd.masked[rel] === undefined) return undefined;
        const range = doc.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
        if (!range) return undefined;
        const word = doc.getText(range);
        const after = cmd.masked.slice(doc.offsetAt(range.end) - cmd.nameEnd);
        if (!def.params[word] || !/^\s*(\[|==|!=|!!|<=|>=|<<|>>|=|<|>)/.test(after)) return undefined;
        return new vscode.Hover(paramDoc(word, def.params[word]), range);
    }
};

// ---------------------------------------------------------------------------
// Colors (decorations, *.cms.php only): command purple, PHP parts orange -
// like the colored view in the backend (.c9-command / .c9-php)
// ---------------------------------------------------------------------------

let commandDeco, phpDeco;

function createDecorations() {
    const cfg = vscode.workspace.getConfiguration('camindo');
    const colors = (light, dark, setting) => {
        const own = (cfg.get(setting) || '').trim();
        return own ? { color: own } : { light: { color: light }, dark: { color: dark } };
    };
    if (commandDeco) commandDeco.dispose();
    if (phpDeco) phpDeco.dispose();
    commandDeco = vscode.window.createTextEditorDecorationType(colors('#a000a0', '#d77cd7', 'commandColor'));
    phpDeco = vscode.window.createTextEditorDecorationType(colors('#ff8800', '#ffa040', 'phpColor'));
}

function isTemplate(doc) {
    return /\.cms\.php$/i.test(doc.fileName);
}

function decorate(editor) {
    if (!editor || !isTemplate(editor.document)) return;
    const doc = editor.document;
    const cmdRanges = [];
    const phpRanges = [];
    for (const cmd of commandsOf(doc)) {
        // command without its PHP parts, so that the two colors do not overlap
        let pos = cmd.start;
        for (const [s, e] of cmd.php) {
            if (s > pos) cmdRanges.push(new vscode.Range(doc.positionAt(pos), doc.positionAt(s)));
            phpRanges.push(new vscode.Range(doc.positionAt(s), doc.positionAt(e)));
            pos = e;
        }
        if (cmd.end > pos) cmdRanges.push(new vscode.Range(doc.positionAt(pos), doc.positionAt(cmd.end)));
    }
    editor.setDecorations(commandDeco, cmdRanges);
    editor.setDecorations(phpDeco, phpRanges);
}

function decorateVisible() {
    vscode.window.visibleTextEditors.forEach(decorate);
}

// ---------------------------------------------------------------------------

function activate(context) {
    loadCommands();
    createDecorations();

    let timer = null;
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(SELECTOR, completionProvider, ':', ' ', '='),
        vscode.languages.registerHoverProvider(SELECTOR, hoverProvider),
        vscode.window.onDidChangeVisibleTextEditors(decorateVisible),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!isTemplate(e.document)) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                vscode.window.visibleTextEditors.filter(ed => ed.document === e.document).forEach(decorate);
            }, 120);
        }),
        vscode.workspace.onDidCloseTextDocument(doc => cache.delete(doc.uri.toString())),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('camindo.commandsFile')) loadCommands();
            if (e.affectsConfiguration('camindo.commandColor') || e.affectsConfiguration('camindo.phpColor')) {
                createDecorations();
                decorateVisible();
            }
        }),
        vscode.commands.registerCommand('camindo.reloadCommands', () => {
            loadCommands();
            vscode.window.showInformationMessage(`camindo: ${Object.keys(commands).length} commands loaded.`);
        }),
        { dispose: () => { commandDeco && commandDeco.dispose(); phpDeco && phpDeco.dispose(); } }
    );
    decorateVisible();
}

function deactivate() {}

module.exports = { activate, deactivate, _test: { scanCommand, scanAll, usedKeys, choices } };
