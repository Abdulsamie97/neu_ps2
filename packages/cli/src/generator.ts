// packages/cli/src/generator.ts

import type {
  Program,
  Instruction,
  IfStatement,
  WhileLoop,
  ForLoop,
  DoWhileLoop,
  FunctionDeclaration,
  FunctionCall,
  ReturnStmt,
  Expr,
  VarDecl,
  Assignment,
  StructDeclaration,
  ExprStatement,
  VarRef,
  AttRef,
  MethRef,
  ArrayLiteral,
 // Exponentiation,
  PrintCommand,
  ThrowCommand,
  CallCommand
} from 'pseudo2-language';

import {
  isBracedBlock,
  isIndentedBlock,
  isIfStatement,
  isWhileLoop,
  isForLoop,
  isDoWhileLoop,
  isFunctionDeclaration,
  isFunctionCall,
  isReturnStmt,
  isVarDecl,
  isAssignment,
  isStructDeclaration,
  isExprStatement,
  isExponentiation,
  isPrintCommand,
  isThrowCommand,
  isCallCommand,

  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isNot,
  isNeg,
  isGrouping,
  isIntLiteral,
  isBoolLiteral,
  isStringLiteral,

  isThisExpr,
  isVarRef,
  isAttSelection,
  isMethSelection,
  isNullLiteral,
  isNewExpr,
  isStructAttDeclaration,
  isArrayLiteral
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
    ${programAst.instructions.map(i => genInstruction(i)).filter(Boolean).join('\n\n')}
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
  if (isForLoop(i)) return genForLoop(i, indent);
  if (isDoWhileLoop(i)) return genDoWhileLoop(i, indent);

  if (isStructDeclaration(i)) return genStructDeclaration(i, indent);
  if (isFunctionDeclaration(i)) return genFunctionDeclaration(i, indent);
  if (isFunctionCall(i)) return genFunctionCall(i, indent);
  if (isReturnStmt(i)) return genReturnStmt(i, indent);
  if (isExprStatement(i)) return genExprStatement(i, indent);

  if (isPrintCommand(i)) return genPrintCommand(i, indent);
  if (isThrowCommand(i)) return genThrowCommand(i, indent);
  if (isCallCommand(i)) return genCallCommand(i, indent);

  if (isVarDecl(i)) return genVarDecl(i, indent);
  if (isAssignment(i)) return genAssignment(i, indent);

  return `${indent}// TODO: instruction\n`;
}

function genBracedBlock(b: any, indent = ''): string {
  return genBlockBody(b, indent);
}

