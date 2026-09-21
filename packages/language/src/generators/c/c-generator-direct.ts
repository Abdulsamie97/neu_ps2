/**
 * @file c-generator-direct.ts
 * @brief Erzeugt lesbares, statisch typisiertes C ohne Pseudo2-Runtime.
 *
 * Dieser Modus ist bewusst von der dynamischen Tagged-Value-Runtime getrennt. Er
 * uebersetzt VeriFast-Annotationen auf native C-Werte und akzeptiert nur Ausdruecke,
 * deren C-Typ und Lebensdauer ohne Tagged Values eindeutig sind. Andere Konstrukte
 * melden einen Fehler mit Pseudo2-Zeile.
 *
 * @author Abdul
 */

import { AstUtils, type AstNode } from 'langium';
import type {
  ArrayLiteral, Assignment, Block, Expr, FunctionDeclaration, Instruction, LoopAnnotation, VerificationAnnotation,
  ParameterDecl, Program, StructDeclaration, VarDecl, Variable
} from '../../generated/ast.js';
import {
  isAddition, isAnd, isArrayLiteral, isAssignment, isAttSelection, isBoolLiteral,
  isBracedBlock, isCallCommand, isComparison, isDoWhileLoop, isEquality,
  isExponentiation, isExprStatement, isForLoop, isFunctionCall,
  isFunctionDeclaration, isGrouping, isIfStatement, isIndexSelection,
  isIndentedBlock, isIntLiteral, isMethSelection, isMultiplication, isNeg,
  isNewExpr, isNot, isNullLiteral, isOr, isParameterDecl, isPrintCommand,
  isResultExpr, isReturnStmt, isSpecConstantExpr, isSpecPredicateExpr,
  isStringLiteral, isStructAttDeclaration, isStructDeclaration, isThisExpr,
  isThrowCommand, isUndefinedSpecExpr, isVarDecl, isVarRef,
  isVerificationStatement, isWhileLoop
} from '../../generated/ast.js';
import { Pseudo2TypeComputer } from '../../typing/pseudo2-type-computer.js';
import type { Pseudo2Type } from '../../typing/pseudo2-type.js';
import type { CSourceMapEntry } from './c-generator-core.js';
import { directCStringRuntime, type DirectCStringRuntimeMode } from './direct-runtime/c-direct-string-runtime.js';
import { directCArrayRuntime, type DirectCArrayRuntimeType } from './direct-runtime/c-direct-array-runtime.js';
import {
  directCOptionalPrintFunction,
  directCOptionalPrintRuntime,
  type DirectCOptionalPrintKind
} from './direct-runtime/c-direct-optional-runtime.js';
import {
  DIRECT_C_STRUCT_PRINT_FUNCTION,
  DIRECT_C_STRUCT_THROW_FUNCTION,
  directCArrayPrintFunction,
  directCArrayThrowFunction,
  directCPrintRuntime
} from './direct-runtime/c-direct-print-runtime.js';

type CType = { base: string; depth: number };
type SpecAliases = {
  fields: Map<string, string>;
  definedFields: Map<string, string>;
  arrays: Map<string, string>;
  arrayLengths: Map<string, string>;
  strings: Map<string, string>;
};
type OwnedArray = {
  declaration: VarDecl;
  name: string;
  length: string;
  type: CType;
  hasMallocBlock: boolean;
  lengthInvariant: string;
  ownershipInvariant: string;
  contentTransferred?: boolean;
};
type EmitState = {
  thisName?: string;
  returnType?: CType;
  heapInvariants?: string[];
  loopAliases?: SpecAliases;
  specAliases?: SpecAliases;
  nonNullStrings?: Set<Variable>;
  ownedArrays?: OwnedArray[];
  ownedStructs?: Array<{ declaration: VarDecl; name: string; struct: StructDeclaration }>;
  arrayStructElements?: Map<Variable, Map<string, Variable>>;
  assignedArrayFields?: Set<string>;
};
type NativeOwnership = {
  requires: string[];
  ensures: string[];
  invariants: string[];
  requiresAliases: SpecAliases;
  ensuresAliases: SpecAliases;
  invariantAliases: SpecAliases;
};
type DirectArrayInfo = { logicalType: CType; runtimeType: DirectCArrayRuntimeType };
type NestedArrayAccess = { type: CType; descriptor: string; indices: Expr[] };
/** Konfiguriert die kleine native Hilfsschicht des Direct-C-Generators. */
export type DirectCGeneratorOptions = {
  /** Waehlt abstrakte VeriFast-Vertraege oder die ausfuehrbare Implementierung. */
  runtime?: DirectCStringRuntimeMode;
};
const TYPES = new Pseudo2TypeComputer();
const NUMBER: CType = { base: 'double', depth: 0 };
const INTEGER: CType = { base: 'int', depth: 0 };
const BOOLEAN: CType = { base: 'bool', depth: 0 };
const STRING: CType = { base: 'const char *', depth: 0 };
const VOID: CType = { base: 'void', depth: 0 };
const VOID_POINTER: CType = { base: 'void *', depth: 0 };
const C_KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double',
  'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
  'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static',
  'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
  'bool', 'true', 'false', 'NULL', 'main', 'mythis', 'printf', 'puts', 'malloc', 'calloc',
  'free', 'abort', 'exit', 'fputs', 'fprintf', 'snprintf', 'strlen', 'strcmp', 'memcpy',
  'div', 'min', 'max', 'pow', 'floor', 'round',
  'ps2_text_equal', 'ps2_text_equal_nonnull', 'ps2_text_truthy', 'ps2_concat_text', 'ps2_number_to_text',
  'box', 'predicate', 'lemma', 'requires', 'ensures', 'invariant', 'emp', 'module'
]);

/** Kennzeichnet eine nicht ohne Laufzeitmodell uebersetzbare Pseudo2-Stelle. */
export class DirectCGenerationError extends Error {
  constructor(message: string, node?: AstNode) {
    const line = node?.$cstNode?.range.start.line;
    super(`Direct C${line === undefined ? '' : ` (Pseudo2 line ${line + 1})`}: ${message}`);
    this.name = 'DirectCGenerationError';
  }
}

/** Erzeugt eine eigenstaendige C-Uebersetzungseinheit mit nativen C-Typen. */
export function generateDirectCProgram(program: Program, options: DirectCGeneratorOptions = {}): string {
  return generateDirectCProgramWithSourceMap(program, options).code;
}

/** Erzeugt natives C samt Zeilenabbildung fuer VeriFast-Diagnosen. */
export function generateDirectCProgramWithSourceMap(
  program: Program,
  options: DirectCGeneratorOptions = {}
): { code: string; sourceMap: CSourceMapEntry[] } {
  return new DirectCGenerator(program, options).generate();
}

/** Haelt Typ-, Namens- und Arraylaengeninformationen fuer einen Generierungslauf. */
class DirectCGenerator {
  private readonly variableTypes = new Map<Variable, CType>();
  private readonly functionTypes = new Map<FunctionDeclaration, CType>();
  private readonly arrayLengths = new Map<Variable, string>();
  private readonly arrayFieldLengths = new Map<Variable, string>();
  private readonly fieldDefinedNames = new Map<Variable, string>();
  private readonly arrayRuntimeTypes = new Map<string, DirectArrayInfo>();
  private readonly arrayLiteralFunctions = new Map<ArrayLiteral, string>();
  private readonly lengthParameterOwners = new Map<Variable, ParameterDecl>();
  private readonly variableNames = new Map<Variable, string>();
  private readonly functionNames = new Map<FunctionDeclaration, string>();
  private readonly structNames = new Map<StructDeclaration, string>();
  private readonly usedGlobalNames = new Set<string>();
  private tempCounter = 0;
  private readonly hasAnnotations: boolean;
  private readonly verifiedIntegers: boolean;
  private readonly numberType: CType;

  private readonly runtimeMode: DirectCStringRuntimeMode;

  constructor(private readonly program: Program, options: DirectCGeneratorOptions) {
    this.runtimeMode = options.runtime ?? 'contracts';
    const allNodes = [...AstUtils.streamAllContents(program)];
    this.hasAnnotations = allNodes.some(node =>
      isVerificationStatement(node) || node.$type === 'VerificationAnnotation' || node.$type === 'LoopAnnotation');
    const fractional = allNodes.find(node =>
      (isMultiplication(node) && node.op.includes('/')) || isExponentiation(node) && node.right.length > 0);
    this.verifiedIntegers = fractional === undefined;
    this.numberType = this.verifiedIntegers ? INTEGER : NUMBER;
    if (this.runtimeMode === 'contracts' && fractional) {
      throw new DirectCGenerationError(
        'Native VeriFast-Vertraege fuer Division und Potenzen benoetigen ein separates Gleitkomma-/Rationalmodell; der ausfuehrbare Direct-C-Modus unterstuetzt diese Operationen.',
        fractional
      );
    }
    this.prepareNames();
    this.inferTypes();
    for (const node of allNodes) {
      if ((isVarDecl(node) || isParameterDecl(node) || isStructAttDeclaration(node)) &&
          this.variableTypes.get(node)!.depth > 0) {
        this.ensureArrayRuntimeType(this.variableTypes.get(node)!);
      }
      if (isParameterDecl(node) && node.isArray) {
        if (node.len) this.lengthParameterOwners.set(node.len, node);
      }
      if (isFunctionDeclaration(node) && this.functionTypes.get(node)!.depth > 0) {
        this.ensureArrayRuntimeType(this.functionTypes.get(node)!);
      }
      if (isArrayLiteral(node)) {
        const type = this.typeOfExpr(node);
        if (type) {
          this.ensureArrayRuntimeType(type);
          this.arrayLiteralFunctions.set(node, this.temp('array_literal'));
        }
      }
    }
    for (const field of allNodes.filter(isStructAttDeclaration)) {
      this.fieldDefinedNames.set(field, this.temp(`${this.identifier(field.name)}_defined`));
      if (this.variableTypes.get(field)?.depth) {
        this.arrayFieldLengths.set(field, this.temp(`${this.identifier(field.name)}_length`));
      }
    }
    for (const decl of allNodes.filter(isVarDecl)) {
      if (this.variableTypes.get(decl)?.depth && !isForLoop(decl.$container)) {
        this.arrayLengths.set(decl, this.temp('length'));
      }
    }
  }

  /** Ordnet Quellnamen nur bei C-Kollisionen einen Praefix zu. */
  private prepareNames(): void {
    const nodes = [...AstUtils.streamAllContents(this.program)];
    for (const node of nodes) {
      if (isStructDeclaration(node)) {
        this.structNames.set(node, this.uniqueGlobal(node.name));
      }
    }
    for (const node of nodes) {
      if (isFunctionDeclaration(node)) {
        const owner = AstUtils.getContainerOfType(node, isStructDeclaration);
        const preferred = owner ? `${owner.name}_${node.name}` : node.name;
        this.functionNames.set(node, this.uniqueGlobal(preferred));
      }
    }
    for (const node of nodes) {
      if (isVarDecl(node) || isParameterDecl(node) || isStructAttDeclaration(node)) {
        if (node.$container === this.program) {
          this.variableNames.set(node, this.uniqueGlobal(node.name));
        } else {
          const local = this.identifier(node.name);
          this.variableNames.set(node, this.usedGlobalNames.has(local) ? this.identifier(`local_${local}`) : local);
        }
      }
    }
  }

