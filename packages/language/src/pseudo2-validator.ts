// packages/language/src/pseudo2-validator.ts

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

  // NEW: structs & selection
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
  Variable
} from './generated/ast.js';
import type { Pseudo2Services } from './pseudo2-module.js';

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

    // Structs / Types
    StructDeclaration: validator.checkStructDeclaration,
    StructAttDeclaration: validator.checkStructAttDeclaration,
    StructType: validator.checkStructType,
    NewExpr: validator.checkNewExpr,

    // Selection / References
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
    // no rules yet
  }

  checkIndentedBlock(node: IndentedBlock, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkIfStatement(node: IfStatement, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkWhileLoop(node: WhileLoop, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkForLoop(node: ForLoop, accept: ValidationAcceptor): void {
    // Optional:
    // if (!node.iterator) accept('warning', 'For-Schleife ohne Iterator.', { node, property: 'iterator' });
  }

  checkDoWhileLoop(node: DoWhileLoop, accept: ValidationAcceptor): void {
    // no rules yet
  }

  // --------------------
  // Functions
  // --------------------

  checkFunctionDeclaration(node: FunctionDeclaration, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkFunctionCall(node: FunctionCall, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Funktion.', { node, property: 'f' });
    }
  }

  checkReturnStmt(node: ReturnStmt, accept: ValidationAcceptor): void {
    // later: ensure return only inside functions
  }

  // --------------------
  // Variables / assignment
  // --------------------

  checkVarDecl(node: VarDecl, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    // sel is Expr -> if it's a VarRef and unresolved, VarRef check will catch it.
    // Optional additional check: prohibit assigning to non-lvalues (e.g., function call)
  }

  // --------------------
  // Structs / types
  // --------------------

  checkStructDeclaration(node: StructDeclaration, accept: ValidationAcceptor): void {
    // later: duplicate fields/methods
  }

  checkStructAttDeclaration(node: StructAttDeclaration, accept: ValidationAcceptor): void {
    // later: type checks
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
    // later: duplicates/shadowing in same scope
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
    // later: ensure used only in methods
  }
}