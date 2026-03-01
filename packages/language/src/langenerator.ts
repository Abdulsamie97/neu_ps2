// packages/language/src/langenerator.ts

import type {
  BracedBlock,
  IndentedBlock,
  IfStatement,
  WhileLoop,
  Instruction,
  Program,
  Expr,
  VarDeclaration,
  Assignment
} from './generated/ast.js';

import {
  isBracedBlock,
  isIndentedBlock,
  isIfStatement,
  isWhileLoop,
  isVarDeclaration,
  isAssignment,

  isOr, isAnd, isEquality, isComparison, isAddition, isMultiplication,
  isNot, isNeg,
  isGrouping, isIntLiteral, isBoolLiteral, isStringLiteral, isVarRef
} from './generated/ast.js';

export function generateProgram(program: Program): string {
  return program.instructions.map(i => generateInstruction(i)).join('\n');
}

function generateInstruction(instruction: Instruction, indent = 0): string {
  if (isBracedBlock(instruction) || isIndentedBlock(instruction)) {
    return generateBlock(instruction, indent);
  }

  if (isIfStatement(instruction)) {
    return generateIfStatement(instruction, indent);
  }

  if (isWhileLoop(instruction)) {
    return generateWhileLoop(instruction, indent);
  }

  if (isVarDeclaration(instruction)) {
    return generateVarDeclaration(instruction, indent);
  }

  if (isAssignment(instruction)) {
    return generateAssignment(instruction, indent);
  }

  return '';
}

function generateBlock(block: BracedBlock | IndentedBlock, indent = 0): string {
  const padding = ' '.repeat(indent);

  const body = block.instructions ?? [];
  if (body.length === 0) {
    return `${padding}{}`;
  }

  const nested = body
    .map(instruction => generateInstruction(instruction, indent + 2))
    .join('\n');

  return `${padding}{\n${nested}\n${padding}}`;
}

function generateIfStatement(ifStatement: IfStatement, indent = 0): string {
  const padding = ' '.repeat(indent);

  const condition = genExpr(ifStatement.condition);
  const thenBlock = generateBlock(ifStatement.thenBlock, indent);

  const elsePart = ifStatement.elseBlock
    ? `\n${padding}else ${generateBlock(ifStatement.elseBlock, indent)}`
    : '';

  return `${padding}if (${condition}) ${thenBlock}${elsePart}`;
}

function generateWhileLoop(loop: WhileLoop, indent = 0): string {
  const padding = ' '.repeat(indent);
  const condition = genExpr(loop.condition);
  const body = generateBlock(loop.body, indent);
  return `${padding}while (${condition}) ${body}`;
}

// --------------------
// Simple statements
// --------------------

function generateVarDeclaration(decl: VarDeclaration, indent = 0): string {
  const padding = ' '.repeat(indent);
  if (decl.initializer) {
    return `${padding}var ${decl.name} = ${genExpr(decl.initializer)}`;
  }
  return `${padding}var ${decl.name}`;
}

function generateAssignment(assign: Assignment, indent = 0): string {
  const padding = ' '.repeat(indent);

  const targetDecl = assign.target.ref.ref;
  const targetName = targetDecl?.name ?? '/*unresolved*/';

  return `${padding}${targetName} = ${genExpr(assign.value)}`;
}

// --------------------
// Expression generation
// --------------------

function genExpr(e: Expr): string {
  if (isIntLiteral(e)) return String(e.value);
  if (isBoolLiteral(e)) return String(e.value);
  if (isStringLiteral(e)) return String(e.value);

  if (isVarRef(e)) {
    return e.ref.ref?.name ?? '/*unresolved*/';
  }

  if (isGrouping(e)) return `(${genExpr(e.value)})`;
  if (isNot(e)) return `(!${genExpr(e.value)})`;
  if (isNeg(e)) return `(-${genExpr(e.value)})`;

  if (isOr(e)) return genChain(genExpr(e.left), '||', e.right);
  if (isAnd(e)) return genChain(genExpr(e.left), '&&', e.right);

  if (isEquality(e) || isComparison(e) || isAddition(e) || isMultiplication(e)) {
    return genOpChain(genExpr(e.left), e.op ?? [], e.right ?? []);
  }

  return '/*expr*/';
}

function genChain(left: string, op: string, rights: Expr[]): string {
  let out = `(${left}`;
  for (const r of rights) out += ` ${op} ${genExpr(r)}`;
  return out + ')';
}

function genOpChain(left: string, ops: string[], rights: Expr[]): string {
  let out = `(${left}`;
  for (let i = 0; i < rights.length; i++) {
    out += ` ${ops[i] ?? '?'} ${genExpr(rights[i])}`;
  }
  return out + ')';
}