  /** Leitet Parameter, Variablen und Rueckgaben iterativ aus Deklarationen und Aufrufen ab. */
  private inferTypes(): void {
    const nodes = [...AstUtils.streamAllContents(this.program)];
    for (const node of nodes) {
      if (isStructAttDeclaration(node)) {
        this.variableTypes.set(node, this.fromPseudoType(TYPES.typeForTypeRef(node.type)) ?? this.numberType);
      }
      if (isParameterDecl(node)) {
        const known = this.fromPseudoType(this.typeOfParameter(node));
        if (known) this.variableTypes.set(node, known);
        if (node.len) this.variableTypes.set(node.len, this.numberType);
      }
      if (isVarDecl(node) && isForLoop(node.$container)) this.variableTypes.set(node, this.numberType);
    }
    for (let pass = 0; pass < 4; pass++) {
      for (const node of nodes) {
        if (isFunctionCall(node) || isMethSelection(node)) {
          const fn = isFunctionCall(node) ? node.f?.ref : node.methref.f?.ref;
          const args = isFunctionCall(node) ? node.params : node.methref.params;
          for (let index = 0; fn && index < Math.min(args.length, fn.params.length); index++) {
            const parameter = fn.params[index];
            const inferred = this.typeOfExpr(args[index]);
            if (!inferred) continue;
            const current = this.variableTypes.get(parameter);
            if (current && (current.base !== inferred.base || current.depth !== inferred.depth)) {
              throw new DirectCGenerationError(`Parameter '${parameter.name}' wird mit verschiedenen C-Typen aufgerufen.`, node);
            }
            this.variableTypes.set(parameter, inferred);
          }
        }
        if (isVarDecl(node) && !this.variableTypes.has(node) && node.initializer) {
          const type = this.typeOfExpr(node.initializer);
          if (type) this.variableTypes.set(node, node.isArrayVariable ? { ...type, depth: type.depth + 1 } : type);
        }
        if (isAssignment(node) && isVarRef(node.sel)) {
          const decl = node.sel.ref?.ref;
          const targetType = this.typeOfExpr(node.sel);
          if (targetType) this.inferExpressionType(node.value, targetType);
          const valueType = this.typeOfExpr(node.value);
          if (decl && valueType && !this.variableTypes.has(decl)) {
            this.variableTypes.set(decl, node.sel.index ? { ...valueType, depth: valueType.depth + 1 } : valueType);
          }
        }
        if (isFunctionDeclaration(node) && !this.functionTypes.has(node)) {
          const returns = [...AstUtils.streamAllContents(node.body)].filter(isReturnStmt);
          const valued = returns.filter(ret => ret.retExpr);
          if (valued.length === 0) {
            this.functionTypes.set(node, VOID);
          } else {
            const type = valued.map(ret => this.typeOfExpr(ret.retExpr!)).find(Boolean);
            if (type) this.functionTypes.set(node, type);
            else if (valued.every(ret => isNullLiteral(this.unwrap(ret.retExpr!)))) this.functionTypes.set(node, VOID_POINTER);
          }
        }
      }
    }
    for (const node of nodes) {
      if (isParameterDecl(node) && !this.variableTypes.has(node)) {
        this.variableTypes.set(node, node.isArray ? { ...this.numberType, depth: 1 } : this.numberType);
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      for (const node of nodes) {
        if (isFunctionDeclaration(node) && !this.functionTypes.has(node)) {
          const returns = [...AstUtils.streamAllContents(node.body)].filter(isReturnStmt);
          const valued = returns.filter(ret => ret.retExpr);
          const type = valued.map(ret => this.typeOfExpr(ret.retExpr!)).find(Boolean);
          if (type) this.functionTypes.set(node, type);
          else if (valued.length > 0 && valued.every(ret => isNullLiteral(this.unwrap(ret.retExpr!)))) {
            this.functionTypes.set(node, VOID_POINTER);
          }
        }
        if (isVarDecl(node) && !this.variableTypes.has(node) && node.initializer) {
          const type = this.typeOfExpr(node.initializer);
          if (type) this.variableTypes.set(node, node.isArrayVariable ? { ...type, depth: type.depth + 1 } : type);
        }
      }
    }
    for (const node of nodes) {
      if (isVarDecl(node) && !this.variableTypes.has(node)) {
        if (node.isArrayVariable) {
          this.variableTypes.set(node, { ...this.numberType, depth: 1 });
        } else if (!node.initializer) {
          throw new DirectCGenerationError(`Typ von '${node.name}' ohne Initialisierer nicht bestimmbar.`, node);
        } else {
          throw new DirectCGenerationError(`Dynamischer Typ von '${node.name}' nicht ohne Runtime abbildbar.`, node);
        }
      }
      if (isFunctionDeclaration(node) && !this.functionTypes.has(node)) {
        throw new DirectCGenerationError(`Rueckgabetyp von '${node.name}' nicht statisch bestimmbar.`, node);
      }
    }
  }

  /**
   * Uebertraegt einen bereits bekannten Kontexttyp auf eine noch untypisierte
   * Variablenreferenz. Bei einem Elementzugriff wird dabei die Arraytiefe wieder
   * hinzugefuegt, etwa von `edgeElem` fuer `A[i]` auf `edgeElem[]` fuer `A`.
   */
  private inferExpressionType(expression: Expr, expected: CType): void {
    const value = this.unwrap(expression);
    if (!isVarRef(value) || !value.ref?.ref || this.variableTypes.has(value.ref.ref)) return;
    this.variableTypes.set(value.ref.ref, value.index
      ? { ...expected, depth: expected.depth + 1 }
      : expected);
  }

  /** Bestimmt den Typ eines Parameters aus Typrechner und nichtrekursiven Aufrufen. */
  private typeOfParameter(parameter: ParameterDecl): Pseudo2Type {
    return TYPES.typeFor({ $type: 'VarRef', ref: { ref: parameter } } as never);
  }

  /** Uebersetzt bekannte Pseudo2-Typen in C-Basistyp und Pointertiefe. */
  private fromPseudoType(type: Pseudo2Type): CType | undefined {
    if (type.isUnknown() || type.isPartiallyUnknown()) return undefined;
    const base = type.isStructType()
      ? `struct ${this.structNameBySource(type.name)} *`
      : type.name === 'string' ? 'const char *' : type.name === 'bool' ? 'bool' : this.numberType.base;
    return { base, depth: type.arrayDepth };
  }

  /** Bestimmt den C-Typ eines Ausdrucks mit Vorrang fuer bereits bekannte Deklarationen. */
  private typeOfExpr(expr: Expr): CType | undefined {
    const value = this.unwrap(expr);
    if (value !== expr) return this.typeOfExpr(value);
    if (isEquality(expr) || isComparison(expr) || isOr(expr) || isAnd(expr) || isNot(expr)) return BOOLEAN;
    if (isMultiplication(expr) || isExponentiation(expr) || isNeg(expr)) return this.numberType;
    if (isAddition(expr) && expr.right.length > 0) {
      return [expr.left, ...expr.right].some(part => this.typeOfExpr(part)?.base === STRING.base) ? STRING : this.numberType;
    }
    if (isArrayLiteral(expr)) {
      const element = expr.elems.length ? this.typeOfExpr(expr.elems[0]) : this.numberType;
      if (element && expr.elems.slice(1).some(item => {
        if (isNullLiteral(this.unwrap(item))) return !this.isPointerType(element);
        const next = this.typeOfExpr(item);
        return !next || next.base !== element.base || next.depth !== element.depth;
      })) return undefined;
      return element ? { ...element, depth: element.depth + 1 } : undefined;
    }
    if (isVarRef(expr)) {
      const type = expr.ref?.ref ? this.variableTypes.get(expr.ref.ref) : undefined;
      return type ? (expr.index ? { ...type, depth: Math.max(0, type.depth - 1) } : type)
        : this.fromPseudoType(TYPES.typeFor(expr));
    }
    if (isFunctionCall(expr)) return expr.f?.ref ? this.functionTypes.get(expr.f.ref) : undefined;
    if (isMethSelection(expr)) return expr.methref.f?.ref ? this.functionTypes.get(expr.methref.f.ref) : undefined;
    if (isAttSelection(expr) && expr.attref.ref?.ref) {
      const type = this.variableTypes.get(expr.attref.ref.ref);
      return type ? (expr.attref.index ? { ...type, depth: Math.max(0, type.depth - 1) } : type) : undefined;
    }
    if (isIndexSelection(expr)) {
      const type = this.typeOfExpr(expr.receiver);
      return type ? { ...type, depth: Math.max(0, type.depth - 1) } : undefined;
    }
    return this.fromPseudoType(TYPES.typeFor(expr));
  }

  /** Schreibt Includes, Structs, Prototypen, globale Variablen und main in C-Reihenfolge. */
  generate(): { code: string; sourceMap: CSourceMapEntry[] } {
    const top = this.program.instructions ?? [];
    const allNodes = [...AstUtils.streamAllContents(this.program)];
    const structs = top.filter(isStructDeclaration);
    const functions = top.filter(isFunctionDeclaration);
    const methods = structs.flatMap(struct => (struct.children ?? []).filter(isFunctionDeclaration));
    const referencedByFunction = new Set([...functions, ...methods].flatMap(fn =>
      [...AstUtils.streamAllContents(fn.body)].filter(isVarRef).map(ref => ref.ref?.ref)));
    const globalVariables = top.filter(isVarDecl).filter(decl => referencedByFunction.has(decl));
    const needsStringRuntime = allNodes.some(node =>
      isAddition(node) && node.right.length > 0 && this.typeOfExpr(node)?.base === STRING.base ||
      isEquality(node) && [node.left, ...node.right].some(part => this.typeOfExpr(part)?.base === STRING.base) ||
      (isIfStatement(node) || isWhileLoop(node) || isDoWhileLoop(node)) &&
        this.typeOfExpr(node.condition)?.base === STRING.base ||
      isNot(node) && this.typeOfExpr(node.value)?.base === STRING.base);
    const optionalPrintKinds = [...new Set(allNodes.filter(isPrintCommand).flatMap(command => {
      if (!this.isPotentiallyUndefinedField(command.param)) return [];
      const type = this.typeOfExpr(command.param);
      const kind = type && type.depth === 0 ? this.optionalPrintKind(type) : undefined;
      return kind ? [kind] : [];
    }))];
    const outputTypes = allNodes.filter(node => isPrintCommand(node) || isThrowCommand(node))
      .map(node => this.typeOfExpr(node.param))
      .filter((type): type is CType => type !== undefined);
    const needsArrayOutput = outputTypes.some(type => type.depth > 0);
    const needsStructOutput = outputTypes.some(type => type.depth === 0 && type.base.startsWith('struct '));
    const lines = [
      '#include <stdbool.h>', '#include <stdio.h>', '#include <stdlib.h>',
      '#include <stdint.h>', '#include <string.h>', '#include <math.h>', '//@ #include "arrays.gh"', ''
    ];
    if (needsStringRuntime) lines.push(directCStringRuntime(this.runtimeMode, this.verifiedIntegers), '');
    if (optionalPrintKinds.length) {
      lines.push(directCOptionalPrintRuntime(optionalPrintKinds, this.runtimeMode), '');
    }
    if ([...AstUtils.streamAllContents(this.program)].some(node => isVarDecl(node) && node.isArrayVariable)) {
      lines.push(
        '/*@',
        'lemma void ps2_all_eq_append<t>(list<t> values, t value)',
        '  requires all_eq(values, value) == true;',
        '  ensures all_eq(append(values, cons(value, nil)), value) == true;',
        '{',
        '  switch (values) {',
        '    case nil:',
        '    case cons(head, tail): ps2_all_eq_append(tail, value);',
        '  }',
        '}',
        '@*/', ''
      );
    }
    const needsCheckedIndex = allNodes.some(node =>
      (isVarRef(node) && !!node.index) || isIndexSelection(node) || (isAttSelection(node) && !!node.attref.index)) ||
      [...this.arrayRuntimeTypes.values()].some(info => info.logicalType.depth > 1);
    if (needsCheckedIndex) {
      lines.push(
        `static int ps2_checked_index(${this.numberType.base} index, int length)`,
        '//@ requires true;',
        '//@ ensures result == index - 1 &*& 0 <= result &*& result < length;',
        '{',
        `  if (index < 1 || index > length${this.verifiedIntegers ? '' : ' || index != (int)index'}) abort();`,
        '  return (int)index - 1;',
        '}', ''
      );
    }
    for (const struct of structs) lines.push(`struct ${this.structName(struct)};`);
    if (structs.length) lines.push('');
    if (this.arrayRuntimeTypes.size) {
      lines.push(directCArrayRuntime(
        [...this.arrayRuntimeTypes.values()].map(info => info.runtimeType),
        this.runtimeMode
      ), '');
    }
    if (needsArrayOutput || needsStructOutput) {
      lines.push(directCPrintRuntime(
        needsArrayOutput ? [...this.arrayRuntimeTypes.values()].map(info => info.runtimeType) : [],
        needsStructOutput,
        this.runtimeMode
      ), '');
    }
    const arrayLiterals = [...this.arrayLiteralFunctions.keys()];
    for (const literal of arrayLiterals) lines.push(...this.arrayLiteralContract(literal));
    if (arrayLiterals.length) lines.push('');
    for (const literal of arrayLiterals) {
      if (this.runtimeMode === 'contracts' && this.typeOfExpr(literal)!.depth > 1) continue;
      lines.push(this.emitArrayLiteralFactory(literal), '');
    }
    for (const struct of structs) lines.push(this.emitStruct(struct), '');
    for (const struct of structs) lines.push(this.emitStructAllocator(struct), '');
    for (const variable of globalVariables) {
      lines.push(this.declaration(variable) + ';');
      if (this.variableTypes.get(variable)?.depth) lines.push(`int ${this.lengthOfVariable(variable, variable)};`);
    }
    if (globalVariables.length) lines.push('');
    for (const fn of [...functions, ...methods]) {
      const state = this.functionState(fn);
      lines.push(`${this.signature(fn)};`, ...this.contracts(fn.annotations ?? [], state, this.functionOwnership(fn, state)));
    }
    if (functions.length || methods.length) lines.push('');
    for (const fn of [...functions, ...methods]) lines.push(this.emitFunction(fn), '');
    if (globalVariables.length && this.hasAnnotations) {
      throw new DirectCGenerationError('VeriFast-Vertraege fuer funktionsuebergreifende globale Variablen benoetigen ein Modul-/Ownership-Modell.', globalVariables[0]);
    }
    lines.push('int main(void)', '//@ requires true;', '//@ ensures true;', '{');
    const mainState: EmitState = {
      heapInvariants: [],
      loopAliases: this.emptySpecAliases(),
      specAliases: this.emptySpecAliases(),
      ownedArrays: [],
      arrayStructElements: new Map(),
      assignedArrayFields: new Set(),
      nonNullStrings: new Set()
    };
    for (const instruction of top) {
      if (isStructDeclaration(instruction) || isFunctionDeclaration(instruction)) continue;
      lines.push(this.mapped(instruction, this.emitInstruction(instruction, 1, mainState, isVarDecl(instruction) && globalVariables.includes(instruction))));
    }
    lines.push(...this.cleanupOwnedHeap(mainState, '  '));
    for (const decl of top.filter(isVarDecl)) {
      const heapAllocated = decl.initializer && isNewExpr(this.unwrap(decl.initializer));
      if (!heapAllocated) continue;
      const overwritten = top.some(node => isAssignment(node) && isVarRef(node.sel) && !node.sel.index && node.sel.ref?.ref === decl);
      if (overwritten) {
        if (this.hasAnnotations) throw new DirectCGenerationError(`Heapvariable '${decl.name}' wird neu zugewiesen; eine sichere Freigabe ist ohne Ownership-Tracking nicht beweisbar.`, decl);
        continue;
      }
      lines.push(this.mapped(decl, `  free(${this.name(decl)});`));
    }
    lines.push('  return 0;', '}');
    return this.finish(lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n').trimEnd() + '\n');
  }

  /** Schreibt ein natives C-Struct mit unveraenderten Feldnamen. */
  private emitStruct(struct: StructDeclaration): string {
    const fields = (struct.children ?? []).filter(isStructAttDeclaration);
    return [
      `struct ${this.structName(struct)} {`,
      ...(fields.length ? fields.flatMap(field => [
        `  bool ${this.fieldDefinedName(field)};`,
        `  ${this.typeName(this.variableTypes.get(field)!)} ${this.name(field)};`,
        ...(this.variableTypes.get(field)?.depth ? [`  int ${this.arrayFieldLength(field)};`] : [])
      ]) : ['  unsigned char unused;']),
      '};'
    ].join('\n');
  }

  /** Erzeugt einen typisierten Struct-Konstruktor mit vollstaendigem VeriFast-Besitz. */
  private emitStructAllocator(struct: StructDeclaration): string {
    const fields = (struct.children ?? []).filter(isStructAttDeclaration);
    const type = `struct ${this.structName(struct)}`;
    const name = this.structAllocatorName(struct);
    const ownership = fields.flatMap(field => {
      const fieldType = this.variableTypes.get(field)!;
      return [
        `result->${this.fieldDefinedName(field)} |-> false`,
        `result->${this.name(field)} |-> ${this.zeroValue(fieldType)}`,
        ...(fieldType.depth > 0 ? [`result->${this.arrayFieldLength(field)} |-> 0`] : [])
      ];
    });
    if (fields.length === 0) ownership.push('result->unused |-> 0');
    ownership.push(`malloc_block_${this.structName(struct)}(result)`);
    return [
      `static ${type} *${name}(void)`,
      '//@ requires true;',
      `//@ ensures ${ownership.join(' &*& ')};`,
      '{',
      `  ${type} *result = (${type} *)malloc(sizeof(${type}));`,
      '  if (result == NULL) abort();',
      ...fields.flatMap(field => {
        const fieldType = this.variableTypes.get(field)!;
        return [
          `  result->${this.fieldDefinedName(field)} = false;`,
          `  result->${this.name(field)} = ${this.zeroValue(fieldType)};`,
          ...(fieldType.depth > 0 ? [`  result->${this.arrayFieldLength(field)} = 0;`] : [])
        ];
      }),
      ...(fields.length === 0 ? ['  result->unused = 0;'] : []),
      '  return result;',
      '}'
    ].join('\n');
  }

  /** Schreibt Signatur und exakten Inhaltvertrag eines typisierten Arrayliterals. */
  private arrayLiteralContract(literal: ArrayLiteral): string[] {
    const type = this.typeOfExpr(literal)!;
    const values = literal.elems.map((_, index) => `value_${index}`);
    const ownership = this.arrayLiteralOwnership(literal, type, values);
    return [
      `${this.arrayLiteralSignature(literal)};`,
      `//@ requires ${ownership.requires.join(' &*& ') || 'true'};`,
      `//@ ensures result.length == ${literal.elems.length} &*& ${this.arrayOwnershipAssertion(type, 'result.data', 'result.length', this.veriFastList(ownership.ghostValues))};`
    ];
  }

  /** Erzeugt eine kleine Literal-Funktion, deren Heapkopie den aktuellen Block ueberleben darf. */
  private emitArrayLiteralFactory(literal: ArrayLiteral): string {
    const type = this.typeOfExpr(literal)!;
    const runtime = this.arrayRuntimeType(type);
    const source = this.temp('literal_values');
    const values = literal.elems.map((_, index) => `value_${index}`);
    const ownership = this.arrayLiteralOwnership(literal, type, values);
    const result = this.temp('literal_result');
    if (type.depth > 1) {
      const childType = this.arrayRuntimeType({ ...type, depth: type.depth - 1 }).resultType;
      return [
        this.arrayLiteralSignature(literal),
        `//@ requires ${ownership.requires.join(' &*& ') || 'true'};`,
        `//@ ensures result.length == ${literal.elems.length} &*& ${this.arrayOwnershipAssertion(type, 'result.data', 'result.length', this.veriFastList(ownership.ghostValues))};`,
        '{',
        `  ${runtime.elementType} *${source} = (${runtime.elementType} *)calloc(${Math.max(1, values.length)}, sizeof(${runtime.elementType}));`,
        `  if (${source} == NULL) abort();`,
        ...values.flatMap((value, index) => [
          `  ${source}[${index}] = (${childType} *)malloc(sizeof(${childType}));`,
          `  if (${source}[${index}] == NULL) abort();`,
          `  *${source}[${index}] = ${value};`
        ]),
        `  ${runtime.resultType} ${result} = { ${source}, ${values.length} };`,
        `  return ${result};`,
        '}'
      ].join('\n');
    }
    return [
      this.arrayLiteralSignature(literal),
      `//@ requires ${ownership.requires.join(' &*& ') || 'true'};`,
      `//@ ensures result.length == ${literal.elems.length} &*& ${this.arrayOwnershipAssertion(type, 'result.data', 'result.length', this.veriFastList(ownership.ghostValues))};`,
      '{',
      `  ${runtime.elementType} ${source}[${Math.max(1, values.length)}] = {${values.join(', ') || this.zeroValue({ ...type, depth: type.depth - 1 })}};`,
      `  ${runtime.resultType} ${result} = ${runtime.copyFunction}(${source}, ${values.length});`,
      `  return ${result};`,
      '}'
    ].join('\n');
  }

  /** Formatiert den C-Funktionskopf eines Arrayliteral-Konstruktors. */
  private arrayLiteralSignature(literal: ArrayLiteral): string {
    const type = this.typeOfExpr(literal)!;
    const runtime = this.arrayRuntimeType(type);
    const parameterType = type.depth > 1
      ? this.arrayRuntimeType({ ...type, depth: type.depth - 1 }).resultType
      : runtime.elementType;
    const parameters = literal.elems.map((_, index) => `${parameterType} value_${index}`);
    return `${runtime.resultType} ${this.arrayLiteralFunctions.get(literal)!}(${parameters.join(', ') || 'void'})`;
  }

  /** Baut eine VeriFast-Liste in derselben Reihenfolge wie das Pseudo2-Arrayliteral. */
  private veriFastList(values: string[]): string {
    return values.reduceRight((tail, value) => `cons(${value}, ${tail})`, 'nil');
  }

  /** Koppelt die Argumente eines verschachtelten Literals an ihre rekursiven Ghostlisten. */
  private arrayLiteralOwnership(
    literal: ArrayLiteral,
    type: CType,
    values: string[]
  ): { requires: string[]; ghostValues: string[] } {
    if (type.depth === 1) return { requires: [], ghostValues: values };
    const childType = { ...type, depth: type.depth - 1 };
    const factory = this.arrayLiteralFunctions.get(literal)!;
    const requires: string[] = [];
    const ghostValues = values.map((value, index) => {
      const ghost = `${factory}_value_${index}_values`;
      requires.push(
        `0 <= ${value}.length`,
        this.arrayOwnershipAssertion(childType, `${value}.data`, `${value}.length`, `?${ghost}`)
      );
      return ghost;
    });
    return { requires, ghostValues };
  }

  /** Schreibt die C-Signatur inklusive explizitem Methodenempfaenger und Arraylaengen. */
  private signature(fn: FunctionDeclaration): string {
    const ret = this.functionTypes.get(fn)!;
    const owner = AstUtils.getContainerOfType(fn, isStructDeclaration);
    const args = owner ? [`struct ${this.structName(owner)} *mythis`] : [];
    for (const p of fn.params ?? []) {
      const parameterType = this.variableTypes.get(p)!;
      args.push(p.isArray
        ? `${this.arrayRuntimeType(parameterType).resultType} ${this.name(p)}`
        : `${this.typeName(parameterType)} ${this.name(p)}`);
    }
    const returnType = ret.depth > 0 ? this.arrayRuntimeType(ret).resultType : this.typeName(ret);
    return `${returnType} ${this.functionName(fn)}(${args.join(', ') || 'void'})`;
  }

  /** Schreibt Funktionsrumpf und Pseudo2-Anweisungen ohne generierte Wrapper. */
  private emitFunction(fn: FunctionDeclaration): string {
    const state = this.functionState(fn);
    const ownership = this.functionOwnership(fn, state);
    state.heapInvariants = ownership.invariants;
    state.loopAliases = ownership.invariantAliases;
    state.specAliases = this.copySpecAliases(ownership.invariantAliases);
    for (const p of fn.params ?? []) if (p.isArray) this.arrayLengths.set(p, `${this.name(p)}.length`);
    const body = fn.body.instructions.map(i => this.mapped(i, this.emitInstruction(i, 1, state)));
    const fallsThrough = this.functionTypes.get(fn) === VOID && !isReturnStmt(fn.body.instructions.at(-1));
    return [
      this.mapped(fn, this.signature(fn)),
      ...this.contracts(fn.annotations ?? [], state, ownership),
      '{',
      ...body,
      ...(fallsThrough ? this.cleanupOwnedHeap(state, '  ') : []),
      '}'
    ].join('\n');
  }

  /** Erstellt den aus Rueckgabetyp und optionalem Methodenempfaenger bestehenden Funktionszustand. */
  private functionState(fn: FunctionDeclaration): EmitState {
    return {
      thisName: AstUtils.getContainerOfType(fn, isStructDeclaration) ? 'mythis' : undefined,
      returnType: this.functionTypes.get(fn),
      ownedArrays: [],
      ownedStructs: [],
      arrayStructElements: new Map(),
      assignedArrayFields: this.initiallyAssignedArrayFields(fn),
      nonNullStrings: new Set((fn.params ?? []).filter(parameter => {
        const type = this.variableTypes.get(parameter);
        return type?.depth === 0 && type.base === STRING.base;
      }))
    };
  }

  /** Kennzeichnet Arrayfelder von Heapparametern, deren Inhalt bereits der Vorbedingung gehoert. */
  private initiallyAssignedArrayFields(fn: FunctionDeclaration): Set<string> {
    const result = new Set<string>();
    const add = (receiver: string, struct: StructDeclaration | undefined): void => {
      if (!struct) return;
      for (const field of (struct.children ?? []).filter(isStructAttDeclaration)) {
        if (this.variableTypes.get(field)?.depth) result.add(`${receiver}->${this.name(field)}`);
      }
    };
    const owner = AstUtils.getContainerOfType(fn, isStructDeclaration);
    if (owner) add('mythis', owner);
    for (const parameter of fn.params ?? []) {
      add(this.name(parameter), this.structForType(this.variableTypes.get(parameter)!));
    }
    return result;
  }

  /** Schreibt einen C-Block mit derselben Kontrollflussform wie in Pseudo2. */
  private emitBlock(block: Block, level: number, state: EmitState): string {
    const indent = '  '.repeat(level);
    const arrayStart = state.ownedArrays?.length ?? 0;
    const structStart = state.ownedStructs?.length ?? 0;
    const invariantStart = state.heapInvariants?.length ?? 0;
    const previousLoopAliases = this.copySpecAliases(state.loopAliases);
    const previousSpecAliases = this.copySpecAliases(state.specAliases);
    const body = block.instructions.map(i => this.mapped(i, this.emitInstruction(i, level + 1, state))).filter(Boolean);
    const localArrays = state.ownedArrays?.slice(arrayStart) ?? [];
    const localStructs = state.ownedStructs?.slice(structStart) ?? [];
    const last = block.instructions.at(-1);
    const terminates = !!last && (isReturnStmt(last) || isThrowCommand(last));
    const cleanup = terminates
      ? []
      : this.cleanupOwnedHeap({ ...state, ownedArrays: localArrays, ownedStructs: localStructs }, `${indent}  `);
    state.ownedArrays?.splice(arrayStart);
    state.ownedStructs?.splice(structStart);
    state.heapInvariants?.splice(invariantStart);
    state.loopAliases = previousLoopAliases;
    state.specAliases = previousSpecAliases;
    for (const array of localArrays) state.arrayStructElements?.delete(this.arrayAliasRoot(array.declaration));
    return ['{', ...body, ...cleanup, `${indent}}`].join('\n');
  }

  /** Verteilt Anweisungen auf ihre direkten C-Entsprechungen. */
  private emitInstruction(instruction: Instruction, level: number, state: EmitState, global = false): string {
    const i = '  '.repeat(level);
    if (isBracedBlock(instruction) || isIndentedBlock(instruction)) return i + this.emitBlock(instruction, level, state);
    if (isVerificationStatement(instruction)) {
      const inline = instruction.kind === 'assert'
        ? this.inlineArrayAssertion(instruction.condition, state)
        : { clauses: [] as string[], aliases: state.specAliases };
      const condition = this.specCondition(instruction.condition, { ...state, specAliases: inline.aliases });
      const assertion = [...inline.clauses, condition].map(clause => `(${clause})`).join(' &*& ');
      return instruction.kind === 'assume' ? `${i}//@ assume(${condition});` : `${i}//@ ${instruction.kind} ${assertion};`;
    }
    if (isVarDecl(instruction)) return this.emitVarDecl(instruction, level, state, global);
    if (isAssignment(instruction)) {
      this.registerArrayStructElementAssignment(instruction, state);
      const targetType = this.typeOfExpr(instruction.sel);
      if (targetType) this.requireType(targetType, instruction.value);
      this.trackNonNullStringAssignment(instruction, state);
      const nestedTarget = this.nestedArrayAccess(instruction.sel, state);
      if (nestedTarget) {
        const setter = this.arrayRuntimeType(nestedTarget.type).setFunction!;
        const indices = nestedTarget.indices.map(index => this.expr(index, state));
        const lowered = this.lowerRootExpression(instruction.value, state, i);
        return [
          ...lowered.prefix,
          `${i}${setter}(${[nestedTarget.descriptor, ...indices, lowered.expression].join(', ')});`
        ].join('\n');
      }
      if (targetType?.depth && this.isWholeArrayTarget(instruction.sel)) {
        return this.emitWholeArrayAssignment(instruction.sel, instruction.value, targetType, level, state);
      }
      const lowered = this.lowerRootExpression(instruction.value, state, i);
      const assignment = `${i}${this.emitTarget(instruction.sel, state)} = ${lowered.expression};`;
      const defined = this.fieldDefinedTarget(instruction.sel, state);
      return [
        ...lowered.prefix,
        assignment,
        ...(defined ? [`${i}${defined} = true;`] : [])
      ].join('\n');
    }
    if (isIfStatement(instruction)) {
      const thenPart = `${i}if (${this.condition(instruction.condition, state)}) ${this.emitBlock(instruction.thenBlock, level, state)}`;
      return instruction.elseBlock ? `${thenPart}\n${i}else ${this.emitBlock(instruction.elseBlock, level, state)}` : thenPart;
    }
    if (isWhileLoop(instruction)) return `${i}while (${this.condition(instruction.condition, state)})\n${this.loopContracts(instruction.annotations ?? [], i, state)}${i}${this.emitBlock(instruction.body, level, state)}`;
    if (isDoWhileLoop(instruction)) return `${i}do\n${this.loopContracts(instruction.annotations ?? [], i, state)}${i}${this.emitBlock(instruction.body, level, state)} while (${this.condition(instruction.condition, state)});`;
    if (isForLoop(instruction)) {
      const name = instruction.iterator ? this.name(instruction.iterator) : this.temp('for');
      const start = this.temp('start');
      const end = this.temp('end');
      const step = this.temp('step');
      const op = instruction.direction === 'to' ? '<=' : '>=';
      const update = instruction.direction === 'to' ? '+=' : '-=';
      const staticStepExpr = instruction.step ? this.unwrap(instruction.step) : undefined;
      const staticStep = instruction.step
        ? isIntLiteral(staticStepExpr) ? staticStepExpr.value : undefined
        : 1;
      if (staticStep !== undefined && staticStep <= 0) {
        throw new DirectCGenerationError('For-Schrittweite muss positiv sein.', instruction.step ?? instruction);
      }
      return [
        `${i}{`,
        `${i}  ${this.numberType.base} ${name} = ${this.expr(instruction.from, state)};`,
        `${i}  ${this.numberType.base} ${start} = ${name};`,
        `${i}  ${this.numberType.base} ${end} = ${this.expr(instruction.to, state)};`,
        `${i}  ${this.numberType.base} ${step} = ${instruction.step ? this.expr(instruction.step, state) : '1'};`,
        ...(staticStep === undefined
          ? [`${i}  if (${step} <= 0) { fputs("For step must be positive\\n", stderr); exit(1); }`]
          : []),
        `${i}  for (; ${name} ${op} ${end}; ${name} ${update} ${step})`,
        this.loopContracts(instruction.annotations ?? [], `${i}  `, state, [
          `${step} > 0`,
          instruction.direction === 'to' ? `${start} <= ${name}` : `${name} <= ${start}`
        ]).trimEnd(),
        `${i}  ${this.emitBlock(instruction.body, level + 1, state)}`,
        `${i}}`
      ].join('\n');
    }
    if (isReturnStmt(instruction)) {
      if (instruction.retExpr && state.returnType) this.requireType(state.returnType, instruction.retExpr);
      const loweredCall = instruction.retExpr ? this.materializeRootCall(instruction.retExpr, state, i) : undefined;
      const returnValue = instruction.retExpr
        ? loweredCall?.expression ?? this.expr(instruction.retExpr, state)
        : undefined;
      if (instruction.retExpr && state.returnType?.depth) {
        const result = this.temp('return_array');
        const descriptorType = this.arrayRuntimeType(state.returnType).resultType;
        const leaksAllocation = this.arrayAllocationOwner(instruction.retExpr) !== undefined;
        return [
          ...(loweredCall?.prefix ?? []),
          `${i}${descriptorType} ${result} = ${loweredCall ? returnValue : this.arrayDescriptorValue(instruction.retExpr, state.returnType, state)};`,
          ...this.cleanupOwnedHeap(state, i, instruction.retExpr),
          ...(leaksAllocation
            ? [`${i}//@ leak malloc_block_${this.veriFastAllocationKind(state.returnType)}(${result}.data, ${result}.length);`]
            : []),
          `${i}return ${result};`
        ].join('\n');
      }
      if (instruction.retExpr && state.returnType && this.hasOwnedHeap(state)) {
        const result = this.temp('return');
        return [
          ...(loweredCall?.prefix ?? []),
          `${i}${this.typeName(state.returnType)} ${result} = ${returnValue};`,
          ...this.cleanupOwnedHeap(state, i, instruction.retExpr),
          `${i}return ${result};`
        ].join('\n');
      }
      if (!instruction.retExpr && this.hasOwnedHeap(state)) {
        return [...this.cleanupOwnedHeap(state, i), `${i}return;`].join('\n');
      }
      return [
        ...(loweredCall?.prefix ?? []),
        `${i}return${returnValue ? ` ${returnValue}` : ''};`
      ].join('\n');
    }
    if (isPrintCommand(instruction)) return this.emitPrint(instruction.param, level, state);
    if (isThrowCommand(instruction)) return this.emitThrow(instruction.param, level, state);
    if (isCallCommand(instruction)) {
      const lowered = this.lowerRootExpression(instruction.param, state, i);
      return [...lowered.prefix, `${i}${lowered.expression};`].join('\n');
    }
    if (isExprStatement(instruction)) {
      const lowered = this.lowerRootExpression(instruction.expr, state, i);
      return [...lowered.prefix, `${i}${lowered.expression};`].join('\n');
    }
    if (isFunctionCall(instruction)) {
      const lowered = this.lowerRootExpression(instruction, state, i);
      return [...lowered.prefix, `${i}${lowered.expression};`].join('\n');
    }
    throw new DirectCGenerationError(`Anweisung '${instruction.$type}' nicht unterstuetzt.`, instruction);
  }

  /** Schreibt lokale oder globale native Arrays sowie skalare Variablen. */
  private emitVarDecl(decl: VarDecl, level: number, state: EmitState, global: boolean): string {
    const i = '  '.repeat(level);
    const name = this.name(decl);
    const type = this.variableTypes.get(decl)!;
    if (decl.isArrayVariable) {
      const size = decl.size ? this.expr(decl.size, state) : '0';
      const sizeExpr = decl.size ? this.unwrap(decl.size) : undefined;
      const staticSize = sizeExpr && isIntLiteral(sizeExpr) ? sizeExpr.value : undefined;
      if (staticSize !== undefined && staticSize < 0) {
        throw new DirectCGenerationError('Arraygroesse darf nicht negativ sein.', decl.size);
      }
      const length = this.arrayLengths.get(decl) ?? this.temp('length');
      this.arrayLengths.set(decl, length);
      const elementType = this.arrayElementTypeName(type);
      const loweredInitializer = decl.initializer
        ? this.lowerRootExpression(decl.initializer, state, i)
        : undefined;
      const init = loweredInitializer?.expression ?? this.zeroValue({ ...type, depth: type.depth - 1 });
      const allocation = `(${this.typeName(type)})calloc(${length} > 0 ? ${length} : 1, sizeof(${elementType}))`;
      const storage = global ? `${name} = ${allocation};` : `${this.typeName(type)} ${name} = ${allocation};`;
      const index = this.temp('i');
      const initializer = decl.initializer ? this.unwrap(decl.initializer) : undefined;
      const zeroInitialized = initializer === undefined || this.isZeroInitializer(initializer);
      const freshStructs = initializer !== undefined && isNewExpr(initializer);
      const fillValue = this.temp('fill');
      const arrayPredicate = this.veriFastAllocationKind(type);
      const staticallyUnrolledFill = staticSize !== undefined && staticSize <= 1024 && !freshStructs;
      const proofIndexes = staticSize !== undefined && staticSize <= 1024
        ? Array.from({ length: staticSize }, (_, indexValue) => indexValue + 1)
        : this.staticArrayIndexes(decl);
      const filledValues = `ps2_${this.identifier(name)}_filled`;
      const initializedValues = `ps2_${this.identifier(name)}_initialized`;
      const remainingValues = `ps2_${this.identifier(name)}_remaining`;
      this.registerLocalArrayOwnership(decl, name, length, type, state, true);
      this.registerArrayStructElement(decl, initializer, state, staticSize);
      const zeroProof = zeroInitialized ? [
        `${i}//@ assert ${name}[0..${length}] |-> ?${filledValues} &*& all_eq(${filledValues}, ${init}) == true;`,
        ...proofIndexes.map(arrayIndex => `${i}//@ all_eq_nth(${filledValues}, ${init}, ${arrayIndex - 1});`)
      ] : [];
      const fill = zeroInitialized ? [] : staticallyUnrolledFill ? [
        `${i}${elementType} ${fillValue} = ${init};`,
        ...proofIndexes.map(arrayIndex => `${i}${name}[${arrayIndex - 1}] = ${fillValue};`),
        `${i}//@ assert ${name}[0..${length}] |-> ?${filledValues};`,
        ...proofIndexes.map(arrayIndex => `${i}//@ assert nth(${arrayIndex - 1}, ${filledValues}) == ${fillValue};`)
      ] : freshStructs ? [
        `${i}for (int ${index} = 0; ${index} < ${length}; ++${index}) {`,
        `${i}  ${name}[${index}] = ${this.expr(initializer, state)};`,
        `${i}  if (${name}[${index}] == NULL) abort();`,
        `${i}}`
      ] : [
        `${i}${elementType} ${fillValue} = ${init};`,
        `${i}for (int ${index} = 0; ${index} < ${length}; ++${index})`,
        `${i}//@ invariant 0 <= ${index} &*& ${index} <= ${length} &*& ${name}[0..${index}] |-> ?${initializedValues} &*& all_eq(${initializedValues}, ${fillValue}) == true &*& ${name}[${index}..${length}] |-> ?${remainingValues} &*& malloc_block_${arrayPredicate}(${name}, ${length});`,
        `${i}{`,
        `${i}  ${name}[${index}] = ${fillValue};`,
        `${i}  //@ close ${arrayPredicate}(${name} + ${index}, 1, cons(${fillValue}, nil));`,
        `${i}  //@ ${arrayPredicate}_join(${name});`,
        `${i}  //@ ps2_all_eq_append(${initializedValues}, ${fillValue});`,
        `${i}}`,
        `${i}//@ assert ${name}[0..${length}] |-> ?${filledValues} &*& all_eq(${filledValues}, ${fillValue}) == true;`,
        ...proofIndexes.map(arrayIndex => `${i}//@ all_eq_nth(${filledValues}, ${fillValue}, ${arrayIndex - 1});`)
      ];
      return [
        `${i}${global ? '' : 'int '}${length} = (int)(${size});`,
        ...(staticSize === undefined
          ? [`${i}if (${length} < 0) { fputs("Negative array size\\n", stderr); exit(1); }`]
          : []),
        `${i}${storage}`,
        `${i}if (${name} == NULL) { fputs("Out of memory\\n", stderr); exit(1); }`,
        ...(loweredInitializer?.prefix ?? []),
        ...zeroProof,
        ...fill
      ].join('\n');
    }
    const literal = decl.initializer ? this.unwrap(decl.initializer) : undefined;
    if (literal && isArrayLiteral(literal)) {
      const elements = literal.elems ?? [];
      for (const element of elements) this.requireType({ ...type, depth: type.depth - 1 }, element);
      const length = this.lengthOfVariable(decl, decl);
      const result = this.temp(`${this.identifier(name)}_array`);
      const descriptor = this.expr(literal, state);
      this.registerLocalArrayOwnership(decl, name, length, type, state, false);
      return [
        `${i}${this.arrayRuntimeType(type).resultType} ${result} = ${descriptor};`,
        `${i}${global ? '' : `${this.typeName(type)} `}${name} = ${result}.data;`,
        `${i}${global ? '' : 'int '}${length} = ${result}.length;`
      ].join('\n');
    }
    if (decl.initializer) this.requireType(type, decl.initializer);
    if (type.depth > 0 && decl.initializer) {
      const length = this.lengthOfVariable(decl, decl);
      const loweredInitializer = this.materializeRootCall(decl.initializer, state, i);
      const descriptorExpression = loweredInitializer?.expression ??
        this.arrayDescriptorExpression(decl.initializer, type, state);
      if (descriptorExpression) {
        const result = this.temp(`${this.identifier(name)}_array`);
        if (isArrayLiteral(this.unwrap(decl.initializer)) || isFunctionCall(this.unwrap(decl.initializer)) ||
            isMethSelection(this.unwrap(decl.initializer))) {
          this.registerLocalArrayOwnership(decl, name, length, type, state, false);
        }
        return [
          ...(loweredInitializer?.prefix ?? []),
          `${i}${this.arrayRuntimeType(type).resultType} ${result} = ${descriptorExpression};`,
          `${i}${global ? '' : `${this.typeName(type)} `}${name} = ${result}.data;`,
          `${i}${global ? '' : 'int '}${length} = ${result}.length;`
        ].join('\n');
      }
      const value = this.expr(decl.initializer, state);
      return [
        `${i}${global ? '' : this.typeName(type) + ' '}${name} = ${value};`,
        `${i}${global ? '' : 'int '}${length} = ${this.lengthOf(decl.initializer, state)}` + ';'
      ].join('\n');
    }
    const loweredInitializer = decl.initializer
      ? this.lowerRootExpression(decl.initializer, state, i)
      : undefined;
    const value = loweredInitializer?.expression ?? this.zeroValue(type);
    const declaration = global ? `${i}${name} = ${value};` : `${i}${this.typeName(type)} ${name} = ${value};`;
    const initializer = decl.initializer ? this.unwrap(decl.initializer) : undefined;
    if (type.depth === 0 && type.base === STRING.base) {
      if (initializer && this.nonNullString(initializer, state)) state.nonNullStrings?.add(decl);
      else state.nonNullStrings?.delete(decl);
    }
    const struct = this.structForType(type);
    if (state.ownedStructs && struct && initializer && !isNullLiteral(initializer) &&
        (isNewExpr(initializer) || isFunctionCall(initializer) || isMethSelection(initializer))) {
      this.registerLocalStructOwnership(decl, name, struct, state);
    }
    return [...(loweredInitializer?.prefix ?? []), declaration].join('\n');
  }

  /** Erkennt eine Arrayvariable oder ein Arrayfeld ohne nachfolgenden Elementindex. */
  private isWholeArrayTarget(target: Expr): boolean {
    return isVarRef(target) && !target.index || isAttSelection(target) && !target.attref.index;
  }

  /**
   * Schreibt eine Arrayreferenz und ihre logische Laenge gemeinsam um.
   *
   * Arrayliterale erhalten einen benannten C-Speicher im aktuellen Block. Bei einer
   * Referenzzuweisung werden Pointer und Laenge kopiert, sodass spaetere Elemente
   * geteilt bleiben, eine erneute Zuweisung der Quellvariable aber nicht die Laenge
   * des bereits angelegten Alias veraendert.
   */
  private emitWholeArrayAssignment(
    target: Expr,
    value: Expr,
    targetType: CType,
    level: number,
    state: EmitState
  ): string {
    const i = '  '.repeat(level);
    const targetValue = this.emitTarget(target, state);
    const targetLength = this.arrayTargetLength(target, state);
    const targetDefined = this.fieldDefinedTarget(target, state);
    const loweredValue = this.materializeRootCall(value, state, i);
    const replacementProof: string[] = [];
    if (targetDefined) {
      state.assignedArrayFields ??= new Set();
      if (state.assignedArrayFields.has(targetValue)) {
        const oldData = this.temp('replaced_array');
        const oldLength = this.temp('replaced_length');
        replacementProof.push(
          `${i}${this.typeName(targetType)} ${oldData} = ${targetValue};`,
          `${i}int ${oldLength} = ${targetLength};`,
          `${i}//@ leak ${this.arrayOwnershipAssertion(targetType, oldData, oldLength, '_')};`
        );
      }
      state.assignedArrayFields.add(targetValue);
      this.transferArrayContentToField(value, state);
    }
    const literal = this.unwrap(value);
    if (isArrayLiteral(literal)) {
      for (const element of literal.elems) this.requireType({ ...targetType, depth: targetType.depth - 1 }, element);
      const result = this.temp('array_value');
      return [
        ...replacementProof,
        `${i}${this.arrayRuntimeType(targetType).resultType} ${result} = ${this.expr(literal, state)};`,
        `${i}${targetValue} = ${result}.data;`,
        `${i}${targetLength} = ${result}.length;`,
        ...(targetDefined ? [`${i}${targetDefined} = true;`] : [])
      ].join('\n');
    }
    const descriptorExpression = loweredValue?.expression ?? this.arrayDescriptorExpression(value, targetType, state);
    if (descriptorExpression) {
      const result = this.temp('array_value');
      return [
        ...replacementProof,
        ...(loweredValue?.prefix ?? []),
        `${i}${this.arrayRuntimeType(targetType).resultType} ${result} = ${descriptorExpression};`,
        `${i}${targetValue} = ${result}.data;`,
        `${i}${targetLength} = ${result}.length;`,
        ...(targetDefined ? [`${i}${targetDefined} = true;`] : [])
      ].join('\n');
    }
    return [
      ...replacementProof,
      `${i}${targetValue} = ${this.expr(value, state)};`,
      `${i}${targetLength} = ${this.lengthOf(value, state)};`,
      ...(targetDefined ? [`${i}${targetDefined} = true;`] : [])
    ].join('\n');
  }

  /** Liefert die veränderliche Laengenstelle eines ganzen Array-Zuweisungsziels. */
  private arrayTargetLength(target: Expr, state: EmitState): string {
    if (isVarRef(target) && !target.index && target.ref?.ref) {
      const decl = target.ref.ref;
      if (isStructAttDeclaration(decl)) {
        if (!state.thisName) throw new DirectCGenerationError('Implizites Arrayfeld ausserhalb einer Methode.', target);
        return `${state.thisName}->${this.arrayFieldLength(decl)}`;
      }
      return this.lengthOfVariable(decl, target);
    }
    if (isAttSelection(target) && !target.attref.index && target.attref.ref?.ref) {
      return `${this.expr(target.receiver, state)}->${this.arrayFieldLength(target.attref.ref.ref)}`;
    }
    throw new DirectCGenerationError('Arraylaenge des Zuweisungsziels nicht bestimmbar.', target);
  }

  /** Liefert das Initialisierungsflag eines ganzen Structfeld-Zuweisungsziels. */
  private fieldDefinedTarget(target: Expr, state: EmitState): string | undefined {
    if (isVarRef(target) && !target.index && isStructAttDeclaration(target.ref?.ref)) {
      if (!state.thisName) throw new DirectCGenerationError('Implizites Struct-Feld ausserhalb einer Methode.', target);
      return `${state.thisName}->${this.fieldDefinedName(target.ref.ref)}`;
    }
    if (isAttSelection(target) && !target.attref.index && target.attref.ref?.ref) {
      return `${this.expr(target.receiver, state)}->${this.fieldDefinedName(target.attref.ref.ref)}`;
    }
    return undefined;
  }

  /** Erkennt Initialisierer, deren Byte-Nullbelegung bereits dem Pseudo2-Wert entspricht. */
  private isZeroInitializer(value: Expr): boolean {
    const initializer = this.unwrap(value);
    return isIntLiteral(initializer) && initializer.value === 0 ||
      isBoolLiteral(initializer) && initializer.value === 'false' ||
      isNullLiteral(initializer);
  }

  /** Sammelt statische einsbasierte Indizes, fuer die nach einer Füllschleife Inhaltsfakten gebraucht werden. */
  private staticArrayIndexes(variable: VarDecl): number[] {
    const indexes = [...AstUtils.streamAllContents(this.program)].flatMap(node => {
      if (!isVarRef(node) || node.ref?.ref !== variable || !node.index) return [];
      const index = this.unwrap(node.index);
      return isIntLiteral(index) && index.value >= 1 ? [index.value] : [];
    });
    return [...new Set(indexes)];
  }

  /** Schreibt eine globale Variable ohne C-unzulaessige Laufzeitinitialisierung. */
  private declaration(decl: VarDecl): string {
    const type = this.variableTypes.get(decl)!;
    return `${this.typeName(type)} ${this.name(decl)}`;
  }

  /** Uebersetzt Pseudo2-Vertraege in native VeriFast-Kommentare. */
  private contracts(annotations: VerificationAnnotation[], state: EmitState, ownership: NativeOwnership): string[] {
    const parts = (kind: string) => annotations.filter(a => a.kind === kind);
    const line = (kind: 'requires' | 'ensures') => {
      const matches = parts(kind);
      const automatic = kind === 'requires' ? ownership.requires : ownership.ensures;
      const aliases = kind === 'requires' ? ownership.requiresAliases : ownership.ensuresAliases;
      const specState = { ...state, specAliases: aliases };
      const clauses = [...automatic, ...matches.map(a => this.specCondition(a.condition!, specState))];
      const spec = clauses.map(clause => `(${clause})`).join(' &*& ') || 'true';
      return this.mapped(matches[0], `//@ ${kind} ${spec};`);
    };
    return [line('requires'), line('ensures'), ...parts('terminates').map(a => this.mapped(a, '//@ terminates;'))];
  }

  /** Platziert explizite Invarianten und Abnahmeklauseln vor dem C-Schleifenrumpf. */
  private loopContracts(annotations: LoopAnnotation[], indent: string, state: EmitState, additional: string[] = []): string {
    const invariants = annotations.filter(a => a.kind === 'invariant');
    const decreases = annotations.filter(a => a.kind === 'decreases');
    const specState = { ...state, specAliases: state.loopAliases };
    const clauses = [...(state.heapInvariants ?? []), ...additional, ...invariants.map(a => this.specCondition(a.condition, specState))];
    const invariant = clauses.map(clause => `(${clause})`).join(' &*& ') || 'true';
    return [
      this.mapped(invariants[0], `${indent}//@ invariant ${invariant};`),
      ...decreases.map(a => this.mapped(a, `${indent}//@ decreases ${this.specExpr(a.condition, state)};`))
    ].join('\n') + '\n';
  }

  /** Leitet native VeriFast-Besitzbedingungen fuer Heapparameter und Methodenempfaenger ab. */
  private functionOwnership(fn: FunctionDeclaration, state: EmitState): NativeOwnership {
    const requires: string[] = [];
    const ensures: string[] = [];
    const invariants: string[] = [];
    const requiresAliases = this.emptySpecAliases();
    const ensuresAliases = this.emptySpecAliases();
    const invariantAliases = this.emptySpecAliases();
    const aliasRoots = this.parameterAliasRoots(fn);
    const addArray = (parameter: ParameterDecl, descriptor: string, mutated: boolean) => {
      const name = `${descriptor}.data`;
      const length = `${descriptor}.length`;
      const ghost = `ps2_${this.identifier(descriptor)}_values`;
      const after = mutated ? `${ghost}_after` : ghost;
      const type = this.variableTypes.get(parameter)!;
      requires.push(`0 <= ${length}`, this.arrayOwnershipAssertion(type, name, length, `?${ghost}`));
      ensures.push(this.arrayOwnershipAssertion(type, name, length, `${mutated ? '?' : ''}${after}`));
      invariants.push(`0 <= ${length}`, this.arrayOwnershipAssertion(type, name, length, `?${ghost}_loop`));
      requiresAliases.arrays.set(name, ghost);
      ensuresAliases.arrays.set(name, after);
      invariantAliases.arrays.set(name, `${ghost}_loop`);
    };
    const aliasArray = (descriptor: string, rootDescriptor: string) => {
      const target = `${descriptor}.data`;
      const source = `${rootDescriptor}.data`;
      const required = requiresAliases.arrays.get(source);
      const ensured = ensuresAliases.arrays.get(source);
      const invariant = invariantAliases.arrays.get(source);
      if (required) requiresAliases.arrays.set(target, required);
      if (ensured) ensuresAliases.arrays.set(target, ensured);
      if (invariant) invariantAliases.arrays.set(target, invariant);
    };
    const addString = (name: string) => {
      const ghost = `ps2_${this.identifier(name)}_chars`;
      requires.push(`[_]string((char *)${name}, ?${ghost})`);
      ensures.push(`[_]string((char *)${name}, ${ghost})`);
      invariants.push(`[_]string((char *)${name}, ${ghost})`);
      requiresAliases.strings.set(name, ghost);
      ensuresAliases.strings.set(name, ghost);
      invariantAliases.strings.set(name, ghost);
    };
    const addStruct = (name: string, struct: StructDeclaration) => {
      for (const field of (struct.children ?? []).filter(isStructAttDeclaration)) {
        const fieldName = this.name(field);
        const ghost = `ps2_${this.identifier(name)}_${fieldName}`;
        const definedField = this.fieldDefinedName(field);
        const definedGhost = `${ghost}_defined`;
        requires.push(`${name}->${definedField} |-> ?${definedGhost}`);
        ensures.push(`${name}->${definedField} |-> ?${definedGhost}_after`);
        invariants.push(`${name}->${definedField} |-> ?${definedGhost}_loop`);
        requires.push(`${name}->${fieldName} |-> ?${ghost}`);
        ensures.push(`${name}->${fieldName} |-> ?${ghost}_after`);
        invariants.push(`${name}->${fieldName} |-> ?${ghost}_loop`);
        const access = `${name}->${fieldName}`;
        requiresAliases.fields.set(access, ghost);
        ensuresAliases.fields.set(access, `${ghost}_after`);
        invariantAliases.fields.set(access, `${ghost}_loop`);
        requiresAliases.definedFields.set(access, definedGhost);
        ensuresAliases.definedFields.set(access, `${definedGhost}_after`);
        invariantAliases.definedFields.set(access, `${definedGhost}_loop`);
        if (this.variableTypes.get(field)?.depth) {
          const lengthField = this.arrayFieldLength(field);
          const lengthGhost = `${ghost}_length`;
          const valuesGhost = `${ghost}_values`;
          const fieldType = this.variableTypes.get(field)!;
          requires.push(`${name}->${lengthField} |-> ?${lengthGhost}`, `0 <= ${lengthGhost}`, this.arrayOwnershipAssertion(fieldType, ghost, lengthGhost, `?${valuesGhost}`));
          ensures.push(`${name}->${lengthField} |-> ?${lengthGhost}_after`, `0 <= ${lengthGhost}_after`, this.arrayOwnershipAssertion(fieldType, `${ghost}_after`, `${lengthGhost}_after`, `?${valuesGhost}_after`));
          invariants.push(`${name}->${lengthField} |-> ?${lengthGhost}_loop`, `0 <= ${lengthGhost}_loop`, this.arrayOwnershipAssertion(fieldType, `${ghost}_loop`, `${lengthGhost}_loop`, `?${valuesGhost}_loop`));
          requiresAliases.arrays.set(access, valuesGhost);
          ensuresAliases.arrays.set(access, `${valuesGhost}_after`);
          invariantAliases.arrays.set(access, `${valuesGhost}_loop`);
          requiresAliases.arrayLengths.set(access, lengthGhost);
          ensuresAliases.arrayLengths.set(access, `${lengthGhost}_after`);
          invariantAliases.arrayLengths.set(access, `${lengthGhost}_loop`);
        }
      }
      requires.push(`malloc_block_${this.structName(struct)}(${name})`);
      ensures.push(`malloc_block_${this.structName(struct)}(${name})`);
      invariants.push(`malloc_block_${this.structName(struct)}(${name})`);
    };
    const aliasStruct = (name: string, rootName: string, struct: StructDeclaration) => {
      for (const field of (struct.children ?? []).filter(isStructAttDeclaration)) {
        const fieldName = this.name(field);
        const source = `${rootName}->${fieldName}`;
        const target = `${name}->${fieldName}`;
        for (const aliases of [requiresAliases, ensuresAliases, invariantAliases]) {
          const value = aliases.fields.get(source);
          const defined = aliases.definedFields.get(source);
          const array = aliases.arrays.get(source);
          const length = aliases.arrayLengths.get(source);
          if (value) aliases.fields.set(target, value);
          if (defined) aliases.definedFields.set(target, defined);
          if (array) aliases.arrays.set(target, array);
          if (length) aliases.arrayLengths.set(target, length);
        }
      }
    };

    const owner = AstUtils.getContainerOfType(fn, isStructDeclaration);
    if (owner && state.thisName) addStruct(state.thisName, owner);
    for (const parameter of fn.params ?? []) {
      const name = this.name(parameter);
      const type = this.variableTypes.get(parameter)!;
      const root = aliasRoots.get(parameter) ?? parameter;
      if (root !== parameter) {
        const rootName = this.name(root);
        if (parameter.isArray && root.isArray) {
          aliasArray(name, rootName);
        } else {
          const struct = this.structForType(type);
          if (struct) aliasStruct(name, rootName, struct);
        }
        continue;
      }
      if (parameter.isArray && parameter.len) {
        const mutated = (fn.params ?? []).some(candidate =>
          (aliasRoots.get(candidate) ?? candidate) === root && this.functionMutatesArray(fn, candidate)
        );
        addArray(parameter, name, mutated);
      } else if (type.depth === 0 && type.base === STRING.base) {
        addString(name);
      } else {
        const struct = this.structForType(type);
        if (struct) addStruct(name, struct);
      }
    }
    const returnType = this.functionTypes.get(fn)!;
    if (returnType.depth > 0) {
      const values = 'ps2_result_values';
      ensures.push('0 <= result.length', this.arrayOwnershipAssertion(returnType, 'result.data', 'result.length', `?${values}`));
      ensuresAliases.arrays.set('result.data', values);
      ensuresAliases.arrayLengths.set('result.data', 'result.length');
    } else if (returnType.base === STRING.base) {
      const chars = 'ps2_result_chars';
      ensures.push('result != 0', `[_]string((char *)result, ?${chars})`);
      ensuresAliases.strings.set('result', chars);
    } else {
      const returnedStruct = this.structForType(returnType);
      if (returnedStruct) {
        const returnedParameter = this.returnedStructParameter(fn);
        if (returnedParameter) {
          const parameterName = this.name(returnedParameter);
          ensures.push(`result == ${parameterName}`);
          for (const field of (returnedStruct.children ?? []).filter(isStructAttDeclaration)) {
            const source = `${parameterName}->${this.name(field)}`;
            const target = `result->${this.name(field)}`;
            const fieldAlias = ensuresAliases.fields.get(source);
            const definedAlias = ensuresAliases.definedFields.get(source);
            const arrayAlias = ensuresAliases.arrays.get(source);
            const lengthAlias = ensuresAliases.arrayLengths.get(source);
            if (fieldAlias) ensuresAliases.fields.set(target, fieldAlias);
            if (definedAlias) ensuresAliases.definedFields.set(target, definedAlias);
            if (arrayAlias) ensuresAliases.arrays.set(target, arrayAlias);
            if (lengthAlias) ensuresAliases.arrayLengths.set(target, lengthAlias);
          }
        } else if (!this.functionCanReturnNull(fn)) {
          for (const field of (returnedStruct.children ?? []).filter(isStructAttDeclaration)) {
            const fieldName = this.name(field);
            const access = `result->${fieldName}`;
            const ghost = `ps2_result_${fieldName}`;
            const definedGhost = `${ghost}_defined`;
            ensures.push(
              `result->${this.fieldDefinedName(field)} |-> ?${definedGhost}`,
              `${access} |-> ?${ghost}`
            );
            ensuresAliases.fields.set(access, ghost);
            ensuresAliases.definedFields.set(access, definedGhost);
            const fieldType = this.variableTypes.get(field)!;
            if (fieldType.depth > 0) {
              const lengthGhost = `${ghost}_length`;
              const valuesGhost = `${ghost}_values`;
              ensures.push(
                `result->${this.arrayFieldLength(field)} |-> ?${lengthGhost}`,
                `0 <= ${lengthGhost}`,
                this.arrayOwnershipAssertion(fieldType, ghost, lengthGhost, `?${valuesGhost}`)
              );
              ensuresAliases.arrays.set(access, valuesGhost);
              ensuresAliases.arrayLengths.set(access, lengthGhost);
            }
          }
          ensures.push(`malloc_block_${this.structName(returnedStruct)}(result)`);
        }
      }
    }
    return {
      requires, ensures, invariants,
      requiresAliases, ensuresAliases, invariantAliases
    };
  }

  /**
   * Bildet durch `@requires A == B` zugesicherte Heapparameter auf einen
   * gemeinsamen repraesentativen Parameter ab. Dadurch wird derselbe Array- oder
   * Structbesitz im VeriFast-Vertrag nur einmal angefordert und zurueckgegeben.
   */
  private parameterAliasRoots(fn: FunctionDeclaration): Map<ParameterDecl, ParameterDecl> {
    const parameters = fn.params ?? [];
    const parent = new Map(parameters.map(parameter => [parameter, parameter]));
    const index = new Map(parameters.map((parameter, position) => [parameter, position]));
    const find = (parameter: ParameterDecl): ParameterDecl => {
      const direct = parent.get(parameter) ?? parameter;
      if (direct === parameter) return parameter;
      const root = find(direct);
      parent.set(parameter, root);
      return root;
    };
    const union = (left: ParameterDecl, right: ParameterDecl): void => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot === rightRoot) return;
      if ((index.get(leftRoot) ?? 0) <= (index.get(rightRoot) ?? 0)) parent.set(rightRoot, leftRoot);
      else parent.set(leftRoot, rightRoot);
    };
    for (const annotation of (fn.annotations ?? []).filter(item => item.kind === 'requires' && item.condition)) {
      for (const candidate of [annotation.condition!, ...AstUtils.streamAllContents(annotation.condition!)]) {
        if (!isEquality(candidate) || candidate.right.length !== 1 || candidate.op[0] !== '==') continue;
        const left = this.unwrap(candidate.left);
        const right = this.unwrap(candidate.right[0]);
        if (!isVarRef(left) || left.index || !isParameterDecl(left.ref?.ref) ||
            !isVarRef(right) || right.index || !isParameterDecl(right.ref?.ref)) continue;
        const leftType = this.variableTypes.get(left.ref.ref);
        const rightType = this.variableTypes.get(right.ref.ref);
        const leftHeap = left.ref.ref.isArray || !!leftType && !!this.structForType(leftType);
        const rightHeap = right.ref.ref.isArray || !!rightType && !!this.structForType(rightType);
        if (leftHeap && rightHeap) union(left.ref.ref, right.ref.ref);
      }
    }
    return new Map(parameters.map(parameter => [parameter, find(parameter)]));
  }