function genIndentedBlock(b: any, indent = ''): string {
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

function genForLoop(loop: ForLoop, indent = ''): string {
  const from = genExpr(loop.from);
  const to = genExpr(loop.to);
  const step = loop.step ? genExpr(loop.step) : '1';

  const iterName = loop.iterator?.name ?? null;
  if (!iterName) {
    let out = `${indent}// TODO: for-loop without iterator is not supported in JS output\n`;
    out += `${indent}// for ${from} ${loop.direction} ${to} by ${step}\n`;
    out += genBlockAny(loop.body, indent);
    return out;
  }

  if (loop.direction === 'to') {
    return `${indent}for (let ${iterName} = ${from}; ${iterName} <= ${to}; ${iterName} += ${step}) ` +
           genBlockAny(loop.body, indent);
  } else {
    return `${indent}for (let ${iterName} = ${from}; ${iterName} >= ${to}; ${iterName} -= ${step}) ` +
           genBlockAny(loop.body, indent);
  }
}

function genDoWhileLoop(loop: DoWhileLoop, indent = ''): string {
  return `${indent}do ` + genBlockAny(loop.body, indent) + `${indent}while (${genExpr(loop.condition)});\n`;
}

// --------------------
// Structs
// --------------------

function genStructDeclaration(structDecl: StructDeclaration, indent = ''): string {
  const attributes = (structDecl.children ?? []).filter(isStructAttDeclaration);
  const methods = (structDecl.children ?? []).filter(isFunctionDeclaration);

  const ctorLines = attributes
    .map(att => `${indent}    this.${att.name} = null;\n`)
    .join('');

  const ctor = attributes.length > 0
    ? `${indent}  constructor() {\n${ctorLines}${indent}  }\n`
    : `${indent}  constructor() {}\n`;

  const methodText = methods
    .map(m => genMethodDeclaration(m, indent + '  '))
    .join('\n');

  return `${indent}class ${structDecl.name} {\n${ctor}${methodText ? '\n' + methodText : ''}${indent}}\n`;
}

function genMethodDeclaration(fn: FunctionDeclaration, indent = ''): string {
  const params = (fn.params ?? []).map(p => p.name).join(', ');
  const body = genBlockAny(fn.body, indent);
  return `${indent}${fn.name}(${params}) ${body}`;
}

// --------------------
// Functions
// --------------------

function genFunctionDeclaration(fn: FunctionDeclaration, indent = ''): string {
  const params = (fn.params ?? []).map(p => p.name).join(', ');
  return `${indent}function ${fn.name}(${params}) ` + genBlockAny(fn.body, indent);
}

function genFunctionCall(call: FunctionCall, indent = ''): string {
  const fnName = call.f?.ref?.name ?? '/*unresolved*/';
  const args = (call.params ?? []).map(p => genExpr(p)).join(', ');
  return `${indent}${fnName}(${args})\n`;
}

function genReturnStmt(ret: ReturnStmt, indent = ''): string {
  if (ret.retExpr) return `${indent}return ${genExpr(ret.retExpr)}\n`;
  return `${indent}return\n`;
}

function genExprStatement(stmt: ExprStatement, indent = ''): string {
  return `${indent}${genExpr(stmt.expr)}\n`;
}

function genPrintCommand(cmd: PrintCommand, indent = ''): string {
  return `${indent}console.log(${genExpr(cmd.param)})\n`;
}

function genThrowCommand(cmd: ThrowCommand, indent = ''): string {
  return `${indent}throw ${genExpr(cmd.param)}\n`;
}

function genCallCommand(cmd: CallCommand, indent = ''): string {
  return `${indent}${genExpr(cmd.param)}\n`;
}

function genVarDecl(n: VarDecl, indent = ''): string {
  if (n.initializer) {
    return `${indent}let ${n.name} = ${genExpr(n.initializer)}\n`;
  }
  return `${indent}let ${n.name}\n`;
}

function genAssignment(n: Assignment, indent = ''): string {
  const left = genExpr(n.sel as unknown as Expr);
  return `${indent}${left} = ${genExpr(n.value)}\n`;
}

// --------------------
// Expression generation
// --------------------

function genExpr(e: Expr): string {
  if (isIntLiteral(e)) return String(e.value);
  if (isBoolLiteral(e)) return String(e.value);
  if (isStringLiteral(e)) return JSON.stringify(e.value);
  
  if (isNullLiteral(e)) return 'null';

  if (isArrayLiteral(e)) {
    return genArrayLiteral(e);
  }

  if (isNewExpr(e)) {
    const typeName = e.type?.ref?.name ?? '/*unresolved*/';
    return `new ${typeName}()`;
  }

  if (isThisExpr(e)) return 'this';

  if (isVarRef(e)) {
    return genVarRef(e);
  }

  if (isAttSelection(e)) {
    const recv = genExpr(e.receiver);
    const att = genAttRef(e.attref);
    return `${recv}.${att}`;
  }

  if (isMethSelection(e)) {
    const recv = genExpr(e.receiver);
    const meth = genMethRef(e.methref);
    return `${recv}.${meth}`;
  }

  if (isGrouping(e)) return `(${genExpr(e.value)})`;
  if (isNot(e)) return `(!${genExpr(e.value)})`;
  if (isNeg(e)) return `(-${genExpr(e.value)})`;

  if (isOr(e)) {
    return (e.right?.length ?? 0) === 0
      ? genExpr(e.left)
      : genChain(genExpr(e.left), '||', e.right);
  }

  if (isAnd(e)) {
    return (e.right?.length ?? 0) === 0
      ? genExpr(e.left)
      : genChain(genExpr(e.left), '&&', e.right);
  }

  if (isEquality(e) || isComparison(e) || isAddition(e) || isMultiplication(e) || isExponentiation(e)) {
    return (e.right?.length ?? 0) === 0
      ? genExpr(e.left)
      : genOpChain(genExpr(e.left), e.op ?? [], e.right ?? []);
  }

  if (isFunctionCall(e)) {
    const fnName = e.f?.ref?.name ?? '/*unresolved*/';
    const args = (e.params ?? []).map(p => genExpr(p)).join(', ');
    return `${fnName}(${args})`;
  }

  return '/*expr*/';
}

function genArrayLiteral(e: ArrayLiteral): string {
  const elems = (e.elems ?? []).map(elem => genExpr(elem)).join(', ');
  return `[${elems}]`;
}

function genVarRef(e: VarRef): string {
  const target = e.ref.ref;
  const name = target?.name ?? '/*unresolved*/';

  if (target && isStructAttDeclaration(target)) {
    if (e.index) return `this.${name}[${genExpr(e.index)}]`;
    return `this.${name}`;
  }

  if (e.index) return `${name}[${genExpr(e.index)}]`;
  return name;
}

function genAttRef(r: AttRef): string {
  const name = r.ref?.ref?.name ?? '/*unresolved*/';
  if (r.index) return `${name}[${genExpr(r.index)}]`;
  return name;
}

function genMethRef(r: MethRef): string {
  const name = r.f?.ref?.name ?? '/*unresolved*/';
  const args = (r.params ?? []).map(p => genExpr(p)).join(', ');
  return `${name}(${args})`;
}

function genChain(left: string, op: string, rights: Expr[]): string {
  let out = `(${left}`;
  for (const r of rights) out += ` ${op} ${genExpr(r)}`;
  return out + ')';
}

function genOpChain(left: string, ops: string[], rights: Expr[]): string {
  let out = `(${left}`;
  for (let i = 0; i < rights.length; i++) {
    const rawOp = ops[i] ?? '?';
    const op = rawOp === 'mod' ? '%' : rawOp === '^' ? '**' : rawOp;
    out += ` ${op} ${genExpr(rights[i])}`;
  }
  return out + ')';
}

function genBlockAny(b: any, indent = ''): string {
  return genBlockBody(b, indent);
}