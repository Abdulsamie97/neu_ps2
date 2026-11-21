/**
 * @file debug-breakpoint.ts
 * @brief Lesende Haltepunktbedingungen mit Bindung an die Pseudo2-Quellzeile.
 * @author Abdul
 */

import { AstUtils, GrammarUtils, type LangiumParser, type ScopeProvider } from 'langium';
import {
  isBlock, isDoWhileLoop, isForLoop, isFunctionDeclaration, isInstruction, isProgram,
  isStructAttDeclaration, isStructDeclaration, isVariable, isVerificationStatement, isWhileLoop,
  type Instruction, type Program, type VarRef
} from '../generated/ast.js';
import type { Pseudo2GeneratorContext } from '../generators/javascript/generator-context.js';
import { canBeDebugBoolean, collectDebugNames, parseDebugExpression, type DebugExpression } from './debug-expression.js';

/** Haltepunkt mit optionaler Bedingung und deren aufgeloesten Deklarations-IDs. */
export interface DebugBreakpoint {
  line: number;
  condition?: { expression: DebugExpression; bindings: Record<string, string> };
}

/** Eingabe fuer die Browser-Oberflaeche, bevor ein Programm gebunden wurde. */
export interface DebugConditionInput {
  source: string;
  expression: DebugExpression;
}

/** Parst eine Bedingung mit der normalen Pseudo2-Ausdrucksgrammatik. */
export function parseDebugCondition(source: string, parser: Pick<LangiumParser, 'parse'>): ReturnType<typeof parseDebugExpression> {
  const parsed = parseDebugExpression(source, parser);
  if ('error' in parsed) return parsed;
  return canBeDebugBoolean(parsed.expression) ? parsed : { error: 'Die Haltepunktbedingung muss einen booleschen Wert ergeben.' };
}

/** Bindet Bedingungen anhand der ausfuehrbaren Anweisungen und des regulaeren Pseudo2-Scopes. */
export function createDebugBreakpointBinder(program: Program, context: Pseudo2GeneratorContext, scopeProvider: ScopeProvider) {
  const instructions = new Map<number, Instruction[]>();
  for (const node of AstUtils.streamAllContents(program)) {
    if (!isInstruction(node) || !(isProgram(node.$container) || isBlock(node.$container)) || isBlock(node)
      || isFunctionDeclaration(node) || isStructDeclaration(node) || isVerificationStatement(node)) continue;
    const keyword = isForLoop(node) ? 'for' : isWhileLoop(node) ? 'while' : isDoWhileLoop(node) ? 'do' : undefined;
    const position = (keyword ? GrammarUtils.findNodeForKeyword(node.$cstNode, keyword) : node.$cstNode)?.range.start
      ?? node.$cstNode?.range.start;
    if (!position) continue;
    const line = position.line + 1;
    const existing = instructions.get(line);
    if (existing) existing.push(node);
    else instructions.set(line, [node]);
  }

  return (line: number, input?: DebugConditionInput): DebugBreakpoint => {
    if (!input) return { line };
    const names = collectDebugNames(input.expression);
    const scopes = (instructions.get(line) ?? []).map(node => {
      const ref: VarRef = { $type: 'VarRef', $container: node, ref: { $refText: '', ref: undefined } };
      return { node, scope: scopeProvider.getScope({ container: ref, property: 'ref', reference: ref.ref }) };
    });
    const bindings: [string, string][] = [];
    for (const name of names) {
      const variables = scopes.map(({ node, scope }) => isForLoop(node) && node.iterator?.name === name
        ? node.iterator : scope.getElement(name)?.node);
      const variable = variables[0];
      if (isVariable(variable) && !isStructAttDeclaration(variable) && variables.every(item => item === variable)) {
        bindings.push([name, context.getVarName(variable)]);
      }
    }
    return { line, condition: { expression: input.expression, bindings: Object.fromEntries(bindings) } };
  };
}

/** Fuehrt den erlaubten Bedingungs-AST im Worker aus, ohne Quellcode zu evaluieren. */
export const DEBUG_BREAKPOINT_SCRIPT = String.raw`
function readDebugBreakpoints(breakpoints) {
  return new Map((breakpoints || []).map(function (point) {
    return typeof point === 'number' ? [point, undefined] : [point.line, point.condition];
  }));
}

function evaluateDebugCondition(condition, locals, globals, fieldNames) {
  return requireDebugBoolean(evaluateDebugExpression(condition.expression, locals, globals, fieldNames, condition.bindings));
}
`;
