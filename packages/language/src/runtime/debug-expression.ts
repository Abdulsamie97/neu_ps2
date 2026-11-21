/**
 * @file debug-expression.ts
 * @brief Gemeinsamer nebenwirkungsfreier Ausdrucksauswerter fuer den Debugger.
 * @author Abdul
 */

import type { LangiumParser } from 'langium';
import {
  isAddition, isAnd, isAttSelection, isBoolLiteral, isComparison, isEquality, isExponentiation,
  isGrouping, isIndexSelection, isIntLiteral, isMultiplication, isNeg, isNot, isNullLiteral,
  isOr, isStringLiteral, isVarRef, type Expr
} from '../generated/ast.js';

export const MAX_DEBUG_EXPRESSION_LENGTH = 200;
const booleanOperators = ['&&', '||', '==', '!=', '<', '<=', '>', '>='] as const;
const binaryOperators = [...booleanOperators, '+', '-', '*', '/', '%', 'mod', '^'] as const;
type BinaryOperator = typeof binaryOperators[number];

/** Uebertragbarer AST, der keine Aufrufe, Allokationen oder Schreiboperationen enthaelt. */
export type DebugExpression =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'variable'; name: string }
  | { kind: 'field'; receiver: DebugExpression; name: string }
  | { kind: 'index'; receiver: DebugExpression; index: DebugExpression }
  | { kind: 'unary'; op: '!' | '-'; value: DebugExpression }
  | { kind: 'binary'; op: BinaryOperator; left: DebugExpression; right: DebugExpression };

/** Erhaelt Gruppierung und Praezedenz des Sprach-AST und laesst nur lesende Knoten zu. */
function compile(expr: Expr): DebugExpression | undefined {
  if (isGrouping(expr)) return compile(expr.value);
  if (isBoolLiteral(expr)) return { kind: 'literal', value: expr.value === 'true' };
  if (isNullLiteral(expr)) return { kind: 'literal', value: null };
  if (isStringLiteral(expr) || isIntLiteral(expr)) return { kind: 'literal', value: expr.value };
  if (isNot(expr) || isNeg(expr)) {
    const value = compile(expr.value);
    return value && { kind: 'unary', op: isNot(expr) ? '!' : '-', value };
  }
  if (isVarRef(expr)) return compileIndex({ kind: 'variable', name: expr.ref.$refText }, expr.index);
  if (isAttSelection(expr)) {
    const receiver = compile(expr.receiver);
    return receiver && compileIndex({ kind: 'field', receiver, name: expr.attref.ref.$refText }, expr.attref.index);
  }
  if (isIndexSelection(expr)) {
    const receiver = compile(expr.receiver);
    return receiver && compileIndex(receiver, expr.index);
  }
  if (isOr(expr) || isAnd(expr) || isEquality(expr) || isComparison(expr) || isAddition(expr)
    || isMultiplication(expr) || isExponentiation(expr)) {
    if (!expr.right.length) return compile(expr.left);
    const operands: DebugExpression[] = [];
    for (const operand of [expr.left, ...expr.right]) {
      const value = compile(operand);
      if (!value) return undefined;
      operands.push(value);
    }
    if (isExponentiation(expr)) {
      // Der JavaScript-Generator verwendet rechtsassoziatives ** fuer ^.
      let right = operands[operands.length - 1];
      for (let i = operands.length - 2; i >= 0; i--) right = { kind: 'binary', op: '^', left: operands[i], right };
      return right;
    }
    let left = operands[0];
    for (let i = 0; i < expr.right.length; i++) {
      const symbol = isOr(expr) ? '||' : isAnd(expr) ? '&&' : expr.op[i];
      const op = binaryOperators.find(candidate => candidate === symbol);
      if (!op) return undefined;
      left = { kind: 'binary', op, left, right: operands[i + 1] };
    }
    return left;
  }
  return undefined;
}

/** Indizes sind ebenfalls lesende Ausdruecke; ihren Zahlenwert prueft der Worker. */
function compileIndex(receiver: DebugExpression, source?: Expr): DebugExpression | undefined {
  if (!source) return receiver;
  const index = compile(source);
  return index && { kind: 'index', receiver, index };
}

/** Parst normale Pseudo2-Ausdruecke, ohne sie auszufuehren oder gegen ein Dokument zu linken. */
export function parseDebugExpression(source: string, parser: Pick<LangiumParser, 'parse'>): { expression: DebugExpression } | { error: string } {
  const text = source.trim();
  if (!text || text.length > MAX_DEBUG_EXPRESSION_LENGTH || /[\r\n]/.test(text)) {
    return { error: 'Ein kurzer, einzeiliger Ausdruck ist erforderlich.' };
  }
  try {
    const parsed = parser.parse<Expr>(text, { rule: 'Expression' });
    if (!parsed.lexerErrors.length && !parsed.parserErrors.length) {
      const expression = compile(parsed.value);
      return expression ? { expression } : { error: 'Erlaubt sind nur lesende Ausdruecke ohne Aufrufe, Konstruktionen oder Aenderungen.' };
    }
  } catch {
    // Unvollstaendige Eingaben duerfen keinen Debug-Lauf unterbrechen.
  }
  return { error: 'Ungueltiger Pseudo2-Ausdruck.' };
}