  /** Erkennt Schreibzugriffe auf einen bestimmten Arrayparameter im Funktionsrumpf. */
  private functionMutatesArray(fn: FunctionDeclaration, parameter: ParameterDecl): boolean {
    return [...AstUtils.streamAllContents(fn.body)].filter(isAssignment).some(assignment => {
      let target = assignment.sel;
      while (isIndexSelection(target) || isAttSelection(target)) target = target.receiver;
      return isVarRef(target) && target.ref?.ref === parameter;
    });
  }

  /** Erkennt, ob alle Struct-Rueckgaben dieselbe formale Parameterreferenz zurueckgeben. */
  private returnedStructParameter(fn: FunctionDeclaration): ParameterDecl | undefined {
    const values = [...AstUtils.streamAllContents(fn.body)]
      .filter(isReturnStmt)
      .flatMap(statement => statement.retExpr ? [this.unwrap(statement.retExpr)] : []);
    if (values.length === 0 || !values.every(isVarRef)) return undefined;
    const declaration = values[0].ref?.ref;
    return isParameterDecl(declaration) && values.every(value => value.ref?.ref === declaration)
      ? declaration
      : undefined;
  }

  /** Erkennt einen expliziten `null`-Rueckgabepfad, fuer den kein voller Structbesitz garantiert werden darf. */
  private functionCanReturnNull(fn: FunctionDeclaration): boolean {
    return [...AstUtils.streamAllContents(fn.body)]
      .filter(isReturnStmt)
      .some(statement => statement.retExpr && isNullLiteral(this.unwrap(statement.retExpr)));
  }

