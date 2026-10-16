# camindo CMS Templates for VS Code

Support for camindo CMS template files (`*.cms.php`):

- **Colors** – `(CMS:…)` commands in purple, PHP expressions inside them (`{$…}`, `$var`,
  `$this->cms`) in orange, like the colored view in the backend. PHP and HTML outside
  the commands keep the colors of your theme. Commands inside PHP comments are colored
  too – the template compiler translates them as well.
- **Completion** – after `(CMS:` the command names; after a space the parameters of the
  command (mandatory ones first, already used ones left out unless they take keys such as
  `filter[…]`); after `=` the fixed values (`true / false`, `asc / desc` …).
- **Hover** – description of the command (with its parameters) or of a parameter.

The grammar (`syntaxes/cms.injection.tmLanguage.json`) is injected into PHP files and reads
each command as one unit, so quotes or HTML snippets in parameter values
(`prefix="<div class='x'>"`) do not confuse the HTML highlighting.

## Installation

Without packaging – link the folder into the VS Code extensions directory and reload the window:

```bash
ln -s "$PWD" ~/.vscode/extensions/camindo.camindo-cms-templates-0.1.0
```

As a package: `npx @vscode/vsce package`, then *Extensions › … › Install from VSIX*.

## Command definitions

Completion and hover read `data/commands.json`. It is generated from the core
`commands.php` plus the commands of the active modules; after a change there run (in
the PHP container, from the project directory):

```bash
php vscode-camindo/tools/export-commands.php > vscode-camindo/data/commands.json
```

and then *camindo: Reload command definitions* (command palette). The setting
`camindo.commandsFile` points to another file (absolute or relative to the workspace), for
example one per project with its own modules.

## Settings

| Setting | Default |
|---|---|
| `camindo.commandsFile` | the file shipped with the extension |
| `camindo.commandColor` | purple (`#a000a0`, lighter in dark themes) |
| `camindo.phpColor` | orange (`#ff8800`) |
