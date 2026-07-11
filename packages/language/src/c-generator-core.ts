import { AstUtils, type AstNode } from 'langium';
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
  LoopAnnotation,
  MethSelection,
  ParameterDecl,
  PrintCommand,
  Program,
  ReturnStmt,
  SpecPredicateExpr,
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
  isResultExpr,
  isSpecPredicateExpr,
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

type CGeneratorState = {
  thisName: string;
  topLevel: boolean;
  sourceMap: boolean;
  globalNames: string[];
  arrayFillDecls?: ReadonlySet<VarDecl>;
};

const DEFAULT_STATE: CGeneratorState = { thisName: 'this', topLevel: false, sourceMap: false, globalNames: [] };
const METHOD_THIS_NAME = 'mythis';
const SOURCE_MAP_MARKER_RE = /^\/\*@@pseudo2-source-line:(\d+)\*\/$/;
const SOURCE_MAP_END_MARKER = '/*@@pseudo2-source-line:end*/';
const TYPES = new Pseudo2TypeComputer();

export type GenerateCProgramOptions = {
  runtime?: 'contracts' | 'implementation';
  moduleName?: string;
};

export type CSourceMapEntry = {
  generatedLine: number;
  sourceLine: number;
};

export type GeneratedCProgram = {
  code: string;
  sourceMap: CSourceMapEntry[];
};

export function generateCProgram(
  program: Program,
  context = Pseudo2GeneratorContext.fromProgram(program),
  options: GenerateCProgramOptions = {}
): string {
  return generateCProgramInternal(program, context, options, false);
}

export function generateCProgramWithSourceMap(
  program: Program,
  context = Pseudo2GeneratorContext.fromProgram(program),
  options: GenerateCProgramOptions = {}
): GeneratedCProgram {
  return stripSourceMapMarkers(generateCProgramInternal(program, context, options, true));
}

function generateCProgramInternal(
  program: Program,
  context: Pseudo2GeneratorContext,
  options: GenerateCProgramOptions,
  sourceMap: boolean
): string {
  const runtimePrelude = options.runtime === 'implementation' ? C_RUNTIME_IMPLEMENTATION : C_RUNTIME_PRELUDE;
  const moduleName = toCModuleName(options.moduleName ?? 'pseudo2_program');
  const declarations = program.instructions.filter(isTopLevelDeclaration);
  const globalVariables = program.instructions.filter(isVarDecl);
  const globalNames = globalVariables.map(variable => context.getVarName(variable));
  const arrayLiteralArities = collectArrayLiteralArities(program);
  const arrayFillDecls = collectArrayFillDeclarations(program);
  const arrayFillArities = collectArrayFillArities(arrayFillDecls);
  const arrayLiteralHelpers = generateArrayLiteralHelpers(arrayLiteralArities, options.runtime ?? 'contracts');
  const arrayFillHelpers = generateArrayFillHelpers(arrayFillArities, options.runtime ?? 'contracts');
  const rootState = { ...DEFAULT_STATE, sourceMap, globalNames, arrayFillDecls };
  const statements = program.instructions.filter(instruction => !isTopLevelDeclaration(instruction) && !isVarDecl(instruction));

  const prototypes = [
    ...declarations.flatMap(declaration => generatePrototype(declaration, context))
  ].join('\n');
  const globals = globalVariables
    .map(variable => `static Ps2Value* ${context.getVarName(variable)};`)
    .join('\n');
  const definitions = declarations
    .map(declaration => generateInstruction(declaration, context, '', rootState))
    .filter(Boolean)
    .join('\n\n');
  const mainBody = [
    ...globalVariables.map(variable => generateGlobalVarInit(variable, context, '  ', { ...rootState, topLevel: true })),
    ...statements.map(statement => generateInstruction(statement, context, '  ', { ...rootState, topLevel: true }))
  ].filter(Boolean).join('\n');

  return [
    runtimePrelude,
    arrayLiteralHelpers,
    arrayFillHelpers,
    prototypes,
    globals,
    definitions,
    generateMain(mainBody, globalNames, moduleName)
  ].filter(Boolean).join('\n\n');
}

function collectArrayLiteralArities(program: Program): number[] {
  const arities = new Set<number>();
  for (const node of AstUtils.streamAllContents(program)) {
    if (isArrayLiteral(node)) {
      arities.add(node.elems?.length ?? 0);
    }
  }
  return [...arities].sort((a, b) => a - b);
}