  /** Erstellt voneinander unabhaengige Alias-Tabellen fuer Spezifikationsphasen. */
  private emptySpecAliases(): SpecAliases {
    return {
      fields: new Map(),
      definedFields: new Map(),
      arrays: new Map(),
      arrayLengths: new Map(),
      strings: new Map()
    };
  }

  /** Kopiert Aliasbindungen, damit eine einzelne Assertion frische Ghostwerte binden kann. */
  private copySpecAliases(source?: SpecAliases): SpecAliases {
    return {
      fields: new Map(source?.fields),
      definedFields: new Map(source?.definedFields),
      arrays: new Map(source?.arrays),
      arrayLengths: new Map(source?.arrayLengths),
      strings: new Map(source?.strings)
    };
  }

  /**
   * Bindet die in einer `assert`-Bedingung gelesenen lokalen Arrays an frische Listen.
   * Dadurch wird `A[i]` als `nth(i - 1, values)` formuliert und VeriFast erhaelt
   * zugleich den benoetigten Slice, auch nachdem das Array zuvor veraendert wurde.
   */
  private inlineArrayAssertion(value: Expr, state: EmitState): { clauses: string[]; aliases: SpecAliases } {
    const aliases = this.copySpecAliases(state.specAliases);
    const clauses: string[] = [];
    const roots = new Map<Variable, { data: string; length: string; ghost: string }>();
    const references = [value, ...AstUtils.streamAllContents(value)].filter(isVarRef);
    for (const reference of references) {
      const declaration = reference.ref?.ref;
      const type = declaration ? this.variableTypes.get(declaration) : undefined;
      if (!declaration || !type?.depth) continue;
      const root = this.arrayAliasRoot(declaration);
      let binding = roots.get(root);
      if (!binding) {
        const rootRef = { $type: 'VarRef', ref: { ref: root } } as unknown as Expr;
        const data = this.specArrayData(rootRef, state);
        const length = this.lengthOf(rootRef, state);
        const ghost = `ps2_assert_values_${this.tempCounter++}`;
        binding = { data, length, ghost };
        roots.set(root, binding);
        clauses.push(this.arrayOwnershipAssertion(this.variableTypes.get(root)!, data, length, `?${ghost}`));
      }
      const data = isStructAttDeclaration(declaration)
        ? `${state.thisName}->${this.name(declaration)}`
        : isParameterDecl(declaration) && declaration.isArray
          ? `${this.name(declaration)}.data`
          : this.name(declaration);
      aliases.arrays.set(data, binding.ghost);
    }
    return { clauses, aliases };
  }

