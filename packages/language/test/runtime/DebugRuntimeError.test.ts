/**
 * @file DebugRuntimeError.test.ts
 * @brief Prueft Fehlerzeilen und Werte nach dem Abwickeln verschachtelter Aufrufe.
 * @author Abdul
 */

import { runInNewContext } from 'node:vm';
import { EmptyFileSystem, URI } from 'langium';
import { expect, test } from 'vitest';
import {
  collectStructFieldNames, createPseudo2Services, generateProgram, isProgram, OBSERVED_WORKER_SCRIPT,
  Pseudo2GeneratorContext, type ObservedExecutionResult, type PausedExecutionStep
} from '../../src/index.js';
import { parseDebugExpression } from '../../src/runtime/debug-expression.js';
import type { DebugWatchResult } from '../../src/runtime/debug-watch.js';

/** Fuehrt den echten Generator und Worker aus und setzt regulaere Pausen sofort fort. */
async function run(source: string, debugMode = true, stopOnRuntimeError = true) {
  const services = createPseudo2Services(EmptyFileSystem);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse('memory:/debug-runtime-error.pseudo2'));
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  expect(document.diagnostics?.filter(item => item.severity === 1)).toEqual([]);
  const program = document.parseResult.value;
  if (!isProgram(program)) throw new Error('Expected a Pseudo2 program.');
  const context = Pseudo2GeneratorContext.fromProgram(program, true, false, debugMode);
  const pauses: PausedExecutionStep[] = [];
  const streamed: string[] = [];
  const watches: DebugWatchResult[][] = [];
  let completed: Partial<ObservedExecutionResult> | undefined;
  type Message = Partial<ObservedExecutionResult> & {
    type?: string; text?: string; step?: PausedExecutionStep; results?: DebugWatchResult[];
  };
  const worker = {
    postMessage(message: Message) {
      if (message.step) {
        pauses.push(message.step);
        if (message.step.reason !== 'error') queueMicrotask(() => void command({ command: 'continue' }));
      }
      if (message.text !== undefined) streamed.push(message.text);
      if (message.results) watches.push(message.results);
      if (message.output) completed = message;
    }
  } as { postMessage: (message: Message) => void; onmessage: (event: { data: Record<string, unknown> }) => Promise<void> };
  const command = (data: Record<string, unknown>) => worker.onmessage({ data });
  runInNewContext(OBSERVED_WORKER_SCRIPT, { self: worker });
  await command({
    source: generateProgram(program, context), fieldNames: collectStructFieldNames(program, context),
    debugMode, stopOnRuntimeError, inspectValues: true
  });
  return { services, pauses, streamed, completed, watches, command };
}

const nestedSource = `func inner(index)
    var numbers = [7, 8]
    var bad = index
    return numbers[bad]

func outer(value)
    var caller = value * 10
    return inner(value)

var arg = 3
print "vorher"
print outer(arg)
print "nachher"
`;

test('preserves the failing function, its callers, output and Watches', async () => {
  const result = await run(nestedSource);
  expect(result.pauses.map(step => [step.line, step.reason])).toEqual([[10, 'entry'], [4, 'error']]);
  expect(result.completed).toBeUndefined();
  expect(result.streamed).toEqual(['vorher\n']);

  const failed = result.pauses.at(-1)!;
  expect(failed.runtimeError).toContain('out of bounds');
  expect(failed.frames.map(frame => [frame.name, frame.line])).toEqual([['Programm', 12], ['outer', 8], ['inner', 4]]);
  expect(failed.frames[1].variables.find(value => value.name === 'caller')?.value).toBe('30');
  expect(failed.frames[2].variables.find(value => value.name === 'bad')?.value).toBe('3');
  expect(failed.globals.find(value => value.name === 'arg')?.value).toBe('3');

  const watch = parseDebugExpression('numbers[1]', result.services.Pseudo2.parser.LangiumParser);
  if ('error' in watch) throw new Error(watch.error);
  await result.command({ command: 'continue' });
  await result.command({ command: 'inspectWatches', frameId: failed.frames[2].id, requestId: 1, expressions: [watch.expression] });
  expect(result.watches).toEqual([[{ value: '7' }]]);
  expect(result.pauses).toHaveLength(2);
});

test.each([
  { source: 'throw "kaputt"\n', line: 1, message: 'kaputt', frame: 'Programm' },
  { source: 'var inc = 0\nfor i=1 to 3 by inc\n    print i\n', line: 2, message: 'step-size', frame: 'Programm' },
  { source: 'var A = [1]\nvar i = 1\ndo\n    i += 1\nwhile A[i] == 1\n', line: 5, message: 'out of bounds', frame: 'Programm' },
  { source: 'struct Node\n    num key\n    Node next\n    read()\n        return this.next.key\nvar head = new Node\nhead.next = null\nprint head.read()\n',
    line: 5, message: 'NullPointerException', frame: 'Node.read' }
])('maps $message to Pseudo2 line $line', async ({ source, line, message, frame }) => {
  const result = await run(source);
  const failed = result.pauses.at(-1);
  expect(failed).toMatchObject({ line, reason: 'error' });
  expect(failed?.runtimeError).toContain(message);
  expect(failed?.frames.at(-1)?.name).toBe(frame);
});

test.each([false, true])('reports a terminal error without opt-in (debug mode: %s)', async debugMode => {
  const result = await run(nestedSource, debugMode, false);
  expect(result.pauses.map(step => step.reason)).toEqual(debugMode ? ['entry'] : []);
  expect(result.completed?.error).toContain('out of bounds');
  expect(result.completed?.output).toEqual(['vorher\n']);
});
