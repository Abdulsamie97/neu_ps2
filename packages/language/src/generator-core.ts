import { AstUtils } from 'langium';
import type { AstNode } from 'langium';
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
  StructAttDeclaration,
  StructDeclaration,
  ThrowCommand,
  VarDecl,
  VarRef,
  Variable,
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
  isParameterDecl,
  isPrintCommand,
  isResultExpr,
  isReturnStmt,
  isStringLiteral,
  isStructAttDeclaration,
  isStructDeclaration,
  isThisExpr,
  isThrowCommand,
  isVarDecl,
  isVarRef,
  isVerificationStatement,
  isWhileLoop
} from './generated/ast.js';
import { Pseudo2GeneratorContext } from './generator-context.js';
import { Pseudo2TypeComputer } from './typing/pseudo2-type-computer.js';
import type { Pseudo2Type } from './typing/pseudo2-type.js';
import { PSEUDO2_RUNTIME_PRELUDE } from './runtime/runtime-prelude.js';

type GeneratorState = {
  thisName: string;
};

type RuntimeKind = 'array' | 'scalar' | 'struct';

const DEFAULT_STATE: GeneratorState = { thisName: 'this' };
const METHOD_THIS_NAME = 'mythis';
const TYPES = new Pseudo2TypeComputer();
export function generateProgram(program: Program, context = Pseudo2GeneratorContext.fromProgram(program)): string {
  const declarations = program.instructions.filter(isTopLevelDeclaration);
  const statements = program.instructions.filter(instruction => !isTopLevelDeclaration(instruction));
  const body = [...declarations, ...statements]
    .map(instruction => generateInstruction(instruction, context, '', DEFAULT_STATE))
    .filter(Boolean)
    .join('\n\n');

  return [PSEUDO2_RUNTIME_PRELUDE, body].filter(Boolean).join('\n\n');
}

function isTopLevelDeclaration(instruction: Instruction): boolean {
  return isStructDeclaration(instruction) || isFunctionDeclaration(instruction);
}

function buildExpandedCall(
  callee: string,
  formals: ParameterDecl[] | undefined,
  actuals: Expr[] | undefined,
  context: Pseudo2GeneratorContext,
  state: GeneratorState,
  leadingArgs: string[] = []
): string {
  const params = formals ?? [];
  const args = actuals ?? [];

  if (!params.some(p => p.isArray && p.len)) {
    const plainArgs = args.map(a => genExpr(a, context, state));
    return `${callee}(${[...leadingArgs, ...plainArgs].join(', ')})`;
  }

  const tempNames = args.map(() => context.getAnonymousVarName('__arg'));
  const tempValues = args.map(a => genExpr(a, context, state));
  const expandedArgs: string[] = [...leadingArgs];

  for (let i = 0; i < params.length; i++) {
    const formal = params[i];
    const temp = tempNames[i] ?? 'undefined';

    expandedArgs.push(temp);

    if (formal.isArray && formal.len) {
      expandedArgs.push(`__ps2_arrayLength(${temp})`);
    }
  }

  return `((${tempNames.join(', ')}) => ${callee}(${expandedArgs.join(', ')}))(${tempValues.join(', ')})`;
}

function generateInstruction(
  instruction: Instruction,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  if (isBracedBlock(instruction) || isIndentedBlock(instruction)) {
    return generateBlock(instruction, context, indent, state);
  }

  if (isIfStatement(instruction)) return generateIfStatement(instruction, context, indent, state);
  if (isWhileLoop(instruction)) return generateWhileLoop(instruction, context, indent, state);
  if (isForLoop(instruction)) return generateForLoop(instruction, context, indent, state);
  if (isDoWhileLoop(instruction)) return generateDoWhileLoop(instruction, context, indent, state);
  if (isStructDeclaration(instruction)) return generateStructDeclaration(instruction, context, indent);
  if (isFunctionDeclaration(instruction)) return generateFunctionDeclaration(instruction, context, indent);
  if (isVarDecl(instruction)) return generateVarDecl(instruction, context, indent, state);
  if (isAssignment(instruction)) return generateAssignment(instruction, context, indent, state);
  if (isFunctionCall(instruction)) return generateFunctionCall(instruction, context, indent, state);
  if (isReturnStmt(instruction)) return generateReturnStatement(instruction, context, indent, state);
  if (isExprStatement(instruction)) return generateExprStatement(instruction, context, indent, state);
  if (isPrintCommand(instruction)) return generatePrintCommand(instruction, context, indent, state);
  if (isThrowCommand(instruction)) return generateThrowCommand(instruction, context, indent, state);
  if (isCallCommand(instruction)) return generateCallCommand(instruction, context, indent, state);
  if (isVerificationStatement(instruction)) return '';

  throw new Error(`Unsupported instruction type: ${(instruction as AstNode).$type}`);
}

