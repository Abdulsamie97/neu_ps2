/**
 * @file debug-watch.ts
 * @brief Parst lesende Beobachtungsausdruecke und wertet sie im pausierten Worker aus.
 * @author Abdul
 */

import type { LangiumParser } from 'langium';
import {
  isAddition, isAnd, isAttSelection, isComparison, isEquality, isExponentiation, isGrouping,
  isIndexSelection, isIntLiteral, isMultiplication, isNeg, isOr, isVarRef, type Expr
} from '../generated/ast.js';
import type { DebugValueSnapshot } from './debug-value-snapshot.js';

export const MAX_DEBUG_WATCHES = 16;
export const MAX_DEBUG_WATCH_LENGTH = 200;

/** Ein uebertragbarer Zugriffspfad ohne Aufrufe, Operatoren oder Schreiboperationen. */
export type DebugWatchPath =
  | { kind: 'variable'; name: string }
  | { kind: 'field'; receiver: DebugWatchPath; name: string }
  | { kind: 'index'; receiver: DebugWatchPath; index: number | DebugWatchPath };

export type DebugWatchResult = { value: string; debugValue?: DebugValueSnapshot } | { error: string };

/** Entfernt reine Praezedenzknoten und Gruppierungen, ohne Operatoren auszuwerten. */
function unwrapWatchExpr(expr: Expr): Expr {
  if (isGrouping(expr)) return unwrapWatchExpr(expr.value);
  if (isOr(expr) || isAnd(expr) || isEquality(expr) || isComparison(expr) || isAddition(expr)
    || isMultiplication(expr) || isExponentiation(expr)) {
    if (expr.right.length === 0) return unwrapWatchExpr(expr.left);
  }
  return expr;
}

/** Uebernimmt nur Variablen-, Feld- und Indexknoten aus dem echten Pseudo2-AST. */
function compileWatchPath(expression: Expr): DebugWatchPath | undefined {
  const expr = unwrapWatchExpr(expression);
  if (isVarRef(expr)) return compileIndex({ kind: 'variable', name: expr.ref.$refText }, expr.index);
  if (isAttSelection(expr)) {
    const receiver = compileWatchPath(expr.receiver);
    if (receiver) return compileIndex({ kind: 'field', receiver, name: expr.attref.ref.$refText }, expr.attref.index);
  }
  if (isIndexSelection(expr)) {
    const receiver = compileWatchPath(expr.receiver);
    if (receiver) return compileIndex(receiver, expr.index);
  }
  return undefined;
}

/** Indizes duerfen Ganzzahlliterale oder ihrerseits lesende Zugriffe sein. */
function compileIndex(receiver: DebugWatchPath, expression?: Expr): DebugWatchPath | undefined {
  if (!expression) return receiver;
  const expr = unwrapWatchExpr(expression);
  const number = isIntLiteral(expr) ? expr.value : isNeg(expr) && isIntLiteral(expr.value) ? -expr.value.value : undefined;
  const index = number !== undefined && Number.isSafeInteger(number) ? number : compileWatchPath(expr);
  return index === undefined ? undefined : { kind: 'index', receiver, index };
}

/** Parst ohne Linking, da Namen erst im ausgewaehlten Debug-Aufruf aufgeloest werden. */
export function parseDebugWatch(source: string, parser: Pick<LangiumParser, 'parse'>): { path: DebugWatchPath } | { error: string } {
  const text = source.trim();
  if (!text || text.length > MAX_DEBUG_WATCH_LENGTH || /[\r\n]/.test(text)) {
    return { error: 'Ein kurzer, einzeiliger Ausdruck ist erforderlich.' };
  }
  try {
    const parsed = parser.parse<Expr>(text, { rule: 'Expression' });
    if (!parsed.lexerErrors.length && !parsed.parserErrors.length) {
      const path = compileWatchPath(parsed.value);
      return path ? { path } : { error: 'Erlaubt sind Variablen, Struct-Felder und Array-Zugriffe.' };
    }
  } catch {
    // Auch unvollstaendige Eingaben duerfen den Debug-Lauf nicht beeinflussen.
  }
  return { error: 'Ungueltiger Pseudo2-Ausdruck.' };
}

/** Liest beobachtete Rohwerte im Worker, unabhaengig von der Groesse der Vorschau. */
export const DEBUG_WATCH_SCRIPT = String.raw`
function readDebugWatch(path, locals, globals, fieldNames, budget) {
  function findByName(values, name) {
    var found;
    for (var entry of values.values()) {
      if (entry.metadata.name !== name) continue;
      if (found) throw new Error('Mehrdeutiger Variablenname: ' + name + '.');
      found = entry;
    }
    return found;
  }

  function read(node) {
    if (node.kind === 'variable') {
      var entry = findByName(locals, node.name) || findByName(globals, node.name);
      if (!entry) throw new Error('Kein beobachteter Wert fuer ' + node.name + ' in diesem Aufruf.');
      return unwrapDebugValue(entry.value);
    }
    var receiver = read(node.receiver);
    if (node.kind === 'field') {
      if (receiver === null || typeof receiver !== 'object' || Array.isArray(receiver)) {
        throw new Error('Kein Struct fuer Feld ' + node.name + '.');
      }
      var key = Object.keys(receiver).find(function (key) {
        return (Object.hasOwn(fieldNames, key) ? fieldNames[key] : key) === node.name;
      });
      if (key === undefined) throw new Error('Unbekanntes Struct-Feld: ' + node.name + '.');
      return unwrapDebugValue(receiver[key]);
    }
    if (!Array.isArray(receiver)) throw new Error('Der indizierte Wert ist kein Array.');
    var index = typeof node.index === 'number' ? node.index : read(node.index);
    if (!Number.isSafeInteger(index)) throw new Error('Der Arrayindex muss eine Ganzzahl sein.');
    if (index < 1 || index > receiver.length) {
      throw new Error('Arrayindex ' + index + ' liegt ausserhalb des Arrays (Laenge ' + receiver.length + ').');
    }
    return unwrapDebugValue(receiver[index - 1]);
  }

  try {
    var value = read(path);
    var tree = describeDebugValue(value, fieldNames, budget);
    return tree ? { value: tree.text, debugValue: tree } : { value: formatVariable(value, fieldNames, 0, new Set()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
`;
