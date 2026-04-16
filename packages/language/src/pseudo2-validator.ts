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
  CallCommand
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
  isGrouping
} from './generated/ast.js';

import { Pseudo2TypeComputer } from './typing/pseudo2-type-computer.js';
import { TYPE_NUM, TYPE_BOOL, TYPE_STRING } from './typing/pseudo2-type.js';

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
    CallCommand: validator.checkCallCommand
  };

  registry.register(checks, validator);
}

export class Pseudo2Validator {
  private readonly types = new Pseudo2TypeComputer();

  checkBracedBlock(node: BracedBlock, accept: ValidationAcceptor): void {}

  checkIndentedBlock(node: IndentedBlock, accept: ValidationAcceptor): void {}

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
    for (const p of node.params ?? []) {
      if (seen.has(p.name)) {
        accept('error', `Doppelter Parametername '${p.name}'.`, { node: p, property: 'name' });
      } else {
        seen.add(p.name);
      }
    }

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

    const returns = this.allReturnsWithValue(node);
    if (returns.length <= 1) {
      return;
    }

    const firstType = this.types.typeFor(returns[0].retExpr);
    for (let i = 1; i < returns.length; i++) {
      const currentType = this.types.typeFor(returns[i].retExpr);
      if (
        !currentType.isSameAsIgnoringUnknown(firstType) &&
        !firstType.isUnknown() &&
        !currentType.isUnknown()
      ) {
        accept(
          'error',
          `Inkonsistente Rückgabetypen in Funktion '${node.name}': '${firstType.asString()}' und '${currentType.asString()}'.`,
          {
            node: returns[i],
            property: 'retExpr'
          }
        );
      }
    }
  }

  checkFunctionCall(node: FunctionCall, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Funktion.', { node, property: 'f' });
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
    } else if (actual > expected) {
      accept('error', `Zu viele Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params'
      });
    }
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

      let targetType;
      if (isVarDecl(target) && target.initializer) {
        targetType = this.types.typeFor(target.initializer);
      } else if (isStructAttDeclaration(target)) {
        targetType = this.types.typeForTypeRef(target.type);
      } else if (isParameterDecl(target)) {
        targetType = this.types.typeFor(node);
      }

      if (targetType && !targetType.isArrayType()) {
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
    } else if (actual > expected) {
      accept('error', `Zu viele Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params'
      });
    }
  }

  checkAttSelection(node: AttSelection, accept: ValidationAcceptor): void {}

  checkMethSelection(node: MethSelection, accept: ValidationAcceptor): void {}

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

  private isCallableExpr(expr: Expr): boolean {
    const core = this.unwrapExpr(expr);
    return isFunctionCall(core) || isMethSelection(core);
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

      return current;
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
    return program?.instructions.filter(isVarDecl).find(v => v.name === name);
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

  private allReturnsWithValue(fn: FunctionDeclaration): ReturnStmt[] {
    const out: ReturnStmt[] = [];
    for (const n of AstUtils.streamAllContents(fn)) {
      if (isReturnStmt(n) && n.retExpr) {
        out.push(n);
      }
    }
    return out;
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