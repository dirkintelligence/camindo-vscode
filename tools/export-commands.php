<?php
/**
 * Export the CMS command definitions (core commands.php plus active modules)
 * as JSON for the VS Code extension - completion and hover read data/commands.json.
 *
 * Run inside the PHP container from the project directory:
 *
 *     php vscode-camindo/tools/export-commands.php > vscode-camindo/data/commands.json
 *
 * Texts from commands.php may contain HTML entities (&gt;) - they are decoded here.
 */
define('CAMINDO_STARTED', true);
define('CAMINDO_BACKEND', true);
require dirname(__DIR__, 2) . '/load_camindo.php';

$text = fn($value) => html_entity_decode((string)$value, ENT_QUOTES | ENT_HTML5, 'UTF-8');

$out = [];
foreach ($app->get(\Camindo\Core\Modules\Template\Template::class)->commandDefinitions() as $name => $def) {
    $params = [];
    foreach ((array)($def['params'] ?? []) as $param => $pdef) {
        $params[$param] = [
            'description' => $text($pdef['description'] ?? ''),
            'value'       => $text($pdef['value'] ?? ''),
            'default'     => $text($pdef['default'] ?? ''),
            'mandatory'   => !empty($pdef['mandatory']),
            'subparam'    => (int)($pdef['subparam'] ?? 0),
            'operator'    => !empty($pdef['operator']),
        ];
    }
    $out[$name] = [
        'note'   => $text($def['note'] ?? ''),
        'do'     => (string)($def['do'] ?? ''),
        'oneof'  => (string)($def['oneof'] ?? ''),
        'params' => (object)$params,
    ];
}
echo json_encode(['version' => CAMINDO_VERSION, 'commands' => $out],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
