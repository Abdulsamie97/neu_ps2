/**
 * @file variable-inspector.ts
 * @brief Gemeinsame Variablenbeobachtung fuer Browser- und VS-Code-Editoren.
 * @author Abdul
 */

import { AstUtils } from 'langium';
import type { Program } from '../generated/ast.js';
import {
  isFunctionDeclaration,
  isParameterDecl,
  isStructAttDeclaration,
  isStructDeclaration,
  isVarDecl
} from '../generated/ast.js';
import { Pseudo2GeneratorContext } from '../generators/javascript/generator-context.js';

/** Deklaration und Quellort einer globalen oder lokalen Variable. */
export interface VariableDefinition {
  id: string;
  name: string;
  scope: string;
  global: boolean;
  line: number;
}

/** Zuletzt beobachteter Wert einer Deklaration. */
export interface VariableValue extends VariableDefinition {
  value: string;
  changedLine: number;
}

/** Ausgabe und Variablen nach einem beobachteten Programmlauf. */
export interface ObservedExecutionResult {
  output: string[];
  error?: string;
  variables: VariableValue[];
  steps?: ExecutionStep[];
  traceTruncated?: boolean;
}

/** Zustand unmittelbar vor einer Pseudo2-Zeile oder am Programmende. */
export interface ExecutionStep {
  line: number | null;
  outputCount: number;
  variables: VariableValue[];
  status?: 'completed' | 'error';
}

/** Obergrenze fuer gespeicherte Quellschritte je Programmlauf. */
export const MAX_TRACE_STEPS = 1000;

/**
 * Sammelt Variablen, Parameter und Schleifeniteratoren mit stabiler Generator-ID.
 * Struct-Felder sind keine eigenstaendigen Variablen; sie erscheinen im Struct-Wert.
 */
export function collectVariableDefinitions(
  program: Program,
  context?: Pseudo2GeneratorContext
): VariableDefinition[] {
  let generatedNames = context;
  if (!generatedNames) {
    try {
      generatedNames = Pseudo2GeneratorContext.fromProgram(program);
    } catch {
      // Beim Tippen kann eine noch unvollstaendige Deklaration keinen Zielnamen bekommen.
    }
  }
  return [...AstUtils.streamAllContents(program)]
    .filter(node => isVarDecl(node) || isParameterDecl(node))
    .filter(variable => typeof variable.name === 'string' && variable.name.length > 0)
    .map((variable, index) => {
      const fn = AstUtils.getContainerOfType(variable, isFunctionDeclaration);
      const struct = fn ? AstUtils.getContainerOfType(fn, isStructDeclaration) : undefined;
      return {
        id: generatedNames?.getVarName(variable) ?? `source_${index}`,
        name: variable.name,
        scope: fn ? `${struct ? `Methode ${struct.name}.` : 'Funktion '}${fn.name ?? '?'}` : 'Programm',
        global: variable.$container.$type === 'Program',
        line: (variable.$cstNode?.range.start.line ?? variable.$container.$cstNode?.range.start.line ?? 0) + 1
      };
    });
}

/** Ordnet generierte Struct-Feldnamen den Pseudo2-Quellnamen zu. */
export function collectStructFieldNames(program: Program, context: Pseudo2GeneratorContext): Record<string, string> {
  return Object.fromEntries(
    [...AstUtils.streamAllContents(program)]
      .filter(isStructAttDeclaration)
      .map(field => [context.getVarName(field), field.name])
  );
}

/**
 * Worker-Code ohne Browser- oder Node-spezifische Imports. Ein Host stellt
 * `self.postMessage` bereit und leitet eine Eingabenachricht an `self.onmessage`.
 */
