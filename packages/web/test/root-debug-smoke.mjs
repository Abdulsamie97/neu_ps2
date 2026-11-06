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
  'button-debug', 'debug-continue', 'debug-step', 'debug-over',
  'debug-out', 'debug-stop', 'debug-status', 'variable-list'
];

for (const [name, html] of [['root', root], ['workbench', workbench]]) {
  for (const id of controls) {
    assert.match(html, new RegExp(`id="${id}"`), `${name} must expose ${id}`);
  }
}

assert.match(root, /runDsl\(\)/, 'The root page must initialize the shared editor.');

if (process.argv.includes('--built')) {
  const built = readFileSync(new URL('../../../dist/index.html', import.meta.url), 'utf8');
  for (const id of controls) {
    assert.match(built, new RegExp(`id="${id}"`), `The production root bundle must expose ${id}`);
  }

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