  /** Verfolgt eine reine Arrayalias-Deklaration bis zu ihrem gemeinsamen Ursprung. */
  private arrayAliasRoot(variable: Variable, seen = new Set<Variable>()): Variable {
    if (seen.has(variable)) return variable;
    seen.add(variable);
    if (isVarDecl(variable) && variable.initializer) {
      const initializer = this.unwrap(variable.initializer);
      if (isVarRef(initializer) && !initializer.index && initializer.ref?.ref &&
          (this.variableTypes.get(variable)?.depth ?? 0) > 0 &&
          (this.variableTypes.get(initializer.ref.ref)?.depth ?? 0) > 0) {
        return this.arrayAliasRoot(initializer.ref.ref, seen);
      }
    }
    return variable;
  }

  /** Loest einen nativen Struct-Zeigertyp auf seine Pseudo2-Deklaration zurueck. */
  private structForType(type: CType): StructDeclaration | undefined {
    const match = /^struct (.+) \*$/.exec(type.base);
    if (!match || type.depth !== 0) return undefined;
    for (const [struct, name] of this.structNames) if (name === match[1]) return struct;
    return undefined;
  }

  /** Nutzt die nativen C-Werte direkt im Beweis statt Runtime-Modellfunktionen. */
  private specExpr(value: Expr, state: EmitState): string {
    const expr = this.unwrap(value);
    if (isResultExpr(expr)) return 'result';
    if (isUndefinedSpecExpr(expr)) throw new DirectCGenerationError('undefined ist ohne Tagged-Value-Runtime kein C-Wert.', expr);
    if (isSpecPredicateExpr(expr)) {
      if ((expr.kind === 'length' || expr.kind === 'vf_len') && expr.args.length === 1) {
        return this.specArrayLength(expr.args[0], state);
      }
      throw new DirectCGenerationError(`${expr.kind} gehoert zum Runtime-Modell; Direct C verwendet native C-Ausdruecke.`, expr);
    }
    if (isStringLiteral(expr)) return JSON.stringify(expr.value);
    if (isArrayLiteral(expr) || isFunctionCall(expr) || isMethSelection(expr) || isNewExpr(expr)) {
      throw new DirectCGenerationError('Vertraege duerfen keine neuen Werte erzeugen oder Funktionen aufrufen.', expr);
    }
    if (isGrouping(expr)) return `(${this.specExpr(expr.value, state)})`;
    if (isNeg(expr)) return `(-${this.specExpr(expr.value, state)})`;
    if (isNot(expr)) return `(!${this.specExpr(expr.value, state)})`;
    if (isOr(expr) || isAnd(expr) || isEquality(expr) || isComparison(expr) ||
        isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
      const rights = expr.right ?? [];
      if (isEquality(expr) && rights.length === 1 && (expr.op[0] === '==' || expr.op[0] === '!=')) {
        const left = this.unwrap(expr.left);
        const right = this.unwrap(rights[0]);
        const equalityOperator = expr.op[0];
        const leftType = this.specTypeOf(left, state);
        const rightType = this.specTypeOf(right, state);
        if (leftType?.depth && rightType?.depth) {
          const leftData = this.specArrayData(left, state);
          const rightData = this.specArrayData(right, state);
          if (equalityOperator === '==') {
            return `(${leftData} == ${rightData}) &*& (${this.specArrayLength(left, state)} == ${this.specArrayLength(right, state)})`;
          }
          return `${leftData} != ${rightData}`;
        }
        if (isUndefinedSpecExpr(right) || isUndefinedSpecExpr(left)) {
          const fieldValue = isUndefinedSpecExpr(right) ? left : right;
          const field = this.specFieldAccess(fieldValue, state);
          const defined = field && state.specAliases?.definedFields.get(field);
          const definedAccess = this.specFieldDefinedAccess(fieldValue, state);
          if (!field || (!defined && !definedAccess)) {
            throw new DirectCGenerationError('undefined kann im Direct-C-Vertrag nur mit einem Struct-Feld verglichen werden.', expr);
          }
          const expected = equalityOperator === '==' ? 'false' : 'true';
          return defined ? `${defined} == ${expected}` : `${definedAccess} |-> ${expected}`;
        }
        if (isStringLiteral(right) && this.specTypeOf(left, state)?.base === STRING.base) {
          return this.specStringLiteralComparison(left, right.value, equalityOperator, state);
        }
        if (isStringLiteral(left) && this.specTypeOf(right, state)?.base === STRING.base) {
          return this.specStringLiteralComparison(right, left.value, equalityOperator, state);
        }
        if (this.specTypeOf(left, state)?.base === STRING.base && this.specTypeOf(right, state)?.base === STRING.base) {
          return this.specStringValueComparison(left, right, equalityOperator, state);
        }
        const leftField = this.specFieldAccess(left, state);
        if (leftField) {
          const alias = state.specAliases?.fields.get(leftField);
          return alias
            ? `${alias} ${equalityOperator} ${this.specExpr(right, state)}`
            : `${leftField} |-> ${this.specExpr(right, state)}`;
        }
        const rightField = this.specFieldAccess(right, state);
        if (rightField) {
          const alias = state.specAliases?.fields.get(rightField);
          return alias
            ? `${alias} ${equalityOperator} ${this.specExpr(left, state)}`
            : `${rightField} |-> ${this.specExpr(left, state)}`;
        }
      }
      if (isEquality(expr) && [expr.left, ...rights].filter(part => this.specTypeOf(part, state)?.base === STRING.base).length > 1) {
        throw new DirectCGenerationError('String-Inhaltsvertraege brauchen einen Stringliteral-Vergleich; Zeigervergleich waere unsound.', expr);
      }
      let result = this.specExpr(expr.left, state);
      for (let index = 0; index < rights.length; index++) {
        const op = isOr(expr) ? '||' : isAnd(expr) ? '&*&' : expr.op?.[index] ?? expr.op?.[0] ?? '';
        if (op === '^' || op === 'mod') throw new DirectCGenerationError(`Operator '${op}' ist im nativen VeriFast-Ausdruck nicht verfuegbar.`, expr);
        result = `(${result} ${op} ${this.specExpr(rights[index], state)})`;
      }
      return result;
    }
    const field = this.specFieldAccess(expr, state);
    if (field) {
      const alias = state.specAliases?.fields.get(field);
      if (alias) return alias;
      throw new DirectCGenerationError('Struct-Felder in Vertraegen als einfache Gleichheit schreiben.', expr);
    }
    if (isVarRef(expr) && expr.index) {
      const decl = expr.ref?.ref;
      if (!decl) throw new DirectCGenerationError('Unbekannte Arrayvariable.', expr);
      const rawName = isStructAttDeclaration(decl) ? `${state.thisName}->${this.name(decl)}` : this.name(decl);
      const name = isParameterDecl(decl) && decl.isArray ? `${rawName}.data` : rawName;
      const alias = state.specAliases?.arrays.get(name);
      if (alias) return `nth(${this.specExpr(expr.index, state)} - 1, ${alias})`;
      return `${name}[(${this.specExpr(expr.index, state)}) - 1]`;
    }
    if (isAttSelection(expr) && expr.attref.index) {
      const data = this.specAttributeAccess(expr, state);
      const alias = state.specAliases?.arrays.get(data);
      return alias
        ? `nth(${this.specExpr(expr.attref.index, state)} - 1, ${alias})`
        : `${data}[(${this.specExpr(expr.attref.index, state)}) - 1]`;
    }
    if (isIndexSelection(expr)) {
      const receiver = this.unwrap(expr.receiver);
      const nestedReceiver = isVarRef(receiver) && !!receiver.index || isIndexSelection(receiver) ||
        isAttSelection(receiver) && !!receiver.attref.index;
      if (nestedReceiver) {
        return `nth(${this.specExpr(expr.index, state)} - 1, ${this.specExpr(expr.receiver, state)})`;
      }
      const data = this.specArrayData(expr.receiver, state);
      const alias = state.specAliases?.arrays.get(data);
      return alias
        ? `nth(${this.specExpr(expr.index, state)} - 1, ${alias})`
        : `${data}[(${this.specExpr(expr.index, state)}) - 1]`;
    }
    if (isVarRef(expr) || isThisExpr(expr) ||
        isIntLiteral(expr) || isBoolLiteral(expr) || isNullLiteral(expr) || isSpecConstantExpr(expr)) {
      return this.expr(expr, state);
    }
    throw new DirectCGenerationError(`Annotationsausdruck '${expr.$type}' nicht unterstuetzt.`, expr);
  }

  /** Uebersetzt `length(array)` in die zum nativen Array gehoerende Laengeninformation. */
  private specArrayLength(value: Expr, state: EmitState): string {
    const expression = this.unwrap(value);
    if (isResultExpr(expression)) {
      if (!state.returnType?.depth) throw new DirectCGenerationError('result ist in diesem Vertrag kein Array.', expression);
      return 'result.length';
    }
    if (!this.typeOfExpr(expression)?.depth) throw new DirectCGenerationError('length erwartet im Direct-C-Vertrag ein Array.', expression);
    if ((isVarRef(expression) && !!expression.index) || isIndexSelection(expression) ||
        (isAttSelection(expression) && !!expression.attref.index)) {
      return `length(${this.specExpr(expression, state)})`;
    }
    const data = this.specArrayData(expression, state);
    const alias = state.specAliases?.arrayLengths.get(data);
    if (alias) return alias;
    return this.lengthOf(expression, state);
  }

  /** Liefert den Datenzeiger eines Arrays in reiner VeriFast-Syntax ohne Indexpruefaufruf. */
  private specArrayData(value: Expr, state: EmitState): string {
    const expression = this.unwrap(value);
    if (isResultExpr(expression)) return 'result.data';
    if (isVarRef(expression) && !expression.index && expression.ref?.ref) {
      const decl = expression.ref.ref;
      if (isStructAttDeclaration(decl)) {
        if (!state.thisName) throw new DirectCGenerationError('Implizites Arrayfeld ausserhalb einer Methode.', expression);
        return `${state.thisName}->${this.name(decl)}`;
      }
      return isParameterDecl(decl) && decl.isArray ? `${this.name(decl)}.data` : this.name(decl);
    }
    if (isAttSelection(expression) && !expression.attref.index) return this.specAttributeAccess(expression, state);
    if ((isVarRef(expression) && !!expression.index) || isIndexSelection(expression) ||
        (isAttSelection(expression) && !!expression.attref.index)) {
      throw new DirectCGenerationError('Der Datenzeiger eines inneren Arrays wird im Vertrag durch seine Ghostliste abstrahiert.', expression);
    }
    throw new DirectCGenerationError('Arraydaten dieses Annotationsausdrucks sind nicht bestimmbar.', expression);
  }

  /** Uebernimmt einen alleinstehenden String als rohe VeriFast-Syntax, sonst als typisierten Ausdruck. */
  private specCondition(value: Expr, state: EmitState): string {
    const expression = this.unwrap(value);
    return isStringLiteral(expression) ? expression.value : this.specExpr(expression, state);
  }

  /** Bestimmt auch fuer `result` den statischen Typ im aktuellen Funktionsvertrag. */
  private specTypeOf(expr: Expr, state: EmitState): CType | undefined {
    return isResultExpr(this.unwrap(expr)) ? state.returnType : this.typeOfExpr(expr);
  }

