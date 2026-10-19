// camindo CMS templates for VS Code: colors, completion, hover and syntax check for
// (CMS:…) commands in *.cms.php files. No dependencies; the command definitions come from
// data/commands.{lang}.json (camindo.php template commands --all --out=data) or the
// file in the setting camindo.commandsFile.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { MAX_COMMAND_LENGTH, scanCommand, scanAll, usedKeys, choices } = require('./scanner');
const { lint } = require('./lint');
const { resolveLanguage, t } = require('./l10n');

const SELECTOR = [{ pattern: '**/*.cms.php' }];

let commands = {};
let version = '';
let lang = 'en_US';   // language of the texts (setting camindo.language or VS Code)

const cache = new Map();   // uri -> {version, list}
function commandsOf(doc) {
    const key = doc.uri.toString();
    const hit = cache.get(key);
    if (hit && hit.version === doc.version) return hit.list;
    const list = scanAll(doc.getText());
    cache.set(key, { version: doc.version, list });
    return list;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

function loadCommands() {
    const cfg = vscode.workspace.getConfiguration('camindo');
    lang = resolveLanguage(cfg.get('language') || '', vscode.env.language);
    const setting = (cfg.get('commandsFile') || '').trim();
    let file = path.join(__dirname, 'data', `commands.${lang}.json`);
    if (setting) {
        const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        file = path.isAbsolute(setting) || !folder ? setting : path.join(folder.uri.fsPath, setting);
        // a directory: the file of the language in it (template commands --all --out=DIR)
        try {
            if (fs.statSync(file).isDirectory()) file = path.join(file, `commands.${lang}.json`);
        } catch (e) { /* reported below */ }
    }
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        commands = data.commands || {};
        version = data.version || '';
    } catch (e) {
        vscode.window.showWarningMessage('camindo: ' + t(lang, 'unreadable', file, e.message));
    }
}

function paramDoc(name, p) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${name}**${p.mandatory ? ` *(${t(lang, 'mandatory')})*` : ''}`);
    if (p.subparam > 0) md.appendMarkdown(` – ${t(lang, 'keys')}: ${'`[…]`'.repeat(p.subparam)}`);
    if (p.operator) md.appendMarkdown(' – ' + t(lang, 'operator'));
    md.appendMarkdown('\n\n');
    if (p.description) md.appendText(p.description + '\n\n');
    if (p.value) md.appendMarkdown(t(lang, 'value') + ': `' + p.value.replace(/`/g, "'") + '`  \n');
    if (p.default) md.appendMarkdown(t(lang, 'default', '`' + p.default.replace(/`/g, "'") + '`'));
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
    if (def.oneof) md.appendMarkdown(`\n\n${t(lang, 'oneOf')}: \`${def.oneof}\``);
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
            item.detail = (p.mandatory ? t(lang, 'mandatory') + ' · ' : '') + (p.value || '');
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
// Syntax check (lint.js): errors of the template compiler red, hints yellow
// ---------------------------------------------------------------------------

let diagnostics;

function check(doc) {
    if (!diagnostics || !isTemplate(doc)) return;
    if (!vscode.workspace.getConfiguration('camindo').get('validate', true)) {
        diagnostics.delete(doc.uri);
        return;
    }
    diagnostics.set(doc.uri, lint(doc.getText(), commands).map(d => {
        let message = t(lang, d.code, ...d.args);
        if (d.code === 'unknownParam' && d.args[2]) message += ' ' + t(lang, 'didYouMean', d.args[2]);
        const item = new vscode.Diagnostic(
            new vscode.Range(doc.positionAt(d.start), doc.positionAt(d.end)), message,
            d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
        item.source = 'camindo';
        item.code = d.code;
        return item;
    }));
}

function checkAll() {
    vscode.workspace.textDocuments.forEach(check);
}

// ---------------------------------------------------------------------------

function activate(context) {
    loadCommands();
    createDecorations();
    diagnostics = vscode.languages.createDiagnosticCollection('camindo');

    let timer = null;
    const checkTimers = new Map();   // uri -> timer: check after a short pause in typing
    context.subscriptions.push(
        diagnostics,
        vscode.languages.registerCompletionItemProvider(SELECTOR, completionProvider, ':', ' ', '='),
        vscode.languages.registerHoverProvider(SELECTOR, hoverProvider),
        vscode.window.onDidChangeVisibleTextEditors(decorateVisible),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (!isTemplate(e.document)) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                vscode.window.visibleTextEditors.filter(ed => ed.document === e.document).forEach(decorate);
            }, 120);
            const key = e.document.uri.toString();
            clearTimeout(checkTimers.get(key));
            checkTimers.set(key, setTimeout(() => { checkTimers.delete(key); check(e.document); }, 250));
        }),
        vscode.workspace.onDidOpenTextDocument(check),
        vscode.workspace.onDidCloseTextDocument(doc => {
            cache.delete(doc.uri.toString());
            clearTimeout(checkTimers.get(doc.uri.toString()));
            diagnostics.delete(doc.uri);
        }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('camindo.commandsFile') || e.affectsConfiguration('camindo.language')) loadCommands();
            if (e.affectsConfiguration('camindo')) checkAll();
            if (e.affectsConfiguration('camindo.commandColor') || e.affectsConfiguration('camindo.phpColor')) {
                createDecorations();
                decorateVisible();
            }
        }),
        vscode.commands.registerCommand('camindo.reloadCommands', () => {
            loadCommands();
            checkAll();
            vscode.window.showInformationMessage('camindo: ' + t(lang, 'loaded', Object.keys(commands).length));
        }),
        { dispose: () => { commandDeco && commandDeco.dispose(); phpDeco && phpDeco.dispose(); } }
    );
    decorateVisible();
    checkAll();
}

function deactivate() {}

module.exports = { activate, deactivate };
