import type {
  ArrayLiteral,
  Assignment,
  AttSelection,
  Block,
  CallCommand,
  DoWhileLoop,
  Expr,
  ExprStatement,
  ForLoop,
  FunctionCall,
  FunctionDeclaration,
  IfStatement,
  Instruction,
  MethSelection,
  ParameterDecl,
  PrintCommand,
  Program,
  ReturnStmt,
  StructDeclaration,
  ThrowCommand,
  VarDecl,
  VarRef,
  WhileLoop
} from './generated/ast.js';
import {
  isAddition,
  isAnd,
  isArrayLiteral,
  isAssignment,
  isAttSelection,
  isBoolLiteral,
  isBracedBlock,
  isCallCommand,
  isComparison,
  isDoWhileLoop,
  isEquality,
  isExponentiation,
  isExprStatement,
  isForLoop,
  isFunctionCall,
  isFunctionDeclaration,
  isGrouping,
  isIfStatement,
  isIndentedBlock,
  isIntLiteral,
  isMethSelection,
  isMultiplication,
  isNeg,
  isNewExpr,
  isNot,
  isNullLiteral,
  isOr,
  isPrintCommand,
  isReturnStmt,
  isStringLiteral,
  isStructAttDeclaration,
  isStructDeclaration,
  isThisExpr,
  isThrowCommand,
  isVarDecl,
  isVarRef,
  isWhileLoop
} from './generated/ast.js';
import { Pseudo2GeneratorContext } from './generator-context.js';

export function generateProgram(program: Program, context = Pseudo2GeneratorContext.fromProgram(program)): string {
  return program.instructions
    .map(instruction => generateInstruction(instruction, context))
    .filter(Boolean)
    .join('\n\n');
}

function pseudoArray(sizeExpr: string, initExpr: string): string {
  return `(() => { const __a = Array((${sizeExpr}) + 1).fill(${initExpr}); __a[0] = undefined; return __a; })()`;
}

function pseudoArrayLiteral(elems: string[]): string {
  return elems.length > 0 ? `[undefined, ${elems.join(', ')}]` : `[undefined]`;
}

function buildExpandedCall(
  callee: string,
  formals: ParameterDecl[] | undefined,
  actuals: Expr[] | undefined,
  context: Pseudo2GeneratorContext
): string {
  const params = formals ?? [];
  const args = actuals ?? [];

  if (!params.some(p => p.isArray && p.len)) {
    const plainArgs = args.map(a => genExpr(a, context)).join(', ');
    return `${callee}(${plainArgs})`;
  }

  const tempNames = args.map(() => context.getAnonymousVarName('__arg'));
  const tempValues = args.map(a => genExpr(a, context));
  const expandedArgs: string[] = [];

  for (let i = 0; i < params.length; i++) {
    const formal = params[i];
    const temp = tempNames[i] ?? 'undefined';

    expandedArgs.push(temp);

    if (formal.isArray && formal.len) {
      expandedArgs.push(`${temp}.length - 1`);
    }
  }

  return `((${tempNames.join(', ')}) => ${callee}(${expandedArgs.join(', ')}))(${tempValues.join(', ')})`;
}

function generateInstruction(instruction: Instruction, context: Pseudo2GeneratorContext, indent = ''): string {
  if (isBracedBlock(instruction) || isIndentedBlock(instruction)) {
    return generateBlock(instruction, context, indent);
  }

  if (isIfStatement(instruction)) return generateIfStatement(instruction, context, indent);
  if (isWhileLoop(instruction)) return generateWhileLoop(instruction, context, indent);
  if (isForLoop(instruction)) return generateForLoop(instruction, context, indent);
  if (isDoWhileLoop(instruction)) return generateDoWhileLoop(instruction, context, indent);
  if (isStructDeclaration(instruction)) return generateStructDeclaration(instruction, context, indent);
  if (isFunctionDeclaration(instruction)) return generateFunctionDeclaration(instruction, context, indent);
  if (isVarDecl(instruction)) return generateVarDecl(instruction, context, indent);
  if (isAssignment(instruction)) return generateAssignment(instruction, context, indent);
  if (isFunctionCall(instruction)) return generateFunctionCall(instruction, context, indent);
  if (isReturnStmt(instruction)) return generateReturnStatement(instruction, context, indent);
  if (isExprStatement(instruction)) return generateExprStatement(instruction, context, indent);
  if (isPrintCommand(instruction)) return generatePrintCommand(instruction, context, indent);
  if (isThrowCommand(instruction)) return generateThrowCommand(instruction, context, indent);
  if (isCallCommand(instruction)) return generateCallCommand(instruction, context, indent);

  return `${indent}// TODO: instruction`;
}

