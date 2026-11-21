/**
 * @file debug-watch.ts
 * @brief Formatiert Beobachtungsergebnisse im pausierten Worker.
 * @author Abdul
 */

import type { DebugValueSnapshot } from './debug-value-snapshot.js';

export const MAX_DEBUG_WATCHES = 16;

export type DebugWatchResult = { value: string; debugValue?: DebugValueSnapshot } | { error: string };

/** Verwendet denselben Auswerter wie Haltepunktbedingungen und bereitet die Vorschau auf. */
export const DEBUG_WATCH_SCRIPT = String.raw`
function readDebugWatch(expression, locals, globals, fieldNames, budget) {
  try {
    var value = evaluateDebugExpression(expression, locals, globals, fieldNames);
    var tree = describeDebugValue(value, fieldNames, budget);
    return tree ? { value: tree.text, debugValue: tree } : { value: formatVariable(value, fieldNames, 0, new Set()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
`;
