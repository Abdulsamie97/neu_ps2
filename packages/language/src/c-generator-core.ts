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
  VerificationAnnotation,
  VerificationStatement,
  VarDecl,
  VarRef
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
  isVerificationStatement,
  isWhileLoop
} from './generated/ast.js';
import { Pseudo2GeneratorContext } from './generator-context.js';

type CGeneratorState = {
  thisName: string;
  topLevel: boolean;
};

const DEFAULT_STATE: CGeneratorState = { thisName: 'this', topLevel: false };
const METHOD_THIS_NAME = 'mythis';

export type GenerateCProgramOptions = {
  runtime?: 'contracts' | 'implementation';
};

export function generateCProgram(
  program: Program,
  context = Pseudo2GeneratorContext.fromProgram(program),
  options: GenerateCProgramOptions = {}
): string {
  const runtimePrelude = options.runtime === 'implementation' ? C_RUNTIME_IMPLEMENTATION : C_RUNTIME_PRELUDE;
  const declarations = program.instructions.filter(isTopLevelDeclaration);
  const globalVariables = program.instructions.filter(isVarDecl);
  const statements = program.instructions.filter(instruction => !isTopLevelDeclaration(instruction) && !isVarDecl(instruction));

  const prototypes = [
    ...declarations.flatMap(declaration => generatePrototype(declaration, context))
  ].join('\n');
  const globals = globalVariables
    .map(variable => `static Ps2Value* ${context.getVarName(variable)};`)
    .join('\n');
  const definitions = declarations
    .map(declaration => generateInstruction(declaration, context, '', DEFAULT_STATE))
    .filter(Boolean)
    .join('\n\n');
  const mainBody = [
    ...globalVariables.map(variable => generateGlobalVarInit(variable, context, '  ')),
    ...statements.map(statement => generateInstruction(statement, context, '  ', { ...DEFAULT_STATE, topLevel: true }))
  ].filter(Boolean).join('\n');

  return [
    runtimePrelude,
    prototypes,
    globals,
    definitions,
    generateMain(mainBody)
  ].filter(Boolean).join('\n\n');
}

function isTopLevelDeclaration(instruction: Instruction): boolean {
  return isStructDeclaration(instruction) || isFunctionDeclaration(instruction);
}

function generatePrototype(instruction: Instruction, context: Pseudo2GeneratorContext): string[] {
  if (isFunctionDeclaration(instruction)) {
    return [`Ps2Value* ${context.getFunctionName(instruction)}(${collectCParams(instruction, context).join(', ')});`];
  }

  if (isStructDeclaration(instruction)) {
    const methods = (instruction.children ?? [])
      .filter(isFunctionDeclaration)
      .filter(isMethodDecl)
      .map(method => `Ps2Value* ${context.getFunctionName(method)}(${collectMethodCParams(method, context).join(', ')});`);
    return [
      `Ps2Value* ${context.getStructFactoryName(instruction)}(void);`,
      ...methods
    ];
  }

  return [];
}

function generateMain(body: string): string {
  return [
    'int main(void)',
    '//@ requires true;',
    '//@ ensures true;',
    '{',
    body,
    '  return 0;',
    '}'
  ].filter(line => line.length > 0).join('\n');
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
  if (isFunctionCall(instruction)) return `${indent}${genFunctionCall(instruction, context, state)};`;
  if (isReturnStmt(instruction)) return generateReturnStatement(instruction, context, indent, state);
  if (isExprStatement(instruction)) return generateExprStatement(instruction, context, indent, state);
  if (isPrintCommand(instruction)) return generatePrintCommand(instruction, context, indent, state);
  if (isThrowCommand(instruction)) return generateThrowCommand(instruction, context, indent, state);
  if (isCallCommand(instruction)) return generateCallCommand(instruction, context, indent, state);
  if (isVerificationStatement(instruction)) return generateVerificationStatement(instruction, context, indent, state);

  throw new Error(`Unsupported instruction type for C generator: ${(instruction as unknown as { $type: string }).$type}`);
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

  return `${indent}if (ps2_truthy(${condition})) ${thenBlock}${elsePart}`;
}

function generateWhileLoop(
  loop: Extract<Instruction, { $type: 'WhileLoop' }>,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const condition = genExpr(loop.condition, context, state);
  const body = generateBlock(loop.body, context, indent, state);
  return `${indent}while (ps2_truthy(${condition})) ${body}`;
}