function generateBlock(block: Block, context: Pseudo2GeneratorContext, indent = ''): string {
  const body = block.instructions ?? [];

  if (body.length === 0) {
    return `${indent}{}`;
  }

  const inner = `${indent}  `;
  const nested = body
    .map(instruction => generateInstruction(instruction, context, inner))
    .filter(Boolean)
    .join('\n');

  return `${indent}{\n${nested}\n${indent}}`;
}

function generateIfStatement(ifStatement: IfStatement, context: Pseudo2GeneratorContext, indent = ''): string {
  const condition = genExpr(ifStatement.condition, context);
  const thenBlock = generateBlock(ifStatement.thenBlock, context, indent);
  const elsePart = ifStatement.elseBlock
    ? `\n${indent}else ${generateBlock(ifStatement.elseBlock, context, indent)}`
    : '';

  return `${indent}if (${condition}) ${thenBlock}${elsePart}`;
}

function generateWhileLoop(loop: WhileLoop, context: Pseudo2GeneratorContext, indent = ''): string {
  const condition = genExpr(loop.condition, context);
  const body = generateBlock(loop.body, context, indent);
  return `${indent}while (${condition}) ${body}`;
}

function generateForLoop(loop: ForLoop, context: Pseudo2GeneratorContext, indent = ''): string {
  const from = genExpr(loop.from, context);
  const to = genExpr(loop.to, context);
  const step = loop.step ? genExpr(loop.step, context) : '1';
  const body = generateBlock(loop.body, context, indent);
  const iterName = loop.iterator ? context.getVarName(loop.iterator) : context.getAnonymousVarName('__for');

  if (loop.direction === 'to') {
    return `${indent}for (let ${iterName} = ${from}; ${iterName} <= ${to}; ${iterName} += ${step}) ${body}`;
  }
  return `${indent}for (let ${iterName} = ${from}; ${iterName} >= ${to}; ${iterName} -= ${step}) ${body}`;
}

function generateDoWhileLoop(loop: DoWhileLoop, context: Pseudo2GeneratorContext, indent = ''): string {
  const body = generateBlock(loop.body, context, indent);
  const condition = genExpr(loop.condition, context);
  return `${indent}do ${body} while (${condition});`;
}

function generateStructDeclaration(
  structDecl: StructDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const attributes = (structDecl.children ?? []).filter(isStructAttDeclaration);
  const methods = (structDecl.children ?? [])
    .filter(isFunctionDeclaration)
    .filter(isMethodDecl);

  const ctorLines = attributes
    .map(att => `${indent}    this.${context.getVarName(att)} = null;`)
    .join('\n');
  const ctor = attributes.length > 0
    ? `${indent}  constructor() {\n${ctorLines}\n${indent}  }`
    : `${indent}  constructor() {}`;
  const methodText = methods
    .map(m => generateMethodDeclaration(m, context, `${indent}  `))
    .join('\n\n');
  const body = methodText ? `${ctor}\n\n${methodText}` : ctor;

  return `${indent}class ${structDecl.name} {\n${body}\n${indent}}`;
}

function isMethodDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword !== true;
}

function generateMethodDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = collectJsParams(fn, context).join(', ');
  const body = generateBlock(fn.body, context, indent);
  return `${indent}${context.getFunctionName(fn)}(${params}) ${body}`;
}

function generateFunctionDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = collectJsParams(fn, context).join(', ');
  const body = generateBlock(fn.body, context, indent);
  return `${indent}function ${context.getFunctionName(fn)}(${params}) ${body}`;
}

function collectJsParams(fn: FunctionDeclaration, context: Pseudo2GeneratorContext): string[] {
  const out: string[] = [];

  for (const p of fn.params ?? []) {
    out.push(context.getVarName(p));
    if (p.isArray && p.len) {
      out.push(context.getVarName(p.len));
    }
  }

  return out;
}

function generateFunctionCall(call: FunctionCall, context: Pseudo2GeneratorContext, indent = ''): string {
  const target = call.f?.ref;
  const fnName = target ? context.getFunctionName(target) : '/*unresolved*/';
  return `${indent}${buildExpandedCall(fnName, target?.params, call.params ?? [], context)};`;
}

function generateReturnStatement(ret: ReturnStmt, context: Pseudo2GeneratorContext, indent = ''): string {
  if (ret.retExpr) {
    return `${indent}return ${genExpr(ret.retExpr, context)};`;
  }
  return `${indent}return;`;
}

function generateExprStatement(stmt: ExprStatement, context: Pseudo2GeneratorContext, indent = ''): string {
  return `${indent}${genExpr(stmt.expr, context)};`;
}

function generatePrintCommand(cmd: PrintCommand, context: Pseudo2GeneratorContext, indent = ''): string {
  return `${indent}console.log(${genExpr(cmd.param, context)});`;
}

function generateThrowCommand(cmd: ThrowCommand, context: Pseudo2GeneratorContext, indent = ''): string {
  return `${indent}throw ${genExpr(cmd.param, context)};`;
}

function generateCallCommand(cmd: CallCommand, context: Pseudo2GeneratorContext, indent = ''): string {
  return `${indent}${genExpr(cmd.param, context)};`;
}

