/**
 * @file structural-checks.ts
 * @brief Bewertet Strukturregeln am gelinkten AST der studentischen Abgabe.
 * @author Abdul
 */

import { AstUtils, type AstNode } from 'langium';
import {
  isAddition, isAnd, isArrayLiteral, isArrayType, isAssignment, isAttSelection, isBlock,
  isBoolLiteral, isBoolType, isComparison, isDoWhileLoop, isEquality, isExponentiation,
  isForLoop, isFunctionCall, isFunctionDeclaration, isGrouping, isIfStatement, isIndexSelection,
  isLoopAnnotation, isMethSelection, isMultiplication, isNeg, isNewExpr, isNot, isNumType, isOr,
  isPostfixUpdate, isPrefixUpdate, isPrintCommand, isReturnStmt, isStringType, isStructAttDeclaration,
  isStructDeclaration, isStructType, isThrowCommand, isVarDecl, isVarRef, isVerificationAnnotation,
  isVerificationStatement, isWhileLoop,
  type Block, type Expr, type FunctionDeclaration, type Program, type StructAttDeclaration, type StructDeclaration,
  type TypeRef
} from 'pseudo2-language';
import type {
  StructuralCheck, StructuralCheckResult, StructuralIssue, StructuralOperation, StructuralScope, StructuralStruct
} from './model.js';

const operationLabels: Record<StructuralOperation, string> = {
  loop: 'Schleifen',
  for: 'for-Schleifen',
  while: 'while-Schleifen',
  'do-while': 'do-while-Schleifen',
  print: 'print-Ausgaben',
  throw: 'throw-Anweisungen',
  new: 'Struct-Erzeugungen mit new',
  'array-create': 'Array-Erzeugungen',
  'array-index': 'Array-Indexzugriffe'
};

/** Einmal pro Rumpf erfasste AST-Stellen, einschliesslich aufgeloester Referenzen. */
interface Occurrences {
  calls: Map<FunctionDeclaration, AstNode>;
  fields: Map<StructAttDeclaration, AstNode>;
  arrayAccesses: Map<StructAttDeclaration, AstNode>;
  constructions: Map<StructDeclaration, AstNode>;
  operations: Map<StructuralOperation, AstNode>;
  operators: Map<string, AstNode>;
}

/**
 * Prueft die Kriterien auf dem bereits validierten AST, der nur die Abgabe enthaelt.
 * Deklarationen werden nach Namen gefunden, Aufruf- und Feldstellen dagegen ueber
 * die von Langium aufgeloesten Referenzen auf genau diese Deklarationsknoten.
 *
 * @param program AST der Abgabe vor dem Anhaengen irgendeines Test-Harness.
 * @param checks Validierte Strukturkriterien.
 * @returns Ein Ergebnis pro Kriterium mit studentengerechten Hinweisen.
 */
