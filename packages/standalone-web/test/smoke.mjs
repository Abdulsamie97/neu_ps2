/**
 * @file smoke.mjs
 * @brief Prueft Einzeldatei-Struktur und gemeinsame Pseudo2-JavaScript-Pipeline.
 * @author Abdul
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { EmptyFileSystem, URI } from 'langium';
import {
  OBSERVED_WORKER_SCRIPT, collectStructFieldNames, collectVariableDefinitions,
  createPseudo2Services, generateProgram, isVarDecl, PSEUDO2_VERSION, Pseudo2GeneratorContext
} from 'pseudo2-language';

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
assert.match(html, /id="language-version"/, 'The standalone editor must have a visible language version.');
assert.ok(html.includes(JSON.stringify(PSEUDO2_VERSION)), 'The bundled script must include the current language version.');
assert.match(html, /id="editor-diagnostic"/, 'The standalone editor must contain its inline diagnostic message.');
assert.match(html, /diagnostic-range/, 'The standalone bundle must contain source-range diagnostic decorations.');
assert.match(html, /data-diagnostic-line/, 'The standalone bundle must contain diagnostic line markers.');
assert.match(html, /id="completion-list"/, 'The editor must contain its completion list.');
assert.match(html, /id="variable-list"/, 'The UI must contain the runtime variable panel.');

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

const invalidDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
  'print unknownValue\n',
  URI.parse('memory:/standalone-invalid-smoke-test.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([invalidDocument], { validation: true });
const invalidErrors = (invalidDocument.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
assert.ok(invalidErrors.length > 0, 'An unresolved reference must produce an editor error.');
assert.equal(invalidErrors[0].range.start.line, 0, 'The diagnostic must point to the edited source line.');
assert.ok(
  invalidErrors[0].range.end.character > invalidErrors[0].range.start.character,
  'The diagnostic must expose a visible source range for the editor marker.'
);

const javaScript = generateProgram(document.parseResult.value);
const output = [];
const capturedConsole = {
  log: (...values) => output.push(values.map(String).join(' ')),
  warn: (...values) => output.push(values.map(String).join(' ')),
  error: (...values) => output.push(values.map(String).join(' ')),
  __ps2_write: (value, ending) => output.push(`${String(value)}${ending}`)
};
new Function('console', `"use strict";\n${javaScript}`)(capturedConsole);

assert.deepEqual(output, ['1', '4', '9', '16'], 'Generated JavaScript must produce the expected output.');

const context = Pseudo2GeneratorContext.fromProgram(document.parseResult.value);
const globalVariables = document.parseResult.value.instructions.filter(isVarDecl);
const snapshot = new Function('console', `"use strict";\n${javaScript}\nreturn [${globalVariables
  .map(variable => `{ name: ${JSON.stringify(variable.name)}, value: ${context.getVarName(variable)} }`)
  .join(',')}];`)(capturedConsole);
assert.equal(snapshot[0].name, 'values');
assert.deepEqual(snapshot[0].value.get(), [1, 2, 3, 4], 'The runtime panel must see current array values.');

const tracedSource = `func increase(a)
    var local = a
    local = local + 1
    return local
var number = 1
number = 5
var answer = increase(number)
`;
const tracedDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
  tracedSource, URI.parse('memory:/standalone-trace-smoke-test.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([tracedDocument], { validation: true });
assert.deepEqual((tracedDocument.diagnostics ?? []).filter(item => item.severity === 1), []);
const traceEvents = [];
const tracedProgram = tracedDocument.parseResult.value;
const tracedJavaScript = generateProgram(tracedProgram, Pseudo2GeneratorContext.fromProgram(tracedProgram, true));
new Function('console', '__ps2_trace', `"use strict";\n${tracedJavaScript}`)(capturedConsole, (metadata, value) => {
  traceEvents.push({ ...metadata, value: value.get() });
});
assert.deepEqual(traceEvents.filter(event => event.name === 'number').map(event => event.value), [1, 5]);
assert.deepEqual(traceEvents.filter(event => event.name === 'local').map(event => event.value), [5, 6]);
assert.equal(traceEvents.find(event => event.name === 'local').scope, 'Funktion increase');
assert.equal(traceEvents.find(event => event.name === 'local').line, 2);
assert.equal(traceEvents.find(event => event.name === 'local' && event.value === 6).changedLine, 3);
assert.equal(traceEvents.find(event => event.name === 'a').value, 5, 'Function parameters must be observed.');
assert.equal(traceEvents.find(event => event.name === 'answer').value, 6);

const tracedContext = Pseudo2GeneratorContext.fromProgram(tracedProgram, true);
const definitions = collectVariableDefinitions(tracedProgram, tracedContext);
assert.ok(definitions.some(item => item.name === 'number' && item.global));
assert.ok(definitions.some(item => item.name === 'local' && item.scope === 'Funktion increase'));
const workerMessages = [];
const worker = { postMessage: message => workerMessages.push(message) };
runInNewContext(OBSERVED_WORKER_SCRIPT, { self: worker });
worker.onmessage({ data: {
  source: tracedJavaScript,
  fieldNames: collectStructFieldNames(tracedProgram, tracedContext)
} });
const workerResult = workerMessages.at(-1);
assert.equal(workerResult.error, undefined, 'The shared worker script must execute generated JavaScript.');
assert.equal(workerResult.variables.find(item => item.name === 'local').value, '6');
assert.equal(workerResult.variables.find(item => item.name === 'number').changedLine, 6);

const incomplete = services.shared.workspace.LangiumDocumentFactory.fromString(
  'var result = 5\nvar later = 2', URI.parse('memory:/standalone-incomplete-variables.pseudo2')
);
assert.ok(
  collectVariableDefinitions(incomplete.parseResult.value).some(item => item.name === 'later'),
  'An incomplete declaration must not hide unrelated variables in the editor.'
);

const loopEvents = [];
const loopProgram = document.parseResult.value;
new Function('console', '__ps2_trace', `"use strict";\n${generateProgram(
  loopProgram, Pseudo2GeneratorContext.fromProgram(loopProgram, true)
)}`)(capturedConsole, (metadata, value) => {
  if (metadata.name === 'i') loopEvents.push(value.get());
});
assert.deepEqual(loopEvents, [1, 2, 3, 4, 5], 'The for-loop iterator must update after each assignment.');

const completionSource = 'var count = 5\nprint cou';
const completionUri = URI.parse('memory:/standalone-completion-smoke-test.pseudo2');
const completionDocument = services.shared.workspace.LangiumDocumentFactory.fromString(completionSource, completionUri);
await services.shared.workspace.DocumentBuilder.build([completionDocument], { validation: false });
const completions = await services.Pseudo2.lsp.CompletionProvider.getCompletion(completionDocument, {
  textDocument: { uri: completionUri.toString() },
  position: completionDocument.textDocument.positionAt(completionSource.length)
});
assert.ok(completions?.items.some(item => item.label === 'count'), 'Completion must suggest declared variables.');

const printEndingDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
  'print 1 end=" "\nprint 2 end=""\n',
  URI.parse('memory:/standalone-print-ending-smoke-test.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([printEndingDocument], { validation: true });
const printEndingErrors = (printEndingDocument.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
assert.deepEqual(printEndingErrors, [], 'Explicit print endings must validate in the standalone bundle.');

const printEndingOutput = [];
new Function('console', `"use strict";\n${generateProgram(printEndingDocument.parseResult.value)}`)({
  log: (...values) => printEndingOutput.push(`${values.map(String).join(' ')}\n`),
  __ps2_write: (value, ending) => printEndingOutput.push(`${String(value)}${ending}`)
});
assert.equal(printEndingOutput.join(''), '1 2', 'Explicit print endings must be preserved exactly.');
console.log('Standalone smoke test passed.');