function generateArrayLiteralHelpers(arities: number[], runtime: 'contracts' | 'implementation'): string {
  if (arities.length === 0) {
    return '';
  }

  return arities
    .map(arity => runtime === 'implementation'
      ? generateArrayLiteralImplementation(arity)
      : generateArrayLiteralContract(arity)
    )
    .join('\n\n');
}

function collectArrayFillDeclarations(program: Program): Set<VarDecl> {
  const candidates = new Set<VarDecl>();
  const mutated = new Set<VarDecl>();
  for (const node of AstUtils.streamAllContents(program)) {
    if (isVarDecl(node) && arrayFillArityFor(node) !== undefined) {
      candidates.add(node);
    }

    if (isAssignment(node)) {
      const target = unwrapSingletonSpecExpr(node.sel as Expr);
      if (isVarRef(target)) {
        const decl = target.ref?.ref;
        if (decl && isVarDecl(decl)) {
          mutated.add(decl);
        }
      }
    }
  }

  for (const decl of mutated) {
    candidates.delete(decl);
  }

  return candidates;
}

function collectArrayFillArities(decls: ReadonlySet<VarDecl>): number[] {
  const arities = new Set<number>();
  for (const decl of decls) {
    const arity = arrayFillArityFor(decl);
    if (arity !== undefined) {
      arities.add(arity);
    }
  }
  return [...arities].sort((a, b) => a - b);
}

function arrayFillArityFor(decl: VarDecl): number | undefined {
  if (!decl.isArrayVariable || !isArrayFillInitializerEligible(decl.initializer)) {
    return undefined;
  }

  const size = constantIntValue(decl.size);
  return size !== undefined && size >= 0 ? size : undefined;
}

function isArrayFillInitializerEligible(expr: Expr | undefined): boolean {
  if (!expr) {
    return false;
  }

  const unwrapped = unwrapSingletonSpecExpr(expr);
  return isIntLiteral(unwrapped) || isBoolLiteral(unwrapped) || isStringLiteral(unwrapped) || isNullLiteral(unwrapped);
}

function constantIntValue(expr: Expr | undefined): number | undefined {
  if (!expr) {
    return undefined;
  }

  const unwrapped = unwrapSingletonSpecExpr(expr);
  return isIntLiteral(unwrapped) ? unwrapped.value : undefined;
}

function arrayLiteralHelperName(arity: number): string {
  return `ps2_array_literal_${arity}`;
}

function arrayLiteralParamName(index: number): string {
  return `item_${index}`;
}

function arrayLiteralParamDecls(arity: number): string[] {
  if (arity === 0) {
    return ['void'];
  }

  return Array.from({ length: arity }, (_, index) => `Ps2Value* ${arrayLiteralParamName(index)}`);
}

function generateArrayLiteralContract(arity: number): string {
  const itemFacts = Array.from(
    { length: arity },
    (_, index) => `ps2_model_array_item(result, ${index + 1}) == ${arrayLiteralParamName(index)}`
  );
  const ensures = [
    'result != 0',
    'ps2_model_value(result) == true',
    'ps2_model_array(result) == true',
    `ps2_model_array_length(result) == ${arity}`,
    ...itemFacts
  ].join(' &*& ');

  return [
    `Ps2Value* ${arrayLiteralHelperName(arity)}(${arrayLiteralParamDecls(arity).join(', ')});`,
    '    //@ requires true;',
    `    //@ ensures ${ensures};`,
    '    //@ terminates;'
  ].join('\n');
}

function generateArrayLiteralImplementation(arity: number): string {
  const params = arrayLiteralParamDecls(arity).join(', ');
  const setLines = Array.from(
    { length: arity },
    (_, index) => `  ps2_array_set_zero_based(array_value, ${index}, ${arrayLiteralParamName(index)});`
  );

  return [
    `static Ps2Value* ${arrayLiteralHelperName(arity)}(${params}) {`,
    `  Ps2Value* array_value = ps2_array_create(${arity});`,
    ...setLines,
    '  return array_value;',
    '}'
  ].join('\n');
}

function generateArrayFillHelpers(arities: number[], runtime: 'contracts' | 'implementation'): string {
  if (arities.length === 0) {
    return '';
  }

  return arities
    .map(arity => runtime === 'implementation'
      ? generateArrayFillImplementation(arity)
      : generateArrayFillContract(arity)
    )
    .join('\n\n');
}

function arrayFillHelperName(arity: number): string {
  return `ps2_array_filled_${arity}`;
}

