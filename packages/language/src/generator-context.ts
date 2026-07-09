import { AstUtils } from 'langium';
import type { FunctionDeclaration, Program, Variable } from './generated/ast.js';
import {
  isFunctionDeclaration,
  isVariable
} from './generated/ast.js';

function targetIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

export class Pseudo2GeneratorContext {
  private readonly variableNames = new Map<Variable, string>();
  private readonly functionNames = new Map<FunctionDeclaration, string>();
  private variableCounter = 0;
  private functionCounter = 0;

  static fromProgram(program: Program): Pseudo2GeneratorContext {
    const context = new Pseudo2GeneratorContext();
    context.registerProgram(program);
    return context;
  }

  registerProgram(program: Program): void {
    for (const node of AstUtils.streamAllContents(program)) {
      if (isVariable(node)) {
        this.addVarName(node);
      }
      if (isFunctionDeclaration(node)) {
        this.addFunctionName(node);
      }
    }
  }

  addVarName(variable: Variable): void {
    if (this.variableNames.has(variable)) {
      throw new Error(`Variable '${variable.name}' is already registered.`);
    }
    this.variableNames.set(variable, `${targetIdentifier(variable.name)}_${this.variableCounter++}`);
  }

  getVarName(variable: Variable): string {
    const name = this.variableNames.get(variable);
    if (!name) {
      throw new Error(`Could not find generated name for variable '${variable.name}'.`);
    }
    return name;
  }

  getAnonymousVarName(prefix = 'anonym'): string {
    return `${targetIdentifier(prefix)}_${this.variableCounter++}`;
  }

  addFunctionName(fn: FunctionDeclaration): void {
    if (this.functionNames.has(fn)) {
      throw new Error(`Function '${fn.name}' is already registered.`);
    }
    this.functionNames.set(fn, `func_${targetIdentifier(fn.name)}_${this.functionCounter++}`);
  }

  getFunctionName(fn: FunctionDeclaration): string {
    const name = this.functionNames.get(fn);
    if (!name) {
      throw new Error(`Could not find generated name for function '${fn.name}'.`);
    }
    return name;
  }

  getAnonymousFunctionName(prefix = 'anonym'): string {
    return `${targetIdentifier(prefix)}_${this.functionCounter++}`;
  }
}
