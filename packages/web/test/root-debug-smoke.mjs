/**
 * @file root-debug-smoke.mjs
 * @brief Prueft Debugger-Bedienelemente und die Assets des Root-Bundles.
 * @author Abdul
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../pseudo2-workbench.html', import.meta.url), 'utf8');
const controls = [
  'button-debug', 'debug-start', 'debug-continue', 'debug-step', 'debug-over',
  'debug-out', 'debug-stop', 'debug-status', 'variable-list'
];
const sessionControls = /class="debug-session-actions"[^>]*>\s*<button[^>]*id="debug-start" disabled>[^<]*<\/button>\s*<button[^>]*id="debug-stop" disabled>/;

/** @brief Prueft die Trennung zwischen Werkzeugleiste und Debug-Bereich. */
function assertDebuggerMarkup(name, html) {
  for (const id of controls) {
    assert.match(html, new RegExp(`id="${id}"`), `${name} must expose ${id}`);
  }
  const toolbar = html.match(/<header class="toolbar">[\s\S]*?<\/header>/)?.[0] ?? '';
  const panel = html.match(/<details[^>]*id="debug-panel"[^>]*>[\s\S]*?<\/details>/)?.[0] ?? '';
  assert.match(toolbar, /id="button-debug" aria-controls="debug-panel" disabled>Debug(?:gen| JavaScript)</,
    `${name} must keep a single Debug entry in the toolbar.`);
  assert.doesNotMatch(toolbar, /id="debug-(start|stop)"/);
  assert.match(panel, sessionControls, `${name} must group start and end inside the debugger.`);
}

assertDebuggerMarkup('root', root);
assertDebuggerMarkup('workbench', workbench);
assert.match(root, /runDsl\(\)/, 'The root page must initialize the shared editor.');

if (process.argv.includes('--built')) {
  const built = readFileSync(new URL('../../../dist/index.html', import.meta.url), 'utf8');
  assertDebuggerMarkup('production root bundle', built);

  const assets = [...built.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)]
    .map(([, asset]) => asset);
  assert.ok(assets.some(asset => asset.endsWith('.js')), 'The root bundle must load JavaScript.');
  const stylesheets = assets.filter(asset => asset.endsWith('.css'));
  assert.ok(stylesheets.length > 0, 'The root bundle must load CSS.');
  for (const asset of assets) {
    const path = fileURLToPath(new URL(`../../../dist${asset}`, import.meta.url));
    assert.ok(existsSync(path) && statSync(path).size > 0, `The referenced asset must exist: ${asset}`);
  }
  assert.ok(stylesheets.some(asset => {
    const path = fileURLToPath(new URL(`../../../dist${asset}`, import.meta.url));
    return readFileSync(path, 'utf8').includes('.debug-controls');
  }), 'The root bundle must include debugger styling.');
}

console.log('Web debugger markup smoke test passed.');