function generateBlock(block: Block, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const body = block.instructions ?? [];

  if (body.length === 0) {
    return `${indent}{}`;
  }

  const inner = `${indent}  `;
  const nested = body
    .map(instruction => generateInstruction(instruction, context, inner, state))
    .filter(Boolean)
    .join('\n');

  return `${indent}{\n${nested}\n${indent}}`;
}

function generateIfStatement(
  ifStatement: IfStatement,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const condition = genExpr(ifStatement.condition, context, state);
  const thenBlock = generateBlock(ifStatement.thenBlock, context, indent, state);
  const elsePart = ifStatement.elseBlock
    ? `\n${indent}else ${generateBlock(ifStatement.elseBlock, context, indent, state)}`
    : '';

  return `${indent}if (${condition}) ${thenBlock}${elsePart}`;
}

function generateWhileLoop(
  loop: WhileLoop,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const condition = genExpr(loop.condition, context, state);
  const body = generateBlock(loop.body, context, indent, state);
  return `${indent}while (${condition}) ${body}`;
}

function generateForLoop(loop: ForLoop, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const from = genExpr(loop.from, context, state);
  const to = genExpr(loop.to, context, state);
  const step = loop.step ? genExpr(loop.step, context, state) : '1';
  const body = generateBlock(loop.body, context, indent, state);
  const iterName = loop.iterator ? context.getVarName(loop.iterator) : context.getAnonymousVarName('__for');
  const endName = context.getAnonymousVarName('__forEnd');
  const stepName = context.getAnonymousVarName('__forStep');
  const directionOp = loop.direction === 'to' ? '<=' : '>=';
  const stepOp = loop.direction === 'to' ? '+' : '-';

  return [
    `${indent}let ${iterName} = new ObservableScalar(${from});`,
    `${indent}let ${endName} = new ObservableScalar(${to});`,
    `${indent}let ${stepName} = new ObservableScalar(${step});`,
    `${indent}if (${stepName}.get() <= 0) {`,
    `${indent}  throw new Error("Invoked for-loop with negative step-size " + ${stepName}.get());`,
    `${indent}}`,
    `${indent}for (${iterName}.get(); ${iterName}.get() ${directionOp} ${endName}.get(); ${iterName}.set(${iterName}.get() ${stepOp} ${stepName}.get())) ${body}`
  ].join('\n');
}

function generateDoWhileLoop(
  loop: DoWhileLoop,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const body = generateBlock(loop.body, context, indent, state);
  const condition = genExpr(loop.condition, context, state);
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

  const factoryName = context.getStructFactoryName(structDecl);
  const fields = attributes
    .map((att, index) => {
      const comma = index < attributes.length - 1 ? ',' : '';
      return `${indent}    ${context.getVarName(att)}: undefined${comma}`;
    })
    .join('\n');
  const factory = attributes.length > 0
    ? `${indent}function ${factoryName}() {\n${indent}  return __ps2_struct({\n${fields}\n${indent}  });\n${indent}}`
    : `${indent}function ${factoryName}() {\n${indent}  return __ps2_struct({});\n${indent}}`;
  const methodText = methods
    .map(m => generateMethodDeclaration(m, context, indent))
    .join('\n\n');

  return methodText ? `${factory}\n\n${methodText}` : factory;
}

function isMethodDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword !== true;
}

function generateMethodDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = [METHOD_THIS_NAME, ...collectJsParams(fn, context)].join(', ');
  const body = generateFunctionBody(fn, context, indent, { thisName: METHOD_THIS_NAME });
  return `${indent}function ${context.getFunctionName(fn)}(${params}) ${body}`;
}

function generateFunctionDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = collectJsParams(fn, context).join(', ');
  const body = generateFunctionBody(fn, context, indent, DEFAULT_STATE);
  return `${indent}function ${context.getFunctionName(fn)}(${params}) ${body}`;
}

function generateFunctionBody(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const body = fn.body.instructions ?? [];
  const inner = `${indent}  `;
  const prefix = generateParameterPrelude(fn, context, inner);
  const nested = [
    ...prefix,
    ...body.map(instruction => generateInstruction(instruction, context, inner, state))
  ].filter(Boolean);

  if (nested.length === 0) {
    return `${indent}{}`;
  }

  return `${indent}{\n${nested.join('\n')}\n${indent}}`;
}

function generateParameterPrelude(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string[] {
  const out: string[] = [];

  for (const p of fn.params ?? []) {
    const paramName = context.getVarName(p);

    if (p.isArray) {
      out.push(`${indent}${paramName} = new ObservableArray(${paramName});`);
      if (p.len) {
        out.push(`${indent}${context.getVarName(p.len)} = new ObservableScalar(__ps2_arrayLength(${paramName}));`);
      }
      continue;
    }

    out.push(`${indent}${paramName} = __ps2_wrapValue(${paramName}, ${JSON.stringify(runtimeKindForParameter(p))});`);
  }

  return out;
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

function generateFunctionCall(
  call: FunctionCall,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const target = call.f?.ref;
  const fnName = target ? context.getFunctionName(target) : '/*unresolved*/';
  return `${indent}${buildExpandedCall(fnName, target?.params, call.params ?? [], context, state)};`;
}

function generateReturnStatement(
  ret: ReturnStmt,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  if (ret.retExpr) {
    return `${indent}return ${genExpr(ret.retExpr, context, state)};`;
  }
  return `${indent}return;`;
}

function generateExprStatement(
  stmt: ExprStatement,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}${genExpr(stmt.expr, context, state)};`;
}

function generatePrintCommand(
  cmd: PrintCommand,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}console.log(${genExpr(cmd.param, context, state)});`;
}

function generateThrowCommand(
  cmd: ThrowCommand,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}throw ${genExpr(cmd.param, context, state)};`;
}

function generateCallCommand(
  cmd: CallCommand,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}${genExpr(cmd.param, context, state)};`;
}

function generateVarDecl(decl: VarDecl, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const name = context.getVarName(decl);

  if (decl.isArrayVariable) {
    const sizeExpr = decl.size ? genExpr(decl.size, context, state) : '0';
    const initExpr = decl.initializer ? genExpr(decl.initializer, context, state) : 'null';
    return `${indent}let ${name} = __ps2_array((${sizeExpr}), () => ${initExpr});`;
  }

  if (decl.initializer) {
    return `${indent}let ${name} = __ps2_wrapValue(${genExpr(decl.initializer, context, state)}, ${JSON.stringify(runtimeKindForExpr(decl.initializer))});`;
  }

  return `${indent}let ${name} = __ps2_wrapValue(null, "scalar");`;
}