function generateForLoop(loop: ForLoop, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const iterName = loop.iterator ? context.getVarName(loop.iterator) : context.getAnonymousVarName('__for');
  const endName = context.getAnonymousVarName('__forEnd');
  const stepName = context.getAnonymousVarName('__forStep');
  const from = genExpr(loop.from, context, state);
  const to = genExpr(loop.to, context, state);
  const step = loop.step ? genExpr(loop.step, context, state) : 'ps2_num(1)';
  const directionOp = loop.direction === 'to' ? '<=' : '>=';
  const stepOp = loop.direction === 'to' ? '+' : '-';
  const body = generateBlock(loop.body, context, indent, state);

  return [
    `${indent}Ps2Value* ${iterName} = ps2_copy_value(${from});`,
    `${indent}Ps2Value* ${endName} = ps2_copy_value(${to});`,
    `${indent}Ps2Value* ${stepName} = ps2_copy_value(${step});`,
    `${indent}if (ps2_as_num(${stepName}) <= 0) {`,
    `${indent}  ps2_throw(ps2_string("Invoked for-loop with negative step-size"));`,
    `${indent}}`,
    `${indent}for (; ps2_as_num(${iterName}) ${directionOp} ps2_as_num(${endName}); ${iterName} = ps2_num(ps2_as_num(${iterName}) ${stepOp} ps2_as_num(${stepName}))) ${body}`
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
  return `${indent}do ${body} while (ps2_truthy(${condition}));`;
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
  const defineLines = attributes.map((att, index) =>
    `${indent}  ps2_struct_define(__ps2_obj, ${index}, ${JSON.stringify(context.getVarName(att))}, ps2_undefined());`
  );
  const factory = [
    `${indent}Ps2Value* ${factoryName}(void)`,
    `${indent}//@ requires true;`,
    `${indent}//@ ensures true;`,
    `${indent}{`,
    `${indent}  Ps2Struct* __ps2_obj = ps2_struct_create(${attributes.length});`,
    ...defineLines,
    `${indent}  return ps2_struct_value(__ps2_obj);`,
    `${indent}}`
  ].join('\n');
  const methodText = methods
    .map(method => generateMethodDeclaration(method, context, indent))
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
  const params = collectMethodCParams(fn, context).join(', ');
  const body = generateFunctionBody(fn, context, indent, { thisName: METHOD_THIS_NAME, topLevel: false });
  return `${indent}Ps2Value* ${context.getFunctionName(fn)}(${params})\n${body}`;
}

function generateFunctionDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = collectCParams(fn, context).join(', ');
  const body = generateFunctionBody(fn, context, indent, DEFAULT_STATE);
  return `${indent}Ps2Value* ${context.getFunctionName(fn)}(${params})\n${body}`;
}

function generateFunctionBody(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const body = fn.body.instructions ?? [];
  const inner = `${indent}  `;
  const prelude = generateParameterPrelude(fn, context, inner);
  const contracts = generateFunctionContracts(fn, context, indent, state);
  const nested = [
    ...prelude,
    ...body.map(instruction => generateInstruction(instruction, context, inner, state)),
    ...(containsReturn(body) ? [] : [`${inner}return ps2_null();`])
  ].filter(Boolean);

  return [
    ...contracts,
    `${indent}{`,
    nested.join('\n'),
    `${indent}}`
  ].join('\n');
}

