// packages/cli/src/generator.ts

import type {
  Program,
  Instruction,
  IfStatement,
  WhileLoop,
  Expr,
  VarDeclaration,
  Assignment
} from 'pseudo2-language';

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
} from 'pseudo2-language';

import { expandToNode, toString } from 'langium/generate';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractDestinationAndName } from './util.js';

export function generate(programAst: Program, filePath: string, destination: string | undefined): string {
  const data = extractDestinationAndName(filePath, destination);
  const generatedFilePath = `${path.join(data.destination, data.name)}.js`;

  const fileNode = expandToNode`
    "use strict";

    // Pseudo2 generator
    ${programAst.instructions.map(i => genInstruction(i)).join('')}
  `.appendNewLineIfNotEmpty();

  if (!fs.existsSync(data.destination)) {
    fs.mkdirSync(data.destination, { recursive: true });
  }
  fs.writeFileSync(generatedFilePath, toString(fileNode));
  return generatedFilePath;
}

function genInstruction(i: Instruction, indent = ''): string {
  if (isBracedBlock(i)) return genBracedBlock(i, indent);
  if (isIndentedBlock(i)) return genIndentedBlock(i, indent);

  if (isIfStatement(i)) return genIfStatement(i, indent);
  if (isWhileLoop(i)) return genWhileLoop(i, indent);

  if (isVarDeclaration(i)) return genVarDeclaration(i, indent);
  if (isAssignment(i)) return genAssignment(i, indent);

  return `${indent}// TODO: instruction\n`;
}

function genBracedBlock(b: any, indent = ''): string {
  return genBlockBody(b, indent);
}

function genIndentedBlock(b: any, indent = ''): string {
  // we currently render indented blocks as normal braces in JS output
  return genBlockBody(b, indent);
}

function genBlockBody(b: any, indent = ''): string {
  let out = `${indent}{\n`;
  const inner = indent + '  ';
  for (const instr of b.instructions ?? []) {
    out += genInstruction(instr, inner);
  }
  out += `${indent}}\n`;
  return out;
}

function genIfStatement(n: IfStatement, indent = ''): string {
  let out = `${indent}if (${genExpr(n.condition)}) `;
  out += genBlockAny(n.thenBlock, indent);

  if (n.elseBlock) {
    out += `${indent}else `;
    out += genBlockAny(n.elseBlock, indent);
  }
  return out;
}

function genWhileLoop(w: WhileLoop, indent = ''): string {
  let out = `${indent}while (${genExpr(w.condition)}) `;
  out += genBlockAny(w.body, indent);
  return out;
}

function genVarDeclaration(n: VarDeclaration, indent = ''): string {
  if (n.initializer) {
    return `${indent}var ${n.name} = ${genExpr(n.initializer)}\n`;
  }
  return `${indent}var ${n.name}\n`;
}

function genAssignment(n: Assignment, indent = ''): string {
  const targetName = n.target.ref?.ref?.name ?? '/*unresolved*/';
  return `${indent}${targetName} = ${genExpr(n.value)}\n`;
}

// --------------------
// Expression generation
// --------------------

function genExpr(e: Expr): string {
  if (isIntLiteral(e)) return String(e.value);
  if (isBoolLiteral(e)) return String(e.value);
  if (isStringLiteral(e)) return String(e.value);

  if (isVarRef(e)) return e.ref.ref?.name ?? '/*unresolved*/';

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

// helper: Block can be BracedBlock or IndentedBlock
function genBlockAny(b: any, indent = ''): string {
  return genBlockBody(b, indent);
}