  /** Formuliert Stringgleichheit als Inhaltseigenschaft statt als Zeigervergleich. */
  private specStringLiteralComparison(value: Expr, literal: string, operator: string, state: EmitState): string {
    const chars = this.veriFastStringChars(literal);
    const string = this.specStringValue(value, state);
    if (string.alias) return `${string.alias} ${operator} ${chars}`;
    if (operator === '==') return `[_]string((char *)${string.expression}, ${chars})`;
    const actual = this.temp('string_chars');
    return `[_]string((char *)${string.expression}, ?${actual}) &*& ${actual} != ${chars}`;
  }

  /** Vergleicht zwei native Strings in Vertraegen ueber ihre Zeichenlisten. */
  private specStringValueComparison(left: Expr, right: Expr, operator: string, state: EmitState): string {
    const leftValue = this.specStringValue(left, state);
    const rightValue = this.specStringValue(right, state);
    const chunks: string[] = [];
    const leftChars = leftValue.alias ?? this.temp('string_left');
    const rightChars = rightValue.alias ?? this.temp('string_right');
    if (!leftValue.alias) chunks.push(`[_]string((char *)${leftValue.expression}, ?${leftChars})`);
    if (!rightValue.alias) chunks.push(`[_]string((char *)${rightValue.expression}, ?${rightChars})`);
    return [...chunks, `${leftChars} ${operator} ${rightChars}`].join(' &*& ');
  }

  /** Liefert C-Ausdruck und gegebenenfalls bereits gebundene VeriFast-Zeichenliste eines Strings. */
  private specStringValue(value: Expr, state: EmitState): { expression: string; alias?: string } {
    const unwrapped = this.unwrap(value);
    if (isVarRef(unwrapped) && !unwrapped.index && unwrapped.ref?.ref) {
      const name = this.name(unwrapped.ref.ref);
      const alias = state.specAliases?.strings.get(name);
      if (alias) return { expression: name, alias };
    }
    const field = this.specFieldAccess(unwrapped, state);
    if (field) {
      const alias = state.specAliases?.fields.get(field);
      if (alias) return { expression: alias };
    }
    return { expression: isResultExpr(unwrapped) ? 'result' : this.expr(unwrapped, state) };
  }

  /** Liefert die C-Adresse eines skalaren Struct-Feldes in einer Spezifikation. */
  private specFieldAccess(value: Expr, state: EmitState): string | undefined {
    const expr = this.unwrap(value);
    if (isVarRef(expr) && !expr.index && isStructAttDeclaration(expr.ref?.ref)) {
      if (!state.thisName) throw new DirectCGenerationError('Implizites Struct-Feld ausserhalb einer Methode.', expr);
      return `${state.thisName}->${this.name(expr.ref.ref)}`;
    }
    if (isAttSelection(expr) && !expr.attref.index) return this.specAttributeAccess(expr, state);
    return undefined;
  }

  /** Liefert einen Struct-Feldzugriff und behandelt `result` rein als Vertragswert. */
  private specAttributeAccess(value: Expr & { receiver: Expr; attref: { ref?: { ref?: Variable } } }, state: EmitState): string {
    const field = value.attref.ref?.ref;
    if (!field) throw new DirectCGenerationError('Unbekanntes Struct-Feld im Vertrag.', value);
    const receiver = this.unwrap(value.receiver);
    const receiverValue = isResultExpr(receiver) ? 'result' : this.specExpr(receiver, state);
    const pointer = /^[A-Za-z_]\w*$/.test(receiverValue) ? receiverValue : `(${receiverValue})`;
    return `${pointer}->${this.name(field)}`;
  }

  /** Liefert das zum Feldwert gehoerende native Initialisierungsflag. */
  private specFieldDefinedAccess(value: Expr, state: EmitState): string | undefined {
    const expression = this.unwrap(value);
    if (isVarRef(expression) && !expression.index && isStructAttDeclaration(expression.ref?.ref)) {
      if (!state.thisName) throw new DirectCGenerationError('Implizites Struct-Feld ausserhalb einer Methode.', expression);
      return `${state.thisName}->${this.fieldDefinedName(expression.ref.ref)}`;
    }
    if (isAttSelection(expression) && !expression.attref.index && expression.attref.ref?.ref) {
      const receiver = this.unwrap(expression.receiver);
      const receiverValue = isResultExpr(receiver) ? 'result' : this.expr(receiver, state);
      return `${receiverValue}->${this.fieldDefinedName(expression.attref.ref.ref)}`;
    }
    return undefined;
  }

  /** Kodiert einen Stringliteral-Inhalt als VeriFast-Liste von C-Bytes. */
  private veriFastStringChars(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let list = 'nil';
    for (let index = bytes.length - 1; index >= 0; index--) {
      list = `cons((char)${bytes[index]}, ${list})`;
    }
    return list;
  }

  /** Setzt eine voruebergehende Quellmarke, die vor der Ausgabe wieder entfernt wird. */
  private mapped(node: AstNode | undefined, code: string): string {
    if (!code || !node?.$cstNode) return code;
    return `/*__ps2_line_${node.$cstNode.range.start.line + 1}__*/${code}`;
  }