/** Erkennt Bedingungen, deren oberster Ausdruck nicht schon sicher einen anderen Typ liefert. */
export function canBeDebugBoolean(expression: DebugExpression): boolean {
  if (expression.kind === 'literal') return typeof expression.value === 'boolean';
  if (expression.kind === 'unary') return expression.op === '!';
  if (expression.kind === 'binary') return booleanOperators.some(op => op === expression.op);
  return true;
}

/** Sammelt alle Variablennamen, einschliesslich Namen in berechneten Array-Indizes. */
export function collectDebugNames(expression: DebugExpression): Set<string> {
  const names = new Set<string>();
  const visit = (node: DebugExpression): void => {
    switch (node.kind) {
      case 'variable': names.add(node.name); break;
      case 'field': visit(node.receiver); break;
      case 'index': visit(node.receiver); visit(node.index); break;
      case 'unary': visit(node.value); break;
      case 'binary': visit(node.left); visit(node.right); break;
    }
  };
  visit(expression);
  return names;
}

/** Interpreter fuer die uebertragbaren Knoten, ohne eval oder new Function fuer Debug-Ausdruecke. */
export const DEBUG_EXPRESSION_SCRIPT = String.raw`
function requireDebugBoolean(value) {
  if (typeof value !== 'boolean') throw new Error('Ein boolescher Wert ist erforderlich.');
  return value;
}

function evaluateDebugExpression(expression, locals, globals, fieldNames, bindings) {
  function findByName(values, name) {
    var found;
    for (var entry of values.values()) {
      if (entry.metadata.name !== name) continue;
      if (found) throw new Error('Mehrdeutiger Variablenname: ' + name + '.');
      found = entry;
    }
    return found;
  }

  function readVariable(name) {
    var entry;
    if (bindings) {
      if (!Object.hasOwn(bindings, name)) throw new Error(name + ' ist an dieser Zeile nicht sichtbar.');
      var id = bindings[name];
      entry = locals.get(id) || globals.get(id);
    } else {
      entry = findByName(locals, name) || findByName(globals, name);
    }
    if (!entry) throw new Error('Kein beobachteter Wert fuer ' + name + ' in diesem Aufruf.');
    return unwrapDebugValue(entry.value);
  }

  function readField(receiver, name) {
    if (receiver === null || typeof receiver !== 'object' || Array.isArray(receiver)) {
      throw new Error('Kein Struct fuer Feld ' + name + '.');
    }
    var key = Object.keys(receiver).find(function (key) {
      return (Object.hasOwn(fieldNames, key) ? fieldNames[key] : key) === name;
    });
    if (key === undefined) throw new Error('Unbekanntes Struct-Feld: ' + name + '.');
    return unwrapDebugValue(receiver[key]);
  }

  function readIndex(node) {
    var receiver = read(node.receiver);
    if (!Array.isArray(receiver)) throw new Error('Der indizierte Wert ist kein Array.');
    var index = read(node.index);
    if (!Number.isSafeInteger(index)) throw new Error('Der Arrayindex muss eine Ganzzahl sein.');
    if (index < 1 || index > receiver.length) {
      throw new Error('Arrayindex ' + index + ' liegt ausserhalb des Arrays (Laenge ' + receiver.length + ').');
    }
    return unwrapDebugValue(receiver[index - 1]);
  }

  function concatScalar(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  function readBinary(node) {
    var left = read(node.left);
    if (node.op === '&&') return requireDebugBoolean(left) && requireDebugBoolean(read(node.right));
    if (node.op === '||') return requireDebugBoolean(left) || requireDebugBoolean(read(node.right));
    var right = read(node.right);
    if (node.op === '==') return left === right;
    if (node.op === '!=') return left !== right;
    if (node.op === '+' && (typeof left === 'string' || typeof right === 'string') && concatScalar(left) && concatScalar(right)) {
      return String(left) + String(right);
    }
    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new Error(node.op === '+' ? 'Operator + erwartet zwei Zahlen oder Text mit einem skalaren Wert.'
        : 'Operator ' + node.op + ' erwartet zwei Zahlen.');
    }
    switch (node.op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      case '%': case 'mod': return left % right;
      case '^': return left ** right;
      case '<': return left < right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '>=': return left >= right;
    }
    throw new Error('Unbekannter Operator: ' + node.op + '.');
  }

  function read(node) {
    switch (node.kind) {
      case 'literal': return node.value;
      case 'variable': return readVariable(node.name);
      case 'field': return readField(read(node.receiver), node.name);
      case 'index': return readIndex(node);
      case 'binary': return readBinary(node);
      case 'unary':
        var value = read(node.value);
        if (node.op === '!') return !requireDebugBoolean(value);
        if (node.op === '-' && typeof value === 'number') return -value;
        throw new Error('Das Vorzeichen - erwartet eine Zahl.');
    }
    throw new Error('Unbekannter Debug-Ausdruck.');
  }

  return read(expression);
}
`;
