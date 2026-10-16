# camindo CMS Templates for VS Code

Editor support for [camindo CMS](https://github.com/dirkintelligence/camindo-cms) template
files (`*.cms.php`):

- **Colors** – `(CMS:…)` commands in purple, PHP expressions inside them (`{$…}`, `$var`,
  `$this->cms`) in orange, like the colored view in the camindo backend. PHP and HTML
  outside the commands keep the colors of your theme. Commands inside PHP comments are
  colored too – the template compiler translates them as well.
- **Completion** – after `(CMS:` the command names; after a space the parameters of the
  command (mandatory ones first, used ones left out unless they take keys such as
  `filter[…]`); after `=` the fixed values (`true / false`, `asc / desc` …).
- **Hover** – description of a command (with its parameters) or of a parameter.
- **Twelve languages** – the descriptions come from the camindo backend snippets:
  Arabic, Bengali, Chinese, English, French, German, Hindi, Japanese, Korean,
  Portuguese, Spanish and Urdu.

The grammar is injected into PHP files and reads each command as one unit, so quotes or
HTML snippets in parameter values (`prefix="<div class='x'>"`) do not confuse the HTML
highlighting.

## Installation

- Visual Studio Marketplace or Open VSX: search for *camindo CMS Templates*.
- Or download the `.vsix` of a [release](https://github.com/dirkintelligence/camindo-vscode/releases)
  and use *Extensions › … › Install from VSIX…*.

## Language

The descriptions follow the display language of VS Code; if camindo has no such language,
English. The setting `camindo.language` (e.g. `de_DE`) chooses one explicitly.

## Commands of your own modules

The shipped files contain the commands of the camindo core and its standard modules. A
project with additional modules writes its own files with the camindo command line and
points the setting `camindo.commandsFile` to the directory (or to a single JSON file):

```bash
php Core/cron/camindo.php template commands --all --out=var/vscode
```

```json
"camindo.commandsFile": "var/vscode"
```

After a change run *camindo: Reload command definitions* from the command palette.

## Settings

| Setting | Default |
|---|---|
| `camindo.language` | display language of VS Code |
| `camindo.commandsFile` | the files shipped with the extension |
| `camindo.commandColor` | purple (`#a000a0`, lighter in dark themes) |
| `camindo.phpColor` | orange (`#ff8800`) |

## Development

```bash
npm install
npm test                # scanner, grammar (VS Code tokenizer), data
npm run commands        # data/commands.{lang}.json from ../Core (camindo checkout next to it)
```

To try changes without packaging, link the folder into the extensions directory and reload
the window: `ln -s "$PWD" ~/.vscode/extensions/camindo.camindo-cms-templates-dev`.

A release is a tag `vX.Y.Z` matching the version in `package.json`: GitHub Actions run the
tests, attach the `.vsix` to a GitHub release and publish to the Visual Studio Marketplace
and Open VSX when the secrets `VSCE_PAT` and `OVSX_PAT` are set. When the camindo commands
change, regenerate `data/` and release a new patch version.

## License

AGPL-3.0-or-later, like camindo CMS – the command descriptions in `data/` come from it.
