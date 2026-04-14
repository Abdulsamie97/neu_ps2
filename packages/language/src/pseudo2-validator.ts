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
  Expr
} from './generated/ast.js';
import type { Pseudo2Services } from './pseudo2-module.js';

import {
  isFunctionDeclaration,
  isStructDeclaration,
  isStructAttDeclaration,
  isVarRef,
  isAttSelection
} from './generated/ast.js';

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
    ThisExpr: validator.checkThisExpr
  };

  registry.register(checks, validator);
}

export class Pseudo2Validator {
  // --------------------
  // Blocks / control flow
  // --------------------

  checkBracedBlock(node: BracedBlock, accept: ValidationAcceptor): void {
    // intentionally empty
  }

  checkIndentedBlock(node: IndentedBlock, accept: ValidationAcceptor): void {
    // intentionally empty
  }

  checkIfStatement(node: IfStatement, accept: ValidationAcceptor): void {
    // later: type checks on condition
  }

  checkWhileLoop(node: WhileLoop, accept: ValidationAcceptor): void {
    // later: type checks on condition
  }

  checkForLoop(node: ForLoop, accept: ValidationAcceptor): void {
    if (!node.iterator) {
      accept('warning', 'For-Schleife ohne Iterator.', { node });
    }
  }

  checkDoWhileLoop(node: DoWhileLoop, accept: ValidationAcceptor): void {
    // later: type checks on condition
  }

  // --------------------
  // Functions
  // --------------------

  checkFunctionDeclaration(node: FunctionDeclaration, accept: ValidationAcceptor): void {
    const seen = new Set<string>();
    for (const p of node.params ?? []) {
      if (seen.has(p.name)) {
        accept('error', `Doppelter Parametername '${p.name}'.`, { node: p, property: 'name' });
      } else {
        seen.add(p.name);
      }
    }

    // Methoden-Duplikate werden in checkStructDeclaration behandelt.
    const parentStruct = AstUtils.getContainerOfType(node.$container, isStructDeclaration);
    if (parentStruct) {
      return;
    }

    const program = this.getProgram(node);
    if (!program) return;

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

  checkFunctionCall(node: FunctionCall, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Funktion.', { node, property: 'f' });
    }
  }

  checkReturnStmt(node: ReturnStmt, accept: ValidationAcceptor): void {
    const fn = AstUtils.getContainerOfType(node, isFunctionDeclaration);
    if (!fn) {
      accept('error', 'return darf nur innerhalb einer Funktion verwendet werden.', { node });
    }
  }

  // --------------------
  // Variables / assignment
  // --------------------

  checkVarDecl(node: VarDecl, accept: ValidationAcceptor): void {
    // optional later: duplicate local names / shadowing warnings
  }

  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    const sel = node.sel as Expr;

    const validLValue =
      isVarRef(sel) ||
      isAttSelection(sel);

    if (!validLValue) {
      accept('error', 'Linke Seite einer Zuweisung muss eine Variable oder ein Attributzugriff sein.', {
        node,
        property: 'sel'
      });
    }
  }

  // --------------------
  // Structs / types
  // --------------------

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

  checkStructAttDeclaration(node: StructAttDeclaration, accept: ValidationAcceptor): void {
    // duplicate attributes are handled in checkStructDeclaration
  }

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

  // --------------------
  // Selection / references
  // --------------------

  checkVariable(node: Variable, accept: ValidationAcceptor): void {
    // optional later: duplicate/shadowing by scope kind
  }

  checkVarRef(node: VarRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekannte Variable.', { node, property: 'ref' });
    }
  }

  checkAttRef(node: AttRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekanntes Attribut.', { node, property: 'ref' });
    }
  }

  checkMethRef(node: MethRef, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Methode/Funktion.', { node, property: 'f' });
    }
  }

  checkAttSelection(node: AttSelection, accept: ValidationAcceptor): void {
    // optional later: ensure receiver is struct-typed
  }

  checkMethSelection(node: MethSelection, accept: ValidationAcceptor): void {
    // optional later: ensure receiver is struct-typed
  }

  checkThisExpr(node: ThisExpr, accept: ValidationAcceptor): void {
    const struct = AstUtils.getContainerOfType(node, isStructDeclaration);
    const fn = AstUtils.getContainerOfType(node, isFunctionDeclaration);

    if (!struct || !fn) {
      accept('error', 'this darf nur innerhalb einer Struct-Methode verwendet werden.', { node });
    }
  }

  // --------------------
  // Helpers
  // --------------------

  private getProgram(node: { $container?: unknown }): Program | undefined {
    const doc = AstUtils.getDocument(node as any);
    return doc.parseResult.value as Program;
  }
}