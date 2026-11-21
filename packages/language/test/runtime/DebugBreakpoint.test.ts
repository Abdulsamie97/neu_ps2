/**
 * @file DebugBreakpoint.test.ts
 * @brief Prueft nebenwirkungsfreie Bedingungen und die Bindung am Haltepunkt.
 * @author Abdul
 */

import { runInNewContext } from 'node:vm';
import { EmptyFileSystem, URI } from 'langium';
import { expect, test } from 'vitest';
import {
  collectStructFieldNames, createDebugBreakpointBinder, createPseudo2Services, generateProgram, isProgram,
  OBSERVED_WORKER_SCRIPT, Pseudo2GeneratorContext, type ObservedExecutionResult, type PausedExecutionStep
} from '../../src/index.js';
import { parseDebugCondition, type DebugConditionInput } from '../../src/runtime/debug-breakpoint.js';

const services = createPseudo2Services(EmptyFileSystem);
const parser = services.Pseudo2.parser.LangiumParser;

/** Erstellt die Eingabe fuers Binden eines akzeptierten Haltepunkts. */
function condition(source: string): DebugConditionInput {
  const parsed = parseDebugCondition(source, parser);
  if ('error' in parsed) throw new Error(`${source}: ${parsed.error}`);
  return { source, expression: parsed.expression };
}

test('accepts read-only Pseudo2 comparisons and rejects updates, calls and extra statements', () => {
  expect(condition('node.next != null && (A[i] >= -2 || !done)').expression).toMatchObject({ kind: 'binary', op: '&&' });
  expect(condition('label == "fertig"').expression).toMatchObject({ right: { kind: 'literal', value: 'fertig' } });
  expect(condition('i mod 2 == 0 && A[i + 1] > 5').expression).toMatchObject({ kind: 'binary', op: '&&' });
  for (const source of ['i++ == 3', '++i == 3', 'f() == 3', 'obj.m()', 'a = 3', 'i print 7', '1 < i < 3', 'i &*& true', '17', 'i + 1']) {
    expect(parseDebugCondition(source, parser), source).toHaveProperty('error');
  }
});

test('skips false conditions, keeps normal halts and resolves the loop iterator only in scope', async () => {
  const source = `var i = 10
var A[12] = 1
A[11] = 5
for i=1 to 12
    print i
print i
print 42
`;
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse('memory:/conditional-breakpoints.pseudo2'));
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  expect(document.diagnostics?.filter(item => item.severity === 1)).toEqual([]);
  const program = document.parseResult.value;
  if (!isProgram(program)) throw new Error('Expected a Pseudo2 program.');
  const context = Pseudo2GeneratorContext.fromProgram(program, true, false, true);
  const bind = createDebugBreakpointBinder(program, context, services.Pseudo2.references.ScopeProvider);
  const header = bind(4, condition('i == 11 || (i == 99 && A[0] == 9)'));
  const body = bind(5, condition('i >= 8 && i < 12 && i mod 2 == 0 && A[i + 1] == 5'));
  const outside = bind(6, condition('i == 10'));
  expect(body.condition?.bindings.i).toBe(header.condition?.bindings.i);
  expect(bind(5, condition('A[i + 1] == 5')).condition?.bindings.i).toBe(body.condition?.bindings.i);
  expect(outside.condition?.bindings.i).not.toBe(body.condition?.bindings.i);

  const pauses: PausedExecutionStep[] = [];
  let execution: Partial<ObservedExecutionResult> | undefined;
  type Message = Partial<ObservedExecutionResult> & { step?: PausedExecutionStep };
  const worker = {
    postMessage(message: Message) {
      if (message.step) {
        const step = message.step;
        pauses.push(step);
        queueMicrotask(() => {
          if (step.reason === 'entry') {
            void worker.onmessage({ data: {
              command: 'setBreakpoints', breakpoints: [3, header, body, outside, bind(7, condition('missing == 0'))]
            } });
          }
          void worker.onmessage({ data: { command: 'continue' } });
        });
      }
      if (message.output) execution = message;
    }
  } as { postMessage: (message: Message) => void; onmessage: (event: { data: Record<string, unknown> }) => Promise<void> };
  runInNewContext(OBSERVED_WORKER_SCRIPT, { self: worker });
  await worker.onmessage({ data: {
    source: generateProgram(program, context), fieldNames: collectStructFieldNames(program, context),
    debugMode: true, breakpoints: []
  } });

  expect(pauses.map(step => step.line)).toEqual([1, 3, 5, 4, 6, 7]);
  expect(pauses.slice(1).map(step => step.conditionalBreakpoint)).toEqual([false, true, true, true, true]);
  expect(pauses[2].frames[0].variables.find(value => value.name === 'i')?.value).toBe('10');
  expect(pauses[3].frames[0].variables.find(value => value.name === 'i')?.value).toBe('11');
  expect(pauses[4].conditionError).toBeUndefined();
  expect(pauses[5].conditionError).toContain('missing ist an dieser Zeile nicht sichtbar');
  expect(execution?.error).toBeUndefined();
  expect(execution?.output?.join('')).toBe(`${Array.from({ length: 12 }, (_, index) => index + 1).join('\n')}\n10\n42\n`);
});