function generateArrayFillContract(arity: number): string {
  const itemFacts = Array.from(
    { length: arity },
    (_, index) => `ps2_model_array_item(result, ${index + 1}) == item`
  );
  const ensures = [
    'result != 0',
    'ps2_model_value(result) == true',
    'ps2_model_array(result) == true',
    `ps2_model_array_length(result) == ${arity}`,
    ...itemFacts
  ].join(' &*& ');

  return [
    `Ps2Value* ${arrayFillHelperName(arity)}(Ps2Value* item);`,
    '    //@ requires true;',
    `    //@ ensures ${ensures};`,
    '    //@ terminates;'
  ].join('\n');
}

function generateArrayFillImplementation(arity: number): string {
  const setLines = Array.from(
    { length: arity },
    (_, index) => `  ps2_array_set_zero_based(array_value, ${index}, item);`
  );

  return [
    `static Ps2Value* ${arrayFillHelperName(arity)}(Ps2Value* item) {`,
    `  Ps2Value* array_value = ps2_array_create(${arity});`,
    ...setLines,
    '  return array_value;',
    '}'
  ].join('\n');
}

function stripSourceMapMarkers(markedCode: string): GeneratedCProgram {
  const codeLines: string[] = [];
  const sourceMap: CSourceMapEntry[] = [];
  const sourceLineStack: number[] = [];

  for (const line of markedCode.split(/\r?\n/)) {
    const marker = line.match(SOURCE_MAP_MARKER_RE);
    if (marker) {
      sourceLineStack.push(Number(marker[1]));
      continue;
    }
    if (line === SOURCE_MAP_END_MARKER) {
      sourceLineStack.pop();
      continue;
    }

    codeLines.push(line);

    const currentSourceLine = sourceLineStack[sourceLineStack.length - 1];
    if (currentSourceLine !== undefined) {
      sourceMap.push({
        generatedLine: codeLines.length,
        sourceLine: currentSourceLine
      });
    }
  }

  return {
    code: codeLines.join('\n'),
    sourceMap
  };
}

function sourceMapped(node: AstNode, code: string, state: CGeneratorState): string {
  const sourceLine = sourceLineFor(node);
  if (!state.sourceMap || sourceLine === undefined || code.length === 0) {
    return code;
  }

  return `/*@@pseudo2-source-line:${sourceLine}*/\n${code}\n${SOURCE_MAP_END_MARKER}`;
}

function sourceLineFor(node: AstNode): number | undefined {
  const line = node.$cstNode?.range.start.line;
  return line === undefined ? undefined : line + 1;
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

function generateMain(body: string, globalNames: string[], moduleName: string): string {
  const usesGlobals = globalNames.length > 0;
  const mainSignature = usesGlobals
    ? `int main(void) //@ : main_full(${moduleName})`
    : 'int main(void)';
  const contracts = usesGlobals
    ? [
        `//@ requires module(${moduleName}, true);`,
        '//@ ensures true;'
      ]
    : [
        '//@ requires true;',
        '//@ ensures true;'
      ];
  const moduleOpen = usesGlobals ? ['  //@ open_module();'] : [];
  const globalLeak = usesGlobals
    ? [`  //@ leak ${globalNames.map(name => `${name} |-> _`).join(' &*& ')};`]
    : [];

  return [
    mainSignature,
    ...contracts,
    '{',
    ...moduleOpen,
    body,
    ...globalLeak,
    '  return 0;',
    '}'
  ].filter(line => line.length > 0).join('\n');
}

function toCModuleName(name: string): string {
  const baseName = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]*$/, '') ?? '';
  const sanitized = baseName.replace(/[^a-zA-Z0-9_]/g, '_');
  if (sanitized.length === 0) {
    return 'pseudo2_program';
  }
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function generateInstruction(
  instruction: Instruction,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  let generated: string;

  if (isBracedBlock(instruction) || isIndentedBlock(instruction)) {
    generated = generateBlock(instruction, context, indent, state);
  } else if (isIfStatement(instruction)) {
    generated = generateIfStatement(instruction, context, indent, state);
  } else if (isWhileLoop(instruction)) {
    generated = generateWhileLoop(instruction, context, indent, state);
  } else if (isForLoop(instruction)) {
    generated = generateForLoop(instruction, context, indent, state);
  } else if (isDoWhileLoop(instruction)) {
    generated = generateDoWhileLoop(instruction, context, indent, state);
  } else if (isStructDeclaration(instruction)) {
    generated = generateStructDeclaration(instruction, context, indent, state);
  } else if (isFunctionDeclaration(instruction)) {
    generated = generateFunctionDeclaration(instruction, context, indent, state);
  } else if (isVarDecl(instruction)) {
    generated = generateVarDecl(instruction, context, indent, state);
  } else if (isAssignment(instruction)) {
    generated = generateAssignment(instruction, context, indent, state);
  } else if (isFunctionCall(instruction)) {
    generated = `${indent}${genFunctionCall(instruction, context, state)};`;
  } else if (isReturnStmt(instruction)) {
    generated = generateReturnStatement(instruction, context, indent, state);
  } else if (isExprStatement(instruction)) {
    generated = generateExprStatement(instruction, context, indent, state);
  } else if (isPrintCommand(instruction)) {
    generated = generatePrintCommand(instruction, context, indent, state);
  } else if (isThrowCommand(instruction)) {
    generated = generateThrowCommand(instruction, context, indent, state);
  } else if (isCallCommand(instruction)) {
    generated = generateCallCommand(instruction, context, indent, state);
  } else if (isVerificationStatement(instruction)) {
    generated = generateVerificationStatement(instruction, context, indent, state);
  } else {
    throw new Error(`Unsupported instruction type for C generator: ${(instruction as unknown as { $type: string }).$type}`);
  }

  return sourceMapped(instruction, generated, state);
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
  return [
    `${indent}while (ps2_truthy(${condition}))`,
    ...generateLoopInvariants(loop.annotations ?? [], context, indent, state),
    body
  ].join('\n');
}

