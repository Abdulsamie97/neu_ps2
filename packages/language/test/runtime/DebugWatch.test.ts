/**
 * @file DebugWatch.test.ts
 * @brief Prueft lesende Watches und die Aufloesung im ausgewaehlten Aufruf.
 * @author Abdul
 */

import { runInNewContext } from 'node:vm';
import { EmptyFileSystem, URI } from 'langium';
import { expect, test } from 'vitest';
import {
  collectStructFieldNames, createPseudo2Services, generateProgram, isProgram, OBSERVED_WORKER_SCRIPT,
  Pseudo2GeneratorContext, type ObservedExecutionResult, type PausedExecutionStep
} from '../../src/index.js';
import { DEBUG_EXPRESSION_SCRIPT, parseDebugExpression, type DebugExpression } from '../../src/runtime/debug-expression.js';
import type { DebugWatchResult } from '../../src/runtime/debug-watch.js';

const services = createPseudo2Services(EmptyFileSystem);
const parser = services.Pseudo2.parser.LangiumParser;

/** Erzwingt einen gueltigen Leseausdruck fuer die positiven Tests. */
function expression(source: string): DebugExpression {
  const watch = parseDebugExpression(source, parser);
  if ('error' in watch) throw new Error(`${source}: ${watch.error}`);
  return watch.expression;
}

test('parses Pseudo2 selectors without permitting writes, calls or extra statements', () => {
  expect(expression('liste.next.keys[i]')).toMatchObject({
    kind: 'index', receiver: { kind: 'field', name: 'keys' }, index: { kind: 'variable', name: 'i' }
  });
  expect(expression('A[-1]')).toMatchObject({ kind: 'index', index: { kind: 'unary', op: '-' } });
  expect(expression('A[indices[1] + 1].key')).toMatchObject({ kind: 'field', receiver: { kind: 'index', index: { op: '+' } } });
  for (const source of ['i++', '++i', 'A[i++ + 1]', 'a = 3', 'A[f()]', 'obj.m()', 'i print 7', 'A[', 'i\nprint 7', 'new Item', '[1, 2]']) {
    expect(parseDebugExpression(source, parser), source).toHaveProperty('error');
  }
});

const evaluate = runInNewContext(`${DEBUG_EXPRESSION_SCRIPT}\nevaluateDebugExpression`) as (
  value: DebugExpression, locals: Map<string, unknown>, globals: Map<string, unknown>, fieldNames: Record<string, string>
) => unknown;

test('uses the JavaScript generator semantics for pure numeric, text and boolean expressions', async () => {
  const sources = [
    '2 + 3 * 4', '(2 + 3) * 4', '2 ^ 3 ^ 2', '(2 ^ 3) ^ 2', '-2 ^ 2', '2 ^ -2',
    '7 / 2', '8 / 2 / 2', '7 - 3 - 2', '-7 mod 3', '7 % 3', '1 / 0', '0 / 0',
    '"i=" + 3 + true', '!(1 <= 2) || 3 >= 3', 'null == null', 'false && true || true'
  ];
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(
    sources.map(source => `print ${source}`).join('\n'), URI.parse('memory:/debug-expression-parity.pseudo2')
  );
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  expect(document.diagnostics?.filter(item => item.severity === 1)).toEqual([]);
  const program = document.parseResult.value;
  if (!isProgram(program)) throw new Error('Expected a Pseudo2 program.');
  const output: unknown[] = [];
  const capture = (value: unknown) => output.push(value);
  runInNewContext(generateProgram(program), { console: { log: capture, __ps2_write: capture } });
  expect(sources.map(source => evaluate(expression(source), new Map(), new Map(), {}))).toEqual(output);
});

test('short-circuits missing values and rejects invalid operand types', () => {
  const read = (source: string) => evaluate(expression(source), new Map(), new Map(), {});
  expect(read('false && missing > 0')).toBe(false);
  expect(read('true || missing > 0')).toBe(true);
  expect(() => read('true + 1')).toThrow('Operator +');
  expect(() => read('"3" * 2')).toThrow('erwartet zwei Zahlen');
  expect(() => read('2 || false')).toThrow('boolescher Wert');
});

