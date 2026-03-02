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
  VarDecl,
  Assignment
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

    VarDecl: validator.checkVarDecl,
    Assignment: validator.checkAssignment
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
    // no rules yet
    // Optional: warn if iterator missing
    // if (!node.iterator) accept('warning', 'For-Schleife ohne Iterator.', { node, property: 'iterator' });
  }

  checkDoWhileLoop(node: DoWhileLoop, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkVarDecl(node: VarDecl, accept: ValidationAcceptor): void {
    // no rules yet
  }

  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    // Optional:
    // if (!node.target.ref.ref) accept('error', 'Unbekannte Variable.', { node: node.target, property: 'ref' });
  }
}