export function runStructuralChecks(program: Program, checks: StructuralCheck[]): StructuralCheckResult[] {
  if (checks.length === 0) return [];
  const structs = new Map<string, StructDeclaration>();
  const fields = new Map<string, StructAttDeclaration>();
  const callables = new Map<string, FunctionDeclaration>();
  for (const instruction of program.instructions) {
    if (isFunctionDeclaration(instruction) && instruction.keyword) callables.set(instruction.name, instruction);
    if (!isStructDeclaration(instruction)) continue;
    structs.set(instruction.name, instruction);
    for (const child of instruction.children) {
      if (isStructAttDeclaration(child)) fields.set(memberName(child), child);
      if (isFunctionDeclaration(child) && !child.keyword) callables.set(callableName(child), child);
    }
  }

  const bodies = new Map<FunctionDeclaration, Occurrences>();
  const traversals = new Map<FunctionDeclaration, Occurrences[]>();
  return checks.map(check => {
    const issues: StructuralIssue[] = [];
    if (check.struct) inspectStruct(check.struct, structs.get(check.struct.name), issues);
    for (const scope of check.scopes) {
      const entry = callables.get(scope.in);
      if (!entry) {
        issues.push(issue(`Deklariere ${scope.in.includes('.') ? 'die Methode' : 'die Funktion'} "${scope.in}".`));
        continue;
      }
      const occurrences = scope.includeCallees
        ? getReachableBodies(entry, bodies, traversals)
        : [getBody(entry, bodies)];
      for (const name of scope.requiredCalls) {
        const target = callables.get(name);
        if (!target || !occurrences.some(body => body.calls.has(target))) {
          issues.push(issue(`Rufe "${name}" beim Ausfuehren von "${scope.in}" auf.`, entry));
        }
      }
      for (const [names, kind, hint] of [
        [scope.requiredFields, 'fields', 'Verwende das Feld'],
        [scope.requiredArrayAccesses, 'arrayAccesses', 'Greife per Index auf das Arrayfeld']
      ] as const) {
        for (const name of names) {
          const field = fields.get(name);
          if (!field || !occurrences.some(body => body[kind].has(field))) {
            const suffix = kind === 'arrayAccesses' ? ' zu' : '';
            issues.push(issue(`${hint} "${name}" in "${scope.in}"${suffix}.`, entry));
          }
        }
      }
      for (const name of scope.requiredConstructions) {
        const struct = structs.get(name);
        if (!struct || !occurrences.some(body => body.constructions.has(struct))) {
          issues.push(issue(`Erzeuge in "${scope.in}" ein Objekt mit "new ${name}".`, entry));
        }
      }
      inspectRestrictions(scope, occurrences, issues);
    }
    return { check, issues };
  });
}

/** Vergleicht Feldformen, aufgeloeste Typen und Methodenparameter mit dem Kriterium. */
function inspectStruct(expected: StructuralStruct, actual: StructDeclaration | undefined, issues: StructuralIssue[]): void {
  if (!actual) {
    issues.push(issue(`Deklariere den Struct "${expected.name}".`));
    return;
  }
  const attributes = new Map(actual.children.filter(isStructAttDeclaration).map(field => [field.name, field]));
  const methods = new Map(actual.children.filter(isFunctionDeclaration).filter(method => !method.keyword).map(method => [method.name, method]));
  for (const field of expected.fields) {
    const attribute = attributes.get(field.name);
    const type = attribute?.type;
    const array = isArrayType(type) ? type : undefined;
    const base = array ? array.base : type;
    if (!attribute || field.array !== Boolean(array) || (array && array.dimensions.length !== 1)
        || (field.type !== undefined && (!base || typeName(base) !== field.type))) {
      const wanted = field.type
        ? `vom Typ "${field.type}${field.array ? '[]' : ''}"`
        : field.array ? 'als eindimensionales Arrayfeld' : 'als Feld ohne Arraytyp';
      issues.push(issue(`Deklariere "${expected.name}.${field.name}" ${wanted}.`, attribute ?? actual));
    }
  }
  for (const method of expected.methods) {
    const declaration = methods.get(method.name);
    if (!declaration) {
      issues.push(issue(`Implementiere die Methode "${expected.name}.${method.name}".`, actual));
    } else if (method.arity !== undefined && declaration.params.length !== method.arity) {
      issues.push(issue(`Die Methode "${expected.name}.${method.name}" braucht ${method.arity} Parameter.`, declaration));
    }
  }
}

/** Liefert den Quellnamen eines skalaren oder referenzierten Struct-Typs. */
function typeName(type: TypeRef): string | undefined {
  if (isNumType(type)) return 'num';
  if (isBoolType(type)) return 'bool';
  if (isStringType(type)) return 'string';
  if (isStructType(type)) return type.struct.ref?.name;
  return undefined;
}

