// packages/language/src/pseudo2-validator.ts

import { AstUtils } from 'langium';
import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type {
  Pseudo2AstType,
  BracedBlock,
  IndentedBlock,
  IfStatement,
  WhileLoop,
  ForLoop,
  DoWhileLoop,
  FunctionDeclaration,
  FunctionCall,
  ReturnStmt,
  VarDecl,
  Assignment,
  StructDeclaration,
  StructAttDeclaration,
  StructType,
  NewExpr,
  VarRef,
  AttRef,
  MethRef,
  AttSelection,
  MethSelection,
  ThisExpr,
  Variable,
  Program,
  Expr,
  ArrayLiteral,
  Instruction,
  ParameterDecl,
  PrintCommand,
  ThrowCommand,
  CallCommand,
  Addition,
  Equality,
  Comparison,
  Multiplication,
  Exponentiation,
  And,
  Or,
  Not,
  Neg
} from './generated/ast.js';
import type { Pseudo2Services } from './pseudo2-module.js';

import {
  isFunctionDeclaration,
  isStructDeclaration,
  isStructAttDeclaration,
  isVarRef,
  isAttSelection,
  isVarDecl,
  isParameterDecl,
  isReturnStmt,
  isBracedBlock,
  isIndentedBlock,
  isIfStatement,
  isWhileLoop,
  isForLoop,
  isDoWhileLoop,
  isFunctionCall,
  isMethSelection,
  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isGrouping,
  isExponentiation,
  isNot//,
  //isNeg
} from './generated/ast.js';

import { Pseudo2TypeComputer } from './typing/pseudo2-type-computer.js';
import { TYPE_NUM, TYPE_BOOL, TYPE_STRING, TYPE_ARRAY_UNKNOWN, TYPE_UNKNOWN } from './typing/pseudo2-type.js';

export function registerValidationChecks(services: Pseudo2Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.Pseudo2Validator;

  const checks: ValidationChecks<Pseudo2AstType> = {
    BracedBlock: validator.checkBracedBlock,
    IndentedBlock: validator.checkIndentedBlock,

    IfStatement: validator.checkIfStatement,
    WhileLoop: validator.checkWhileLoop,
    ForLoop: validator.checkForLoop,
    DoWhileLoop: validator.checkDoWhileLoop,

    FunctionDeclaration: validator.checkFunctionDeclaration,
    FunctionCall: validator.checkFunctionCall,
    ReturnStmt: validator.checkReturnStmt,

    VarDecl: validator.checkVarDecl,
    Assignment: validator.checkAssignment,

    StructDeclaration: validator.checkStructDeclaration,
    StructAttDeclaration: validator.checkStructAttDeclaration,
    StructType: validator.checkStructType,
    NewExpr: validator.checkNewExpr,

    Variable: validator.checkVariable,
    VarRef: validator.checkVarRef,
    AttRef: validator.checkAttRef,
    MethRef: validator.checkMethRef,
    AttSelection: validator.checkAttSelection,
    MethSelection: validator.checkMethSelection,
    ThisExpr: validator.checkThisExpr,

    ArrayLiteral: validator.checkArrayLiteral,

    PrintCommand: validator.checkPrintCommand,
    ThrowCommand: validator.checkThrowCommand,
    CallCommand: validator.checkCallCommand,
    
    Equality: validator.checkEquality,
    Comparison: validator.checkComparison,
    Addition: validator.checkAddition,
    Multiplication: validator.checkMultiplication,
    Exponentiation: validator.checkExponentiation,
    And: validator.checkAnd,
    Or: validator.checkOr,
    Not: validator.checkNot,
    Neg: validator.checkNeg,
  };

  registry.register(checks, validator);
}

export class Pseudo2Validator {
  private readonly types = new Pseudo2TypeComputer();

  checkBracedBlock(node: BracedBlock, accept: ValidationAcceptor): void {
    this.checkNoInstructionsAfterReturn(node.instructions ?? [], accept);
  }