function generateVarDecl(decl: VarDecl, context: Pseudo2GeneratorContext, indent = ''): string {
  const name = context.getVarName(decl);

  if (decl.isArrayVariable) {
    const sizeExpr = decl.size ? genExpr(decl.size, context) : '0';
    const initExpr = decl.initializer ? genExpr(decl.initializer, context) : 'null';
    return `${indent}let ${name} = ${pseudoArray(sizeExpr, initExpr)};`;
  }

  if (decl.initializer) {
    return `${indent}let ${name} = ${genExpr(decl.initializer, context)};`;
  }

  return `${indent}let ${name};`;
}

function generateAssignment(assign: Assignment, context: Pseudo2GeneratorContext, indent = ''): string {
  const left = genExpr(assign.sel as Expr, context);
  return `${indent}${left} = ${genExpr(assign.value, context)};`;
}

function genExpr(expr: Expr, context: Pseudo2GeneratorContext): string {
  if (isIntLiteral(expr)) return String(expr.value);
  if (isBoolLiteral(expr)) return String(expr.value);
  if (isStringLiteral(expr)) return JSON.stringify(expr.value);
  if (isNullLiteral(expr)) return 'null';
  if (isArrayLiteral(expr)) return genArrayLiteral(expr, context);

  if (isNewExpr(expr)) {
    const typeName = expr.type?.ref?.name ?? '/*unresolved*/';
    return `new ${typeName}()`;
  }

  if (isThisExpr(expr)) return 'this';
  if (isVarRef(expr)) return genVarRef(expr, context);
  if (isAttSelection(expr)) return `${genExpr(expr.receiver, context)}.${genAttRefName(expr, context)}`;
  if (isMethSelection(expr)) return genMethSelectionCall(expr, context);
  if (isGrouping(expr)) return `(${genExpr(expr.value, context)})`;
  if (isNot(expr)) return `(!${genExpr(expr.value, context)})`;
  if (isNeg(expr)) return `(-${genExpr(expr.value, context)})`;

  if (isOr(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context)
      : genChain(genExpr(expr.left, context), '||', expr.right, context);
  }

  if (isAnd(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context)
      : genChain(genExpr(expr.left, context), '&&', expr.right, context);
  }

  if (isEquality(expr) || isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context)
      : genOpChain(genExpr(expr.left, context), expr.op ?? [], expr.right ?? [], context);
  }

  if (isFunctionCall(expr)) {
    const target = expr.f?.ref;
    const fnName = target ? context.getFunctionName(target) : '/*unresolved*/';
    return buildExpandedCall(fnName, target?.params, expr.params ?? [], context);
  }

  return '/*expr*/';
}

function genMethSelectionCall(expr: MethSelection, context: Pseudo2GeneratorContext): string {
  const receiver = genExpr(expr.receiver, context);
  const target = expr.methref.f?.ref;
  const methName = target ? context.getFunctionName(target) : '/*unresolved*/';
  return buildExpandedCall(`${receiver}.${methName}`, target?.params, expr.methref.params ?? [], context);
}

function genArrayLiteral(expr: ArrayLiteral, context: Pseudo2GeneratorContext): string {
  const elems = (expr.elems ?? []).map(elem => genExpr(elem, context));
  return pseudoArrayLiteral(elems);
}

function genVarRef(expr: VarRef, context: Pseudo2GeneratorContext): string {
  const target = expr.ref?.ref;
  const name = target ? context.getVarName(target) : '/*unresolved*/';

  if (target && isStructAttDeclaration(target)) {
    if (expr.index) {
      return `this.${name}[${genExpr(expr.index, context)}]`;
    }
    return `this.${name}`;
  }

  if (expr.index) {
    return `${name}[${genExpr(expr.index, context)}]`;
  }

  return name;
}

function genAttRefName(expr: AttSelection, context: Pseudo2GeneratorContext): string {
  const target = expr.attref.ref?.ref;
  const attName = target ? context.getVarName(target) : '/*unresolved*/';

  if (expr.attref.index) {
    return `${attName}[${genExpr(expr.attref.index, context)}]`;
  }
  return attName;
}

function genChain(left: string, op: string, rights: Expr[], context: Pseudo2GeneratorContext): string {
  let out = `(${left}`;
  for (const right of rights) {
    out += ` ${op} ${genExpr(right, context)}`;
  }
  return `${out})`;
}

function genOpChain(left: string, ops: string[], rights: Expr[], context: Pseudo2GeneratorContext): string {
  let out = `(${left}`;
  for (let i = 0; i < rights.length; i++) {
    const rawOp = ops[i] ?? '?';
    const op = rawOp === 'mod' ? '%' : rawOp === '^' ? '**' : rawOp;
    out += ` ${op} ${genExpr(rights[i], context)}`;
  }
  return `${out})`;
}