test('reads actual array elements and isolated locals in a paused generated program', async () => {
  const source = `struct Item
    num key
    Item next

var A[85] = 2
A[80] = 9
var i = 80
var node = new Item
node.key = 4

func lookup(i)
    var local = node
    return A[i]

print lookup(1)
`;
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse('memory:/debug-watch.pseudo2'));
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  expect(document.diagnostics?.filter(item => item.severity === 1)).toEqual([]);
  const program = document.parseResult.value;
  if (!isProgram(program)) throw new Error('Expected a Pseudo2 program.');
  const context = Pseudo2GeneratorContext.fromProgram(program, true, false, true);
  const breakLine = source.split('\n').findIndex(line => line.trim() === 'return A[i]') + 1;
  const expressions = [
    'i', 'A[i]', 'A[80]', 'local.key', 'node.next.key', 'A[0]', 'missing', 'A',
    'i + 1', 'A[i + 79]', 'A[3 / 2]', 'false && A[0] == 9'
  ].map(expression);
  const replies = new Map<number, DebugWatchResult[]>();
  let output: string[] | undefined;
  type Message = Partial<ObservedExecutionResult> & {
    type?: string; step?: PausedExecutionStep; requestId?: number; results?: DebugWatchResult[];
  };
  const worker = {
    postMessage(message: Message) {
      if (message.type === 'watches' && message.requestId !== undefined) {
        replies.set(message.requestId, message.results ?? []);
      }
      if (message.step) {
        const frameId = message.step.line === breakLine ? message.step.frames.at(-1)?.id : undefined;
        queueMicrotask(() => {
          if (frameId !== undefined) {
            void worker.onmessage({ data: { command: 'inspectWatches', requestId: 1, frameId, expressions } });
            void worker.onmessage({ data: { command: 'inspectWatches', requestId: 2, frameId: 0, expressions } });
          }
          void worker.onmessage({ data: { command: 'continue' } });
        });
      }
      if (message.output) output = message.output;
    }
  } as { postMessage: (message: Message) => void; onmessage: (event: { data: Record<string, unknown> }) => Promise<void> };
  runInNewContext(OBSERVED_WORKER_SCRIPT, { self: worker });
  await worker.onmessage({ data: {
    source: generateProgram(program, context), fieldNames: collectStructFieldNames(program, context),
    debugMode: true, inspectValues: true, breakpoints: [breakLine]
  } });

  expect(replies.get(1)?.slice(0, 4)).toEqual([{ value: '1' }, { value: '2' }, { value: '9' }, { value: '4' }]);
  expect(replies.get(1)?.[4]).toMatchObject({ error: expect.stringContaining('Kein Struct') });
  expect(replies.get(1)?.[5]).toMatchObject({ error: expect.stringContaining('ausserhalb') });
  expect(replies.get(1)?.[6]).toMatchObject({ error: expect.stringContaining('missing') });
  expect(replies.get(1)?.[7]).toMatchObject({ debugValue: { text: 'Array (85)', omitted: 45 } });
  expect(replies.get(1)?.slice(8, 10)).toEqual([{ value: '2' }, { value: '9' }]);
  expect(replies.get(1)?.[10]).toMatchObject({ error: expect.stringContaining('Ganzzahl') });
  expect(replies.get(1)?.[11]).toEqual({ value: 'false' });
  expect(replies.get(2)?.slice(0, 3)).toEqual([{ value: '80' }, { value: '9' }, { value: '9' }]);
  expect(replies.get(2)?.[3]).toMatchObject({ error: expect.stringContaining('local') });
  expect(output).toEqual(['2\n']);

  await worker.onmessage({ data: { command: 'inspectWatches', requestId: 3, frameId: 0, expressions } });
  expect(replies.get(3)).toEqual([]);
});