  /** Entfernt Quellmarken und sammelt die C-zu-Pseudo2-Zeilenabbildung. */
  private finish(markedCode: string): { code: string; sourceMap: CSourceMapEntry[] } {
    const sourceMap: CSourceMapEntry[] = [];
    let sourceLine: number | undefined;
    const code = markedCode.split('\n').map((line, index) => {
      const matches = [...line.matchAll(/\/\*__ps2_line_(\d+)__\*\//g)];
      if (matches.length) sourceLine = Number(matches[matches.length - 1][1]);
      if (sourceLine !== undefined) sourceMap.push({ generatedLine: index + 1, sourceLine });
      return line.replace(/\/\*__ps2_line_\d+__\*\//g, '');
    }).join('\n');
    return { code, sourceMap };
  }

  /** Waehlt ein printf-Format fuer einen eindeutig bestimmten skalaren Ausdruck. */
  private emitPrint(value: Expr, level: number, state: EmitState): string {
    const i = '  '.repeat(level);
    if (isNullLiteral(this.unwrap(value))) return `${i}puts("null");`;
    const type = this.typeOfExpr(value);
    if (!type) throw new DirectCGenerationError('Typ des print-Ausdrucks ist nicht bestimmbar.', value);
    const defined = this.fieldDefinedTarget(this.unwrap(value), state);
    if (type.depth > 0) {
      const lowered = this.materializeRootCall(value, state, i);
      const descriptor = lowered?.expression ?? this.arrayDescriptorValue(value, type, state);
      const output = `${directCArrayPrintFunction(this.arrayRuntimeType(type))}(${descriptor});`;
      return [
        ...(lowered?.prefix ?? []),
        `${i}${defined ? `if (${defined}) ${output} else puts("undefined");` : output}`
      ].join('\n');
    }
    if (type.base.startsWith('struct ')) {
      const lowered = this.lowerRootExpression(value, state, i);
      const output = `${DIRECT_C_STRUCT_PRINT_FUNCTION}(${lowered.expression});`;
      return [
        ...lowered.prefix,
        `${i}${defined ? `if (${defined}) ${output} else puts("undefined");` : output}`
      ].join('\n');
    }
    const lowered = this.lowerRootExpression(value, state, i);
    let expression = lowered.expression;
    const prefix: string[] = [...lowered.prefix];
    if (isFunctionCall(this.unwrap(value)) || isMethSelection(this.unwrap(value)) ||
        [...AstUtils.streamAllContents(value)].some(node => isFunctionCall(node) || isMethSelection(node))) {
      const temp = this.temp('print');
      prefix.push(`${i}${this.typeName(type)} ${temp} = ${expression};`);
      expression = temp;
    }
    if (defined) {
      const kind = this.optionalPrintKind(type);
      if (!kind) throw new DirectCGenerationError('Initialisierbares Feld besitzt keinen direkt ausgebbaren C-Typ.', value);
      return [...prefix, `${i}${directCOptionalPrintFunction(kind)}(${defined}, ${expression});`].join('\n');
    }
    let output: string;
    if (type.base === 'bool') output = [...prefix, `${i}puts(${expression} ? "true" : "false");`].join('\n');
    else if (type.base === 'const char *') {
      const temp = this.temp('text');
      output = [...prefix, `${i}const char *${temp} = ${expression};`, `${i}printf("%s\\n", ${temp} == NULL ? "null" : ${temp});`].join('\n');
    } else {
      output = [...prefix, `${i}printf("${this.verifiedIntegers ? '%d' : '%.15g'}\\n", ${expression});`].join('\n');
    }
    return output;
  }

  /** Erkennt einen Struct-Feldwert, dessen JavaScript-Wert noch `undefined` sein kann. */
  private isPotentiallyUndefinedField(value: Expr): boolean {
    const expression = this.unwrap(value);
    return isVarRef(expression) && !expression.index && isStructAttDeclaration(expression.ref?.ref) ||
      isAttSelection(expression) && !expression.attref.index;
  }

  /** Ordnet einen nativen Skalartyp seinem typisierten optionalen Ausgabehelfer zu. */
  private optionalPrintKind(type: CType): DirectCOptionalPrintKind | undefined {
    if (type.depth > 0) return undefined;
    if (type.base === 'int') return 'int';
    if (type.base === 'double') return 'double';
    if (type.base === 'bool') return 'bool';
    if (type.base === STRING.base) return 'string';
    return undefined;
  }

  /** Verhindert den von JavaScript abweichenden C-Wahrheitswert leerer Strings. */
  private condition(value: Expr, state: EmitState): string {
    const defined = this.fieldDefinedTarget(this.unwrap(value), state);
    const type = this.typeOfExpr(value);
    if (type?.base === STRING.base && type.depth === 0) {
      const stable = this.unwrap(value);
      if (isStringLiteral(stable)) return stable.value.length > 0 ? 'true' : 'false';
      const expression = this.expr(stable, state);
      const truthy = `ps2_text_truthy(${expression})`;
      return defined ? `(${defined} && ${truthy})` : truthy;
    }
    const expression = this.expr(value, state);
    return defined ? `(${defined} && ${expression})` : expression;
  }

  /** Schreibt throw mit einem zum statischen Skalar passenden stderr-Format. */
  private emitThrow(value: Expr, level: number, state: EmitState): string {
    const i = '  '.repeat(level);
    if (isNullLiteral(this.unwrap(value))) return `${i}fputs("null\\n", stderr);\n${i}exit(1);`;
    const type = this.typeOfExpr(value);
    if (!type) throw new DirectCGenerationError('Typ des throw-Ausdrucks ist nicht bestimmbar.', value);
    const defined = this.fieldDefinedTarget(this.unwrap(value), state);
    if (type.depth > 0) {
      const lowered = this.materializeRootCall(value, state, i);
      const descriptor = lowered?.expression ?? this.arrayDescriptorValue(value, type, state);
      const fail = `${directCArrayThrowFunction(this.arrayRuntimeType(type))}(${descriptor});`;
      return [
        ...(lowered?.prefix ?? []),
        ...(defined ? [
          `${i}if (!${defined}) { fputs("undefined\\n", stderr); exit(1); }`,
          `${i}else ${fail}`
        ] : [`${i}${fail}`])
      ].join('\n');
    }
    if (type.base.startsWith('struct ')) {
      const lowered = this.lowerRootExpression(value, state, i);
      const fail = `${DIRECT_C_STRUCT_THROW_FUNCTION}(${lowered.expression});`;
      return [
        ...lowered.prefix,
        ...(defined ? [
          `${i}if (!${defined}) { fputs("undefined\\n", stderr); exit(1); }`,
          `${i}else ${fail}`
        ] : [`${i}${fail}`])
      ].join('\n');
    }
    const lowered = this.lowerRootExpression(value, state, i);
    const expression = lowered.expression;
    if (type.base === STRING.base) {
      const temp = this.temp('text');
      return [...lowered.prefix, `${i}const char *${temp} = ${expression};`, `${i}fprintf(stderr, "%s\\n", ${temp} == NULL ? "null" : ${temp});`, `${i}exit(1);`].join('\n');
    }
    const format = type.base === BOOLEAN.base ? '%s' : this.verifiedIntegers ? '%d' : '%.15g';
    const argument = type.base === BOOLEAN.base ? `(${expression} ? "true" : "false")` : expression;
    return [...lowered.prefix, `${i}fprintf(stderr, "${format}\\n", ${argument});`, `${i}exit(1);`].join('\n');
  }

  /** Schreibt Werte, Zugriffe, Aufrufe und Operatoren direkt als C-Ausdruecke. */
  private expr(value: Expr, state: EmitState): string {
    if (isIntLiteral(value)) {
      return !this.verifiedIntegers && Number.isInteger(value.value)
        ? `${value.value}.0`
        : String(value.value);
    }
    if (isBoolLiteral(value)) return value.value;
    if (isStringLiteral(value)) return JSON.stringify(value.value);
    if (isNullLiteral(value)) return 'NULL';
    if (isSpecConstantExpr(value)) return value.value;
    if (isResultExpr(value) || isUndefinedSpecExpr(value) || isSpecPredicateExpr(value)) {
      throw new DirectCGenerationError('VeriFast-Ausdruecke sind im Direct-C-Programm nicht ausfuehrbar.', value);
    }
    const nestedAccess = this.nestedArrayAccess(value, state);
    if (nestedAccess) {
      const getter = this.arrayRuntimeType(nestedAccess.type).getFunction!;
      const indices = nestedAccess.indices.map(index => this.expr(index, state));
      return `${getter}(${[nestedAccess.descriptor, ...indices].join(', ')})`;
    }
    if (isNewExpr(value)) {
      const struct = value.type?.ref;
      if (!struct) throw new DirectCGenerationError('Unbekannter Struct-Typ.', value);
      return `${this.structAllocatorName(struct)}()`;
    }
    if (isThisExpr(value)) {
      if (!state.thisName) throw new DirectCGenerationError('this ausserhalb einer Methode.', value);
      return state.thisName;
    }
    if (isVarRef(value)) {
      const decl = value.ref?.ref;
      if (!decl) throw new DirectCGenerationError('Unbekannte Variable.', value);
      const lengthOwner = this.lengthParameterOwners.get(decl);
      if (lengthOwner) return `${this.name(lengthOwner)}.length`;
      if (isStructAttDeclaration(decl) && !state.thisName) {
        throw new DirectCGenerationError('Impliziter Feldzugriff ohne Methodenempfaenger.', value);
      }
      const rawName = isStructAttDeclaration(decl) ? `${state.thisName}->${this.name(decl)}` : this.name(decl);
      const parameterArray = isParameterDecl(decl) && decl.isArray;
      const name = parameterArray ? `${rawName}.data` : rawName;
      if (!value.index) return name;
      const length = isStructAttDeclaration(decl)
        ? `${state.thisName}->${this.arrayFieldLength(decl)}`
        : parameterArray
          ? `${rawName}.length`
        : this.lengthOfVariable(decl, value);
      return `${name}[${this.checkedIndex(value.index, length, state)}]`;
    }
    if (isAttSelection(value)) {
      const field = value.attref.ref?.ref;
      if (!field) throw new DirectCGenerationError('Unbekanntes Struct-Feld.', value);
      const access = `${this.expr(value.receiver, state)}->${this.name(field)}`;
      if (value.attref.index) {
        const length = `${this.expr(value.receiver, state)}->${this.arrayFieldLength(field)}`;
        return `${access}[${this.checkedIndex(value.attref.index, length, state)}]`;
      }
      return access;
    }
    if (isIndexSelection(value)) return `${this.arrayData(value.receiver, state)}[${this.checkedIndex(value.index, this.lengthOf(value.receiver, state), state)}]`;
    if (isArrayLiteral(value)) {
      const factory = this.arrayLiteralFunctions.get(value);
      if (!factory) throw new DirectCGenerationError('Arrayliteraltyp konnte nicht vorbereitet werden.', value);
      return `${factory}(${value.elems.map(element => this.expr(element, state)).join(', ')})`;
    }
    if (isFunctionCall(value)) {
      const fn = value.f?.ref;
      if (!fn) throw new DirectCGenerationError('Unbekannte Funktion.', value);
      return this.call(fn, value.params ?? [], state);
    }
    if (isMethSelection(value)) {
      const fn = value.methref.f?.ref;
      if (!fn) throw new DirectCGenerationError('Unbekannte Methode.', value);
      return this.call(fn, value.methref.params ?? [], state, this.expr(value.receiver, state));
    }
    if (isGrouping(value)) return `(${this.expr(value.value, state)})`;
    if (isNeg(value)) return `(-${this.expr(value.value, state)})`;
    if (isNot(value)) {
      const type = this.typeOfExpr(value.value);
      if (type?.base === STRING.base && type.depth === 0) {
        return `(!${this.condition(value.value, state)})`;
      }
      return `(!${this.expr(value.value, state)})`;
    }
    if (isOr(value) || isAnd(value) || isComparison(value) || isEquality(value) || isAddition(value) || isMultiplication(value) || isExponentiation(value)) {
      const rights = value.right ?? [];
      if (!rights.length) return this.expr(value.left, state);
      let left = this.expr(value.left, state);
      let leftType = this.typeOfExpr(value.left);
      for (let n = 0; n < rights.length; n++) {
        const right = this.expr(rights[n], state);
        const rightType = this.typeOfExpr(rights[n]);
        const op = isOr(value) ? '||' : isAnd(value) ? '&&' : value.op?.[n] ?? value.op?.[0] ?? '';
        if (isEquality(value)) {
          const leftNull = n === 0 && isNullLiteral(this.unwrap(value.left));
          const rightNull = isNullLiteral(this.unwrap(rights[n]));
          if ((!leftNull && !leftType) || (!rightNull && !rightType)) {
            throw new DirectCGenerationError('Gleichheit mit unbekanntem Typ ist ohne Runtime nicht darstellbar.', value);
          }
          const different = leftNull || rightNull
            ? !(leftNull && rightNull) && !this.isPointerType((leftNull ? rightType : leftType)!)
            : leftType!.base !== rightType!.base || leftType!.depth !== rightType!.depth;
          if (different) {
            left = `((${left}), (${right}), ${op === '!=' ? 'true' : 'false'})`;
          } else if (leftType?.base === STRING.base && rightType?.base === STRING.base) {
            const leftSource = n === 0 ? value.left : rights[n - 1];
            const helper = this.nonNullString(leftSource, state) && this.nonNullString(rights[n], state)
              ? 'ps2_text_equal_nonnull'
              : 'ps2_text_equal';
            const equality = `${helper}(${left}, ${right})`;
            left = op === '!=' ? `(!${equality})` : equality;
          } else {
            left = `(${left} ${op} ${right})`;
          }
          leftType = BOOLEAN;
          continue;
        }
        if (isAddition(value) && op === '+' &&
            (leftType?.base === STRING.base || rightType?.base === STRING.base ||
             isNullLiteral(this.unwrap(n === 0 ? value.left : rights[n - 1])) || isNullLiteral(this.unwrap(rights[n])))) {
          const leftSource = n === 0 ? value.left : rights[n - 1];
          left = `ps2_concat_text(${this.textValue(left, leftType, leftSource, state)}, ${this.textValue(right, rightType, rights[n], state)})`;
          leftType = STRING;
          continue;
        }
        if (isOr(value) || isAnd(value)) {
          if (leftType?.base !== BOOLEAN.base || rightType?.base !== BOOLEAN.base) {
            throw new DirectCGenerationError('Logische Operatoren auf nicht-booleschen Werten brauchen eine Runtime.', value);
          }
        } else if (leftType?.base !== this.numberType.base || rightType?.base !== this.numberType.base ||
                   leftType.depth !== 0 || rightType.depth !== 0) {
          throw new DirectCGenerationError(isAddition(value) && op === '+' &&
            (leftType?.base === STRING.base || rightType?.base === STRING.base)
              ? 'Stringverkettung braucht Speicherverwaltung und ist ohne Runtime nicht darstellbar.'
              : 'Operator auf nicht-numerischen Werten ist ohne Runtime nicht darstellbar.', value);
        }
        if (op === '^') {
          left = `pow(${left}, ${right})`;
        } else if (op === 'mod' || op === '%') {
          left = this.verifiedIntegers ? `(${left} % ${right})` : `fmod(${left}, ${right})`;
        } else {
          left = `(${left} ${op} ${right})`;
        }
        leftType = isOr(value) || isAnd(value) || isComparison(value) ? BOOLEAN : this.numberType;
      }
      return left;
    }
    throw new DirectCGenerationError(`Ausdruck '${value.$type}' nicht unterstuetzt.`, value);
  }

  /** Wandelt einen statisch bekannten Pseudo2-Skalar fuer String-`+` in Text um. */
  private textValue(expression: string, type: CType | undefined, source: Expr, state: EmitState): string {
    if (isNullLiteral(this.unwrap(source))) return '"null"';
    const defined = this.fieldDefinedTarget(this.unwrap(source), state);
    const whenDefined = type?.base === STRING.base && type.depth === 0
      ? `(${expression} == NULL ? "null" : ${expression})`
      : type?.base === BOOLEAN.base && type.depth === 0
        ? `(${expression} ? "true" : "false")`
        : type?.base === this.numberType.base && type.depth === 0
          ? `ps2_number_to_text(${expression})`
          : undefined;
    if (defined && whenDefined) return `(${defined} ? ${whenDefined} : "undefined")`;
    if (type?.base === STRING.base && type.depth === 0) {
      return `(${expression} == NULL ? "null" : ${expression})`;
    }
    if (type?.base === BOOLEAN.base && type.depth === 0) return `(${expression} ? "true" : "false")`;
    if (type?.base === this.numberType.base && type.depth === 0) return `ps2_number_to_text(${expression})`;
    throw new DirectCGenerationError('Stringverkettung ist nur fuer Strings, Zahlen, Bool und null definiert.', source);
  }

  /** Erkennt Stringausdruecke, fuer die C-Code und VeriFast-Vertrag Nicht-null garantieren. */
  private nonNullString(value: Expr, state: EmitState): boolean {
    const expression = this.unwrap(value);
    if (isStringLiteral(expression)) return true;
    if (isVarRef(expression) && !expression.index && expression.ref?.ref) {
      return state.nonNullStrings?.has(expression.ref.ref) === true;
    }
    if (isFunctionCall(expression) || isMethSelection(expression)) {
      return this.typeOfExpr(expression)?.base === STRING.base;
    }
    return isAddition(expression) && this.typeOfExpr(expression)?.base === STRING.base;
  }

  /** Aktualisiert die lokale Nicht-null-Information nach einer Stringzuweisung. */
  private trackNonNullStringAssignment(assignment: Assignment, state: EmitState): void {
    const target = this.unwrap(assignment.sel);
    if (!isVarRef(target) || target.index || !target.ref?.ref) return;
    const type = this.variableTypes.get(target.ref.ref);
    if (type?.depth !== 0 || type.base !== STRING.base) return;
    if (this.nonNullString(assignment.value, state)) state.nonNullStrings?.add(target.ref.ref);
    else state.nonNullStrings?.delete(target.ref.ref);
  }

  /** Ergaenzt bei Arrayparametern den Laengenparameter ohne Runtime-Helfer. */
  private call(fn: FunctionDeclaration, args: Expr[], state: EmitState, receiver?: string): string {
    const actuals = receiver ? [receiver] : [];
    for (let n = 0; n < args.length; n++) {
      const parameter = fn.params[n];
      if (parameter) this.requireType(this.variableTypes.get(parameter)!, args[n]);
      actuals.push(parameter?.isArray
        ? this.arrayDescriptorValue(args[n], this.variableTypes.get(parameter)!, state)
        : this.expr(args[n], state));
    }
    return `${this.functionName(fn)}(${actuals.join(', ')})`;
  }

  /**
   * Materialisiert Arraydeskriptoren eines direkt verwendeten Funktionsaufrufs in
   * getrennten C-Anweisungen. Das legt die Auswertungsreihenfolge fest und erlaubt
   * VeriFast auch mehrere beziehungsweise identische Arrayargumente sicher zu
   * konsumieren und wieder bereitzustellen.
   */
  private materializeRootCall(
    value: Expr,
    state: EmitState,
    indent: string
  ): { prefix: string[]; expression: string } | undefined {
    const expression = this.unwrap(value);
    let fn: FunctionDeclaration | undefined;
    let args: Expr[];
    let actuals: string[];
    if (isFunctionCall(expression)) {
      fn = expression.f?.ref;
      args = expression.params;
      actuals = [];
    } else if (isMethSelection(expression)) {
      fn = expression.methref.f?.ref;
      args = expression.methref.params;
      actuals = [this.expr(expression.receiver, state)];
    } else {
      return undefined;
    }
    if (!fn) return undefined;
    const prefix: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const parameter = fn.params[index];
      if (parameter) this.requireType(this.variableTypes.get(parameter)!, args[index]);
      if (parameter?.isArray) {
        const type = this.variableTypes.get(parameter)!;
        const temporary = this.temp('array_argument');
        prefix.push(`${indent}${this.arrayRuntimeType(type).resultType} ${temporary} = ${this.arrayDescriptorValue(args[index], type, state)};`);
        actuals.push(temporary);
      } else {
        actuals.push(this.expr(args[index], state));
      }
    }
    return { prefix, expression: `${this.functionName(fn)}(${actuals.join(', ')})` };
  }

  /**
   * Senkt einen direkten Aufruf ab und liefert fuer andere Ausdruecke unveraendert
   * deren C-Darstellung. Aufrufer koennen dadurch dieselbe feste Reihenfolge fuer
   * Arraydeskriptoren in Deklarationen, Zuweisungen und Kommandos verwenden.
   */
  private lowerRootExpression(
    value: Expr,
    state: EmitState,
    indent: string
  ): { prefix: string[]; expression: string } {
    return this.materializeRootCall(value, state, indent) ?? {
      prefix: [],
      expression: this.expr(value, state)
    };
  }

  /** Verhindert implizite C-Zeigerarithmetik und Typwechsel im statischen Modus. */
  private requireType(expected: CType, expression: Expr): void {
    const unwrapped = this.unwrap(expression);
    if (expected.depth > 0 && isArrayLiteral(unwrapped) && unwrapped.elems.length === 0) return;
    if (isNullLiteral(unwrapped)) {
      if (expected.depth > 0 || expected.base.endsWith('*')) return;
      throw new DirectCGenerationError('null kann hier keinem nativen C-Skalar zugewiesen werden.', expression);
    }
    const actual = this.typeOfExpr(expression);
    if (!actual || expected.base !== actual.base || expected.depth !== actual.depth) {
      throw new DirectCGenerationError(`Typwechsel nach ${this.typeName(expected)} ist ohne Runtime nicht zulaessig.`, expression);
    }
  }

  /** Erkennt C-Pointer auch bei einem einzelnen Struct- oder Stringwert. */
  private isPointerType(type: CType): boolean {
    return type.depth > 0 || type.base.endsWith('*');
  }

  /** Erkennt Ausdruecke, die bereits einen `data`/`length`-Deskriptor liefern. */
  private arrayDescriptorExpression(value: Expr, type: CType, state: EmitState): string | undefined {
    const expression = this.unwrap(value);
    if (isArrayLiteral(expression)) return this.expr(expression, state);
    if (isFunctionCall(expression) || isMethSelection(expression)) {
      return this.typeOfExpr(expression)?.depth ? this.expr(expression, state) : undefined;
    }
    if ((isVarRef(expression) && !!expression.index || isAttSelection(expression) && !!expression.attref.index ||
         isIndexSelection(expression)) && this.typeOfExpr(expression)?.depth) {
      return `*(${this.expr(expression, state)})`;
    }
    if (isResultExpr(expression) && type.depth > 0) return 'result';
    return undefined;
  }

  /** Verfolgt einfache Arrayaliase bis zu einer per `var A[n]` angelegten Heapallokation. */
  private arrayAllocationOwner(value: Expr, seen = new Set<Variable>()): VarDecl | undefined {
    const expression = this.unwrap(value);
    if (!isVarRef(expression) || expression.index || !expression.ref?.ref) return undefined;
    const declaration = expression.ref.ref;
    if (seen.has(declaration)) return undefined;
    seen.add(declaration);
    if (isVarDecl(declaration) && declaration.isArrayVariable) return declaration;
    if (isVarDecl(declaration) && declaration.initializer) {
      return this.arrayAllocationOwner(declaration.initializer, seen);
    }
    return undefined;
  }

  /** Nimmt ein neu besessenes lokales Array in spaetere Schleifeninvarianten auf. */
  private registerLocalArrayOwnership(
    declaration: VarDecl,
    name: string,
    length: string,
    type: CType,
    state: EmitState,
    hasMallocBlock: boolean
  ): void {
    state.heapInvariants ??= [];
    state.loopAliases ??= this.emptySpecAliases();
    state.specAliases ??= this.copySpecAliases(state.loopAliases);
    const ghost = `ps2_${this.identifier(name)}_loop_values_${this.tempCounter++}`;
    const lengthInvariant = `0 <= ${length}`;
    const ownershipInvariant = this.arrayOwnershipAssertion(type, name, length, `?${ghost}`);
    state.heapInvariants.push(lengthInvariant, ownershipInvariant);
    if (hasMallocBlock) {
      state.heapInvariants.push(`malloc_block_${this.veriFastAllocationKind(type)}(${name}, ${length})`);
    }
    state.loopAliases.arrays.set(name, ghost);
    state.ownedArrays?.push({
      declaration, name, length, type, hasMallocBlock, lengthInvariant, ownershipInvariant
    });
  }

  /**
   * Verschiebt den Inhaltsbesitz eines lokalen Arrays in ein Struct-Arrayfeld.
   * Der separate Allokationsblock bleibt bis zum Scope-Ende erhalten, waehrend
   * Schleifen den Inhalt fortan ueber das Structfeld tragen.
   */
  private transferArrayContentToField(value: Expr, state: EmitState): void {
    const expression = this.unwrap(value);
    if (!isVarRef(expression) || expression.index || !expression.ref?.ref) return;
    const root = this.arrayAliasRoot(expression.ref.ref);
    const owned = state.ownedArrays?.find(array => this.arrayAliasRoot(array.declaration) === root);
    if (!owned || owned.contentTransferred) return;
    owned.contentTransferred = true;
    state.heapInvariants = (state.heapInvariants ?? []).filter(clause =>
      clause !== owned.lengthInvariant && clause !== owned.ownershipInvariant
    );
    state.loopAliases?.arrays.delete(owned.name);
  }

  /** Nimmt den Feld- und Blockbesitz eines lokalen Structs in spaetere Schleifen auf. */
  private registerLocalStructOwnership(
    declaration: VarDecl,
    name: string,
    struct: StructDeclaration,
    state: EmitState
  ): void {
    state.heapInvariants ??= [];
    state.loopAliases ??= this.emptySpecAliases();
    state.specAliases ??= this.copySpecAliases(state.loopAliases);
    for (const field of (struct.children ?? []).filter(isStructAttDeclaration)) {
      const access = `${name}->${this.name(field)}`;
      const ghost = `ps2_${this.identifier(name)}_${this.name(field)}_loop_${this.tempCounter++}`;
      const definedGhost = `${ghost}_defined`;
      state.heapInvariants.push(
        `${name}->${this.fieldDefinedName(field)} |-> ?${definedGhost}`,
        `${access} |-> ?${ghost}`
      );
      state.loopAliases.fields.set(access, ghost);
      state.loopAliases.definedFields.set(access, definedGhost);
      const fieldType = this.variableTypes.get(field)!;
      if (fieldType.depth > 0) {
        const lengthGhost = `${ghost}_length`;
        const valuesGhost = `${ghost}_values`;
        state.heapInvariants.push(
          `${name}->${this.arrayFieldLength(field)} |-> ?${lengthGhost}`,
          `0 <= ${lengthGhost}`,
          this.arrayOwnershipAssertion(fieldType, ghost, lengthGhost, `?${valuesGhost}`)
        );
        state.loopAliases.arrays.set(access, valuesGhost);
        state.loopAliases.arrayLengths.set(access, lengthGhost);
      }
    }
    state.heapInvariants.push(`malloc_block_${this.structName(struct)}(${name})`);
    state.ownedStructs?.push({ declaration, name, struct });
  }

  /** Gibt Arraybesitz am Scope-Ende wie bei einer Garbage-Collection fuer den Beweis frei. */
  private cleanupOwnedArrays(state: EmitState, indent: string, transferred?: Expr): string[] {
    const transferredExpression = transferred ? this.unwrap(transferred) : undefined;
    const transferredRoot = transferredExpression && isVarRef(transferredExpression) && !transferredExpression.index && transferredExpression.ref?.ref
      ? this.arrayAliasRoot(transferredExpression.ref.ref)
      : undefined;
    const transferredStruct = transferredExpression && isVarRef(transferredExpression) && !transferredExpression.index && transferredExpression.ref?.ref
      ? this.structAliasRoot(transferredExpression.ref.ref)
      : undefined;
    const transferredFields = transferredStruct ? this.transferredStructArrayRoots(transferredStruct) : new Set<Variable>();
    return (state.ownedArrays ?? []).flatMap(array => {
      if (array.contentTransferred) {
        return array.hasMallocBlock
          ? [`${indent}//@ leak malloc_block_${this.veriFastAllocationKind(array.type)}(${array.name}, ${array.length});`]
          : [];
      }
      if (transferredRoot && this.arrayAliasRoot(array.declaration) === transferredRoot) return [];
      if (transferredFields.has(this.arrayAliasRoot(array.declaration))) {
        return array.hasMallocBlock
          ? [`${indent}//@ leak malloc_block_${this.veriFastAllocationKind(array.type)}(${array.name}, ${array.length});`]
          : [];
      }
      const chunks = [
        this.arrayOwnershipAssertion(array.type, array.name, array.length, '_'),
        ...(array.hasMallocBlock
          ? [`malloc_block_${this.veriFastAllocationKind(array.type)}(${array.name}, ${array.length})`]
          : [])
      ];
      return [`${indent}//@ leak ${chunks.join(' &*& ')};`];
    });
  }

  /** Gibt lokalen Structbesitz frei, sofern er nicht ueber den Rueckgabewert transferiert wird. */
  private cleanupOwnedStructs(state: EmitState, indent: string, transferred?: Expr): string[] {
    const expression = transferred ? this.unwrap(transferred) : undefined;
    const expressionType = expression ? this.typeOfExpr(expression) : undefined;
    const transferredRoot = expression && expressionType && this.structForType(expressionType) &&
      isVarRef(expression) && !expression.index && expression.ref?.ref
      ? this.structAliasRoot(expression.ref.ref)
      : undefined;
    const transferredArrayStructs = expression ? this.transferredArrayStructRoots(expression, state) : new Set<Variable>();
    return (state.ownedStructs ?? []).flatMap(item => {
      if (transferredRoot && this.structAliasRoot(item.declaration) === transferredRoot) return [];
      if (transferredArrayStructs.has(this.structAliasRoot(item.declaration))) {
        const chunks = (item.struct.children ?? []).filter(isStructAttDeclaration).map(field =>
          `${item.name}->${this.fieldDefinedName(field)} |-> _`
        );
        chunks.push(`malloc_block_${this.structName(item.struct)}(${item.name})`);
        return [`${indent}//@ leak ${chunks.join(' &*& ')};`];
      }
      const chunks = (item.struct.children ?? []).filter(isStructAttDeclaration).flatMap(field => {
        const access = `${item.name}->${this.name(field)}`;
        const fieldType = this.variableTypes.get(field)!;
        return [
          `${item.name}->${this.fieldDefinedName(field)} |-> _`,
          `${access} |-> ?ps2_discard_${this.tempCounter++}`,
          ...(fieldType.depth > 0 ? [
            `${item.name}->${this.arrayFieldLength(field)} |-> ?ps2_discard_length_${this.tempCounter++}`
          ] : [])
        ];
      });
      chunks.push(`malloc_block_${this.structName(item.struct)}(${item.name})`);
      return [`${indent}//@ leak ${chunks.join(' &*& ')};`];
    });
  }

  /**
   * Ermittelt lokale Structobjekte, deren Zeiger als Elemente eines zurueckgegebenen
   * Arrays weitergegeben werden. Die sichtbaren Feld-Chunks bleiben fuer den
   * Funktionsvertrag erhalten; nur interne Defined-Flags und der Allokationsblock
   * werden beim Transfer aus dem lokalen Ownership-Zustand geloest.
   */
  private transferredArrayStructRoots(value: Expr, state: EmitState): Set<Variable> {
    const owner = this.arrayAllocationOwner(value);
    if (!owner) return new Set();
    return new Set(state.arrayStructElements?.get(this.arrayAliasRoot(owner))?.values() ?? []);
  }

  /** Merkt einen benannten Structzeiger, der in ein lokales Array uebertragen wird. */
  private registerArrayStructElement(
    array: Variable,
    candidate: Expr | undefined,
    state: EmitState,
    staticSize?: number,
    index?: string
  ): void {
    if (!candidate) return;
    const expression = this.unwrap(candidate);
    if (!isVarRef(expression) || expression.index || !expression.ref?.ref) return;
    const candidateType = this.variableTypes.get(expression.ref.ref);
    if (!candidateType || !this.structForType(candidateType)) return;
    state.arrayStructElements ??= new Map();
    const arrayRoot = this.arrayAliasRoot(array);
    const elements = state.arrayStructElements.get(arrayRoot) ?? new Map<string, Variable>();
    const structRoot = this.structAliasRoot(expression.ref.ref);
    if (index) {
      elements.set(index, structRoot);
    } else if (staticSize !== undefined) {
      for (let position = 1; position <= staticSize; position++) elements.set(String(position), structRoot);
    } else {
      elements.set('*', structRoot);
    }
    state.arrayStructElements.set(arrayRoot, elements);
  }

  /** Erfasst dieselbe Ownership-Beziehung bei einer spaeteren Arrayelementzuweisung. */
  private registerArrayStructElementAssignment(assignment: Assignment, state: EmitState): void {
    const target = this.unwrap(assignment.sel);
    if (!isVarRef(target) || !target.index || !target.ref?.ref) return;
    const index = this.unwrap(target.index);
    this.registerArrayStructElement(
      target.ref.ref,
      assignment.value,
      state,
      undefined,
      isIntLiteral(index) ? String(index.value) : '*'
    );
  }

  /** Fuehrt die beweisseitige Garbage-Collection fuer Arrays und Structs gemeinsam aus. */
  private cleanupOwnedHeap(state: EmitState, indent: string, transferred?: Expr): string[] {
    return [
      ...this.cleanupOwnedArrays(state, indent, transferred),
      ...this.cleanupOwnedStructs(state, indent, transferred)
    ];
  }

  /** Erkennt, ob der aktuelle Scope eigenen Heapbesitz traegt. */
  private hasOwnedHeap(state: EmitState): boolean {
    return (state.ownedArrays?.length ?? 0) > 0 || (state.ownedStructs?.length ?? 0) > 0;
  }

  /** Verfolgt reine Struct-Zeigeraliase zu ihrer urspruenglichen Deklaration. */
  private structAliasRoot(variable: Variable, seen = new Set<Variable>()): Variable {
    if (seen.has(variable)) return variable;
    seen.add(variable);
    if (isVarDecl(variable) && variable.initializer) {
      const initializer = this.unwrap(variable.initializer);
      const variableType = this.variableTypes.get(variable);
      const initializerType = isVarRef(initializer) && initializer.ref?.ref
        ? this.variableTypes.get(initializer.ref.ref)
        : undefined;
      if (isVarRef(initializer) && !initializer.index && initializer.ref?.ref && variableType && initializerType &&
          this.structForType(variableType) && this.structForType(initializerType)) {
        return this.structAliasRoot(initializer.ref.ref, seen);
      }
    }
    return variable;
  }

  /** Bestimmt fuer jedes Arrayfeld eines transferierten Structs die zuletzt zugewiesene Arraywurzel. */
  private transferredStructArrayRoots(structRoot: Variable): Set<Variable> {
    const latest = new Map<Variable, Variable>();
    for (const assignment of [...AstUtils.streamAllContents(this.program)].filter(isAssignment)) {
      const target = this.unwrap(assignment.sel);
      if (!isAttSelection(target) || target.attref.index || !target.attref.ref?.ref) continue;
      const receiver = this.unwrap(target.receiver);
      if (!isVarRef(receiver) || receiver.index || !receiver.ref?.ref ||
          this.structAliasRoot(receiver.ref.ref) !== structRoot) continue;
      const value = this.unwrap(assignment.value);
      if (isVarRef(value) && !value.index && value.ref?.ref && this.variableTypes.get(value.ref.ref)?.depth) {
        latest.set(target.attref.ref.ref, this.arrayAliasRoot(value.ref.ref));
      } else {
        latest.delete(target.attref.ref.ref);
      }
    }
    return new Set(latest.values());
  }

  /** Verpackt einen Arrayzeiger samt Laenge oder uebernimmt einen schon vorhandenen Deskriptor. */
  private arrayDescriptorValue(value: Expr, type: CType, state: EmitState): string {
    const descriptor = this.arrayDescriptorExpression(value, type, state);
    if (descriptor) return descriptor;
    const runtime = this.arrayRuntimeType(type);
    return `${runtime.referenceFunction}(${this.arrayData(value, state)}, ${this.lengthOf(value, state)})`;
  }

  /**
   * Zerlegt einen vollstaendig bis zum Skalar indizierten verschachtelten Arrayzugriff.
   * Der Wurzeldeskriptor wird genau einmal an den typisierten Getter oder Setter
   * uebergeben; dadurch bleiben auch Funktionsrueckgaben als Arraywurzel wohldefiniert.
   */
  private nestedArrayAccess(value: Expr, state: EmitState): NestedArrayAccess | undefined {
    let root = this.unwrap(value);
    const indices: Expr[] = [];
    while (isIndexSelection(root)) {
      indices.unshift(root.index);
      root = this.unwrap(root.receiver);
    }

    let type: CType | undefined;
    let descriptor: string | undefined;
    if (isVarRef(root) && root.index && root.ref?.ref) {
      indices.unshift(root.index);
      type = this.variableTypes.get(root.ref.ref);
      if (type?.depth) descriptor = this.variableArrayDescriptor(root.ref.ref, type, state);
    } else if (isAttSelection(root) && root.attref.index && root.attref.ref?.ref) {
      indices.unshift(root.attref.index);
      type = this.variableTypes.get(root.attref.ref.ref);
      if (type?.depth) {
        const receiver = this.expr(root.receiver, state);
        const field = root.attref.ref.ref;
        descriptor = `${this.arrayRuntimeType(type).referenceFunction}(${receiver}->${this.name(field)}, ${receiver}->${this.arrayFieldLength(field)})`;
      }
    } else if (indices.length > 0) {
      type = this.typeOfExpr(root);
      if (type?.depth) descriptor = this.arrayDescriptorValue(root, type, state);
    }

    if (!type || type.depth <= 1 || indices.length !== type.depth || !descriptor) return undefined;
    return { type, descriptor, indices };
  }

  /** Verpackt eine benannte Arrayvariable ohne einen kuenstlichen AST-Knoten als Deskriptor. */
  private variableArrayDescriptor(variable: Variable, type: CType, state: EmitState): string {
    const runtime = this.arrayRuntimeType(type);
    const name = this.name(variable);
    if (isParameterDecl(variable) && variable.isArray) return name;
    if (isStructAttDeclaration(variable)) {
      if (!state.thisName) throw new DirectCGenerationError('Implizites Arrayfeld ausserhalb einer Methode.', variable);
      return `${runtime.referenceFunction}(${state.thisName}->${name}, ${state.thisName}->${this.arrayFieldLength(variable)})`;
    }
    return `${runtime.referenceFunction}(${name}, ${this.lengthOfVariable(variable, variable)})`;
  }

  /** Liefert den Datenzeiger eines logischen Arrays unabhaengig von seiner C-Darstellung. */
  private arrayData(value: Expr, state: EmitState): string {
    const type = this.typeOfExpr(value);
    if (!type?.depth) throw new DirectCGenerationError('Datenzeiger eines Nicht-Arrays angefordert.', value);
    const descriptor = this.arrayDescriptorExpression(value, type, state);
    return descriptor ? `(${descriptor}).data` : this.expr(value, state);
  }

  /** Liefert die bereits gebundene Laenge eines Arrayarguments oder meldet fehlende Metadaten. */
  private lengthOf(expr: Expr, state: EmitState = {}): string {
    const value = this.unwrap(expr);
    if (isArrayLiteral(value)) return String(value.elems.length);
    if (isResultExpr(value) && state.returnType?.depth) return 'result.length';
    if (isVarRef(value) && !value.index && value.ref?.ref) {
      if (isStructAttDeclaration(value.ref.ref)) {
        if (!state.thisName) throw new DirectCGenerationError('Implizites Arrayfeld ausserhalb einer Methode.', value);
        return `${state.thisName}->${this.arrayFieldLength(value.ref.ref)}`;
      }
      if (isParameterDecl(value.ref.ref) && value.ref.ref.isArray) return `${this.name(value.ref.ref)}.length`;
      const length = this.arrayLengths.get(value.ref.ref);
      if (length) return length;
      const decl = value.ref.ref;
      if (isVarDecl(decl) && decl.isArrayVariable && decl.size && isIntLiteral(decl.size)) return String(decl.size.value);
    }
    if (isAttSelection(value) && !value.attref.index && value.attref.ref?.ref) {
      return `${this.expr(value.receiver, state)}->${this.arrayFieldLength(value.attref.ref.ref)}`;
    }
    const type = this.typeOfExpr(value);
    const descriptor = type?.depth ? this.arrayDescriptorExpression(value, type, state) : undefined;
    if (descriptor) return `(${descriptor}).length`;
    throw new DirectCGenerationError('Arraylaenge dieses Ausdrucks ohne Runtime nicht bestimmbar.', expr);
  }

  /** Ermittelt die bekannte logische Laenge eines direkt indizierten Arrays. */
  private lengthOfVariable(decl: Variable, node: AstNode): string {
    const length = this.arrayLengths.get(decl);
    if (!length) throw new DirectCGenerationError('Arraylaenge fuer sicheren Indexzugriff nicht bekannt.', node);
    return length;
  }

  /** Wandelt einen einsbasierten Pseudo2-Index mit Laufzeitpruefung in C um. */
  private checkedIndex(index: Expr, length: string, state: EmitState): string {
    return `ps2_checked_index(${this.expr(index, state)}, ${length})`;
  }

  /** Entfernt reine Ausdrucks-Prioritaetshuelle ohne Operator, damit Metadaten sichtbar bleiben. */
  private unwrap(expr: Expr): Expr {
    let value = expr;
    while (true) {
      if (isGrouping(value)) { value = value.value; continue; }
      if ((isOr(value) || isAnd(value) || isEquality(value) || isComparison(value) ||
           isAddition(value) || isMultiplication(value) || isExponentiation(value)) && value.right.length === 0) {
        value = value.left;
        continue;
      }
      return value;
    }
  }

  /** Schreibt eine direkte linke Seite fuer skalare, Feld- und Arrayzuweisungen. */
  private emitTarget(target: Expr, state: EmitState): string {
    if (isVarRef(target) || isAttSelection(target) || isIndexSelection(target)) return this.expr(target, state);
    throw new DirectCGenerationError('Zuweisungsziel nicht als C-Lvalue darstellbar.', target);
  }

  /** Formatiert einen C-Typ mit Array-Pointertiefe. */
  private typeName(type: CType): string {
    if (type.depth === 0) return type.base;
    return `${this.arrayElementTypeName(type)} *`;
  }

  /** Liefert den realen C-Elementtyp; innere Arrays tragen ihren Deskriptor als Wert. */
  private arrayElementTypeName(type: CType): string {
    if (type.depth <= 0) throw new DirectCGenerationError('Skalartyp besitzt keinen Arrayelementtyp.');
    return type.depth === 1
      ? type.base
      : `${this.arrayRuntimeType({ ...type, depth: type.depth - 1 }).resultType} *`;
  }

  /** Registriert rekursiv einen typisierten Arraydeskriptor und seine Helfernamen. */
  private ensureArrayRuntimeType(type: CType): DirectArrayInfo {
    if (type.depth <= 0) throw new DirectCGenerationError('Fuer einen Skalar wird kein Arraydeskriptor erzeugt.');
    const key = `${type.base}|${type.depth}`;
    const known = this.arrayRuntimeTypes.get(key);
    if (known) return known;
    const lower = type.depth === 1
      ? undefined
      : this.ensureArrayRuntimeType({ ...type, depth: type.depth - 1 }).runtimeType;
    const elementType = lower ? `${lower.resultType} *` : type.base;
    const suffix = `${this.identifier(type.base.replace(/\s+/g, '_'))}_${type.depth}`;
    const info: DirectArrayInfo = {
      logicalType: { ...type },
      runtimeType: {
        resultType: `Ps2DirectArray_${suffix}`,
        elementType,
        depth: type.depth,
        scalarType: type.base,
        copyFunction: `ps2_copy_array_${suffix}`,
        referenceFunction: `ps2_array_ref_${suffix}`,
        ownershipPredicate: type.depth > 1 ? `ps2_array_ownership_${suffix}` : undefined,
        ownershipValueType: lower ? this.arrayGhostListType({ ...type, depth: type.depth - 1 }) : undefined,
        childOwnershipPredicate: lower?.ownershipPredicate,
        childDescriptorType: lower?.resultType,
        getFunction: type.depth > 1 ? `ps2_array_get_${suffix}` : undefined,
        setFunction: type.depth > 1 ? `ps2_array_set_${suffix}` : undefined,
        childGetFunction: lower?.getFunction,
        childSetFunction: lower?.setFunction
      }
    };
    this.arrayRuntimeTypes.set(key, info);
    return info;
  }

  /** Liefert den bereits registrierten oder bei Bedarf neu angelegten Arraydeskriptor. */
  private arrayRuntimeType(type: CType): DirectCArrayRuntimeType {
    return this.ensureArrayRuntimeType(type).runtimeType;
  }

  /** Formatiert den passenden nativen oder deskriptorbasierten Arraybesitz. */
  private arrayOwnershipAssertion(type: CType, data: string, length: string, values: string): string {
    const predicate = this.arrayRuntimeType(type).ownershipPredicate;
    return predicate
      ? `${predicate}(${data}, ${length}, ${values})`
      : `${data}[0..${length}] |-> ${values}`;
  }

  /** Formatiert den rekursiven reinen VeriFast-Listentyp eines logischen Arrays. */
  private arrayGhostListType(type: CType): string {
    if (type.depth <= 0) throw new DirectCGenerationError('Ein Skalar besitzt keinen Array-Ghostlistentyp.');
    const element = type.depth === 1
      ? type.base
      : this.arrayGhostListType({ ...type, depth: type.depth - 1 });
    return `list<${element}${element.endsWith('>') ? ' ' : ''}>`;
  }

  /** Liefert den von VeriFast fuer den elementtypisierten malloc-Block verwendeten Praedikatsnamen. */
  private veriFastAllocationKind(arrayType: CType): string {
    const element = { ...arrayType, depth: Math.max(0, arrayType.depth - 1) };
    if (element.depth > 0 || element.base.includes('*')) return 'pointers';
    if (element.base === 'bool') return 'bools';
    if (element.base === 'int') return 'ints';
    if (element.base === 'double') return 'doubles';
    return 'chars';
  }

  /** Liefert den sicheren C-Namen einer Variable oder eines Structfeldes. */
  private name(variable: Variable): string {
    return this.variableNames.get(variable) ?? this.identifier(variable.name);
  }

  /** Liefert den kollisionsfreien Laengenfeldnamen eines Arrayattributs. */
  private arrayFieldLength(field: Variable): string {
    const name = this.arrayFieldLengths.get(field);
    if (!name) throw new DirectCGenerationError(`Arraylaenge fuer Feld '${field.name}' nicht vorbereitet.`, field);
    return name;
  }

  /** Liefert das zu einem Structfeld gehoerende `undefined`-Statusfeld. */
  private fieldDefinedName(field: Variable): string {
    const name = this.fieldDefinedNames.get(field);
    if (!name) throw new DirectCGenerationError(`Initialisierungsstatus fuer Feld '${field.name}' nicht vorbereitet.`, field);
    return name;
  }

  /** Liefert den eindeutigen C-Namen einer Funktion. */
  private functionName(fn: FunctionDeclaration): string {
    return this.functionNames.get(fn)!;
  }

  /** Liefert den eindeutigen C-Struct-Tag. */
  private structName(struct: StructDeclaration): string {
    return this.structNames.get(struct)!;
  }

  /** Liefert den eindeutigen Namen des typisierten Struct-Konstruktors. */
  private structAllocatorName(struct: StructDeclaration): string {
    return `ps2_new_${this.structName(struct)}`;
  }

  /** Findet den C-Struct-Tag zu einem typisierten Pseudo2-Namen. */
  private structNameBySource(name: string): string {
    for (const [decl, mapped] of this.structNames) if (decl.name === name) return mapped;
    return this.identifier(name);
  }

  /** Vermeidet C-Schluesselwoerter und ungueltige Zeichen. */
  private identifier(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
    return C_KEYWORDS.has(cleaned) || !/^[A-Za-z_]/.test(cleaned) ? `ps2_${cleaned}` : cleaned;
  }

  /** Reserviert einen kollisionsfreien globalen Zielnamen. */
  private uniqueGlobal(name: string): string {
    const base = this.identifier(name);
    let result = base;
    for (let n = 1; this.usedGlobalNames.has(result); n++) result = `${base}_${n}`;
    this.usedGlobalNames.add(result);
    return result;
  }

  /** Reserviert einen lokalen Namen fuer Laengen und Schleifengrenzen. */
  private temp(prefix: string): string {
    return `ps2_${prefix}_${this.tempCounter++}`;
  }

  /** Initialisiert skalare C-Variablen ohne Pseudo2-Wrapper. */
  private zeroValue(type: CType): string {
    return type.depth > 0 || type.base.includes('*') ? 'NULL' : type.base === 'bool' ? 'false' : '0';
  }
}