export const OBSERVED_WORKER_SCRIPT = String.raw`
function formatValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'undefined') return 'undefined';
  if (typeof value === 'bigint') return String(value) + 'n';
  if (value instanceof Error) return value.name + ': ' + value.message;
  try {
    var json = JSON.stringify(value);
    return typeof json === 'undefined' ? String(value) : json;
  } catch (_) {
    return String(value);
  }
}

function formatVariable(value, fieldNames, depth, path) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value !== 'object') return String(value);
  if (path.has(value)) return '[Zyklus]';
  if (depth >= 4) return '...';
  path.add(value);
  try {
    if (typeof value.get === 'function' && Object.prototype.hasOwnProperty.call(value, 'value')) {
      return formatVariable(value.get(), fieldNames, depth + 1, path);
    }
    if (Array.isArray(value.ref) || Array.isArray(value)) {
      var items = Array.isArray(value) ? value : value.ref;
      var shown = items.slice(0, 30).map(item => formatVariable(item, fieldNames, depth + 1, path));
      if (items.length > 30) shown.push('...');
      return '[' + shown.join(', ') + ']';
    }
    var object = typeof value.getRef === 'function' ? value.getRef() : value;
    if (object === null) return 'null';
    if (path.has(object) && object !== value) return '[Zyklus]';
    if (object !== value) path.add(object);
    try {
      var entries = Object.entries(object);
      var shown = entries.slice(0, 30).map(function (entry) {
        return (fieldNames[entry[0]] || entry[0]) + ': ' + formatVariable(entry[1], fieldNames, depth + 1, path);
      });
      if (entries.length > 30) shown.push('...');
      return '{' + shown.join(', ') + '}';
    } finally {
      if (object !== value) path.delete(object);
    }
  } finally {
    path.delete(value);
  }
}

self.onmessage = function (event) {
  var output = [];
  var traces = new Map();
  var traceCount = 0;
  var stepLimit = Math.min(${MAX_TRACE_STEPS}, Math.max(0, Math.floor(Number(event.data.stepLimit) || 0)));
  var steps = [];
  var pendingSteps = [];
  var traceTruncated = false;
  var capturedConsole = {
    log: function () { output.push(Array.from(arguments).map(formatValue).join(' ') + '\n'); },
    warn: function () { output.push(Array.from(arguments).map(formatValue).join(' ') + '\n'); },
    error: function () { output.push(Array.from(arguments).map(formatValue).join(' ') + '\n'); },
    __ps2_write: function (value, ending) { output.push(formatValue(value) + String(ending)); }
  };

  function currentVariables() {
    return Array.from(traces.values()).map(function (entry) {
      return Object.assign({}, entry.metadata, {
        value: formatVariable(entry.value, event.data.fieldNames, 0, new Set())
      });
    });
  }

  function trace(metadata, value) {
    traces.set(metadata.id, { metadata: metadata, value: value });
    traceCount++;
    if (traceCount <= 500 || traceCount % 5000 === 0) {
      try {
        self.postMessage({ type: 'variable', variable: Object.assign({}, metadata, {
          value: formatVariable(value, event.data.fieldNames, 0, new Set())
        }) });
      } catch (_) {
        // Darstellung darf die Programmausfuehrung nicht beeinflussen.
      }
    }
  }

  function flushSteps() {
    if (pendingSteps.length > 0) {
      self.postMessage({ type: 'steps', steps: pendingSteps });
      pendingSteps = [];
    }
  }

  function recordStep(entry) {
    steps.push(entry);
    pendingSteps.push(entry);
    if (pendingSteps.length >= 25) flushSteps();
  }

  function step(line) {
    if (stepLimit === 0) return;
    if (steps.length >= stepLimit) {
      traceTruncated = true;
      return;
    }
    recordStep({ line: line, outputCount: output.length, variables: currentVariables() });
  }

  function finishTrace(status) {
    if (stepLimit === 0) return;
    recordStep({ line: null, outputCount: output.length, variables: currentVariables(), status: status });
    flushSteps();
  }

  try {
    new Function('console', '__ps2_trace', '__ps2_step', '"use strict";\n' + event.data.source)(capturedConsole, trace, step);
    finishTrace('completed');
    self.postMessage({ output: output, variables: currentVariables(), steps: steps, traceTruncated: traceTruncated });
  } catch (error) {
    finishTrace('error');
    self.postMessage({
      output: output,
      error: error instanceof Error ? error.name + ': ' + error.message : String(error),
      variables: currentVariables(),
      steps: steps,
      traceTruncated: traceTruncated
    });
  }
};`;

/**
 * Fuehrt beobachtetes JavaScript in einem kurzlebigen Browser-Worker aus.
 * Zwischenmeldungen liefern Werte waehrend der Ausfuehrung; ein Zeitlimit
 * beendet Endlosschleifen, ohne den Editor zu blockieren.
 */
export function executeObservedJavaScript(
  source: string,
  fieldNames: Record<string, string>,
  onVariable: (variable: VariableValue) => void,
  timeoutMs = 5_000,
  stepLimit = 0
): Promise<ObservedExecutionResult> {
  return new Promise(resolve => {
    const workerUrl = URL.createObjectURL(new Blob([OBSERVED_WORKER_SCRIPT], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    const lastValues = new Map<string, VariableValue>();
    const lastSteps: ExecutionStep[] = [];
    let settled = false;

    const finish = (result: ObservedExecutionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve({ ...result, variables: result.variables ?? [...lastValues.values()], steps: result.steps ?? lastSteps });
    };

    const timeout = setTimeout(() => finish({
      output: [],
      error: `Zeitlimit von ${timeoutMs / 1000} Sekunden ueberschritten.`,
      variables: [...lastValues.values()],
      steps: lastSteps
    }), timeoutMs);

    worker.onmessage = event => {
      const result = event.data as ObservedExecutionResult & { type?: string; variable?: VariableValue };
      if (result.type === 'variable' && result.variable) {
        lastValues.set(result.variable.id, result.variable);
        onVariable(result.variable);
      } else if (result.type === 'steps' && Array.isArray(result.steps)) {
        lastSteps.push(...result.steps);
      } else {
        finish({
          output: Array.isArray(result.output) ? result.output.map(String) : [],
          error: typeof result.error === 'string' ? result.error : undefined,
          variables: Array.isArray(result.variables) ? result.variables : [...lastValues.values()],
          steps: Array.isArray(result.steps) ? result.steps : lastSteps,
          traceTruncated: result.traceTruncated === true
        });
      }
    };
    worker.onerror = event => finish({
      output: [],
      error: event.message || 'Unbekannter Worker-Fehler.',
      variables: [...lastValues.values()],
      steps: lastSteps
    });
    worker.postMessage({ source, fieldNames, stepLimit });
  });
}