function generateForLoop(loop: ForLoop, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const iterName = loop.iterator ? context.getVarName(loop.iterator) : context.getAnonymousVarName('__for');
  const endName = context.getAnonymousVarName('__forEnd');
  const stepName = context.getAnonymousVarName('__forStep');
  const from = genExpr(loop.from, context, state);
  const to = genExpr(loop.to, context, state);
  const step = loop.step ? genExpr(loop.step, context, state) : 'ps2_int(1)';
  const directionOp = loop.direction === 'to' ? '<=' : '>=';
  const stepOp = loop.direction === 'to' ? '+' : '-';
  const body = generateForLoopBody(loop, context, indent, state, iterName, stepName, stepOp);

  return [
    `${indent}Ps2Value* ${iterName} = ps2_copy_value(${from});`,
    `${indent}Ps2Value* ${endName} = ps2_copy_value(${to});`,
    `${indent}Ps2Value* ${stepName} = ps2_copy_value(${step});`,
    `${indent}if (ps2_as_num(${stepName}) <= 0) {`,
    `${indent}  ps2_throw(ps2_string("Invoked for-loop with negative step-size"));`,
    `${indent}}`,
    `${indent}while (ps2_as_num(${iterName}) ${directionOp} ps2_as_num(${endName}))`,
    ...generateLoopInvariants(loop.annotations ?? [], context, indent, state),
    body
  ].join('\n');
}

function generateForLoopBody(
  loop: ForLoop,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState,
  iterName: string,
  stepName: string,
  stepOp: string
): string {
  const body = loop.body.instructions ?? [];
  const inner = `${indent}  `;
  const nested = body
    .map(instruction => generateInstruction(instruction, context, inner, state))
    .filter(Boolean);
  const update = `${inner}${iterName} = ps2_num(ps2_as_num(${iterName}) ${stepOp} ps2_as_num(${stepName}));`;

  return `${indent}{\n${[...nested, update].join('\n')}\n${indent}}`;
}

function generateDoWhileLoop(
  loop: DoWhileLoop,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const body = generateBlock(loop.body, context, indent, state);
  const condition = genExpr(loop.condition, context, state);
  return [
    `${indent}do`,
    ...generateLoopInvariants(loop.annotations ?? [], context, indent, state),
    `${body} while (ps2_truthy(${condition}));`
  ].join('\n');
}

