/**
 * @file DebugPause.test.ts
 * @brief Prueft Pause-Anforderungen zwischen echten Worker-Haltepunkten.
 * @author Abdul
 */

import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { OBSERVED_WORKER_SCRIPT, type ObservedExecutionResult, type PausedExecutionStep } from '../../src/runtime/variable-inspector.js';

test('a pause request stops at the next step only if the worker is running', async () => {
  const pauses: PausedExecutionStep[] = [];
  let outcome: Partial<ObservedExecutionResult> | undefined;
  type Message = Partial<ObservedExecutionResult> & { step?: PausedExecutionStep };
  const worker = {
    postMessage(message: Message) {
      const step = message.step;
      if (step) {
        pauses.push(step);
        queueMicrotask(() => {
          if (step.reason === 'entry') {
            // Eine kurz vor der Eintrittspause gesendete Meldung trifft verspaetet ein.
            void worker.onmessage({ data: { command: 'pause' } });
          }
          void worker.onmessage({ data: { command: 'continue' } });
          if (step.reason === 'breakpoint') {
            void worker.onmessage({ data: { command: 'pause' } });
          }
        });
      }
      if (message.output) outcome = message;
    }
  } as { postMessage: (message: Message) => void; onmessage: (event: { data: Record<string, unknown> }) => Promise<void> };
  runInNewContext(OBSERVED_WORKER_SCRIPT, { self: worker });
  await worker.onmessage({ data: {
    source: 'await __ps2_step(1); await __ps2_step(2); await __ps2_step(3); await __ps2_step(4); console.log("done");',
    debugMode: true,
    fieldNames: {},
    breakpoints: [3]
  } });

  expect(pauses.map(({ line, reason }) => [line, reason])).toEqual([[1, 'entry'], [3, 'breakpoint'], [4, 'pause']]);
  expect(outcome?.error).toBeUndefined();
  expect(outcome?.output).toEqual(['done\n']);
});
