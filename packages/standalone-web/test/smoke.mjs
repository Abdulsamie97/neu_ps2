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
assert.match(html, /id="trace-button"/, 'The standalone editor must offer an explicit step trace.');
assert.match(html, /id="trace-position"/, 'The trace must have a step navigator.');
assert.match(html, /id="trace-line-highlight"/, 'The current Pseudo2 source line must be marked.');

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
assert.equal(javaScript.includes('__ps2_step('), false, 'Normal JavaScript output must not contain debug hooks.');
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
assert.deepEqual(Array.from(workerResult.steps), [], 'A normal run must not record steps.');

const stepJavaScript = generateProgram(tracedProgram, Pseudo2GeneratorContext.fromProgram(tracedProgram, true, true));
assert.ok(stepJavaScript.includes('__ps2_step(5)'), 'Debug output must retain the Pseudo2 source line.');
const stepMessages = [];
const stepWorker = { postMessage: message => stepMessages.push(message) };
runInNewContext(OBSERVED_WORKER_SCRIPT, { self: stepWorker });
stepWorker.onmessage({ data: {
  source: stepJavaScript,
  fieldNames: collectStructFieldNames(tracedProgram, tracedContext),
  stepLimit: 1000
} });
const stepResult = stepMessages.at(-1);
assert.equal(stepResult.error, undefined);
assert.deepEqual(Array.from(stepResult.steps, step => step.line), [5, 6, 7, 2, 3, 4, null]);
assert.equal(stepResult.steps[1].variables.find(item => item.name === 'number').value, '1');
assert.equal(stepResult.steps[2].variables.find(item => item.name === 'number').value, '5');
assert.equal(stepResult.steps[4].variables.find(item => item.name === 'local').value, '5');
assert.equal(stepResult.steps[5].variables.find(item => item.name === 'local').value, '6');
assert.equal(stepResult.steps.at(-1).variables.find(item => item.name === 'answer').value, '6');
assert.equal(stepResult.steps.at(-1).status, 'completed');

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

const loopStepMessages = [];
const loopStepWorker = { postMessage: message => loopStepMessages.push(message) };
runInNewContext(OBSERVED_WORKER_SCRIPT, { self: loopStepWorker });
loopStepWorker.onmessage({ data: {
  source: generateProgram(loopProgram, Pseudo2GeneratorContext.fromProgram(loopProgram, true, true)),
  fieldNames: collectStructFieldNames(loopProgram, Pseudo2GeneratorContext.fromProgram(loopProgram)),
  stepLimit: 4
} });
const loopStepResult = loopStepMessages.at(-1);
assert.equal(loopStepResult.error, undefined);
assert.equal(loopStepResult.steps.length, 5, 'The limit must retain four source steps and the terminal state.');
assert.equal(loopStepResult.traceTruncated, true, 'Further loop iterations must be reported as truncated.');
assert.equal(loopStepResult.steps.at(-1).status, 'completed');
assert.equal(loopStepResult.output.join(''), '1\n4\n9\n16\n', 'Recording must not change program output.');

const branchSource = `var count = 0
while count < 2
  count = count + 1
do
  count = count + 1
while count < 3
if count == 3
  print count
`;
const branchDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
  branchSource, URI.parse('memory:/standalone-branch-trace.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([branchDocument], { validation: true });
assert.deepEqual((branchDocument.diagnostics ?? []).filter(item => item.severity === 1), []);
const branchProgram = branchDocument.parseResult.value;
const branchMessages = [];
const branchWorker = { postMessage: message => branchMessages.push(message) };
runInNewContext(OBSERVED_WORKER_SCRIPT, { self: branchWorker });
branchWorker.onmessage({ data: {
  source: generateProgram(branchProgram, Pseudo2GeneratorContext.fromProgram(branchProgram, true, true)),
  fieldNames: {},
  stepLimit: 100
} });
const branchResult = branchMessages.at(-1);
assert.equal(branchResult.error, undefined);
assert.deepEqual(Array.from(branchResult.steps, step => step.line), [1, 2, 3, 2, 3, 2, 4, 5, 7, 8, null]);
assert.equal(branchResult.steps[6].variables.find(item => item.name === 'count').value, '2');
assert.equal(branchResult.steps[8].variables.find(item => item.name === 'count').value, '3');
assert.equal(branchResult.steps.at(-1).outputCount, 1);

const annotatedSource = 'var count = 0\n//@ invariant true\nwhile count < 1\n  count = count + 1\n';
const annotatedDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
  annotatedSource, URI.parse('memory:/standalone-annotated-trace.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([annotatedDocument], { validation: true });
assert.deepEqual((annotatedDocument.diagnostics ?? []).filter(item => item.severity === 1), []);
const annotatedProgram = annotatedDocument.parseResult.value;
const annotatedMessages = [];
const annotatedWorker = { postMessage: message => annotatedMessages.push(message) };
runInNewContext(OBSERVED_WORKER_SCRIPT, { self: annotatedWorker });
annotatedWorker.onmessage({ data: {
  source: generateProgram(annotatedProgram, Pseudo2GeneratorContext.fromProgram(annotatedProgram, true, true)),
  fieldNames: {},
  stepLimit: 100
} });
assert.deepEqual(Array.from(annotatedMessages.at(-1).steps, step => step.line), [1, 3, 4, 3, null]);

const errorSource = 'var value = 1\nthrow "stop"\n';
const errorDocument = services.shared.workspace.LangiumDocumentFactory.fromString(
  errorSource, URI.parse('memory:/standalone-error-trace.pseudo2')
);
await services.shared.workspace.DocumentBuilder.build([errorDocument], { validation: true });
assert.deepEqual((errorDocument.diagnostics ?? []).filter(item => item.severity === 1), []);
const errorProgram = errorDocument.parseResult.value;
const errorMessages = [];
const errorWorker = { postMessage: message => errorMessages.push(message) };
runInNewContext(OBSERVED_WORKER_SCRIPT, { self: errorWorker });
errorWorker.onmessage({ data: {
  source: generateProgram(errorProgram, Pseudo2GeneratorContext.fromProgram(errorProgram, true, true)),
  fieldNames: {},
  stepLimit: 100
} });
const errorResult = errorMessages.at(-1);
assert.equal(errorResult.error, 'stop');
assert.deepEqual(Array.from(errorResult.steps, step => step.line), [1, 2, null]);
assert.equal(errorResult.steps.at(-1).status, 'error');

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