  checkIndentedBlock(node: IndentedBlock, accept: ValidationAcceptor): void {
    this.checkNoInstructionsAfterReturn(node.instructions ?? [], accept);
  }

  checkIfStatement(node: IfStatement, accept: ValidationAcceptor): void {
    const conditionType = this.types.typeFor(node.condition);
    if (!conditionType.isSameAs(TYPE_BOOL) && !conditionType.isUnknown()) {
      accept('error', `if-Bedingung muss vom Typ bool sein, ist aber '${conditionType.asString()}'.`, {
        node,
        property: 'condition'
      });
    }
  }

  checkWhileLoop(node: WhileLoop, accept: ValidationAcceptor): void {
    const conditionType = this.types.typeFor(node.condition);
    if (!conditionType.isSameAs(TYPE_BOOL) && !conditionType.isUnknown()) {
      accept('error', `while-Bedingung muss vom Typ bool sein, ist aber '${conditionType.asString()}'.`, {
        node,
        property: 'condition'
      });
    }
  }

  checkForLoop(node: ForLoop, accept: ValidationAcceptor): void {
    if (!node.iterator) {
      accept('warning', 'For-Schleife ohne Iterator.', { node });
    }

    const fromType = this.types.typeFor(node.from);
    if (!fromType.isSameAs(TYPE_NUM) && !fromType.isUnknown()) {
      accept('error', `for-Startwert muss vom Typ num sein, ist aber '${fromType.asString()}'.`, {
        node,
        property: 'from'
      });
    }

    const toType = this.types.typeFor(node.to);
    if (!toType.isSameAs(TYPE_NUM) && !toType.isUnknown()) {
      accept('error', `for-Endwert muss vom Typ num sein, ist aber '${toType.asString()}'.`, {
        node,
        property: 'to'
      });
    }

    if (node.step) {
      const stepType = this.types.typeFor(node.step);
      if (!stepType.isSameAs(TYPE_NUM) && !stepType.isUnknown()) {
        accept('error', `for-Schrittweite muss vom Typ num sein, ist aber '${stepType.asString()}'.`, {
          node,
          property: 'step'
        });
      }
    }
  }

  checkDoWhileLoop(node: DoWhileLoop, accept: ValidationAcceptor): void {
    const conditionType = this.types.typeFor(node.condition);
    if (!conditionType.isSameAs(TYPE_BOOL) && !conditionType.isUnknown()) {
      accept('error', `do-while-Bedingung muss vom Typ bool sein, ist aber '${conditionType.asString()}'.`, {
        node,
        property: 'condition'
      });
    }
  }

  checkFunctionDeclaration(node: FunctionDeclaration, accept: ValidationAcceptor): void {
    const seen = new Set<string>();

    // 1. Parameter prüfen
    for (const p of node.params ?? []) {
      if (seen.has(p.name)) {
        accept('error', `Doppelter Parametername '${p.name}'.`, {
          node: p,
          property: 'name'
        });
      } else {
        seen.add(p.name);
      }

      if (p.isArray) {
        if (p.start !== undefined && p.start < 0) {
          accept('error', `Array-Parameter '${p.name}' darf keinen negativen Startindex haben.`, {
            node: p,
            property: 'start'
          });
        }

        if (!p.len) {
          accept('error', `Array-Parameter '${p.name}' benötigt einen Längenparameter.`, {
            node: p,
            property: 'name'
          });
        } else if (seen.has(p.len.name)) {
          accept('error', `Doppelter Parametername '${p.len.name}'.`, {
            node: p.len,
            property: 'name'
          });
        } else {
          seen.add(p.len.name);
        }
      }
    }

    // 2. Doppelte globale Funktionen prüfen
    const parentStruct = AstUtils.getContainerOfType(node.$container, isStructDeclaration);
    if (!parentStruct) {
      const program = this.getProgram(node);
      if (program) {
        const functions = program.instructions.filter(isFunctionDeclaration);
        const index = functions.indexOf(node);
        const previousWithSameName = functions.slice(0, index).find(f => f.name === node.name);

        if (previousWithSameName) {
          accept('error', `Doppelte globale Funktion '${node.name}'.`, {
            node,
            property: 'name'
          });
        }
      }
    }

    // 3. return mit und ohne Wert nicht mischen
    const allReturns = this.allReturns(node);
    const returnsWithValue = allReturns.filter(r => r.retExpr);
    const returnsWithoutValue = allReturns.filter(r => !r.retExpr);

    if (returnsWithValue.length > 0 && returnsWithoutValue.length > 0) {
      for (const r of allReturns) {
        accept('error', `Funktion '${node.name}' mischt return mit und ohne Wert.`, {
          node: r
        });
      }
    }

    // 4. Rückgabetypen prüfen
    if (returnsWithValue.length <= 1) {
      return;
    }

    const firstType = this.types.typeFor(returnsWithValue[0].retExpr);
    for (let i = 1; i < returnsWithValue.length; i++) {
      const currentType = this.types.typeFor(returnsWithValue[i].retExpr);

      if (
        !currentType.isSameAsIgnoringUnknown(firstType) &&
        !firstType.isUnknown() &&
        !currentType.isUnknown()
      ) {
        accept(
          'error',
          `Inkonsistente Rückgabetypen in Funktion '${node.name}': '${firstType.asString()}' und '${currentType.asString()}'.`,
          {
            node: returnsWithValue[i],
            property: 'retExpr'
          }
        );
      }
    }
  }