function generateFunctionContracts(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string[] {
  const annotations = fn.annotations ?? [];
  const requires = annotations.filter(annotation => annotation.kind === 'requires');
  const ensures = annotations.filter(annotation => annotation.kind === 'ensures');

  return [
    ...generateContractLines('requires', requires, context, indent, state),
    ...generateContractLines('ensures', ensures, context, indent, state)
  ];
}

function generateContractLines(
  kind: 'requires' | 'ensures',
  annotations: VerificationAnnotation[],
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): string[] {
  if (annotations.length === 0) {
    return [`${indent}//@ ${kind} true;`];
  }

  return annotations.map(annotation =>
    `${indent}//@ ${kind} ${genSpecExpr(annotation.condition, context, state)};`
  );
}

function containsReturn(instructions: Instruction[]): boolean {
  for (const instruction of instructions) {
    if (isReturnStmt(instruction)) {
      return true;
    }
    if ((isBracedBlock(instruction) || isIndentedBlock(instruction)) && containsReturn(instruction.instructions ?? [])) {
      return true;
    }
    if (isIfStatement(instruction)) {
      if (containsReturn(instruction.thenBlock.instructions ?? [])) {
        return true;
      }
      if (instruction.elseBlock && containsReturn(instruction.elseBlock.instructions ?? [])) {
        return true;
      }
    }
    if (isWhileLoop(instruction) && containsReturn(instruction.body.instructions ?? [])) {
      return true;
    }
    if (isForLoop(instruction) && containsReturn(instruction.body.instructions ?? [])) {
      return true;
    }
    if (isDoWhileLoop(instruction) && containsReturn(instruction.body.instructions ?? [])) {
      return true;
    }
  }
  return false;
}

function generateParameterPrelude(fn: FunctionDeclaration, context: Pseudo2GeneratorContext, indent = ''): string[] {
  const out: string[] = [];

  for (const param of fn.params ?? []) {
    const paramName = context.getVarName(param);
    out.push(`${indent}${paramName} = ps2_copy_value(${paramName});`);
    if (param.isArray && param.len) {
      const lenName = context.getVarName(param.len);
      out.push(`${indent}${lenName} = ps2_copy_value(${lenName});`);
    }
  }

  return out;
}

function collectMethodCParams(fn: FunctionDeclaration, context: Pseudo2GeneratorContext): string[] {
  return [`Ps2Value* ${METHOD_THIS_NAME}`, ...collectCParams(fn, context)];
}

function collectCParams(fn: FunctionDeclaration, context: Pseudo2GeneratorContext): string[] {
  const out: string[] = [];

  for (const param of fn.params ?? []) {
    out.push(`Ps2Value* ${context.getVarName(param)}`);
    if (param.isArray && param.len) {
      out.push(`Ps2Value* ${context.getVarName(param.len)}`);
    }
  }

  return out.length > 0 ? out : ['void'];
}

function buildExpandedCall(
  callee: string,
  formals: ParameterDecl[] | undefined,
  actuals: Expr[] | undefined,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState,
  leadingArgs: string[] = []
): string {
  const params = formals ?? [];
  const args = actuals ?? [];
  const expandedArgs = [...leadingArgs];

  for (let i = 0; i < params.length; i++) {
    const actual = args[i];
    const actualExpr = actual ? genExpr(actual, context, state) : 'ps2_null()';
    expandedArgs.push(actualExpr);

    if (params[i].isArray && params[i].len) {
      expandedArgs.push(`ps2_num((double)ps2_array_length(${actualExpr}))`);
    }
  }

  return `${callee}(${expandedArgs.join(', ')})`;
}

function generateGlobalVarInit(decl: VarDecl, context: Pseudo2GeneratorContext, indent = ''): string {
  return generateVarDecl(decl, context, indent, { ...DEFAULT_STATE, topLevel: true });
}

function generateVarDecl(decl: VarDecl, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const name = context.getVarName(decl);
  const prefix = state.topLevel ? '' : 'Ps2Value* ';

  if (decl.isArrayVariable) {
    const sizeExpr = decl.size ? genExpr(decl.size, context, state) : 'ps2_num(0)';
    const initExpr = decl.initializer ? genExpr(decl.initializer, context, state) : 'ps2_null()';
    const indexName = context.getAnonymousVarName('__arrInit');
    return [
      `${indent}${prefix}${name} = ps2_array_create(ps2_as_int(${sizeExpr}));`,
      `${indent}for (int ${indexName} = 0; ${indexName} < ps2_array_length(${name}); ${indexName}++) {`,
      `${indent}  ps2_array_set_zero_based(${name}, ${indexName}, ${initExpr});`,
      `${indent}}`
    ].join('\n');
  }

  const initializer = decl.initializer ? genExpr(decl.initializer, context, state) : 'ps2_null()';
  return `${indent}${prefix}${name} = ps2_copy_value(${initializer});`;
}

function generateAssignment(assign: Assignment, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  return `${indent}${genAssignmentTarget(assign.sel as Expr, genExpr(assign.value, context, state), context, state)};`;
}

function generateReturnStatement(ret: ReturnStmt, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  return ret.retExpr
    ? `${indent}return ps2_copy_value(${genExpr(ret.retExpr, context, state)});`
    : `${indent}return ps2_null();`;
}

function generateExprStatement(stmt: ExprStatement, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  return `${indent}${genExpr(stmt.expr, context, state)};`;
}

function generatePrintCommand(cmd: PrintCommand, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  return `${indent}ps2_print(${genExpr(cmd.param, context, state)});`;
}

function generateThrowCommand(cmd: ThrowCommand, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  return `${indent}ps2_throw(${genExpr(cmd.param, context, state)});`;
}

function generateCallCommand(cmd: CallCommand, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  return `${indent}${genExpr(cmd.param, context, state)};`;
}

function generateVerificationStatement(
  statement: VerificationStatement,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}//@ ${statement.kind} ${genSpecExpr(statement.condition, context, state)};`;
}

