// packages/language/src/pseudo2-validator.ts

import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type {
  Pseudo2AstType,
  BracedBlock,
  IndentedBlock,
  IfStatement,
  VarDeclaration,
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
    VarDeclaration: validator.checkVarDeclaration,
    Assignment: validator.checkAssignment
  };

  registry.register(checks, validator);
}

/**
 * Implementation of custom validations.
 */
export class Pseudo2Validator {

  checkBracedBlock(node: BracedBlock, accept: ValidationAcceptor): void {
    // Step 1: no rules yet
    // Optional:
    // if ((node.instructions ?? []).length === 0) {
    //   accept('warning', 'Leerer Block.', { node });
    // }
  }

  checkIndentedBlock(node: IndentedBlock, accept: ValidationAcceptor): void {
    // Step 1: no rules yet
  }

  checkIfStatement(node: IfStatement, accept: ValidationAcceptor): void {
    // Step 2: no rules yet
  }

  checkVarDeclaration(node: VarDeclaration, accept: ValidationAcceptor): void {
    // Step 3: no rules yet (later: warn on shadowing, unused vars, etc.)
  }

  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    // Step 3: no rules yet
    // Optional example:
    // if (!node.target.ref.ref) accept('error', 'Unbekannte Variable.', { node: node.target, property: 'ref' });
  }
}