function generateStructDeclaration(
  structDecl: StructDeclaration,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const attributes = (structDecl.children ?? []).filter(isStructAttDeclaration);
  const methods = (structDecl.children ?? [])
    .filter(isFunctionDeclaration)
    .filter(isMethodDecl);
  const factoryName = context.getStructFactoryName(structDecl);
  const defineLines = attributes.map((att, index) =>
    `${indent}  ps2_struct_define(__ps2_obj, ${index}, ${JSON.stringify(context.getVarName(att))}, ps2_undefined());`
  );
  const defaultFieldFacts = attributes.map(att =>
    `ps2_model_undefined(ps2_model_struct_field(result, ${context.getStructFieldId(att)})) == true`
  );
  const defaultFieldAssumptions = attributes.map(att =>
    `${indent}  //@ assume(ps2_model_undefined(ps2_model_struct_field(__ps2_value, ${context.getStructFieldId(att)})) == true);`
  );
  const factoryEnsures = [
    'result != 0',
    'ps2_model_value(result) == true',
    'ps2_model_struct(result) == true',
    ...defaultFieldFacts
  ].join(' &*& ');
  const factory = [
    `${indent}Ps2Value* ${factoryName}(void)`,
    `${indent}//@ requires true;`,
    `${indent}//@ ensures ${factoryEnsures};`,
    `${indent}{`,
    `${indent}  Ps2Struct* __ps2_obj = ps2_struct_create(${attributes.length});`,
    ...defineLines,
    `${indent}  Ps2Value* __ps2_value = ps2_struct_value(__ps2_obj);`,
    ...defaultFieldAssumptions,
    `${indent}  return __ps2_value;`,
    `${indent}}`
  ].join('\n');
  const methodText = methods
    .map(method => generateMethodDeclaration(method, context, indent, state))
    .join('\n\n');

  return methodText ? `${factory}\n\n${methodText}` : factory;
}

function isMethodDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword !== true;
}

function generateMethodDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const params = collectMethodCParams(fn, context).join(', ');
  const body = generateFunctionBody(fn, context, indent, { ...state, thisName: METHOD_THIS_NAME });
  return `${indent}Ps2Value* ${context.getFunctionName(fn)}(${params})\n${body}`;
}

function generateFunctionDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const params = collectCParams(fn, context).join(', ');
  const body = generateFunctionBody(fn, context, indent, state);
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
  const terminates = annotations.filter(annotation => annotation.kind === 'terminates');

  return [
    ...generateContractLines('requires', requires, fn, context, indent, state),
    ...generateContractLines('ensures', ensures, fn, context, indent, state),
    ...terminates.map(annotation => sourceMapped(annotation, `${indent}//@ terminates;`, state))
  ];
}

function generateContractLines(
  kind: 'requires' | 'ensures',
  annotations: VerificationAnnotation[],
  fallbackNode: AstNode,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState,
  options: { emitFallback?: boolean } = {}
): string[] {
  if (annotations.length === 0) {
    if (options.emitFallback === false) {
      return [];
    }
    return [sourceMapped(fallbackNode, `${indent}//@ ${kind} true;`, state)];
  }

  return annotations.map(annotation => {
    const condition = annotation.condition;
    if (!condition) {
      return sourceMapped(annotation, `${indent}//@ ${kind} true;`, state);
    }
    return sourceMapped(annotation, `${indent}//@ ${kind} ${genSpecExpr(condition, context, state)};`, state);
  });
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
      expandedArgs.push(`ps2_int(ps2_array_length(${actualExpr}))`);
    }
  }

  return `${callee}(${expandedArgs.join(', ')})`;
}

function generateGlobalVarInit(
  decl: VarDecl,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return sourceMapped(decl, generateVarDecl(decl, context, indent, { ...state, topLevel: true }), state);
}