function genExpr(expr: Expr, context: Pseudo2GeneratorContext, state = DEFAULT_STATE): string {
  if (isIntLiteral(expr)) return `ps2_num(${expr.value})`;
  if (isBoolLiteral(expr)) return `ps2_bool(${expr.value === 'true' ? 1 : 0})`;
  if (isStringLiteral(expr)) return `ps2_string(${JSON.stringify(expr.value)})`;
  if (isNullLiteral(expr)) return 'ps2_null()';
  if (isArrayLiteral(expr)) return genArrayLiteral(expr, context, state);

  if (isNewExpr(expr)) {
    const type = expr.type?.ref;
    return type ? `${context.getStructFactoryName(type)}()` : 'ps2_null()';
  }

  if (isThisExpr(expr)) return state.thisName;
  if (isVarRef(expr)) return genVarRef(expr, context, state);
  if (isAttSelection(expr)) return genAttSelection(expr, context, state);
  if (isMethSelection(expr)) return genMethSelectionCall(expr, context, state);
  if (isGrouping(expr)) return genExpr(expr.value, context, state);
  if (isNot(expr)) return `ps2_bool(!ps2_truthy(${genExpr(expr.value, context, state)}))`;
  if (isNeg(expr)) return `ps2_num(-ps2_as_num(${genExpr(expr.value, context, state)}))`;

  if (isOr(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genBooleanChain(expr.left, '||', expr.right ?? [], context, state);
  }

  if (isAnd(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genBooleanChain(expr.left, '&&', expr.right ?? [], context, state);
  }

  if (isEquality(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genEqualityChain(expr.left, expr.op ?? [], expr.right ?? [], context, state);
  }

  if (isComparison(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genComparisonChain(expr.left, expr.op ?? [], expr.right ?? [], context, state);
  }

  if (isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
    return (expr.right?.length ?? 0) === 0
      ? genExpr(expr.left, context, state)
      : genOpChain(expr.left, expr.op ?? [], expr.right ?? [], context, state);
  }

  if (isFunctionCall(expr)) {
    return genFunctionCall(expr, context, state);
  }

  throw new Error(`Unsupported expression type for C generator: ${expr.$type}`);
}

function genSpecExpr(expr: Expr, context: Pseudo2GeneratorContext, state = DEFAULT_STATE): string {
  if (isStringLiteral(expr)) return expr.value;
  if (isIntLiteral(expr)) return String(expr.value);
  if (isBoolLiteral(expr)) return expr.value;
  if (isNullLiteral(expr)) return '0';
  if (isThisExpr(expr)) return state.thisName;
  if (isVarRef(expr)) {
    if (expr.index) {
      throw new Error('Array access in VeriFast annotations is not supported yet. Use a raw string annotation for C-specific specs.');
    }
    const target = expr.ref?.ref;
    return target ? context.getVarName(target) : '/* unresolved */';
  }
  if (isGrouping(expr)) return `(${genSpecExpr(expr.value, context, state)})`;
  if (isNot(expr)) return `(!${genSpecExpr(expr.value, context, state)})`;
  if (isNeg(expr)) return `(-${genSpecExpr(expr.value, context, state)})`;

  if (isOr(expr)) return genSpecRepeated(expr.left, ['||'], expr.right ?? [], context, state);
  if (isAnd(expr)) return genSpecRepeated(expr.left, ['&&'], expr.right ?? [], context, state);
  if (isEquality(expr) || isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
    return genSpecRepeated(expr.left, expr.op ?? [], expr.right ?? [], context, state);
  }

  throw new Error(`Unsupported VeriFast annotation expression: ${expr.$type}. Use a string literal for raw C/VeriFast specs.`);
}

function genSpecRepeated(
  left: Expr,
  ops: string[],
  rights: Expr[],
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string {
  if (rights.length === 0) {
    return genSpecExpr(left, context, state);
  }

  let out = `(${genSpecExpr(left, context, state)}`;
  for (let i = 0; i < rights.length; i++) {
    out += ` ${specOperator(ops[i] ?? ops[0] ?? '?')} ${genSpecExpr(rights[i], context, state)}`;
  }
  return `${out})`;
}

function specOperator(op: string): string {
  if (op === 'mod') {
    return '%';
  }
  if (op === '^') {
    throw new Error('Exponentiation in VeriFast annotations is not supported yet. Use a raw string annotation for C-specific specs.');
  }
  return op;
}

function genFunctionCall(expr: FunctionCall, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const target = expr.f?.ref;
  const fnName = target ? context.getFunctionName(target) : 'ps2_null';
  return buildExpandedCall(fnName, target?.params, expr.params ?? [], context, state);
}

function genMethSelectionCall(expr: MethSelection, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const receiver = genExpr(expr.receiver, context, state);
  const target = expr.methref.f?.ref;
  const methName = target ? context.getFunctionName(target) : 'ps2_null';
  return buildExpandedCall(methName, target?.params, expr.methref.params ?? [], context, state, [receiver]);
}

function genArrayLiteral(expr: ArrayLiteral, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const elems = (expr.elems ?? []).map(elem => genExpr(elem, context, state));
  return `ps2_array_literal(${elems.length}${elems.length > 0 ? `, ${elems.join(', ')}` : ''})`;
}

function genVarRef(expr: VarRef, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const target = expr.ref?.ref;
  const name = target ? context.getVarName(target) : '/* unresolved */';

  if (target && isStructAttDeclaration(target)) {
    const attribute = genStructGet(state.thisName, name);
    return expr.index ? genArrayGet(attribute, expr.index, context, state) : attribute;
  }

  return expr.index ? genArrayGet(name, expr.index, context, state) : name;
}

function genAttSelection(expr: AttSelection, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const receiver = genExpr(expr.receiver, context, state);
  const target = expr.attref.ref?.ref;
  const attName = target ? context.getVarName(target) : '/* unresolved */';
  const attribute = genStructGet(receiver, attName);
  return expr.attref.index ? genArrayGet(attribute, expr.attref.index, context, state) : attribute;
}

function genAssignmentTarget(target: Expr, value: string, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  if (isVarRef(target)) {
    const decl = target.ref?.ref;
    const name = decl ? context.getVarName(decl) : '/* unresolved */';

    if (decl && isStructAttDeclaration(decl)) {
      if (target.index) {
        return genArraySet(genStructGet(state.thisName, name), target.index, value, context, state);
      }
      return genStructSet(state.thisName, name, value);
    }

    if (target.index) {
      return genArraySet(name, target.index, value, context, state);
    }

    return `${name} = ps2_copy_value(${value})`;
  }

  if (isAttSelection(target)) {
    const receiver = genExpr(target.receiver, context, state);
    const decl = target.attref.ref?.ref;
    const attName = decl ? context.getVarName(decl) : '/* unresolved */';

    if (target.attref.index) {
      return genArraySet(genStructGet(receiver, attName), target.attref.index, value, context, state);
    }
    return genStructSet(receiver, attName, value);
  }

  throw new Error(`Unsupported assignment target for C generator: ${target.$type}`);
}

function genArrayGet(array: string, index: Expr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  return `ps2_array_get(${array}, ${genExpr(index, context, state)})`;
}

function genArraySet(array: string, index: Expr, value: string, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  return `ps2_array_set(${array}, ${genExpr(index, context, state)}, ${value})`;
}

function genStructGet(receiver: string, field: string): string {
  return `ps2_struct_get(${receiver}, ${JSON.stringify(field)})`;
}

function genStructSet(receiver: string, field: string, value: string): string {
  return `ps2_struct_set(${receiver}, ${JSON.stringify(field)}, ${value})`;
}

function genBooleanChain(left: Expr, op: '&&' | '||', rights: Expr[], context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const parts = [left, ...rights].map(expr => `ps2_truthy(${genExpr(expr, context, state)})`);
  return `ps2_bool(${parts.join(` ${op} `)})`;
}

function genEqualityChain(left: Expr, ops: string[], rights: Expr[], context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const parts: string[] = [];
  let previous = left;

  for (let i = 0; i < rights.length; i++) {
    const op = ops[i] === '!=' ? '!' : '';
    parts.push(`${op}ps2_equals(${genExpr(previous, context, state)}, ${genExpr(rights[i], context, state)})`);
    previous = rights[i];
  }

  return `ps2_bool(${parts.join(' && ')})`;
}

function genComparisonChain(left: Expr, ops: string[], rights: Expr[], context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const parts: string[] = [];
  let previous = left;

  for (let i = 0; i < rights.length; i++) {
    parts.push(`ps2_compare(${JSON.stringify(ops[i] ?? '==')}, ${genExpr(previous, context, state)}, ${genExpr(rights[i], context, state)})`);
    previous = rights[i];
  }

  return `ps2_bool(${parts.join(' && ')})`;
}

function genOpChain(left: Expr, ops: string[], rights: Expr[], context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  let out = genExpr(left, context, state);

  for (let i = 0; i < rights.length; i++) {
    out = `ps2_binary_op(${JSON.stringify(ops[i] ?? '+')}, ${out}, ${genExpr(rights[i], context, state)})`;
  }

  return out;
}

function withTrivialVeriFastContracts(source: string): string {
  return source.replace(
    /^(static [^{;\n]+?\([^;\n]*\)) \{/gm,
    '$1\n//@ requires true;\n//@ ensures true;\n{'
  );
}

const C_RUNTIME_PRELUDE = String.raw`#include <math.h>

typedef struct Ps2Value { int _; } Ps2Value;
typedef struct Ps2Array { int _; } Ps2Array;
typedef struct Ps2Struct { int _; } Ps2Struct;

Ps2Value* ps2_undefined(void);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_null(void);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_num(double number);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_bool(int boolean);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_string(const char* string);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_copy_value(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

double ps2_as_num(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

int ps2_as_int(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

int ps2_truthy(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

void ps2_print(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

void ps2_throw(Ps2Value* value);
    //@ requires true;
    //@ ensures false;

Ps2Value* ps2_array_create(int length);
    //@ requires true;
    //@ ensures true;

int ps2_array_length(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

void ps2_array_set_zero_based(Ps2Value* array_value, int index, Ps2Value* value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_array_get(Ps2Value* array_value, Ps2Value* source_index);
    //@ requires true;
    //@ ensures true;

void ps2_array_set(Ps2Value* array_value, Ps2Value* source_index, Ps2Value* value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_array_literal(int count, ...);
    //@ requires true;
    //@ ensures true;

Ps2Struct* ps2_struct_create(int field_count);
    //@ requires true;
    //@ ensures true;

void ps2_struct_define(Ps2Struct* object, int index, const char* name, Ps2Value* value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_struct_value(Ps2Struct* object);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_struct_get(Ps2Value* value, const char* field);
    //@ requires true;
    //@ ensures true;

void ps2_struct_set(Ps2Value* value, const char* field, Ps2Value* new_value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_binary_op(const char* op, Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures true;

int ps2_compare(const char* op, Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures true;

int ps2_equals(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures true;`;

const C_RUNTIME_IMPLEMENTATION = withTrivialVeriFastContracts(String.raw`#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Ps2Value Ps2Value;
typedef struct Ps2Array Ps2Array;
typedef struct Ps2Struct Ps2Struct;

typedef enum {
  PS2_UNDEFINED,
  PS2_NULL,
  PS2_NUM,
  PS2_BOOL,
  PS2_STRING,
  PS2_ARRAY,
  PS2_STRUCT
} Ps2Kind;

struct Ps2Array {
  int length;
  Ps2Value** items;
};

struct Ps2Struct {
  int field_count;
  const char** names;
  Ps2Value** values;
};

struct Ps2Value {
  Ps2Kind kind;
  double number;
  int boolean;
  char* string;
  Ps2Array* array;
  Ps2Struct* object;
};

static void ps2_panic(const char* message) {
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static char* ps2_strdup(const char* source) {
  size_t len = strlen(source);
  char* out = malloc(len + 1);
  if (out == 0) {
    ps2_panic("out of memory");
  }
  memcpy(out, source, len + 1);
  return out;
}

static Ps2Value* ps2_value(Ps2Kind kind) {
  Ps2Value* value = malloc(sizeof(Ps2Value));
  if (value == 0) {
    ps2_panic("out of memory");
  }
  value->kind = kind;
  value->number = 0;
  value->boolean = 0;
  value->string = 0;
  value->array = 0;
  value->object = 0;
  return value;
}

static Ps2Value* ps2_undefined(void) {
  return ps2_value(PS2_UNDEFINED);
}

static Ps2Value* ps2_null(void) {
  return ps2_value(PS2_NULL);
}

static Ps2Value* ps2_num(double number) {
  Ps2Value* value = ps2_value(PS2_NUM);
  value->number = number;
  return value;
}

static Ps2Value* ps2_bool(int boolean) {
  Ps2Value* value = ps2_value(PS2_BOOL);
  value->boolean = boolean ? 1 : 0;
  return value;
}

static Ps2Value* ps2_string(const char* string) {
  Ps2Value* value = ps2_value(PS2_STRING);
  value->string = ps2_strdup(string);
  return value;
}

static Ps2Value* ps2_array_value(Ps2Array* array) {
  Ps2Value* value = ps2_value(PS2_ARRAY);
  value->array = array;
  return value;
}

static Ps2Value* ps2_struct_value(Ps2Struct* object) {
  Ps2Value* value = ps2_value(PS2_STRUCT);
  value->object = object;
  return value;
}

static Ps2Value* ps2_copy_value(Ps2Value* value) {
  if (value == 0) {
    return ps2_null();
  }
  switch (value->kind) {
    case PS2_NUM:
      return ps2_num(value->number);
    case PS2_BOOL:
      return ps2_bool(value->boolean);
    case PS2_STRING:
      return ps2_string(value->string);
    case PS2_ARRAY:
    case PS2_STRUCT:
      return value;
    case PS2_UNDEFINED:
      return ps2_undefined();
    case PS2_NULL:
    default:
      return ps2_null();
  }
}

static double ps2_as_num(Ps2Value* value) {
  if (value == 0 || value->kind == PS2_NULL || value->kind == PS2_UNDEFINED) {
    return 0;
  }
  if (value->kind == PS2_NUM) {
    return value->number;
  }
  if (value->kind == PS2_BOOL) {
    return value->boolean ? 1 : 0;
  }
  ps2_panic("expected numeric Pseudo2 value");
  return 0;
}

static int ps2_as_int(Ps2Value* value) {
  return (int)ps2_as_num(value);
}

static int ps2_truthy(Ps2Value* value) {
  if (value == 0 || value->kind == PS2_NULL || value->kind == PS2_UNDEFINED) {
    return 0;
  }
  if (value->kind == PS2_BOOL) {
    return value->boolean;
  }
  if (value->kind == PS2_NUM) {
    return value->number != 0;
  }
  if (value->kind == PS2_STRING) {
    return value->string != 0 && value->string[0] != '\0';
  }
  return 1;
}

static char* ps2_to_cstring(Ps2Value* value) {
  char buffer[64];
  if (value == 0 || value->kind == PS2_NULL) {
    return ps2_strdup("null");
  }
  if (value->kind == PS2_UNDEFINED) {
    return ps2_strdup("undefined");
  }
  if (value->kind == PS2_BOOL) {
    return ps2_strdup(value->boolean ? "true" : "false");
  }
  if (value->kind == PS2_NUM) {
    snprintf(buffer, sizeof(buffer), "%g", value->number);
    return ps2_strdup(buffer);
  }
  if (value->kind == PS2_STRING) {
    return ps2_strdup(value->string);
  }
  if (value->kind == PS2_ARRAY) {
    return ps2_strdup("[array]");
  }
  return ps2_strdup("[struct]");
}

static void ps2_print(Ps2Value* value) {
  char* text = ps2_to_cstring(value);
  printf("%s\n", text);
  free(text);
}

static void ps2_throw(Ps2Value* value) {
  char* text = ps2_to_cstring(value);
  fprintf(stderr, "%s\n", text);
  free(text);
  exit(1);
}

static Ps2Array* ps2_array_alloc(int length) {
  if (length < 0) {
    ps2_panic("negative array length");
  }
  Ps2Array* array = malloc(sizeof(Ps2Array));
  if (array == 0) {
    ps2_panic("out of memory");
  }
  array->length = length;
  array->items = malloc(sizeof(Ps2Value*) * (size_t)length);
  if (length > 0 && array->items == 0) {
    ps2_panic("out of memory");
  }
  for (int i = 0; i < length; i++) {
    array->items[i] = ps2_null();
  }
  return array;
}

static Ps2Value* ps2_array_create(int length) {
  return ps2_array_value(ps2_array_alloc(length));
}

static int ps2_array_length(Ps2Value* value) {
  if (value == 0 || value->kind != PS2_ARRAY || value->array == 0) {
    ps2_panic("expected array");
  }
  return value->array->length;
}

static void ps2_array_set_zero_based(Ps2Value* array_value, int index, Ps2Value* value) {
  if (array_value == 0 || array_value->kind != PS2_ARRAY || array_value->array == 0) {
    ps2_panic("expected array");
  }
  if (index < 0 || index >= array_value->array->length) {
    ps2_panic("array index out of bounds");
  }
  array_value->array->items[index] = ps2_copy_value(value);
}

static Ps2Value* ps2_array_get(Ps2Value* array_value, Ps2Value* source_index) {
  int index = ps2_as_int(source_index) - 1;
  if (array_value == 0 || array_value->kind != PS2_ARRAY || array_value->array == 0) {
    ps2_panic("expected array");
  }
  if (index < 0 || index >= array_value->array->length) {
    ps2_panic("array index out of bounds");
  }
  return array_value->array->items[index];
}

static void ps2_array_set(Ps2Value* array_value, Ps2Value* source_index, Ps2Value* value) {
  ps2_array_set_zero_based(array_value, ps2_as_int(source_index) - 1, value);
}

static Ps2Value* ps2_array_literal(int count, ...) {
  Ps2Value* array_value = ps2_array_create(count);
  va_list args;
  va_start(args, count);
  for (int i = 0; i < count; i++) {
    Ps2Value* item = va_arg(args, Ps2Value*);
    ps2_array_set_zero_based(array_value, i, item);
  }
  va_end(args);
  return array_value;
}

static Ps2Struct* ps2_struct_create(int field_count) {
  Ps2Struct* object = malloc(sizeof(Ps2Struct));
  if (object == 0) {
    ps2_panic("out of memory");
  }
  object->field_count = field_count;
  object->names = malloc(sizeof(const char*) * (size_t)field_count);
  object->values = malloc(sizeof(Ps2Value*) * (size_t)field_count);
  if (field_count > 0 && (object->names == 0 || object->values == 0)) {
    ps2_panic("out of memory");
  }
  return object;
}

static void ps2_struct_define(Ps2Struct* object, int index, const char* name, Ps2Value* value) {
  if (object == 0 || index < 0 || index >= object->field_count) {
    ps2_panic("invalid struct field definition");
  }
  object->names[index] = name;
  object->values[index] = ps2_copy_value(value);
}

static Ps2Struct* ps2_as_struct(Ps2Value* value) {
  if (value == 0 || value->kind == PS2_NULL) {
    ps2_panic("null pointer while accessing struct");
  }
  if (value->kind != PS2_STRUCT || value->object == 0) {
    ps2_panic("expected struct");
  }
  return value->object;
}

static int ps2_struct_field_index(Ps2Struct* object, const char* field) {
  for (int i = 0; i < object->field_count; i++) {
    if (strcmp(object->names[i], field) == 0) {
      return i;
    }
  }
  ps2_panic("unknown struct field");
  return -1;
}

static Ps2Value* ps2_struct_get(Ps2Value* value, const char* field) {
  Ps2Struct* object = ps2_as_struct(value);
  return object->values[ps2_struct_field_index(object, field)];
}

static void ps2_struct_set(Ps2Value* value, const char* field, Ps2Value* new_value) {
  Ps2Struct* object = ps2_as_struct(value);
  object->values[ps2_struct_field_index(object, field)] = ps2_copy_value(new_value);
}

static Ps2Value* ps2_concat(Ps2Value* left, Ps2Value* right) {
  char* l = ps2_to_cstring(left);
  char* r = ps2_to_cstring(right);
  size_t len = strlen(l) + strlen(r);
  char* out = malloc(len + 1);
  if (out == 0) {
    ps2_panic("out of memory");
  }
  strcpy(out, l);
  strcat(out, r);
  Ps2Value* value = ps2_string(out);
  free(out);
  free(l);
  free(r);
  return value;
}

static Ps2Value* ps2_binary_op(const char* op, Ps2Value* left, Ps2Value* right) {
  if (strcmp(op, "+") == 0) {
    if ((left != 0 && left->kind == PS2_STRING) || (right != 0 && right->kind == PS2_STRING)) {
      return ps2_concat(left, right);
    }
    return ps2_num(ps2_as_num(left) + ps2_as_num(right));
  }
  if (strcmp(op, "-") == 0) return ps2_num(ps2_as_num(left) - ps2_as_num(right));
  if (strcmp(op, "*") == 0) return ps2_num(ps2_as_num(left) * ps2_as_num(right));
  if (strcmp(op, "/") == 0) return ps2_num(ps2_as_num(left) / ps2_as_num(right));
  if (strcmp(op, "%") == 0 || strcmp(op, "mod") == 0) return ps2_num(fmod(ps2_as_num(left), ps2_as_num(right)));
  if (strcmp(op, "^") == 0) return ps2_num(pow(ps2_as_num(left), ps2_as_num(right)));
  ps2_panic("unknown operator");
  return ps2_null();
}

static int ps2_compare(const char* op, Ps2Value* left, Ps2Value* right) {
  double l = ps2_as_num(left);
  double r = ps2_as_num(right);
  if (strcmp(op, "<") == 0) return l < r;
  if (strcmp(op, "<=") == 0) return l <= r;
  if (strcmp(op, ">") == 0) return l > r;
  if (strcmp(op, ">=") == 0) return l >= r;
  return 0;
}

static int ps2_equals(Ps2Value* left, Ps2Value* right) {
  if (left == right) {
    return 1;
  }
  if (left == 0 || right == 0) {
    return 0;
  }
  if (left->kind == PS2_NULL || right->kind == PS2_NULL) {
    return left->kind == right->kind;
  }
  if (left->kind != right->kind) {
    return 0;
  }
  switch (left->kind) {
    case PS2_NUM:
      return left->number == right->number;
    case PS2_BOOL:
      return left->boolean == right->boolean;
    case PS2_STRING:
      return strcmp(left->string, right->string) == 0;
    case PS2_ARRAY:
      return left->array == right->array;
    case PS2_STRUCT:
      return left->object == right->object;
    case PS2_UNDEFINED:
    case PS2_NULL:
    default:
      return 1;
  }
}`);