function generateAssignment(
  assign: Assignment,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}${genAssignmentTarget(assign.sel as Expr, genExpr(assign.value, context, state), context, state)};`;
}

function genExpr(expr: Expr, context: Pseudo2GeneratorContext, state = DEFAULT_STATE): string {
  if (isIntLiteral(expr)) return String(expr.value);
  if (isBoolLiteral(expr)) return String(expr.value);
  if (isStringLiteral(expr)) return JSON.stringify(expr.value);
  if (isNullLiteral(expr)) return 'null';
  if (isResultExpr(expr)) throw new Error('result is only supported inside VeriFast annotations.');
  if (isArrayLiteral(expr)) return genArrayLiteral(expr, context, state);

  if (isNewExpr(expr)) {
    const type = expr.type?.ref;
    return type ? `__ps2_newStruct(${context.getStructFactoryName(type)})` : '/*unresolved*/';
  }

  if (isThisExpr(expr)) return state.thisName;
  if (isVarRef(expr)) return genVarRef(expr, context, state);
  if (isAttSelection(expr)) return genAttSelection(expr, context, state);
  if (isMethSelection(expr)) return genMethSelectionCall(expr, context, state);
  if (isGrouping(expr)) return `(${genExpr(expr.value, context, state)})`;
  if (isNot(expr)) return `(!${genExpr(expr.value, context, state)})`;
  if (isNeg(expr)) return `(-${genExpr(expr.value, context, state)})`;

  if (isOr(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genChain(genExpr(expr.left, context, state), '||', expr.right, context, state);
  }

  if (isAnd(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genChain(genExpr(expr.left, context, state), '&&', expr.right, context, state);
  }

  if (isEquality(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genEqualityChain(expr.left, expr.op ?? [], expr.right ?? [], context, state);
  }

  if (isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genOpChain(genExpr(expr.left, context, state), expr.op ?? [], expr.right ?? [], context, state);
  }

  if (isFunctionCall(expr)) {
    const target = expr.f?.ref;
    const fnName = target ? context.getFunctionName(target) : '/*unresolved*/';
    return buildExpandedCall(fnName, target?.params, expr.params ?? [], context, state);
  }

  return '/*expr*/';
}

function genMethSelectionCall(expr: MethSelection, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const receiver = genExpr(expr.receiver, context, state);
  const target = expr.methref.f?.ref;
  const methName = target ? context.getFunctionName(target) : '/*unresolved*/';
  return buildExpandedCall(methName, target?.params, expr.methref.params ?? [], context, state, [receiver]);
}

function genArrayLiteral(expr: ArrayLiteral, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const elems = (expr.elems ?? []).map(elem => genExpr(elem, context, state));
  return `__ps2_arrayLiteral([${elems.join(', ')}])`;
}

function genVarRef(expr: VarRef, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const target = expr.ref?.ref;
  const name = target ? context.getVarName(target) : '/*unresolved*/';

  if (target && isStructAttDeclaration(target)) {
    if (expr.index) {
      return genArrayGet(genStructGet(state.thisName, name), expr.index, context, state);
    }
    return genStructGet(state.thisName, name);
  }

  if (expr.index) {
    return genArrayGet(name, expr.index, context, state);
  }

  return `${name}.get()`;
}

function genAttSelection(expr: AttSelection, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const receiver = genExpr(expr.receiver, context, state);
  const target = expr.attref.ref?.ref;
  const attName = target ? context.getVarName(target) : '/*unresolved*/';
  const attribute = genStructGet(receiver, attName);

  if (expr.attref.index) {
    return genArrayGet(attribute, expr.attref.index, context, state);
  }
  return attribute;
}

function genAssignmentTarget(
  target: Expr,
  value: string,
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  if (isVarRef(target)) {
    const decl = target.ref?.ref;
    const name = decl ? context.getVarName(decl) : '/*unresolved*/';

    if (decl && isStructAttDeclaration(decl)) {
      if (target.index) {
        return genArraySet(genStructGet(state.thisName, name), target.index, value, context, state);
      }
      return genStructSet(state.thisName, name, value, runtimeKindForStructAtt(decl));
    }

    if (target.index) {
      return genArraySet(name, target.index, value, context, state);
    }

    return genVariableSet(name, value, runtimeKindForVariable(decl));
  }

  if (isAttSelection(target)) {
    const receiver = genExpr(target.receiver, context, state);
    const decl = target.attref.ref?.ref;
    const attName = decl ? context.getVarName(decl) : '/*unresolved*/';

    if (target.attref.index) {
      return genArraySet(genStructGet(receiver, attName), target.attref.index, value, context, state);
    }
    return genStructSet(receiver, attName, value, decl ? runtimeKindForStructAtt(decl) : 'scalar');
  }

  return `${genExpr(target, context, state)} = ${value}`;
}

function genArrayGet(
  array: string,
  index: Expr,
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  return `__ps2_arrayGet(${array}, ${genExpr(index, context, state)})`;
}

function genArraySet(
  array: string,
  index: Expr,
  value: string,
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  return `__ps2_arraySet(${array}, ${genExpr(index, context, state)}, ${value})`;
}

function genStructGet(receiver: string, field: string): string {
  return `__ps2_structGet(${receiver}, ${JSON.stringify(field)})`;
}

function genStructSet(receiver: string, field: string, value: string, kind: RuntimeKind): string {
  return `__ps2_structSet(${receiver}, ${JSON.stringify(field)}, ${value}, ${JSON.stringify(kind)})`;
}

function genVariableSet(name: string, value: string, kind: RuntimeKind): string {
  if (kind === 'struct') {
    return `${name} = __ps2_wrapValue(${value}, "struct")`;
  }

  return `${name}.set(${value})`;
}

function genEqualityChain(
  left: Expr,
  ops: string[],
  rights: Expr[],
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  let out = `(${genEqualityArg(left, context, state)}`;

  for (let i = 0; i < rights.length; i++) {
    const op = ops[i] === '!=' ? '!==' : '===';
    out += ` ${op} ${genEqualityArg(rights[i], context, state)}`;
  }

  return `${out})`;
}

function genEqualityArg(expr: Expr, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const value = genExpr(expr, context, state);
  const type = TYPES.typeFor(expr);

  if (type.isStructType() && !type.isPartiallyUnknown()) {
    return `__ps2_structRef(${value})`;
  }

  return value;
}

function runtimeKindForExpr(expr: Expr): RuntimeKind {
  return runtimeKindForType(TYPES.typeFor(expr));
}

function runtimeKindForStructAtt(att: StructAttDeclaration): RuntimeKind {
  return runtimeKindForType(TYPES.typeForTypeRef(att.type));
}

function runtimeKindForVariable(variable: Variable | undefined): RuntimeKind {
  if (!variable) {
    return 'scalar';
  }

  if (isStructAttDeclaration(variable)) {
    return runtimeKindForStructAtt(variable);
  }

  if (isParameterDecl(variable)) {
    return runtimeKindForParameter(variable);
  }

  if (isVarDecl(variable)) {
    if (isLengthParameterDecl(variable)) {
      return 'scalar';
    }

    if (variable.isArrayVariable) {
      return 'array';
    }

    if (variable.initializer) {
      return runtimeKindForExpr(variable.initializer);
    }
  }

  return 'scalar';
}

function runtimeKindForParameter(param: ParameterDecl): RuntimeKind {
  if (param.isArray) {
    return 'array';
  }

  const fn = param.$container;
  const idx = (fn.params ?? []).indexOf(param);
  if (idx < 0) {
    return 'scalar';
  }

  const root = AstUtils.getDocument(fn).parseResult.value;
  const owningStruct = AstUtils.getContainerOfType(fn, isStructDeclaration);

  for (const node of AstUtils.streamAllContents(root)) {
    const arg = owningStruct
      ? isMethSelection(node) && node.methref.f?.ref === fn && !isInsideFunction(node, fn)
        ? (node.methref.params ?? [])[idx]
        : undefined
      : isFunctionCall(node) && node.f?.ref === fn && !isInsideFunction(node, fn)
        ? (node.params ?? [])[idx]
        : undefined;

    if (!arg) {
      continue;
    }

    const kind = runtimeKindForExpr(arg);
    if (kind !== 'scalar') {
      return kind;
    }
  }

  return 'scalar';
}

function runtimeKindForType(type: Pseudo2Type): RuntimeKind {
  if (type.isArrayType()) {
    return 'array';
  }

  if (type.isStructType()) {
    return 'struct';
  }

  return 'scalar';
}

function isLengthParameterDecl(variable: VarDecl): boolean {
  const parent = variable.$container;
  return isParameterDecl(parent) && parent.len === variable;
}

function isInsideFunction(node: AstNode, fn: FunctionDeclaration): boolean {
  let current = node.$container;

  while (current) {
    if (current === fn) {
      return true;
    }
    current = current.$container;
  }

  return false;
}

function genChain(
  left: string,
  op: string,
  rights: Expr[],
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  let out = `(${left}`;
  for (const right of rights) {
    out += ` ${op} ${genExpr(right, context, state)}`;
  }
  return `${out})`;
}

function genOpChain(
  left: string,
  ops: string[],
  rights: Expr[],
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  let out = `(${left}`;
  for (let i = 0; i < rights.length; i++) {
    const rawOp = ops[i] ?? '?';
    const op = rawOp === 'mod' ? '%' : rawOp === '^' ? '**' : rawOp;
    out += ` ${op} ${genExpr(rights[i], context, state)}`;
  }
  return `${out})`;
}
