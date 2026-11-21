/**
 * @file DebugValueSnapshot.test.ts
 * @brief Prueft verschachtelte Pause-Werte und ihre Anzeigegrenzen.
 * @author Abdul
 */

import { runInNewContext } from 'node:vm';
import { EmptyFileSystem, URI } from 'langium';
import { expect, test } from 'vitest';
import {
  collectStructFieldNames, createPseudo2Services, generateProgram, isProgram, OBSERVED_WORKER_SCRIPT,
  Pseudo2GeneratorContext, type ObservedExecutionResult, type PausedExecutionStep
} from '../../src/index.js';
import { DEBUG_VALUE_SNAPSHOT_SCRIPT, type DebugValueSnapshot } from '../../src/runtime/debug-value-snapshot.js';

const describeValue = runInNewContext(`${DEBUG_VALUE_SNAPSHOT_SCRIPT}\ndescribeDebugValue`) as (
  value: unknown, fieldNames: Record<string, string>, budget: { remaining: number }
) => DebugValueSnapshot;

/** Sucht ein direktes Feld oder einen Array-Eintrag in der strukturierten Vorschau. */
function child(value: DebugValueSnapshot | undefined, label: string): DebugValueSnapshot | undefined {
  return value?.children?.find(entry => entry.label === label)?.value;
}

test('limits preview breadth, nesting and total child count', () => {
  const wide = Array.from({ length: 43 }, (_, index) => index);
  const budget = { remaining: 1000 };
  const value = describeValue(wide, {}, budget);
  expect(value.text).toBe('Array (43)');
  expect(value.children).toHaveLength(40);
  expect(child(value, '[1]')?.text).toBe('0');
  expect(child(value, '[40]')?.text).toBe('39');
  expect(value.omitted).toBe(3);

  describeValue(Array(40).fill(wide), {}, budget);
  expect(budget.remaining).toBe(1000 - 40 - 256);
  const smallBudget = { remaining: 2 };
  expect(describeValue(wide, {}, smallBudget)).toMatchObject({ omitted: 41 });
  expect(smallBudget.remaining).toBe(0);
  expect(describeValue(wide, {}, smallBudget)).toEqual({ text: 'Array (43)', omitted: 43 });

  let linked: { next?: object } = {};
  for (let index = 0; index < 12; index++) linked = { next: linked };
  let snapshot: DebugValueSnapshot | undefined = describeValue(linked, {}, budget);
  for (let index = 0; index < 8; index++) snapshot = child(snapshot, 'next');
  expect(snapshot).toEqual({ text: 'Struct (1 Feld)', omitted: 1 });
});

test('does not mistake shared sibling references for cycles', () => {
  const shared = { key: 7 };
  const value = describeValue({ left: shared, right: shared }, {}, { remaining: 100 });
  expect(child(child(value, 'left'), 'key')?.text).toBe('7');
  expect(child(child(value, 'right'), 'key')?.text).toBe('7');
});

test('a debug pause transmits source field names and handles nested arrays, null and cycles', async () => {
  const source = `struct Link
    num key
    num[] items
    Link next

func peek(node)
    var local = node
    return local.key

var head = new Link
var tail = new Link
var empty = [0]
empty = []
head.key = 5
head.items = [2, 4]
head.next = tail
tail.next = head
print peek(head)
`;
  const services = createPseudo2Services(EmptyFileSystem);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse('memory:/debug-values.pseudo2'));
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  expect(document.diagnostics?.filter(item => item.severity === 1)).toEqual([]);
  const program = document.parseResult.value;
  if (!isProgram(program)) throw new Error('Expected a Pseudo2 program.');
  const context = Pseudo2GeneratorContext.fromProgram(program, true, false, true);
  const breakLine = source.split('\n').findIndex(line => line.trim() === 'return local.key') + 1;
  const pauses: PausedExecutionStep[] = [];
  const messages: Partial<ObservedExecutionResult>[] = [];
  const worker = {
    postMessage(message: Partial<ObservedExecutionResult> & { step?: PausedExecutionStep }) {
      messages.push(message);
      if (message.step) {
        pauses.push(message.step);
        queueMicrotask(() => void worker.onmessage({ data: { command: 'continue' } }));
      }
    }
  } as {
    postMessage: (message: Partial<ObservedExecutionResult> & { step?: PausedExecutionStep }) => void;
    onmessage: (event: { data: Record<string, unknown> }) => Promise<void>;
  };
  runInNewContext(OBSERVED_WORKER_SCRIPT, { self: worker });
  await worker.onmessage({ data: {
    source: generateProgram(program, context), fieldNames: collectStructFieldNames(program, context),
    debugMode: true, inspectValues: true, breakpoints: [breakLine]
  } });

  const pause = pauses.at(-1);
  expect(pause?.line).toBe(breakLine);
  const head = pause?.globals.find(value => value.name === 'head')?.debugValue;
  const local = pause?.frames.at(-1)?.variables.find(value => value.name === 'local')?.debugValue;
  expect(head?.text).toBe('Struct (3 Felder)');
  expect(local).toEqual(head);
  expect(child(head, 'key')?.text).toBe('5');
  expect(child(child(head, 'items'), '[1]')?.text).toBe('2');
  expect(child(child(head, 'items'), '[2]')?.text).toBe('4');
  expect(child(child(head, 'next'), 'items')?.text).toBe('null');
  expect(child(child(head, 'next'), 'next')).toEqual({ text: '[Zyklus]' });
  expect(pause?.globals.find(value => value.name === 'empty')?.debugValue).toEqual({ text: 'Array (0)' });

  const result = messages.at(-1);
  expect(result?.output).toEqual(['5\n']);
  expect(result?.variables?.every(value => value.debugValue === undefined)).toBe(true);
});