/** Gibt Verbote mit der ersten konkreten Fundstelle pro Operation oder Operator aus. */
function inspectRestrictions(scope: StructuralScope, occurrences: Occurrences[], issues: StructuralIssue[]): void {
  const allowed = scope.allowedCalls === undefined ? undefined : new Set(scope.allowedCalls);
  const forbidden = new Set(scope.forbiddenCalls);
  const reported = new Set<string>();
  for (const body of occurrences) {
    for (const [target, node] of body.calls) {
      const name = callableName(target);
      if (!reported.has(name) && (forbidden.has(name) || (allowed && !allowed.has(name)))) {
        reported.add(name);
        issues.push(issue(`Der Aufruf "${name}" ist in "${scope.in}" nicht erlaubt.`, node));
      }
    }
  }
  for (const operation of scope.forbiddenOperations) {
    const body = occurrences.find(candidate => candidate.operations.has(operation));
    if (body) issues.push(issue(`In "${scope.in}" sind ${operationLabels[operation]} nicht erlaubt.`, body.operations.get(operation)));
  }
  for (const operator of scope.forbiddenOperators) {
    const body = occurrences.find(candidate => candidate.operators.has(operator));
    if (body) issues.push(issue(`Der Operator "${operator}" ist in "${scope.in}" nicht erlaubt.`, body.operators.get(operator)));
  }
}

/** Folgt aufgeloesten Aufrufzielen; besucht auch bei Rekursion jeden Rumpf nur einmal. */
function getReachableBodies(
  entry: FunctionDeclaration,
  bodies: Map<FunctionDeclaration, Occurrences>,
  cache: Map<FunctionDeclaration, Occurrences[]>
): Occurrences[] {
  const previous = cache.get(entry);
  if (previous) return previous;
  const visited = new Set([entry]);
  const result: Occurrences[] = [];
  for (const target of visited) {
    const body = getBody(target, bodies);
    result.push(body);
    for (const callee of body.calls.keys()) visited.add(callee);
  }
  cache.set(entry, result);
  return result;
}

/** Erfasst nur Knoten des betreffenden Rumpfs, nicht Typdeklarationen oder Spezifikationen. */
function getBody(entry: FunctionDeclaration, cache: Map<FunctionDeclaration, Occurrences>): Occurrences {
  const previous = cache.get(entry);
  if (previous) return previous;
  const body: Occurrences = {
    calls: new Map(), fields: new Map(), arrayAccesses: new Map(),
    constructions: new Map(), operations: new Map(), operators: new Map()
  };
  const terminated = new Set<Block>();
  const contents = AstUtils.streamAllContents(entry.body).iterator();
  for (const node of contents) {
    if (isFunctionDeclaration(node) || isStructDeclaration(node) || isVerificationAnnotation(node)
        || isLoopAnnotation(node) || isVerificationStatement(node)) {
      contents.prune();
      continue;
    }
    if ((isBlock(node) && isPlainDeadBranch(node))
        || (isBlock(node.$container) && terminated.has(node.$container))) {
      contents.prune();
      continue;
    }
    recordOccurrences(node, body);
    if ((isReturnStmt(node) || isThrowCommand(node)) && isBlock(node.$container)) {
      terminated.add(node.$container);
    }
  }
  cache.set(entry, body);
  return body;
}

/** Ignoriert Rumpfbloecke unter einem unmittelbar erkennbaren false/true-Zweig. */
function isPlainDeadBranch(block: AstNode): boolean {
  const parent = block.$container;
  if (!isIfStatement(parent) && !isWhileLoop(parent)) return false;
  const condition = unwrap(parent.condition);
  if (!isBoolLiteral(condition)) return false;
  return isIfStatement(parent)
    ? block === (condition.value === 'true' ? parent.elseBlock : parent.thenBlock)
    : condition.value === 'false';
}

