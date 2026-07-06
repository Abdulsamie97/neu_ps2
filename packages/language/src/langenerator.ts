// packages/language/src/langenerator.ts

import type {
  BracedBlock,
  IndentedBlock,
  IfStatement,
  WhileLoop,
  ForLoop,
  DoWhileLoop,
  FunctionDeclaration,
  FunctionCall,
  ReturnStmt,
  Instruction,
  Program,
  Expr,
  VarDecl,
  Assignment,
  StructDeclaration,
  ExprStatement,
  VarRef,
  AttSelection,
  MethSelection,
  ArrayLiteral,
  //Exponentiation,
  PrintCommand,
  ThrowCommand,
  CallCommand
} from './generated/ast.js';

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
  isNullLiteral,
  isNewExpr,
  isThisExpr,
  isVarRef,
  isAttSelection,
  isMethSelection,
  isStructAttDeclaration,
  isArrayLiteral
} from './generated/ast.js';

export function generateProgram(program: Program): string {
  return program.instructions.map(i => generateInstruction(i)).filter(Boolean).join('\n\n');
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

  if (isForLoop(instruction)) {
    return generateForLoop(instruction, indent);
  }

  if (isDoWhileLoop(instruction)) {
    return generateDoWhileLoop(instruction, indent);
  }

  if (isStructDeclaration(instruction)) {
    return generateStructDeclaration(instruction, indent);
  }

  if (isFunctionDeclaration(instruction)) {
    return generateFunctionDeclaration(instruction, indent);
  }

  if (isVarDecl(instruction)) {
    return generateVarDecl(instruction, indent);
  }

  if (isAssignment(instruction)) {
    return generateAssignment(instruction, indent);
  }

  if (isFunctionCall(instruction)) {
    return generateFunctionCall(instruction, indent);
  }

  if (isReturnStmt(instruction)) {
    return generateReturnStatement(instruction, indent);
  }

  if (isExprStatement(instruction)) {
    return generateExprStatement(instruction, indent);
  }

  if (isPrintCommand(instruction)) {
    return generatePrintCommand(instruction, indent);
  }

  if (isThrowCommand(instruction)) {
    return generateThrowCommand(instruction, indent);
  }

  if (isCallCommand(instruction)) {
    return generateCallCommand(instruction, indent);
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
    .filter(Boolean)
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

function generateForLoop(loop: ForLoop, indent = 0): string {
  const padding = ' '.repeat(indent);

  const from = genExpr(loop.from);
  const to = genExpr(loop.to);
  const step = loop.step ? genExpr(loop.step) : '1';
  const body = generateBlock(loop.body, indent);

  const iterName = loop.iterator?.name ?? null;
  if (!iterName) {
    return (
      `${padding}// TODO: for-loop without iterator is not supported in JS output\n` +
      `${padding}// for ${from} ${loop.direction} ${to} by ${step}\n` +
      `${padding}${body}\n`
    );
  }

  if (loop.direction === 'to') {
    return `${padding}for (let ${iterName} = ${from}; ${iterName} <= ${to}; ${iterName} += ${step}) ${body}`;
  } else {
    return `${padding}for (let ${iterName} = ${from}; ${iterName} >= ${to}; ${iterName} -= ${step}) ${body}`;
  }
}

function generateDoWhileLoop(loop: DoWhileLoop, indent = 0): string {
  const padding = ' '.repeat(indent);
  const body = generateBlock(loop.body, indent);
  const condition = genExpr(loop.condition);
  return `${padding}do ${body} while (${condition})`;
}

// --------------------
// Structs
// --------------------

function generateStructDeclaration(structDecl: StructDeclaration, indent = 0): string {
  const padding = ' '.repeat(indent);

  const attributes = (structDecl.children ?? []).filter(isStructAttDeclaration);
  const methods = (structDecl.children ?? [])
    .filter(isFunctionDeclaration)
    .filter(isMethodDecl);
  
  const ctorLines = attributes.map(att => `${' '.repeat(indent + 4)}this.${att.name} = null;`).join('\n');
  const ctor =
    attributes.length > 0
      ? `${' '.repeat(indent + 2)}constructor() {\n${ctorLines}\n${' '.repeat(indent + 2)}}`
      : `${' '.repeat(indent + 2)}constructor() {}`;

  const methodText = methods
    .map(m => generateMethodDeclaration(m, indent + 2))
    .join('\n\n');

  const body = methodText ? `${ctor}\n\n${methodText}` : ctor;

  return `${padding}class ${structDecl.name} {\n${body}\n${padding}}`;
}

function generateMethodDeclaration(fn: FunctionDeclaration, indent = 0): string {
  const padding = ' '.repeat(indent);
  const params = collectJsParams(fn).join(', ');
  const body = generateBlock(fn.body, indent);
  return `${padding}${fn.name}(${params}) ${body}`;
}

function isMethodDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword !== true;
}

// --------------------
// Functions
// --------------------

function generateFunctionDeclaration(fn: FunctionDeclaration, indent = 0): string {
  const padding = ' '.repeat(indent);
  const params = collectJsParams(fn).join(', ');
  const body = generateBlock(fn.body, indent);
  return `${padding}function ${fn.name}(${params}) ${body}`;
}

function collectJsParams(fn: FunctionDeclaration): string[] {
  const out: string[] = [];

  for (const p of fn.params ?? []) {
    out.push(p.name);
    if (p.isArray && p.len) {
      out.push(p.len.name);
    }
  }

  return out;
}

function generateFunctionCall(call: FunctionCall, indent = 0): string {
  const padding = ' '.repeat(indent);
  const fnName = call.f?.ref?.name ?? '/*unresolved*/';
  const args = (call.params ?? []).map(p => genExpr(p)).join(', ');
  return `${padding}${fnName}(${args})`;
}

function generateReturnStatement(ret: ReturnStmt, indent = 0): string {
  const padding = ' '.repeat(indent);
  if (ret.retExpr) {
    return `${padding}return ${genExpr(ret.retExpr)}`;
  }
  return `${padding}return`;
}

function generateExprStatement(stmt: ExprStatement, indent = 0): string {
  const padding = ' '.repeat(indent);
  return `${padding}${genExpr(stmt.expr)}`;
}

function generatePrintCommand(cmd: PrintCommand, indent = 0): string {
  const padding = ' '.repeat(indent);
  return `${padding}console.log(${genExpr(cmd.param)})`;
}

function generateThrowCommand(cmd: ThrowCommand, indent = 0): string {
  const padding = ' '.repeat(indent);
  return `${padding}throw ${genExpr(cmd.param)}`;
}

function generateCallCommand(cmd: CallCommand, indent = 0): string {
  const padding = ' '.repeat(indent);
  return `${padding}${genExpr(cmd.param)}`;
}

// --------------------
// Simple statements
// --------------------

function generateVarDecl(decl: VarDecl, indent = 0): string {
  const padding = ' '.repeat(indent);

  if ((decl as any).isArrayVariable) {
    const sizeExpr = (decl as any).size ? genExpr((decl as any).size) : '0';
    const initExpr = decl.initializer ? genExpr(decl.initializer) : 'null';
    return `${padding}let ${decl.name} = Array((${sizeExpr}) + 1).fill(${initExpr})`;
  }

  if (decl.initializer) {
    return `${padding}let ${decl.name} = ${genExpr(decl.initializer)}`;
  }

  return `${padding}let ${decl.name}`;
}

function generateAssignment(assign: Assignment, indent = 0): string {
  const padding = ' '.repeat(indent);
  const left = genExpr(assign.sel as unknown as Expr);
  return `${padding}${left} = ${genExpr(assign.value)}`;
}

// --------------------
// Expression generation
// --------------------

function genExpr(e: Expr): string {
  if (isIntLiteral(e)) return String(e.value);
  if (isBoolLiteral(e)) return String(e.value);
  if (isStringLiteral(e)) return String(e.value);
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
    return `${genExpr(e.receiver)}.${genAttRefName(e)}`;
  }

  if (isMethSelection(e)) {
    return `${genExpr(e.receiver)}.${genMethRefCall(e)}`;
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
  const target = e.ref?.ref;
  const name = target?.name ?? '/*unresolved*/';

  if (target && isStructAttDeclaration(target)) {
    if (e.index) {
      return `this.${name}[${genExpr(e.index)}]`;
    }
    return `this.${name}`;
  }

  if (e.index) {
    return `${name}[${genExpr(e.index)}]`;
  }

  return name;
}

function genAttRefName(e: AttSelection): string {
  const attName = e.attref.ref?.ref?.name ?? '/*unresolved*/';
  if (e.attref.index) {
    return `${attName}[${genExpr(e.attref.index)}]`;
  }
  return attName;
}

function genMethRefCall(e: MethSelection): string {
  const methName = e.methref.f?.ref?.name ?? '/*unresolved*/';
  const args = (e.methref.params ?? []).map(p => genExpr(p)).join(', ');
  return `${methName}(${args})`;
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