function generateVarDecl(decl: VarDecl, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const name = context.getVarName(decl);
  const prefix = state.topLevel ? '' : 'Ps2Value* ';

  if (decl.isArrayVariable) {
    const sizeExpr = decl.size ? genExpr(decl.size, context, state) : 'ps2_int(0)';
    const initExpr = decl.initializer ? genExpr(decl.initializer, context, state) : 'ps2_null()';
    const fillArity = state.arrayFillDecls?.has(decl) ? arrayFillArityFor(decl) : undefined;
    if (fillArity !== undefined) {
      return `${indent}${prefix}${name} = ${arrayFillHelperName(fillArity)}(${initExpr});`;
    }

    const indexName = context.getAnonymousVarName('__arrInit');
    return [
      `${indent}${prefix}${name} = ps2_array_create(ps2_as_int(${sizeExpr}));`,
      `${indent}for (int ${indexName} = 0; ${indexName} < ps2_array_length(${name}); ${indexName}++)`,
      ...generateLoopInvariants([], context, indent, state),
      `${indent}{`,
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
  const spec = genSpecExpr(statement.condition, context, state);

  switch (statement.kind) {
    case 'assume':
      return `${indent}//@ assume(${spec});`;
    case 'assert':
    case 'open':
    case 'close':
    case 'leak':
      return `${indent}//@ ${statement.kind} ${spec};`;
    default:
      throw new Error(`Unsupported VeriFast statement kind: ${statement.kind}`);
  }
}

function genExpr(expr: Expr, context: Pseudo2GeneratorContext, state = DEFAULT_STATE): string {
  if (isIntLiteral(expr)) return `ps2_int(${expr.value})`;
  if (isBoolLiteral(expr)) return `ps2_bool(${expr.value === 'true' ? 1 : 0})`;
  if (isStringLiteral(expr)) return `ps2_string(${JSON.stringify(expr.value)})`;
  if (isNullLiteral(expr)) return 'ps2_null()';
  if (isResultExpr(expr)) throw new Error('result is only supported inside VeriFast annotations.');
  if (isSpecPredicateExpr(expr)) throw new Error(`${expr.kind} is only supported inside VeriFast annotations.`);
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
  if (isResultExpr(expr)) return 'result';
  if (isSpecPredicateExpr(expr)) return genSpecPredicate(expr, context, state);
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

function genSpecPredicate(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  switch (expr.kind) {
    case 'vf_value':
      return `(ps2_model_value(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_array':
      return `(ps2_model_array(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_struct':
      return `(ps2_model_struct(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_len':
      return `ps2_model_array_length(${genSingleSpecArg(expr, context, state)})`;
    case 'vf_int':
      return `ps2_model_int(${genSingleSpecArg(expr, context, state)})`;
    case 'vf_bool':
      return `(ps2_model_bool(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_string':
      return `(ps2_model_string(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_null':
      return `(ps2_model_null(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_undefined':
      return `(ps2_model_undefined(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_elem':
      return genSpecArrayElement(expr, context, state);
    case 'vf_field':
      return genSpecStructField(expr, context, state);
    case 'vf_in_bounds':
      return genSpecArrayBounds(expr, context, state);
    default:
      throw new Error(`Unsupported VeriFast spec helper: ${expr.kind}`);
  }
}

function genSingleSpecArg(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 1) {
    throw new Error(`${expr.kind} expects exactly one argument.`);
  }
  return genSpecExpr(args[0], context, state);
}

function genSpecArrayElement(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_elem expects exactly two arguments.');
  }

  return `ps2_model_array_item(${genSpecExpr(args[0], context, state)}, ${genSpecIndexExpr(args[1], context, state)})`;
}

function genSpecArrayBounds(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_in_bounds expects exactly two arguments.');
  }

  const array = genSpecExpr(args[0], context, state);
  const index = genSpecIndexExpr(args[1], context, state);
  return `((1 <= ${index}) && (${index} <= ps2_model_array_length(${array})))`;
}

function genSpecIndexExpr(expr: Expr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const unwrapped = unwrapSingletonSpecExpr(expr);
  if (isIntLiteral(unwrapped)) {
    return String(unwrapped.value);
  }
  if (isSpecPredicateExpr(unwrapped) && unwrapped.kind === 'vf_int') {
    return genSpecExpr(unwrapped, context, state);
  }

  return `ps2_model_int(${genSpecExpr(expr, context, state)})`;
}

function genSpecStructField(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_field expects exactly two arguments.');
  }
  const fieldNameExpr = unwrapSingletonSpecExpr(args[1]);
  if (!isStringLiteral(fieldNameExpr)) {
    throw new Error('vf_field expects a string literal field name as its second argument.');
  }
  const field = resolveSpecStructField(args[0], fieldNameExpr.value, context);
  if (!field) {
    throw new Error(`vf_field could not resolve struct field '${fieldNameExpr.value}'. Use a receiver with a concrete struct type or a unique field name.`);
  }

  return `ps2_model_struct_field(${genSpecExpr(args[0], context, state)}, ${context.getStructFieldId(field)})`;
}

function resolveSpecStructField(
  receiver: Expr,
  fieldName: string,
  context: Pseudo2GeneratorContext
) {
  const structName = structNameForSpecReceiver(receiver);
  if (structName) {
    const field = context.getStructFieldByStructNameAndSourceName(structName, fieldName);
    if (field) {
      return field;
    }
  }

  return context.getUniqueStructFieldBySourceName(fieldName);
}

function structNameForSpecReceiver(receiver: Expr): string | undefined {
  const unwrapped = unwrapSingletonSpecExpr(receiver);
  if (isResultExpr(unwrapped)) {
    return structNameForEnclosingFunctionResult(unwrapped);
  }

  const receiverType = TYPES.typeFor(receiver);
  return receiverType.isStructType() && receiverType.name ? receiverType.name : undefined;
}

function structNameForEnclosingFunctionResult(expr: Expr): string | undefined {
  const fn = AstUtils.getContainerOfType(expr, isFunctionDeclaration);
  if (!fn) {
    return undefined;
  }

  for (const node of AstUtils.streamAllContents(fn)) {
    if (!isReturnStmt(node) || !node.retExpr) {
      continue;
    }
    const type = TYPES.typeFor(node.retExpr);
    if (type.isStructType() && type.name) {
      return type.name;
    }
  }

  return undefined;
}

function unwrapSingletonSpecExpr(expr: Expr): Expr {
  if ((isOr(expr) || isAnd(expr) || isEquality(expr) || isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) && (expr.right?.length ?? 0) === 0) {
    return unwrapSingletonSpecExpr(expr.left);
  }
  if (isGrouping(expr)) {
    return unwrapSingletonSpecExpr(expr.value);
  }
  return expr;
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
  return `${arrayLiteralHelperName(elems.length)}(${elems.join(', ')})`;
}

function genVarRef(expr: VarRef, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const target = expr.ref?.ref;
  const name = target ? context.getVarName(target) : '/* unresolved */';

  if (target && isStructAttDeclaration(target)) {
    const attribute = genStructGet(state.thisName, name, context.getStructFieldId(target));
    return expr.index ? genArrayGet(attribute, expr.index, context, state) : attribute;
  }

  return expr.index ? genArrayGet(name, expr.index, context, state) : name;
}

function genAttSelection(expr: AttSelection, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const receiver = genExpr(expr.receiver, context, state);
  const target = expr.attref.ref?.ref;
  const attName = target ? context.getVarName(target) : '/* unresolved */';
  const attribute = target ? genStructGet(receiver, attName, context.getStructFieldId(target)) : genStructGet(receiver, attName, -1);
  return expr.attref.index ? genArrayGet(attribute, expr.attref.index, context, state) : attribute;
}

function genAssignmentTarget(target: Expr, value: string, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  if (isVarRef(target)) {
    const decl = target.ref?.ref;
    const name = decl ? context.getVarName(decl) : '/* unresolved */';

    if (decl && isStructAttDeclaration(decl)) {
      if (target.index) {
        return genArraySet(genStructGet(state.thisName, name, context.getStructFieldId(decl)), target.index, value, context, state);
      }
      return genStructSet(state.thisName, name, context.getStructFieldId(decl), value);
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
    const fieldId = decl ? context.getStructFieldId(decl) : -1;

    if (target.attref.index) {
      return genArraySet(genStructGet(receiver, attName, fieldId), target.attref.index, value, context, state);
    }
    return genStructSet(receiver, attName, fieldId, value);
  }

  throw new Error(`Unsupported assignment target for C generator: ${target.$type}`);
}

function genArrayGet(array: string, index: Expr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  return `ps2_array_get(${array}, ${genExpr(index, context, state)})`;
}

function genArraySet(array: string, index: Expr, value: string, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  return `ps2_array_set(${array}, ${genExpr(index, context, state)}, ${value})`;
}

function genStructGet(receiver: string, field: string, fieldId: number): string {
  return `ps2_struct_get_model(${receiver}, ${JSON.stringify(field)}, ${fieldId})`;
}

function genStructSet(receiver: string, field: string, fieldId: number, value: string): string {
  return `ps2_struct_set_model(${receiver}, ${JSON.stringify(field)}, ${fieldId}, ${value})`;
}

function generateLoopInvariants(
  annotations: LoopAnnotation[],
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): string[] {
  const invariantAnnotations = annotations.filter(annotation => annotation.kind === 'invariant');
  const decreasesAnnotations = annotations.filter(annotation => annotation.kind === 'decreases');
  const generatedInvariant = state.topLevel && state.globalNames.length > 0
    ? state.globalNames.map(name => `${name} |-> _`).join(' &*& ')
    : 'true';
  const invariants = [
    ...invariantAnnotations.map(annotation => genSpecExpr(annotation.condition, context, state)),
    generatedInvariant
  ];
  const combined = invariants.length > 1
    ? invariants.map(invariant => `(${invariant})`).join(' &*& ')
    : invariants[0] ?? 'true';
  const invariantLine = `${indent}  //@ invariant ${combined};`;
  const invariantOutput = invariantAnnotations[0]
    ? [sourceMapped(invariantAnnotations[0], invariantLine, state)]
    : [invariantLine];
  const decreasesOutput = decreasesAnnotations.map(annotation =>
    sourceMapped(annotation, `${indent}  //@ decreases ${genSpecExpr(annotation.condition, context, state)};`, state)
  );

  return [...invariantOutput, ...decreasesOutput];
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

function withTerminatingVeriFastContracts(source: string): string {
  return source.replace(
    /(    \/\/@ ensures [^\n]+;)/g,
    '$1\n    //@ terminates;'
  );
}

const C_RUNTIME_PRELUDE = withTerminatingVeriFastContracts(String.raw`#include <math.h>

typedef struct Ps2Value { int _; } Ps2Value;
typedef struct Ps2Array { int _; } Ps2Array;
typedef struct Ps2Struct { int _; } Ps2Struct;

/*@
fixpoint bool ps2_model_value(Ps2Value* value);
fixpoint bool ps2_model_array(Ps2Value* value);
fixpoint bool ps2_model_struct(Ps2Value* value);
fixpoint bool ps2_model_bool(Ps2Value* value);
fixpoint bool ps2_model_string(Ps2Value* value);
fixpoint bool ps2_model_null(Ps2Value* value);
fixpoint bool ps2_model_undefined(Ps2Value* value);
fixpoint int ps2_model_array_length(Ps2Value* value);
fixpoint int ps2_model_int(Ps2Value* value);
fixpoint Ps2Value* ps2_model_array_item(Ps2Value* value, int index);
fixpoint Ps2Value* ps2_model_struct_field(Ps2Value* value, int field);
@*/

Ps2Value* ps2_undefined(void);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_undefined(result) == true;

Ps2Value* ps2_null(void);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_null(result) == true;

Ps2Value* ps2_num(double number);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true;

Ps2Value* ps2_int(int number);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_int(result) == number;

Ps2Value* ps2_bool(int boolean);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_bool(result) == (boolean == 0 ? false : true);

Ps2Value* ps2_string(const char* string);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_string(result) == true;

Ps2Value* ps2_copy_value(Ps2Value* value);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& (ps2_model_array(value) == true ? result == value &*& ps2_model_array(result) == true &*& ps2_model_array_length(result) == ps2_model_array_length(value) : true) &*& (ps2_model_struct(value) == true ? result == value &*& ps2_model_struct(result) == true : true) &*& ps2_model_int(result) == ps2_model_int(value) &*& ps2_model_bool(result) == ps2_model_bool(value) &*& ps2_model_string(result) == ps2_model_string(value) &*& ps2_model_null(result) == ps2_model_null(value) &*& ps2_model_undefined(result) == ps2_model_undefined(value);

double ps2_as_num(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

int ps2_as_int(Ps2Value* value);
    //@ requires true;
    //@ ensures result == ps2_model_int(value);

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
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_array(result) == true &*& ps2_model_array_length(result) == length;

int ps2_array_length(Ps2Value* value);
    //@ requires true;
    //@ ensures result == ps2_model_array_length(value);

void ps2_array_set_zero_based(Ps2Value* array_value, int index, Ps2Value* value);
    //@ requires true;
    //@ ensures ps2_model_array_item(array_value, index + 1) == value;

Ps2Value* ps2_array_get(Ps2Value* array_value, Ps2Value* source_index);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& result == ps2_model_array_item(array_value, ps2_model_int(source_index));

void ps2_array_set(Ps2Value* array_value, Ps2Value* source_index, Ps2Value* value);
    //@ requires true;
    //@ ensures ps2_model_array_item(array_value, ps2_model_int(source_index)) == value;

Ps2Value* ps2_array_literal(int count, ...);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_array(result) == true &*& ps2_model_array_length(result) == count;

Ps2Struct* ps2_struct_create(int field_count);
    //@ requires true;
    //@ ensures result != 0;

void ps2_struct_define(Ps2Struct* object, int index, const char* name, Ps2Value* value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_struct_value(Ps2Struct* object);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_struct(result) == true;

Ps2Value* ps2_struct_get(Ps2Value* value, const char* field);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true;

void ps2_struct_set(Ps2Value* value, const char* field, Ps2Value* new_value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_struct_get_model(Ps2Value* value, const char* field, int field_id);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& result == ps2_model_struct_field(value, field_id);

void ps2_struct_set_model(Ps2Value* value, const char* field, int field_id, Ps2Value* new_value);
    //@ requires true;
    //@ ensures ps2_model_struct_field(value, field_id) == new_value;

Ps2Value* ps2_binary_op(const char* op, Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true;

int ps2_compare(const char* op, Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures true;

int ps2_equals(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures true;`);

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

static Ps2Value* ps2_int(int number) {
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

static Ps2Value* ps2_struct_get_model(Ps2Value* value, const char* field, int field_id) {
  (void)field_id;
  return ps2_struct_get(value, field);
}

static void ps2_struct_set_model(Ps2Value* value, const char* field, int field_id, Ps2Value* new_value) {
  (void)field_id;
  ps2_struct_set(value, field, new_value);
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
