# Changelog

## 0.2.3

- `CMS:RAW` knows the parameter `useval` (at least one of `field`, `useval`)
- Index chains of variables colored as a whole – `$page[title]`, `$page[key][subkey]`, also
  inside double quotes (not inside single quotes)
- Command data updated to camindo 9.1.8

## 0.2.2

- `resulttemplate` of `CMS:SELECT` can be omitted with `hits=false`; without it the syntax check
  still reports a missing template (`mandatory_unless` in the command data)
- PDF commands described in all twelve languages
- Command data updated to camindo 9.1.6

## 0.2.1

- New extension icon

## 0.2.0

- Syntax check while typing (`camindo.validate`): errors of the template compiler in red,
  hints in yellow – missing `)` before the next command or an HTML tag, unclosed quotes and
  brackets, unknown commands and parameters with a suggestion, required parameters,
  operators, sub-key depth, stray or unclosed quotes (marked at the quote, the rest of
  the command is still checked), `(CMS:…)` inside quotes, switches
  that are neither true nor false
- Messages in the twelve camindo backend languages

## 0.1.0

- Colors for `(CMS:…)` commands and the PHP expressions inside them (`*.cms.php`)
- Grammar injected into PHP: a command is one unit, HTML highlighting stays intact
- Completion of command names, parameters and fixed values; hover with descriptions
- Descriptions in the twelve camindo backend languages (camindo CMS 9.0.8),
  setting `camindo.language`
- `camindo.commandsFile`: own command definitions (`camindo.php template commands`)
