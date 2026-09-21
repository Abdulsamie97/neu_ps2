/**
 * @file smoke.mjs
 * @brief Prueft Einzeldatei-Struktur und gemeinsame Pseudo2-JavaScript-Pipeline.
 * @author Abdul
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmptyFileSystem, URI } from 'langium';
import { createPseudo2Services, generateProgram } from 'pseudo2-language';

const workspaceDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(workspaceDirectory, 'dist');
const outputFile = join(outputDirectory, 'pseudo2-js-runner.html');

const files = await readdir(outputDirectory);
assert.deepEqual(files, ['pseudo2-js-runner.html'], 'The standalone build must contain exactly one file.');

const html = await readFile(outputFile, 'utf8');
assert.equal(/<script[^>]+src=/i.test(html), false, 'The standalone HTML must not load an external script.');
assert.equal(/<link[^>]+rel=["']stylesheet/i.test(html), false, 'The standalone HTML must not load an external stylesheet.');
assert.equal(html.includes('__PSEUDO2_SCRIPT__'), false, 'The script placeholder must be replaced.');
assert.equal(html.includes('__PSEUDO2_STYLES__'), false, 'The style placeholder must be replaced.');
assert.match(html, /Pseudo2 Standalone/, 'The generated file must contain the standalone UI.');

const source = `func square(value)
    return value * value

var values = [1, 2, 3, 4]
for i=1 to 4
    print square(values[i])
`;

const services = createPseudo2Services(EmptyFileSystem);
const document = services.shared.workspace.LangiumDocumentFactory.fromString(
  source,
  URI.parse('memory:/standalone-smoke-test.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([document], { validation: true });

const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
assert.deepEqual(errors, [], `The standalone example must validate: ${errors.map(error => error.message).join('; ')}`);

const javaScript = generateProgram(document.parseResult.value);
const output = [];
const capturedConsole = {
  log: (...values) => output.push(values.map(String).join(' ')),
  warn: (...values) => output.push(values.map(String).join(' ')),
  error: (...values) => output.push(values.map(String).join(' '))
};
new Function('console', `"use strict";\n${javaScript}`)(capturedConsole);

assert.deepEqual(output, ['1', '4', '9', '16'], 'Generated JavaScript must produce the expected output.');
console.log('Standalone smoke test passed.');