/** Erfasst Namensreferenzen, AST-Operationen und Operatoren an einer Stelle. */
function recordOccurrences(node: AstNode, body: Occurrences): void {
  if (isFunctionCall(node)) recordFirst(body.calls, node.f.ref, node);
  if (isMethSelection(node)) recordFirst(body.calls, node.methref.f.ref, node);
  if (isNewExpr(node)) {
    recordFirst(body.constructions, node.type.ref, node);
    recordFirst(body.operations, 'new', node);
  }
  if (isArrayLiteral(node) || (isVarDecl(node) && node.isArrayVariable)) recordFirst(body.operations, 'array-create', node);
  if (isPrintCommand(node)) recordFirst(body.operations, 'print', node);
  if (isThrowCommand(node)) recordFirst(body.operations, 'throw', node);

  const loop = isForLoop(node) ? 'for' : isWhileLoop(node) ? 'while' : isDoWhileLoop(node) ? 'do-while' : undefined;
  if (loop) {
    recordFirst(body.operations, 'loop', node);
    recordFirst(body.operations, loop, node);
  }

  if (isIndexSelection(node)) {
    recordFirst(body.operations, 'array-index', node);
    const field = referencedField(unwrap(node.receiver));
    if (field && isArrayType(field.type)) recordFirst(body.arrayAccesses, field, node);
  } else if (isAttSelection(node) || isVarRef(node)) {
    const field = referencedField(node);
    recordFirst(body.fields, field, node);
    if (isAttSelection(node) ? node.attref.index : node.index) {
      recordFirst(body.operations, 'array-index', node);
      if (field && isArrayType(field.type)) recordFirst(body.arrayAccesses, field, node);
    }
  }

  if (isAssignment(node)) recordFirst(body.operators, node.operator, node);
  if (isPrefixUpdate(node) || isPostfixUpdate(node)) recordFirst(body.operators, node.op, node);
  if (isOr(node) && node.right.length > 0) recordFirst(body.operators, '||', node);
  if (isOperatorChain(node)) {
    for (const operator of node.op) recordFirst(body.operators, operator, node);
  }
  if (isNot(node)) recordFirst(body.operators, '!', node);
  if (isNeg(node)) recordFirst(body.operators, '-', node);
}

/** Erkennt die von Langium erzeugten Praezedenzknoten mit einer Operatorliste. */
function isOperatorChain(node: AstNode) {
  return isAnd(node) || isEquality(node) || isComparison(node) || isAddition(node)
    || isMultiplication(node) || isExponentiation(node);
}

/** Entfernt Klammern und Praezedenzhuellen ohne echten Operator. */
function unwrap(expression: Expr): Expr {
  let node = expression;
  for (;;) {
    if (isGrouping(node)) node = node.value;
    else if ((isOr(node) || isOperatorChain(node)) && node.right.length === 0) node = node.left;
    else return node;
  }
}

/** Erkennt explizite Attributselektion sowie implizite this-Feldreferenzen. */
function referencedField(node: AstNode): StructAttDeclaration | undefined {
  const target = isAttSelection(node) ? node.attref.ref.ref : isVarRef(node) ? node.ref.ref : undefined;
  return isStructAttDeclaration(target) ? target : undefined;
}

/** Speichert die erste Fundstelle pro Referenz oder Syntaxelement. */
function recordFirst<K>(occurrences: Map<K, AstNode>, key: K | undefined, node: AstNode): void {
  if (key !== undefined && !occurrences.has(key)) occurrences.set(key, node);
}

/** Unterscheidet globale Funktionen von gleichnamigen Methoden verschiedener Structs. */
function callableName(target: FunctionDeclaration): string {
  return isStructDeclaration(target.$container) ? `${target.$container.name}.${target.name}` : target.name;
}

/** Liefert den qualifizierten Namen eines Feldes fuer die Konfiguration. */
function memberName(field: StructAttDeclaration): string {
  return `${field.$container.name}.${field.name}`;
}

/** Wandelt eine vorhandene AST-Position in einsbasierte Koordinaten um. */
function issue(message: string, node?: AstNode): StructuralIssue {
  const position = node?.$cstNode?.range.start;
  return { message, location: position && { line: position.line + 1, column: position.character + 1 } };
}
