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
  // NEW: because references now point to the common base type
  Variable,
  IdentifierRef,
  VarRef
} from './generated/ast.js';
import type { Pseudo2Services } from './pseudo2-module.js';

/**
 * Register custom validation checks.
 */
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

    // Variable base type: optional checks, useful for duplicates etc.
    Variable: validator.checkVariable,

    VarDecl: validator.checkVarDecl,
    Assignment: validator.checkAssignment,

    // Optional: explicit checks for unresolved refs (nicer messages)
    IdentifierRef: validator.checkIdentifierRef,
    VarRef: validator.checkVarRef
  };

  registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class Pseudo2Validator {

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
    // Optional: warn if iterator missing
    // if (!node.iterator) accept('warning', 'For-Schleife ohne Iterator.', { node, property: 'iterator' });
  }

  checkDoWhileLoop(node: DoWhileLoop, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkFunctionDeclaration(node: FunctionDeclaration, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkFunctionCall(node: FunctionCall, accept: ValidationAcceptor): void {
    // Better error than default unresolved ref (optional but helpful)
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Funktion.', { node, property: 'f' });
    }
  }

  checkReturnStmt(node: ReturnStmt, accept: ValidationAcceptor): void {
    // no rules yet (later: ensure return only inside functions)
  }

  checkVariable(node: Variable, accept: ValidationAcceptor): void {
    // no rules yet (later: shadowing/duplicates in same scope)
  }

  checkVarDecl(node: VarDecl, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    // assignment target is IdentifierRef -> Variable reference
    if (node.target?.ref && !node.target.ref.ref) {
      accept('error', 'Unbekannte Variable.', { node: node.target, property: 'ref' });
    }
  }

  checkIdentifierRef(node: IdentifierRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekannte Variable.', { node, property: 'ref' });
    }
  }

  checkVarRef(node: VarRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekannte Variable.', { node, property: 'ref' });
    }
  }
}