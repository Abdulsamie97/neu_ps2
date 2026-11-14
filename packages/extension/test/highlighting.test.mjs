import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = JSON.parse(await readFile(new URL('../../language/syntaxes/pseudo2.tmLanguage.json', import.meta.url), 'utf8'));
const installed = JSON.parse(await readFile(new URL('../syntaxes/pseudo2.tmLanguage.json', import.meta.url), 'utf8'));
assert.deepEqual(installed, source);

const comments = installed.repository.comments.patterns;
const line = comments.find(pattern => pattern.begin === '//(?!@)');
assert.equal(line?.name, 'comment.line.pseudo2');
assert.equal(new RegExp(line.begin).test('// ordinary comment'), true);
assert.equal(new RegExp(line.begin).test('//'), true);
assert.equal(new RegExp(line.begin).test('//@ requires true'), false);
assert.ok(comments.some(pattern => pattern.name === 'comment.block.pseudo2'));
assert.ok(comments.some(pattern => pattern.begin === '//@'));

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const bindings = manifest.contributes.keybindings.filter(binding => binding.command === 'pseudo2.toggleLineComment');
assert.deepEqual(bindings.map(binding => binding.key), ['ctrl+/', 'ctrl+shift+[Digit7]']);
assert.ok(bindings.every(binding => binding.when.includes('editorLangId == pseudo2')));

console.log('VS Code Pseudo2 comment highlighting test passed.');