  private allReturns(fn: FunctionDeclaration): ReturnStmt[] {
    const out: ReturnStmt[] = [];
    for (const n of AstUtils.streamAllContents(fn)) {
      if (isReturnStmt(n)) {
        out.push(n);
      }
    }
    return out;
  }
  
  checkFunctionCall(node: FunctionCall, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Funktion.', { node, property: 'f' });
      return;
    }

    const target = node.f?.ref;
    if (!target) return;

    if (!this.isStatementFunctionCall(node) && !this.hasReturnValue(target)) {
      accept('error', `Funktion '${target.name}' gibt keinen Wert zurück und kann nicht als Ausdruck verwendet werden.`, {
        node,
        property: 'f'
      });
    }

    const expected = target.params?.length ?? 0;
    const actual = node.params?.length ?? 0;

    if (actual < expected) {
      accept('error', `Zu wenige Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params'
      });
      return;
    } else if (actual > expected) {
      accept('error', `Zu viele Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params'
      });
      return;
    }

    this.checkArgumentTypes(node, target, node.params ?? [], accept);
  }

  private hasReturnValue(fn: FunctionDeclaration): boolean {
    return this.allReturns(fn).some(r => r.retExpr);
  }

  private isStatementFunctionCall(node: FunctionCall): boolean {
    const container: any = node.$container;

    return (
      container?.$type === 'Program' ||
      isBracedBlock(container) ||
      isIndentedBlock(container)
    );
  }

  checkReturnStmt(node: ReturnStmt, accept: ValidationAcceptor): void {
    const fn = AstUtils.getContainerOfType(node, isFunctionDeclaration);
    if (!fn) {
      accept('error', 'return darf nur innerhalb einer Funktion verwendet werden.', { node });
    }
  }

  checkVarDecl(node: VarDecl, accept: ValidationAcceptor): void {
    const siblings = this.getSiblingVarDecls(node);
    const index = siblings.indexOf(node);
    const previousSame = siblings.slice(0, index).find(v => v.name === node.name);

    if (previousSame) {
      accept('error', `Doppelte lokale Variable '${node.name}' im selben Block.`, {
        node,
        property: 'name'
      });
      return;
    }

    const outer = this.findOuterVisibleName(node, node.name);
    if (outer) {
      accept('warning', `Variable '${node.name}' überschattet eine äußere Deklaration.`, {
        node,
        property: 'name'
      });
    }
  }

  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    const leftExpr = node.sel as Expr;
    const validLValue = isVarRef(leftExpr) || isAttSelection(leftExpr);

    if (!validLValue) {
      accept('error', 'Linke Seite einer Zuweisung muss eine Variable oder ein Attributzugriff sein.', {
        node,
        property: 'sel'
      });
      return;
    }

    const leftType = this.types.typeFor(leftExpr);
    const rightType = this.types.typeFor(node.value);

    if (!this.isAssignable(rightType, leftType)) {
      accept(
        'error',
        `Typfehler bei Zuweisung: '${rightType.asString()}' ist nicht zuweisbar zu '${leftType.asString()}'.`,
        { node, property: 'value' }
      );
    }
  }

  checkStructDeclaration(node: StructDeclaration, accept: ValidationAcceptor): void {
    const program = this.getProgram(node);
    if (program) {
      const structs = program.instructions.filter(isStructDeclaration);
      const index = structs.indexOf(node);
      const previousWithSameName = structs.slice(0, index).find(s => s.name === node.name);

      if (previousWithSameName) {
        accept('error', `Doppelte Struct-Deklaration '${node.name}'.`, {
          node,
          property: 'name'
        });
      }
    }

    const seenAttrs = new Set<string>();
    const seenMethods = new Set<string>();

    for (const child of node.children ?? []) {
      if (isStructAttDeclaration(child)) {
        if (seenAttrs.has(child.name)) {
          accept('error', `Doppeltes Attribut '${child.name}' in Struct '${node.name}'.`, {
            node: child,
            property: 'name'
          });
        } else {
          seenAttrs.add(child.name);
        }
      } else if (isFunctionDeclaration(child)) {
        if (seenMethods.has(child.name)) {
          accept('error', `Doppelte Methode '${child.name}' in Struct '${node.name}'.`, {
            node: child,
            property: 'name'
          });
        } else {
          seenMethods.add(child.name);
        }
      }
    }
  }

  checkStructAttDeclaration(node: StructAttDeclaration, accept: ValidationAcceptor): void {}

  checkStructType(node: StructType, accept: ValidationAcceptor): void {
    if (node.struct && !node.struct.ref) {
      accept('error', 'Unbekannter Struct-Typ.', { node, property: 'struct' });
    }
  }

  checkNewExpr(node: NewExpr, accept: ValidationAcceptor): void {
    if (node.type && !node.type.ref) {
      accept('error', 'Unbekannter Struct-Typ in new.', { node, property: 'type' });
    }
  }

  checkVariable(node: Variable, accept: ValidationAcceptor): void {}

  checkVarRef(node: VarRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekannte Variable.', { node, property: 'ref' });
      return;
    }

    if (node.index) {
      const target = node.ref?.ref;
      if (!target) return;

      let isArrayTarget = false;

      if (isParameterDecl(target)) {
        isArrayTarget = target.isArray === true;
      } else if (isStructAttDeclaration(target)) {
        const t = this.types.typeForTypeRef(target.type);
        isArrayTarget = t.isArrayType();
      } else if (isVarDecl(target)) {
        if ((target as any).isArrayVariable === true) {
          isArrayTarget = true;
        } else if (target.initializer) {
          const t = this.types.typeFor(target.initializer);
          isArrayTarget = t.isArrayType();
        }
      }

      if (!isArrayTarget) {
        accept('error', 'Indexzugriff ist nur auf Array-Typen erlaubt.', {
          node,
          property: 'index'
        });
      }

      const indexType = this.types.typeFor(node.index);
      if (!indexType.isSameAs(TYPE_NUM) && !indexType.isUnknown()) {
        accept('error', 'Der Array-Index muss vom Typ num sein.', {
          node,
          property: 'index'
        });
      }
    }
  }

  checkAttRef(node: AttRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekanntes Attribut.', { node, property: 'ref' });
      return;
    }

    if (node.index) {
      const att = node.ref?.ref;
      if (!att?.type) return;

      const attType = this.types.typeForTypeRef(att.type);
      if (!attType.isArrayType()) {
        accept('error', 'Indexzugriff ist nur auf Array-Typen erlaubt.', {
          node,
          property: 'index'
        });
      }

      const indexType = this.types.typeFor(node.index);
      if (!indexType.isSameAs(TYPE_NUM) && !indexType.isUnknown()) {
        accept('error', 'Der Array-Index muss vom Typ num sein.', {
          node,
          property: 'index'
        });
      }
    }
  }

  checkMethRef(node: MethRef, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Methode/Funktion.', { node, property: 'f' });
      return;
    }

    const target = node.f?.ref;
    if (!target) return;

    const expected = target.params?.length ?? 0;
    const actual = node.params?.length ?? 0;

    if (actual < expected) {
      accept('error', `Zu wenige Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params'
      });
      return;
    } else if (actual > expected) {
      accept('error', `Zu viele Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params'
      });
      return;
    }

    this.checkArgumentTypes(node, target, node.params ?? [], accept);
  }

  checkAttSelection(node: AttSelection, accept: ValidationAcceptor): void {
    const receiverType = this.types.typeFor(node.receiver);

    if (!receiverType.isStructType() && !receiverType.isUnknown()) {
      accept('error', `Attributzugriff nur auf Struct-Typen erlaubt, erhalten '${receiverType.asString()}'.`, {
        node,
        property: 'receiver'
      });
      return;
    }

    const structName = this.types.structNameOf(node.receiver);
    if (!structName) return;

    const struct = this.findStructByName(node, structName);
    if (!struct) return;

    const attName = node.attref.ref?.ref?.name;
    if (!attName) return;

    const exists = (struct.children ?? [])
      .filter(isStructAttDeclaration)
      .some(a => a.name === attName);

    if (!exists) {
      accept('error', `Attribut '${attName}' existiert nicht in Struct '${structName}'.`, {
        node,
        property: 'attref'
      });
    }
  }

  checkMethSelection(node: MethSelection, accept: ValidationAcceptor): void {
    const receiverType = this.types.typeFor(node.receiver);

    if (!receiverType.isStructType() && !receiverType.isUnknown()) {
      accept('error', `Methodenaufruf nur auf Struct-Typen erlaubt, erhalten '${receiverType.asString()}'.`, {
        node,
        property: 'receiver'
      });
      return;
    }

    const structName = this.types.structNameOf(node.receiver);
    if (!structName) return;

    const struct = this.findStructByName(node, structName);
    if (!struct) return;

    const methodName = node.methref.f?.ref?.name;
    if (!methodName) return;

    const target = node.methref.f?.ref;
    if (!target) return;

    if (!this.isStatementMethodCall(node) && !this.hasReturnValue(target)) {
      accept('error', `Methode '${target.name}' gibt keinen Wert zurück und kann nicht als Ausdruck verwendet werden.`, {
        node,
        property: 'methref'
      });
    }

    const exists = (struct.children ?? [])
      .filter(isFunctionDeclaration)
      .some(m => m.name === methodName);

    if (!exists) {
      accept('error', `Methode '${methodName}' existiert nicht in Struct '${structName}'.`, {
        node,
        property: 'methref'
      });
    }
  }

  private isStatementMethodCall(node: MethSelection): boolean {
    let current: any = node.$container;

    while (current) {
      if (current.$type === 'ExprStatement') {
        return true;
      }

      if (
        current.$type === 'VarDecl' ||
        current.$type === 'Assignment' ||
        current.$type === 'ReturnStmt' ||
        current.$type === 'PrintCommand' ||
        current.$type === 'ThrowCommand' ||
        current.$type === 'CallCommand'
      ) {
        return false;
      }

      current = current.$container;
    }

    return false;
  }

  private findStructByName(node: { $container?: unknown }, name: string): StructDeclaration | undefined {
    const program = this.getProgram(node);
    return program?.instructions
      .filter(isStructDeclaration)
      .find(s => s.name === name);
  }

  checkThisExpr(node: ThisExpr, accept: ValidationAcceptor): void {
    const struct = AstUtils.getContainerOfType(node, isStructDeclaration);
    const fn = AstUtils.getContainerOfType(node, isFunctionDeclaration);

    if (!struct || !fn) {
      accept('error', 'this darf nur innerhalb einer Struct-Methode verwendet werden.', { node });
    }
  }

  checkArrayLiteral(node: ArrayLiteral, accept: ValidationAcceptor): void {
    const elems = node.elems ?? [];
    if (elems.length <= 1) {
      return;
    }

    const firstType = this.types.typeFor(elems[0]);

    for (let i = 1; i < elems.length; i++) {
      const currentType = this.types.typeFor(elems[i]);

      if (!currentType.isSameAsIgnoringUnknown(firstType)) {
        accept('error', 'Alle Elemente eines Array-Literals müssen denselben Typ haben.', {
          node,
          property: 'elems',
          index: i
        });
      }
    }
  }

  checkPrintCommand(node: PrintCommand, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.param);
    if (!t.isUnknown() && !t.isBaseType()) {
      accept('error', `print erwartet einen Basistyp, ist aber '${t.asString()}'.`, {
        node,
        property: 'param'
      });
    }
  }

  checkThrowCommand(node: ThrowCommand, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.param);
    if (!t.isUnknown() && !t.isSameAs(TYPE_STRING)) {
      accept('error', `throw erwartet einen Wert vom Typ string, ist aber '${t.asString()}'.`, {
        node,
        property: 'param'
      });
    }
  }

  checkCallCommand(node: CallCommand, accept: ValidationAcceptor): void {
    if (!this.isCallableExpr(node.param)) {
      accept('error', 'call erwartet einen aufrufbaren Ausdruck, z. B. f() oder obj.m().', {
        node,
        property: 'param'
      });
    }
  }

  private checkArgumentTypes(
    callNode: FunctionCall | MethRef,
    target: FunctionDeclaration,
    args: Expr[],
    accept: ValidationAcceptor
  ): void {
    const params = target.params ?? [];
    const count = Math.min(params.length, args.length);

    for (let i = 0; i < count; i++) {
      const param = params[i];
      const arg = args[i];

      const expectedType = this.expectedParameterType(param);
      const actualType = this.types.typeFor(arg);

      if (expectedType.isUnknown()) {
        continue;
      }

      if (!this.isAssignable(actualType, expectedType)) {
        accept(
          'error',
          `Argument ${i + 1} hat falschen Typ: erwartet '${expectedType.asString()}', erhalten '${actualType.asString()}'.`,
          {
            node: callNode,
            property: 'params',
            index: i
          }
        );
      }
    }
  }

  private expectedParameterType(param: ParameterDecl): ReturnType<Pseudo2TypeComputer['typeFor']> {
    if (param.isArray) {
      return TYPE_ARRAY_UNKNOWN;
    }

    return this.inferParameterTypeFromFunctionBody(param);
  }

  private inferParameterTypeFromFunctionBody(param: ParameterDecl): ReturnType<Pseudo2TypeComputer['typeFor']> {
    const fn = AstUtils.getContainerOfType(param, isFunctionDeclaration);
    if (!fn) {
      return TYPE_UNKNOWN;
    }

    for (const n of AstUtils.streamAllContents(fn)) {
      if (isVarRef(n) && n.ref?.ref === param) {
        const inferred = this.inferTypeFromUsage(n);
        if (!inferred.isUnknown()) {
          return inferred;
        }
      }
    }

    return TYPE_UNKNOWN;
  }

  private inferTypeFromUsage(ref: VarRef): ReturnType<Pseudo2TypeComputer['typeFor']> {
    let current: any = ref.$container;

    while (current) {
      if (isFunctionDeclaration(current)) {
        return TYPE_UNKNOWN;
      }

      if (isMultiplication(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      if (isExponentiation(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      if (isComparison(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      if (isAddition(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      if (isNot(current)) {
        return TYPE_BOOL;
      }

      if (isAnd(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_BOOL;
      }

      if (isOr(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_BOOL;
      }

      current = current.$container;
    }

    return TYPE_UNKNOWN;
  }

  checkAddition(node: Addition, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) {
      return;
    }

    const operands = [node.left, ...(node.right ?? [])];
    const types = operands.map(e => this.types.typeFor(e));

    const hasString = types.some(t => t.isSameAs(TYPE_STRING));
    const hasBool = types.some(t => t.isSameAs(TYPE_BOOL));
    const hasStruct = types.some(t => t.isStructType());
    const hasArray = types.some(t => t.isArrayType());

    // Komplett verbotene Typen
    if (hasBool || hasStruct || hasArray) {
      accept(
        'error',
        `Ungültige Addition: '+' erlaubt nur num + num oder String-Verkettung.`,
        { node }
      );
      return;
    }

    // String → alles okay
    if (hasString) {
      return;
    }

    // Prüfe num
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      if (!t.isSameAs(TYPE_NUM) && !t.isUnknown()) {
        accept(
          'error',
          `Ungültiger Operand für '+': erwartet num oder string, erhalten '${t.asString()}'.`,
          {
            node,
            property: i === 0 ? 'left' : 'right',
            index: i === 0 ? undefined : i - 1
          } as any
        );
      }
    }
  }

  checkMultiplication(node: Multiplication, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_NUM, accept, `Operatoren '*', '/', '%' und 'mod' erwarten num.`);
  }

  checkExponentiation(node: Exponentiation, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_NUM, accept, `Potenzoperator '^' erwartet num.`);
  }

  checkAnd(node: And, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_BOOL, accept, `Operator '&&' erwartet bool.`);
  }

  checkOr(node: Or, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_BOOL, accept, `Operator '||' erwartet bool.`);
  }

  checkNot(node: Not, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.value);
    if (!t.isSameAs(TYPE_BOOL) && !t.isUnknown()) {
      accept('error', `Operator '!' erwartet bool, erhalten '${t.asString()}'.`, {
        node,
        property: 'value'
      });
    }
  }

  checkNeg(node: Neg, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.value);
    if (!t.isSameAs(TYPE_NUM) && !t.isUnknown()) {
      accept('error', `Vorzeichen '-' erwartet num, erhalten '${t.asString()}'.`, {
        node,
        property: 'value'
      });
    }
  }

  checkEquality(node: Equality, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) {
      return;
    }

    const operands = [node.left, ...(node.right ?? [])];
    const types = operands.map(e => this.types.typeFor(e));

    const first = types[0];

    for (let i = 1; i < types.length; i++) {
      const current = types[i];

      if (first.isUnknown() || current.isUnknown()) {
        continue;
      }

      if (
        first.isArrayType() || current.isArrayType() ||
        first.isStructType() || current.isStructType()
      ) {
        accept('error', `Vergleich nicht erlaubt: Arrays und Structs können nicht mit '==' oder '!=' verglichen werden.`, {
          node
        });
        return;
      }

      if (!first.isSameAs(current)) {
        accept('error', `Typfehler im Vergleich: '${first.asString()}' kann nicht mit '${current.asString()}' verglichen werden.`, {
          node
        });
        return;
      }
    }
  }
  checkComparison(node: Comparison, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_NUM, accept, `Vergleichsoperatoren '<', '<=', '>' und '>=' erwarten num.`);
  }


  private isCallableExpr(expr: Expr): boolean {
    const core = this.unwrapExpr(expr);
    return isFunctionCall(core) || isMethSelection(core);
  }
 
  private checkNoInstructionsAfterReturn(instructions: Instruction[], accept: ValidationAcceptor): void {
    let foundReturn = false;

    for (const instr of instructions) {
      if (foundReturn) {
        accept('warning', 'Diese Anweisung ist nicht erreichbar, weil davor bereits return steht.', {
          node: instr
        });
      }

      if (isReturnStmt(instr)) {
        foundReturn = true;
      }
    }
  }

  private unwrapExpr(expr: Expr): Expr {
    let current: Expr = expr;

    while (true) {
      if (isGrouping(current)) {
        current = current.value;
        continue;
      }

      if (isOr(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isAnd(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isEquality(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isComparison(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isAddition(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isMultiplication(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isExponentiation(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      return current;
    }
  }

  private requireAllTypes(
    node: unknown,
    operands: Expr[],
    expected: ReturnType<Pseudo2TypeComputer['typeFor']>,
    accept: ValidationAcceptor,
    message: string
  ): void {
    for (const operand of operands) {
      const actual = this.types.typeFor(operand);

      if (actual.isUnknown()) {
        continue;
      }

      if (!actual.isSameAs(expected)) {
        accept('error', `${message} Erhalten: '${actual.asString()}'.`, {
          node: node as any
        });
        return;
      }
    }
  }

  private getSiblingVarDecls(node: VarDecl): VarDecl[] {
    const container: any = node.$container;

    if (!container) {
      const program = this.getProgram(node);
      return program ? program.instructions.filter(isVarDecl) : [];
    }

    if (isBracedBlock(container)) {
      return (container.instructions ?? []).filter(isVarDecl);
    }

    if (isIndentedBlock(container)) {
      return (container.instructions ?? []).filter(isVarDecl);
    }

    if (isFunctionDeclaration(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    if (isIfStatement(container)) {
      const thenVars: VarDecl[] = (container.thenBlock?.instructions ?? []).filter(isVarDecl);
      if (thenVars.includes(node)) {
        return thenVars;
      }

      const elseVars: VarDecl[] = (container.elseBlock?.instructions ?? []).filter(isVarDecl);
      if (elseVars.includes(node)) {
        return elseVars;
      }

      return [];
    }

    if (isWhileLoop(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    if (isForLoop(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    if (isDoWhileLoop(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    const program = this.getProgram(node);
    return program ? program.instructions.filter(isVarDecl) : [];
  }

  private findOuterVisibleName(node: VarDecl, name: string): Variable | undefined {
    let current: AstNodeLike | undefined = node.$container;

    while (current) {
      if (isFunctionDeclaration(current)) {
        const param = (current.params ?? []).find((p: ParameterDecl) => p.name === name);
        if (param) return param;

        const parentStruct = AstUtils.getContainerOfType(current.$container, isStructDeclaration);
        if (parentStruct) {
          const att = (parentStruct.children ?? []).filter(isStructAttDeclaration).find(a => a.name === name);
          if (att) return att;
        }
      }

      if (isBracedBlock(current) || isIndentedBlock(current)) {
        const instrs = current.instructions ?? [];
        const currentInstr = this.getEnclosingInstruction(node);
        if (currentInstr) {
          const idx = instrs.indexOf(currentInstr);
          const prev = instrs.slice(0, idx).filter(isVarDecl).find(v => v.name === name);
          if (prev) return prev;
        }
      }

      current = current.$container as AstNodeLike | undefined;
    }

    const program = this.getProgram(node);
    return program?.instructions
      .filter(isVarDecl)
      .find(v => v !== node && v.name === name);
  }

  private getEnclosingInstruction(node: VarDecl): Instruction | undefined {
    let n: AstNodeLike | undefined = node;
    while (n) {
      if (this.isInstructionNode(n)) {
        return n as Instruction;
      }
      n = n.$container as AstNodeLike | undefined;
    }
    return undefined;
  }

  private isInstructionNode(n: AstNodeLike): boolean {
    return (
      isBracedBlock(n as any) ||
      isIndentedBlock(n as any) ||
      isIfStatement(n as any) ||
      isWhileLoop(n as any) ||
      isForLoop(n as any) ||
      isDoWhileLoop(n as any) ||
      isFunctionDeclaration(n as any) ||
      isStructDeclaration(n as any) ||
      isVarDecl(n as any)
    );
  }

  private isAssignable(
    source: ReturnType<Pseudo2TypeComputer['typeFor']>,
    target: ReturnType<Pseudo2TypeComputer['typeFor']>
  ): boolean {
    return source.isConformingTo(target);
  }

  private getProgram(node: { $container?: unknown }): Program | undefined {
    const doc = AstUtils.getDocument(node as any);
    return doc.parseResult.value as Program;
  }
}

type AstNodeLike = {
  $container?: unknown;
};