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
  isIndexSelection,
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
import { C_RUNTIME_CONTRACTS } from './c-runtime-contracts.js';
import { C_RUNTIME_IMPLEMENTATION } from './c-runtime-implementation.js';
import { Pseudo2GeneratorContext } from './generator-context.js';
import { Pseudo2TypeComputer } from './typing/pseudo2-type-computer.js';

type CGeneratorState = {
  thisName: string;
  topLevel: boolean;
  sourceMap: boolean;
  globalNames: string[];
  arrayFillDecls?: ReadonlySet<VarDecl>;
  stringLiteralNames?: ReadonlyMap<string, string>;
  divisionLiteralNames?: ReadonlyMap<number, string>;
  specHeapStates?: ReadonlyMap<string, SpecHeapState>;
  ownedHeapLocals?: Array<Omit<SpecHeapState, 'stateName'>>;
  heapAliases?: ReadonlyMap<string, string>;
  heapContainments?: ReadonlyMap<string, string>;
  heapReplacements?: ReadonlyMap<Assignment, HeapReplacement>;
  expressionTemps?: ReadonlyMap<AstNode, string>;
};

type HeapKind = 'array' | 'struct';

type SpecHeapState = {
  kind: HeapKind;
  receiver: string;
  stateName: string;
  expression?: Expr;
};

type HeapReplacement = {
  kind: HeapKind;
  replacementReceiver?: string;
  conditionalReceiver?: string;
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
  const runtimePrelude = options.runtime === 'implementation' ? C_RUNTIME_IMPLEMENTATION : C_RUNTIME_CONTRACTS;
  const moduleName = toCModuleName(options.moduleName ?? 'pseudo2_program');
  const declarations = program.instructions.filter(isTopLevelDeclaration);
  const globalVariables = program.instructions.filter(isVarDecl);
  const globalNames = globalVariables.map(variable => context.getVarName(variable));
  const arrayLiteralArities = collectArrayLiteralArities(program);
  const arrayFillDecls = collectArrayFillDeclarations(program);
  const arrayFillArities = collectArrayFillArities(arrayFillDecls);
  const stringLiterals = collectStringLiterals(program);
  const stringLiteralNames = new Map(stringLiterals.map((value, index) => [value, stringLiteralHelperName(index)]));
  const divisionLiterals = collectDivisionLiterals(program);
  const divisionLiteralNames = new Map(divisionLiterals.map(value => [value, divisionLiteralHelperName(value)]));
  const arrayLiteralHelpers = generateArrayLiteralHelpers(arrayLiteralArities, options.runtime ?? 'contracts');
  const arrayFillHelpers = generateArrayFillHelpers(arrayFillArities, options.runtime ?? 'contracts');
  const stringLiteralHelpers = generateStringLiteralHelpers(stringLiterals, options.runtime ?? 'contracts');
  const divisionLiteralHelpers = generateDivisionLiteralHelpers(divisionLiterals, options.runtime ?? 'contracts');
  const verifastOptions = options.runtime !== 'implementation' && hasMutatingStructLoop(program)
    ? '//verifast_options{prover:Z3v4.5}'
    : '';
  const rootState: CGeneratorState = {
    ...DEFAULT_STATE,
    sourceMap,
    globalNames,
    arrayFillDecls,
    stringLiteralNames,
    divisionLiteralNames,
    ownedHeapLocals: []
  };
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
    verifastOptions,
    runtimePrelude,
    arrayLiteralHelpers,
    arrayFillHelpers,
    stringLiteralHelpers,
    divisionLiteralHelpers,
    prototypes,
    globals,
    definitions,
    generateMain(mainBody, globalVariables, context, moduleName, rootState.ownedHeapLocals ?? [])
  ].filter(Boolean).join('\n\n');
}

function hasMutatingStructLoop(program: Program): boolean {
  for (const node of AstUtils.streamAllContents(program)) {
    if (!isWhileLoop(node) && !isForLoop(node) && !isDoWhileLoop(node)) {
      continue;
    }
    if ((node.annotations?.length ?? 0) === 0) {
      continue;
    }
    for (const bodyNode of AstUtils.streamAllContents(node.body)) {
      if (isAssignment(bodyNode) && isAttSelection(bodyNode.sel)) {
        return true;
      }
    }
  }
  return false;
}

function collectDivisionLiterals(program: Program): number[] {
  const values = new Set<number>();
  for (const node of AstUtils.streamAllContents(program)) {
    if (!isMultiplication(node)) {
      continue;
    }
    for (let index = 0; index < (node.right?.length ?? 0); index++) {
      const right = unwrapSingletonSpecExpr(node.right[index]);
      if (node.op?.[index] === '/' && isIntLiteral(right) && right.value !== 0) {
        values.add(right.value);
      }
    }
  }
  return [...values].sort((a, b) => a - b);
}

function divisionLiteralHelperName(divisor: number): string {
  return `ps2_divide_by_${divisor < 0 ? `neg_${Math.abs(divisor)}` : divisor}`;
}

function generateDivisionLiteralHelpers(divisors: number[], runtime: 'contracts' | 'implementation'): string {
  return divisors.map(divisor => runtime === 'implementation'
    ? [
        `static Ps2Value* ${divisionLiteralHelperName(divisor)}(Ps2Value* left) {`,
        `  return ps2_divide(left, ps2_int(${divisor}));`,
        '}'
      ].join('\n')
    : [
        `Ps2Value* ${divisionLiteralHelperName(divisor)}(Ps2Value* left);`,
        '    //@ requires true;',
        `    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_int(left) % ${divisor} == 0) &*& ps2_model_real(result) == ps2_model_real(left) / ${divisor}r &*& (ps2_model_integral(result) ? ps2_model_int(result) == ps2_model_int(left) / ${divisor} : true);`,
        '    //@ terminates;'
      ].join('\n')
  ).join('\n\n');
}

function collectStringLiterals(program: Program): string[] {
  const values = new Set<string>();
  for (const node of AstUtils.streamAllContents(program)) {
    if (isStringLiteral(node)) {
      values.add(node.value);
    }
  }
  return [...values].sort();
}

function generateStringLiteralHelpers(values: string[], runtime: 'contracts' | 'implementation'): string {
  return values
    .map((value, index) => runtime === 'implementation'
      ? generateStringLiteralImplementation(value, index)
      : generateStringLiteralContract(value, index)
    )
    .join('\n\n');
}

function stringLiteralHelperName(index: number): string {
  return `ps2_string_literal_${index}`;
}

function generateStringLiteralContract(value: string, index: number): string {
  return [
    `Ps2Value* ${stringLiteralHelperName(index)}(void);`,
    '    //@ requires true;',
    `    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_string_kind &*& ps2_model_string(result) == true &*& ps2_model_string_content(result) == ${genVeriFastStringContent(value)} &*& ps2_model_to_string_content(result) == ${genVeriFastStringContent(value)};`,
    '    //@ terminates;'
  ].join('\n');
}

function generateStringLiteralImplementation(value: string, index: number): string {
  return [
    `static Ps2Value* ${stringLiteralHelperName(index)}(void) {`,
    `  return ps2_string(${JSON.stringify(value)});`,
    '}'
  ].join('\n');
}

function genVeriFastStringContent(value: string): string {
  return [...value]
    .map(character => character.codePointAt(0) ?? 0)
    .reduceRight((tail, codePoint) => `cons(${codePoint}, ${tail})`, 'nil');
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
  for (const node of AstUtils.streamAllContents(program)) {
    if (isVarDecl(node) && arrayFillArityFor(node) !== undefined) {
      candidates.add(node);
    }
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

function veriFastPointerList(values: string[]): string {
  return values.reduceRight((tail, value) => `cons(${value}, ${tail})`, 'nil');
}

function generateArrayLiteralContract(arity: number): string {
  const items = veriFastPointerList(Array.from({ length: arity }, (_, index) => arrayLiteralParamName(index)));
  const ensures = [
    'result != 0',
    'ps2_model_value(result) == true',
    'ps2_model_kind(result) == ps2_array_kind',
    'ps2_model_array(result) == true',
    `ps2_model_array_length(result) == ${arity}`,
    `ps2_array_state(result, ${items})`
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
  const items = veriFastPointerList(Array.from({ length: arity }, () => 'item'));
  const ensures = [
    'result != 0',
    'ps2_model_value(result) == true',
    'ps2_model_kind(result) == ps2_array_kind',
    'ps2_model_array(result) == true',
    `ps2_model_array_length(result) == ${arity}`,
    `ps2_array_state(result, ${items})`
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

function generateMain(
  body: string,
  globalVariables: VarDecl[],
  context: Pseudo2GeneratorContext,
  moduleName: string,
  generatedHeaps: Array<Omit<SpecHeapState, 'stateName'>>
): string {
  const globalNames = globalVariables.map(variable => context.getVarName(variable));
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
    ? [`  //@ leak ${globalVariables.map((variable, index) => {
        const name = context.getVarName(variable);
        const heapKind = heapKindForVariable(variable);
        if (!heapKind) {
          return `${name} |-> _`;
        }
        const valueName = `__ps2_global_value_${index}`;
        const predicate = heapKind === 'array' ? 'ps2_array_state' : 'ps2_struct_state';
        return `${name} |-> ?${valueName} &*& ${predicate}(${valueName}, _)`;
      }).join(' &*& ')};`]
    : [];
  const generatedHeapLeaks = generateHeapLeaks(generatedHeaps, undefined, context, '  ', DEFAULT_STATE);

  return [
    mainSignature,
    ...contracts,
    '{',
    ...moduleOpen,
    body,
    ...generatedHeapLeaks,
    ...globalLeak,
    '  return 0;',
    '}'
  ].filter(line => line.length > 0).join('\n');
}

function heapKindForVariable(variable: VarDecl): HeapKind | undefined {
  if (variable.isArrayVariable || (variable.initializer && TYPES.typeFor(variable.initializer).isArray)) {
    return 'array';
  }
  if (variable.initializer && TYPES.typeFor(variable.initializer).isStructType()) {
    return 'struct';
  }
  return undefined;
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
  const localHeaps = collectOwnedHeapLocals(body, context);
  const inheritedHeapCount = state.ownedHeapLocals?.length ?? 0;
  const blockState = {
    ...state,
    ownedHeapLocals: [...(state.ownedHeapLocals ?? []), ...localHeaps]
  };
  const nested = body
    .map(instruction => generateInstruction(instruction, context, inner, blockState))
    .filter(Boolean);
  const ownedInBlock = (blockState.ownedHeapLocals ?? []).slice(inheritedHeapCount);
  const cleanup = canCompleteNormally(body)
    ? generateHeapLeaks(ownedInBlock, undefined, context, inner, blockState)
    : [];

  return `${indent}{\n${[...nested, ...cleanup].join('\n')}\n${indent}}`;
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
  const loopState = withLoopSpecHeapStates(loop.annotations ?? [], context, state);
  const body = generateBlock(loop.body, context, indent, loopState);
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
  const endKindName = context.getAnonymousVarName('__forEndKind');
  const endIntegralName = context.getAnonymousVarName('__forEndIntegral');
  const endIntName = context.getAnonymousVarName('__forEndInt');
  const endRealName = context.getAnonymousVarName('__forEndReal');
  const stepKindName = context.getAnonymousVarName('__forStepKind');
  const stepIntegralName = context.getAnonymousVarName('__forStepIntegral');
  const stepIntName = context.getAnonymousVarName('__forStepInt');
  const stepRealName = context.getAnonymousVarName('__forStepReal');
  const from = genExpr(loop.from, context, state);
  const to = genExpr(loop.to, context, state);
  const step = loop.step ? genExpr(loop.step, context, state) : 'ps2_int(1)';
  const staticStep = loop.step ? constantIntValue(loop.step) : 1;
  const staticEnd = constantIntValue(loop.to);
  const directionFunction = loop.direction === 'to' ? 'ps2_less_equal' : 'ps2_greater_equal';
  const stepFunction = loop.direction === 'to' ? 'ps2_add' : 'ps2_subtract';
  const loopState = withLoopSpecHeapStates(loop.annotations ?? [], context, state);
  const body = generateForLoopBody(loop, context, indent, loopState, iterName, stepName, stepFunction);
  const stepGuard = staticStep !== undefined && staticStep > 0
    ? []
    : [
        `${indent}if (ps2_less_equal(${stepName}, ps2_int(0))) {`,
        `${indent}  ps2_throw(ps2_string("Invoked for-loop with negative step-size"));`,
        `${indent}}`
      ];
  const snapshotFacts = [
    ...(staticEnd === undefined
      ? [
          `ps2_model_kind(${endName}) == ${endKindName}`,
          `ps2_model_integral(${endName}) == ${endIntegralName}`,
          `ps2_model_int(${endName}) == ${endIntName}`,
          `ps2_model_real(${endName}) == ${endRealName}`
        ]
      : [
          `ps2_model_kind(${endName}) == ps2_number_kind`,
          `ps2_model_integral(${endName}) == true`,
          `ps2_model_int(${endName}) == ${staticEnd}`
        ]),
    ...(staticStep === undefined
      ? [
          `ps2_model_kind(${stepName}) == ${stepKindName}`,
          `ps2_model_integral(${stepName}) == ${stepIntegralName}`,
          `ps2_model_int(${stepName}) == ${stepIntName}`,
          `ps2_model_real(${stepName}) == ${stepRealName}`
        ]
      : [
          `ps2_model_kind(${stepName}) == ps2_number_kind`,
          `ps2_model_integral(${stepName}) == true`,
          `ps2_model_int(${stepName}) == ${staticStep}`
        ])
  ];
  const snapshotInvariant = snapshotFacts.join(' && ');
  const snapshotDeclarations = [
    ...(staticEnd === undefined
      ? [
          `${indent}//@ Ps2ModelKind ${endKindName} = ps2_model_kind(${endName});`,
          `${indent}//@ bool ${endIntegralName} = ps2_model_integral(${endName});`,
          `${indent}//@ int ${endIntName} = ps2_model_int(${endName});`,
          `${indent}//@ real ${endRealName} = ps2_model_real(${endName});`
        ]
      : []),
    ...(staticStep === undefined
      ? [
          `${indent}//@ Ps2ModelKind ${stepKindName} = ps2_model_kind(${stepName});`,
          `${indent}//@ bool ${stepIntegralName} = ps2_model_integral(${stepName});`,
          `${indent}//@ int ${stepIntName} = ps2_model_int(${stepName});`,
          `${indent}//@ real ${stepRealName} = ps2_model_real(${stepName});`
        ]
      : [])
  ];

  return [
    `${indent}Ps2Value* ${iterName} = ps2_copy_value(${from});`,
    `${indent}Ps2Value* ${endName} = ps2_copy_value(${to});`,
    `${indent}Ps2Value* ${stepName} = ps2_copy_value(${step});`,
    ...snapshotDeclarations,
    ...stepGuard,
    `${indent}while (${directionFunction}(${iterName}, ${endName}))`,
    ...generateLoopInvariants(loop.annotations ?? [], context, indent, state, [snapshotInvariant]),
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
  stepFunction: 'ps2_add' | 'ps2_subtract'
): string {
  const body = loop.body.instructions ?? [];
  const inner = `${indent}  `;
  const localHeaps = collectOwnedHeapLocals(body, context);
  const inheritedHeapCount = state.ownedHeapLocals?.length ?? 0;
  const bodyState = {
    ...state,
    ownedHeapLocals: [...(state.ownedHeapLocals ?? []), ...localHeaps]
  };
  const nested = body
    .map(instruction => generateInstruction(instruction, context, inner, bodyState))
    .filter(Boolean);
  const update = `${inner}${iterName} = ps2_copy_value(${stepFunction}(${iterName}, ${stepName}));`;
  const ownedInBody = (bodyState.ownedHeapLocals ?? []).slice(inheritedHeapCount);
  const cleanup = canCompleteNormally(body)
    ? generateHeapLeaks(ownedInBody, undefined, context, inner, bodyState)
    : [];

  return `${indent}{\n${[...nested, update, ...cleanup].join('\n')}\n${indent}}`;
}

function generateDoWhileLoop(
  loop: DoWhileLoop,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  const loopState = withLoopSpecHeapStates(loop.annotations ?? [], context, state);
  const body = generateBlock(loop.body, context, indent, loopState);
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
    `${indent}  ps2_struct_define(__ps2_obj, ${index}, ${context.getStructFieldId(att)}, ${JSON.stringify(context.getVarName(att))}, ps2_undefined());`
  );
  const defaultFieldFacts = attributes.map(att =>
    `ps2_model_undefined(ps2_struct_field_lookup(${context.getStructFieldId(att)}, __ps2_factory_fields)) == true`
  );
  const factoryEnsures = [
    'result != 0',
    'ps2_model_value(result) == true',
    'ps2_model_kind(result) == ps2_struct_kind',
    'ps2_model_struct(result) == true',
    'ps2_struct_state(result, ?__ps2_factory_fields)',
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
  const functionState = {
    ...state,
    ownedHeapLocals: collectOwnedHeapLocals(body, context),
    heapAliases: collectHeapAliases(fn, context)
  };
  functionState.heapContainments = collectHeapContainments(fn, context, functionState);
  functionState.heapReplacements = collectHeapReplacements(fn, context, functionState);
  const prelude = generateParameterPrelude(fn, context, inner);
  const contracts = generateFunctionContracts(fn, context, indent, state);
  const nested = [
    ...prelude,
    ...body.map(instruction => generateInstruction(instruction, context, inner, functionState)),
    ...(containsReturn(body) ? [] : [generateImplicitReturn(context, inner, functionState)])
  ].filter(Boolean);

  return [
    ...contracts,
    `${indent}{`,
    nested.join('\n'),
    `${indent}}`
  ].join('\n');
}

function collectOwnedHeapLocals(
  body: Instruction[],
  context: Pseudo2GeneratorContext
): Array<Omit<SpecHeapState, 'stateName'>> {
  return body
    .filter(isVarDecl)
    .map(variable => {
      const kind = heapKindForOwnedVariable(variable);
      return kind ? { kind, receiver: context.getVarName(variable) } : undefined;
    })
    .filter((receiver): receiver is Omit<SpecHeapState, 'stateName'> => receiver !== undefined);
}

function heapKindForOwnedVariable(variable: VarDecl): HeapKind | undefined {
  if (variable.isArrayVariable) {
    return 'array';
  }
  if (!variable.initializer) {
    return undefined;
  }
  const initializer = unwrapSingletonSpecExpr(variable.initializer);
  if (isVarRef(initializer) || isThisExpr(initializer) || isAttSelection(initializer)) {
    return undefined;
  }
  const type = TYPES.typeFor(initializer);
  if (type.isArrayType()) {
    return 'array';
  }
  return type.isStructType() ? 'struct' : undefined;
}

function collectHeapAliases(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const declarations = [fn.body, ...AstUtils.streamAllContents(fn.body)].filter(isVarDecl);

  for (const variable of declarations) {
    if (!variable.initializer) {
      continue;
    }
    const initializer = unwrapSingletonSpecExpr(variable.initializer);
    if (!isVarRef(initializer) || initializer.index || !initializer.ref?.ref) {
      continue;
    }
    const type = TYPES.typeFor(initializer);
    if (!type.isArrayType() && !type.isStructType()) {
      continue;
    }
    const alias = context.getVarName(variable);
    const target = context.getVarName(initializer.ref.ref);
    aliases.set(alias, resolveHeapAlias(target, aliases));
  }

  return aliases;
}

function collectHeapContainments(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): ReadonlyMap<string, string> {
  const containments = new Map<string, string>();
  for (const node of AstUtils.streamAllContents(fn.body)) {
    if (isVarDecl(node) && node.isArrayVariable && node.initializer) {
      const child = directHeapValueReceiver(node.initializer, context, state);
      if (child) {
        containments.set(child, context.getVarName(node));
      }
      continue;
    }
    if (!isAssignment(node)) {
      continue;
    }
    const child = directHeapValueReceiver(node.value, context, state);
    const parent = containmentTargetReceiver(node.sel as Expr, context, state);
    if (child && parent && child !== parent) {
      containments.set(child, parent);
    }
  }
  return containments;
}

function collectHeapReplacements(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): ReadonlyMap<Assignment, HeapReplacement> {
  const replacements = new Map<Assignment, HeapReplacement>();
  type Child = { receiver: string; kind: HeapKind };
  type Environment = Map<string, Child>;

  const sameChild = (left: Child | undefined, right: Child | undefined) =>
    left?.receiver === right?.receiver && left?.kind === right?.kind;

  const bindSlot = (
    environment: Environment,
    slot: string,
    child: Child | undefined,
    assignment?: Assignment,
    conditional = false
  ) => {
    const previous = environment.get(slot);
    if (previous && !sameChild(previous, child) && assignment) {
      const stillReferenced = [...environment.entries()].some(([candidateSlot, candidate]) =>
        candidateSlot !== slot && sameChild(candidate, previous)
      );
      if (!stillReferenced && (!conditional || child)) {
        replacements.set(assignment, {
          kind: previous.kind,
          replacementReceiver: child?.receiver,
          conditionalReceiver: conditional ? child?.receiver : undefined
        });
      }
    }
    if (child) {
      environment.set(slot, child);
    } else {
      environment.delete(slot);
    }
  };

  const intersectEnvironments = (left: Environment, right: Environment): Environment => {
    const intersection = new Map<string, Child>();
    for (const [slot, child] of left) {
      if (sameChild(child, right.get(slot))) {
        intersection.set(slot, child);
      }
    }
    return intersection;
  };

  const replaceEnvironment = (target: Environment, source: Environment) => {
    target.clear();
    for (const [slot, child] of source) {
      target.set(slot, child);
    }
  };

  const analyzeInstructions = (
    instructions: Instruction[],
    environment: Environment,
    conditionalReplacements = false,
    freshReceivers: ReadonlySet<string> = new Set()
  ): void => {
    for (const instruction of instructions) {
      if (isVarDecl(instruction) && instruction.isArrayVariable && instruction.initializer) {
        const child = directHeapChild(instruction.initializer, context, state);
        const size = constantIntValue(instruction.size);
        if (child && size !== undefined && size >= 0) {
          const array = resolveHeapAlias(context.getVarName(instruction), state.heapAliases ?? new Map());
          for (let index = 1; index <= size; index++) {
            bindSlot(environment, `array:${array}:${index}`, child);
          }
        }
        continue;
      }

      if (isAssignment(instruction)) {
        const slot = heapSlotForAssignment(instruction.sel as Expr, context, state);
        if (slot) {
          const child = directHeapChild(instruction.value, context, state);
          bindSlot(
            environment,
            slot,
            child,
            instruction,
            conditionalReplacements && !freshReceivers.has(child?.receiver ?? '')
          );
        }
        continue;
      }

      if (isIfStatement(instruction)) {
        const thenEnvironment = new Map(environment);
        const elseEnvironment = new Map(environment);
        analyzeInstructions(instruction.thenBlock.instructions ?? [], thenEnvironment, conditionalReplacements, freshReceivers);
        if (instruction.elseBlock) {
          analyzeInstructions(instruction.elseBlock.instructions ?? [], elseEnvironment, conditionalReplacements, freshReceivers);
        }
        replaceEnvironment(environment, intersectEnvironments(thenEnvironment, elseEnvironment));
        continue;
      }

      if (isBracedBlock(instruction) || isIndentedBlock(instruction)) {
        analyzeInstructions(instruction.instructions ?? [], environment, conditionalReplacements, freshReceivers);
        continue;
      }

      if (isWhileLoop(instruction) || isForLoop(instruction) || isDoWhileLoop(instruction)) {
        const loopBody = instruction.body.instructions ?? [];
        const loopLocals = new Set(collectOwnedHeapLocals(loopBody, context).map(local => local.receiver));
        analyzeInstructions(loopBody, new Map(environment), true, loopLocals);
      }
    }
  };

  analyzeInstructions(fn.body.instructions ?? [], new Map());

  return replacements;
}

function directHeapChild(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): { receiver: string; kind: HeapKind } | undefined {
  const receiver = directHeapValueReceiver(expr, context, state);
  if (!receiver) {
    return undefined;
  }
  const type = TYPES.typeFor(unwrapSingletonSpecExpr(expr));
  if (type.isArrayType()) {
    return { receiver, kind: 'array' };
  }
  return type.isStructType() ? { receiver, kind: 'struct' } : undefined;
}

function heapSlotForAssignment(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string | undefined {
  const target = unwrapSingletonSpecExpr(expr);
  if (isVarRef(target)) {
    const declaration = target.ref?.ref;
    if (!declaration) {
      return undefined;
    }
    if (isStructAttDeclaration(declaration)) {
      const field = `field:${state.thisName}:${context.getStructFieldId(declaration)}`;
      return target.index ? arrayElementSlot(field, target.index, context, state) : field;
    }
    if (target.index) {
      const receiver = resolveHeapAlias(context.getVarName(declaration), state.heapAliases ?? new Map());
      return arrayElementSlot(`array:${receiver}`, target.index, context, state);
    }
    return undefined;
  }

  if (isAttSelection(target)) {
    const receiver = directHeapValueReceiver(target.receiver, context, state);
    const declaration = target.attref.ref?.ref;
    if (!receiver || !declaration) {
      return undefined;
    }
    const field = `field:${receiver}:${context.getStructFieldId(declaration)}`;
    return target.attref.index ? arrayElementSlot(field, target.attref.index, context, state) : field;
  }


  if (isIndexSelection(target)) {
    const receiver = directHeapValueReceiver(target.receiver, context, state);
    return receiver ? arrayElementSlot(`array:${receiver}`, target.index, context, state) : undefined;
  }

  return undefined;
}

function arrayElementSlot(
  receiver: string,
  index: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string {
  const constant = constantIntValue(index);
  return `${receiver}:${constant ?? genExpr(index, context, state)}`;
}

function directHeapValueReceiver(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string | undefined {
  const unwrapped = unwrapSingletonSpecExpr(expr);
  const type = TYPES.typeFor(unwrapped);
  if (!type.isArrayType() && !type.isStructType()) {
    return undefined;
  }
  if (isVarRef(unwrapped) && !unwrapped.index) {
    const target = unwrapped.ref?.ref;
    return target
      ? resolveHeapAlias(context.getVarName(target), state.heapAliases ?? new Map())
      : undefined;
  }
  if (isThisExpr(unwrapped)) {
    return state.thisName;
  }
  if (isIndexSelection(unwrapped) || (isVarRef(unwrapped) && unwrapped.index) || isAttSelection(unwrapped)) {
    return genExpr(unwrapped, context, state);
  }
  return undefined;
}

function containmentTargetReceiver(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string | undefined {
  const target = unwrapSingletonSpecExpr(expr);
  if (isVarRef(target)) {
    const declaration = target.ref?.ref;
    if (declaration && isStructAttDeclaration(declaration)) {
      return state.thisName;
    }
    if (declaration && target.index) {
      return resolveHeapAlias(context.getVarName(declaration), state.heapAliases ?? new Map());
    }
  }
  if (isAttSelection(target)) {
    return directHeapValueReceiver(target.receiver, context, state);
  }
  if (isIndexSelection(target)) {
    return directHeapValueReceiver(target.receiver, context, state);
  }
  return undefined;
}

function resolveHeapAlias(receiver: string, aliases: ReadonlyMap<string, string>): string {
  let current = receiver;
  const visited = new Set<string>();
  while (aliases.has(current) && !visited.has(current)) {
    visited.add(current);
    current = aliases.get(current) ?? current;
  }
  return current;
}

function generateImplicitReturn(
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): string {
  const leaks = generateOwnedHeapLeaks(undefined, context, indent, state);
  return [...leaks, `${indent}return ps2_null();`].join('\n');
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
  const automaticInputs = collectAutomaticFunctionHeapReceivers(fn, context);
  const requiredReceivers = mergeHeapReceivers(
    automaticInputs,
    collectAnnotationHeapReceivers(requires, context, state)
  );
  const ensuredReceivers = mergeHeapReceivers(
    requiredReceivers,
    collectAnnotationHeapReceivers(ensures, context, state)
  );
  const heapAliases = new Map(collectContractHeapAliases(requires, requiredReceivers, context, state));
  const returnedReceiver = collectDirectReturnedHeapReceiver(fn, context, state);
  if (returnedReceiver) {
    heapAliases.set('result', resolveHeapAlias(returnedReceiver, heapAliases));
  }
  const preservesHeapState = ![...AstUtils.streamAllContents(fn.body)].some(isAssignment);
  const requiredStates = createSpecHeapStates(requiredReceivers, 'requires', heapAliases, context, state);

  return [
    generateStatefulContractLine('requires', requires, requiredReceivers, fn, context, indent, state, heapAliases),
    generateStatefulContractLine(
      'ensures',
      ensures,
      ensuredReceivers,
      fn,
      context,
      indent,
      state,
      heapAliases,
      preservesHeapState ? requiredStates : undefined
    ),
    ...terminates.map(annotation => sourceMapped(annotation, `${indent}//@ terminates;`, state))
  ];
}

function collectDirectReturnedHeapReceiver(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string | undefined {
  const returns = [...AstUtils.streamAllContents(fn.body)].filter(isReturnStmt);
  if (returns.length === 0) {
    return undefined;
  }
  const receivers = returns.map(ret => ret.retExpr
    ? directContractReceiver(ret.retExpr, context, state)
    : undefined
  );
  const first = receivers[0];
  return first && receivers.every(receiver => receiver === first) ? first : undefined;
}

function collectAutomaticFunctionHeapReceivers(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext
): Array<Omit<SpecHeapState, 'stateName'>> {
  const receivers: Array<Omit<SpecHeapState, 'stateName'>> = [];
  if (isMethodDecl(fn)) {
    receivers.push({ kind: 'struct', receiver: METHOD_THIS_NAME });
  }
  for (const param of fn.params ?? []) {
    if (param.isArray) {
      receivers.push({ kind: 'array', receiver: context.getVarName(param) });
    }
  }
  return receivers;
}

function generateStatefulContractLine(
  kind: 'requires' | 'ensures',
  annotations: VerificationAnnotation[],
  receivers: Array<Omit<SpecHeapState, 'stateName'>>,
  fallbackNode: AstNode,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState,
  aliases: ReadonlyMap<string, string> = new Map(),
  preservedStates?: ReadonlyMap<string, SpecHeapState>
): string {
  const heapStates = createSpecHeapStates(receivers, kind, aliases, context, state, preservedStates);
  const specState = { ...state, specHeapStates: heapStates };
  const preserved = new Set(uniqueHeapStates(preservedStates ?? new Map()).map(heapState =>
    heapStateKey(heapState.kind, `${heapState.receiver}:${heapState.stateName}`)
  ));
  const chunks = uniqueHeapStates(heapStates).map(heapState => heapStatePredicate(
    heapState,
    !preserved.has(heapStateKey(heapState.kind, `${heapState.receiver}:${heapState.stateName}`))
  ));
  const conditions = annotations
    .map(annotation => annotation.condition)
    .filter((condition): condition is Expr => condition !== undefined)
    .map(condition => genSpecExpr(condition, context, specState));
  const contract = [...chunks, ...conditions].join(' &*& ') || 'true';
  const sourceNode = annotations[0] ?? fallbackNode;
  return sourceMapped(sourceNode, `${indent}//@ ${kind} ${contract};`, state);
}

function collectContractHeapAliases(
  annotations: VerificationAnnotation[],
  receivers: Array<Omit<SpecHeapState, 'stateName'>>,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): ReadonlyMap<string, string> {
  const kinds = new Map(receivers.map(receiver => [receiver.receiver, receiver.kind]));
  const aliases = new Map<string, string>();

  for (const annotation of annotations) {
    if (!annotation.condition) {
      continue;
    }
    for (const node of [annotation.condition, ...AstUtils.streamAllContents(annotation.condition)].filter(isEquality)) {
      let left = directContractReceiver(node.left, context, state);
      for (let index = 0; index < (node.right?.length ?? 0); index++) {
        const right = directContractReceiver(node.right[index], context, state);
        if (node.op?.[index] === '==' && left && right && kinds.get(left) === kinds.get(right)) {
          const canonicalLeft = resolveHeapAlias(left, aliases);
          aliases.set(right, canonicalLeft);
        }
        left = right;
      }
    }
    for (const node of [annotation.condition, ...AstUtils.streamAllContents(annotation.condition)].filter(isSpecPredicateExpr)) {
      if (node.kind !== 'vf_same' || !node.args[0] || !node.args[1]) {
        continue;
      }
      const left = directContractReceiver(node.args[0], context, state);
      const right = directContractReceiver(node.args[1], context, state);
      if (left && right && kinds.get(left) === kinds.get(right)) {
        aliases.set(right, resolveHeapAlias(left, aliases));
      }
    }
  }

  return aliases;
}

function directContractReceiver(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string | undefined {
  const unwrapped = unwrapSingletonSpecExpr(expr);
  if (isVarRef(unwrapped) && !unwrapped.index) {
    return genSpecExpr(unwrapped, context, { ...state, specHeapStates: undefined });
  }
  if (isThisExpr(unwrapped)) {
    return state.thisName;
  }
  return undefined;
}

function collectAnnotationHeapReceivers(
  annotations: VerificationAnnotation[],
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): Array<Omit<SpecHeapState, 'stateName'>> {
  return mergeHeapReceivers(annotations.flatMap(annotation =>
    annotation.condition ? collectExprHeapReceivers(annotation.condition, context, state) : []
  ));
}

function collectExprHeapReceivers(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): Array<Omit<SpecHeapState, 'stateName'>> {
  const receivers: Array<Omit<SpecHeapState, 'stateName'>> = [];
  const nodes = [expr, ...AstUtils.streamAllContents(expr)];
  for (const node of nodes) {
    if (isVarRef(node) && node.index) {
      const target = node.ref?.ref;
      receivers.push({
        kind: 'array',
        receiver: target ? context.getVarName(target) : '/* unresolved */'
      });
      continue;
    }

    if (isIndexSelection(node)) {
      receivers.push({
        kind: 'array',
        receiver: genSpecExpr(node.receiver, context, { ...state, specHeapStates: undefined }),
        expression: node.receiver
      });
      continue;
    }

    if (isSpecPredicateExpr(node) && node.args[0]) {
      const kind = heapKindForSpecPredicate(node.kind);
      if (kind) {
        receivers.push({
          kind,
          receiver: genSpecExpr(node.args[0], context, { ...state, specHeapStates: undefined }),
          expression: node.args[0]
        });
      }
    }
  }
  return mergeHeapReceivers(receivers);
}

function heapKindForSpecPredicate(kind: string): HeapKind | undefined {
  if (kind === 'vf_array' || kind === 'vf_len' || kind === 'vf_elem' || kind === 'vf_in_bounds') {
    return 'array';
  }
  if (kind === 'vf_struct' || kind === 'vf_field') {
    return 'struct';
  }
  return undefined;
}

function mergeHeapReceivers(
  ...groups: Array<Array<Omit<SpecHeapState, 'stateName'>>>
): Array<Omit<SpecHeapState, 'stateName'>> {
  const merged = new Map<string, Omit<SpecHeapState, 'stateName'>>();
  for (const receiver of groups.flat()) {
    merged.set(heapStateKey(receiver.kind, receiver.receiver), receiver);
  }
  return [...merged.values()];
}

function createSpecHeapStates(
  receivers: Array<Omit<SpecHeapState, 'stateName'>>,
  phase: string,
  aliases: ReadonlyMap<string, string> = new Map(),
  context?: Pseudo2GeneratorContext,
  generatorState: CGeneratorState = DEFAULT_STATE,
  preservedStates?: ReadonlyMap<string, SpecHeapState>
): ReadonlyMap<string, SpecHeapState> {
  const canonical = mergeHeapReceivers(receivers.map(receiver => ({
    ...receiver,
    receiver: resolveHeapAlias(receiver.receiver, aliases)
  })));
  const states = new Map<string, SpecHeapState>();
  canonical
    .sort((left, right) => expressionComplexity(left.expression) - expressionComplexity(right.expression))
    .forEach((receiver, index) => {
    const fallbackReceiver = receiver.receiver;
    const preserved = preservedStates?.get(heapStateKey(receiver.kind, fallbackReceiver));
    if (preserved) {
      states.set(heapStateKey(receiver.kind, preserved.receiver), preserved);
      states.set(heapStateKey(receiver.kind, fallbackReceiver), preserved);
      return;
    }
    const resolvedReceiver = receiver.expression && context
      ? genSpecExpr(receiver.expression, context, { ...generatorState, specHeapStates: states })
      : fallbackReceiver;
    const heapState: SpecHeapState = {
      ...receiver,
      receiver: resolvedReceiver,
      stateName: `__ps2_${receiver.kind}_${phase}_${index}`
    };
    states.set(heapStateKey(receiver.kind, resolvedReceiver), heapState);
    states.set(heapStateKey(receiver.kind, fallbackReceiver), heapState);
  });
  for (const receiver of receivers) {
    const canonicalReceiver = resolveHeapAlias(receiver.receiver, aliases);
    const heapState = states.get(heapStateKey(receiver.kind, canonicalReceiver));
    if (heapState) {
      states.set(heapStateKey(receiver.kind, receiver.receiver), heapState);
    }
  }
  return states;
}

function expressionComplexity(expr: Expr | undefined): number {
  return expr ? 1 + [...AstUtils.streamAllContents(expr)].length : 0;
}

function uniqueHeapStates(states: ReadonlyMap<string, SpecHeapState>): SpecHeapState[] {
  return [...new Map([...states.values()].map(state => [
    heapStateKey(state.kind, state.receiver),
    state
  ])).values()];
}

function heapStateKey(kind: HeapKind, receiver: string): string {
  return `${kind}:${receiver}`;
}

function heapStatePredicate(state: SpecHeapState, bindState = true): string {
  const predicate = state.kind === 'array' ? 'ps2_array_state' : 'ps2_struct_state';
  return `${predicate}(${state.receiver}, ${bindState ? '?' : ''}${state.stateName})`;
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

function canCompleteNormally(instructions: Instruction[]): boolean {
  return !instructions.some(instruction => definitelyReturns(instruction));
}

function definitelyReturns(instruction: Instruction): boolean {
  if (isReturnStmt(instruction)) {
    return true;
  }
  if (isBracedBlock(instruction) || isIndentedBlock(instruction)) {
    return !canCompleteNormally(instruction.instructions ?? []);
  }
  if (isIfStatement(instruction) && instruction.elseBlock) {
    return !canCompleteNormally(instruction.thenBlock.instructions ?? []) &&
      !canCompleteNormally(instruction.elseBlock.instructions ?? []);
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

function materializeNestedHeapCreations(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState,
  includeRoot: boolean
): { prelude: string[]; value: string } {
  const expressionTemps = new Map(state.expressionTemps ?? []);
  const prelude: string[] = [];
  const rootHeap = unwrapSingletonSpecExpr(expr);
  const nodes = [expr, ...AstUtils.streamAllContents(expr)]
    .filter((node): node is Expr => isArrayLiteral(node) || isNewExpr(node))
    .reverse();

  for (const node of nodes) {
    if (node === rootHeap && !includeRoot) {
      continue;
    }
    const kind: HeapKind = isArrayLiteral(node) ? 'array' : 'struct';
    const tempName = context.getAnonymousVarName('__nestedHeap');
    const value = genExpr(node, context, { ...state, expressionTemps });
    prelude.push(`${indent}Ps2Value* ${tempName} = ${value};`);
    expressionTemps.set(node, tempName);
    state.ownedHeapLocals?.push({ kind, receiver: tempName });
  }

  return {
    prelude,
    value: genExpr(expr, context, { ...state, expressionTemps })
  };
}

function generateVarDecl(decl: VarDecl, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const name = context.getVarName(decl);
  const prefix = state.topLevel ? '' : 'Ps2Value* ';
  const materializedInitializer = decl.initializer
    ? materializeNestedHeapCreations(decl.initializer, context, indent, state, decl.isArrayVariable)
    : { prelude: [] as string[], value: 'ps2_null()' };

  if (decl.isArrayVariable) {
    const sizeExpr = decl.size ? genExpr(decl.size, context, state) : 'ps2_int(0)';
    const initExpr = materializedInitializer.value;
    const fillArity = state.arrayFillDecls?.has(decl) ? arrayFillArityFor(decl) : undefined;
    if (fillArity !== undefined) {
      return [...materializedInitializer.prelude, `${indent}${prefix}${name} = ${arrayFillHelperName(fillArity)}(${initExpr});`].join('\n');
    }

    const indexName = context.getAnonymousVarName('__arrInit');
    const lengthName = context.getAnonymousVarName('__arrLength');
    const initializerName = context.getAnonymousVarName('__arrValue');
    const stateName = '__ps2_array_loop_0';
    return [
      ...materializedInitializer.prelude,
      `${indent}Ps2Value* ${initializerName} = ps2_copy_value(${initExpr});`,
      `${indent}${prefix}${name} = ps2_array_create(ps2_as_int(${sizeExpr}));`,
      `${indent}int ${lengthName} = ps2_array_length(${name});`,
      `${indent}for (int ${indexName} = 0; ${indexName} < ${lengthName}; ${indexName}++)`,
      ...generateLoopInvariants(
        [],
        context,
        indent,
        state,
        [
          `0 <= ${indexName} && ${indexName} <= ${lengthName} && ${lengthName} == length(${stateName})`,
          `take(${indexName}, ${stateName}) == ps2_repeat_value(nat_of_int(${indexName}), ${initializerName})`
        ],
        [{ kind: 'array', receiver: name }]
      ),
      `${indent}{`,
      `${indent}  ps2_array_set_zero_based(${name}, ${indexName}, ${initializerName});`,
      `${indent}  //@ ps2_repeat_update_prefix(${stateName}, ${indexName}, ${initializerName});`,
      `${indent}}`
    ].join('\n');
  }

  return [
    ...materializedInitializer.prelude,
    `${indent}${prefix}${name} = ps2_copy_value(${materializedInitializer.value});`
  ].join('\n');
}

function generateAssignment(assign: Assignment, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const materialized = materializeHeapReads(assign.value, context, indent, state);
  const replacement = materializeHeapReplacement(assign, context, indent, state);
  const target = materializeAssignmentTarget(assign.sel as Expr, materialized.value, context, indent, state);
  return [
    ...materialized.prelude,
    ...replacement.prelude,
    ...target.prelude,
    `${indent}${target.statement};`,
    ...replacement.postlude
  ].join('\n');
}

function materializeHeapReplacement(
  assignment: Assignment,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): { prelude: string[]; postlude: string[] } {
  const replacement = state.heapReplacements?.get(assignment);
  if (!replacement) {
    return { prelude: [], postlude: [] };
  }

  const oldValue = context.getAnonymousVarName('__replacedHeap');
  const predicate = replacement.kind === 'array' ? 'ps2_array_state' : 'ps2_struct_state';
  if (replacement.conditionalReceiver) {
    const preserveFunction = replacement.kind === 'array'
      ? 'ps2_preserve_array_ownership'
      : 'ps2_preserve_struct_ownership';
    return {
      prelude: [
        `${indent}Ps2Value* ${oldValue} = ${genExpr(assignment.sel as Expr, context, state)};`,
        `${indent}if (${oldValue} != ${replacement.conditionalReceiver}) {`,
        `${indent}  //@ leak ${predicate}(${oldValue}, _);`,
        `${indent}}`,
        `${indent}${preserveFunction}(${replacement.conditionalReceiver});`
      ],
      postlude: generateReplacementStateFacts(assignment, replacement.conditionalReceiver, context, indent, state)
    };
  }
  return {
    prelude: [
      `${indent}Ps2Value* ${oldValue} = ${genExpr(assignment.sel as Expr, context, state)};`,
      `${indent}//@ leak ${predicate}(${oldValue}, _);`
    ],
    postlude: replacement.replacementReceiver
      ? generateReplacementStateFacts(assignment, replacement.replacementReceiver, context, indent, state)
      : []
  };
}

function generateReplacementStateFacts(
  assignment: Assignment,
  replacementReceiver: string,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): string[] {
  const target = unwrapSingletonSpecExpr(assignment.sel as Expr);
  if (isAttSelection(target) && !target.attref.index) {
    const declaration = target.attref.ref?.ref;
    const heapState = getBoundHeapState('struct', target.receiver, context, state);
    if (declaration && heapState) {
      return [
        `${indent}//@ ps2_struct_field_lookup_update_same(${context.getStructFieldId(declaration)}, ${replacementReceiver}, ${heapState.stateName});`
      ];
    }
  }
  if (isVarRef(target) && !target.index) {
    const declaration = target.ref?.ref;
    const heapState = state.specHeapStates?.get(heapStateKey('struct', state.thisName));
    if (declaration && isStructAttDeclaration(declaration) && heapState) {
      return [
        `${indent}//@ ps2_struct_field_lookup_update_same(${context.getStructFieldId(declaration)}, ${replacementReceiver}, ${heapState.stateName});`
      ];
    }
  }
  return [];
}

function materializeAssignmentTarget(
  target: Expr,
  value: string,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): { prelude: string[]; statement: string } {
  if (isAttSelection(target) && target.attref.index) {
    const declaration = target.attref.ref?.ref;
    const fieldName = declaration ? context.getVarName(declaration) : '/* unresolved */';
    const fieldId = declaration ? context.getStructFieldId(declaration) : -1;
    const fieldTemp = context.getAnonymousVarName('__heapField');
    return {
      prelude: [`${indent}Ps2Value* ${fieldTemp} = ${genStructGet(genExpr(target.receiver, context, state), fieldName, fieldId)};`],
      statement: genArraySet(fieldTemp, target.attref.index, value, context, state)
    };
  }


  if (isIndexSelection(target)) {
    const receiver = materializeHeapReads(target.receiver, context, indent, state);
    return {
      prelude: receiver.prelude,
      statement: genArraySet(receiver.value, target.index, value, context, state)
    };
  }

  if (isVarRef(target) && target.index) {
    const declaration = target.ref?.ref;
    if (declaration && isStructAttDeclaration(declaration)) {
      const fieldTemp = context.getAnonymousVarName('__heapField');
      return {
        prelude: [`${indent}Ps2Value* ${fieldTemp} = ${genStructGet(state.thisName, context.getVarName(declaration), context.getStructFieldId(declaration))};`],
        statement: genArraySet(fieldTemp, target.index, value, context, state)
      };
    }
  }

  return { prelude: [], statement: genAssignmentTarget(target, value, context, state) };
}

function materializeHeapReads(
  expr: Expr,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): { prelude: string[]; value: string } {
  const reads = [expr, ...AstUtils.streamAllContents(expr)]
    .filter((node): node is Expr => isVarRef(node) && node.index !== undefined || isAttSelection(node) || isIndexSelection(node));
  const expressionTemps = new Map<AstNode, string>();
  const prelude: string[] = [];

  for (const read of reads.reverse()) {
    if (expressionTemps.has(read)) {
      continue;
    }
    const tempName = context.getAnonymousVarName('__heapRead');
    const readState = { ...state, expressionTemps };
    const readExpression = materializeHeapReadExpression(read, context, indent, readState, prelude);
    prelude.push(`${indent}Ps2Value* ${tempName} = ${readExpression};`);
    expressionTemps.set(read, tempName);
  }

  return {
    prelude,
    value: genExpr(expr, context, { ...state, expressionTemps })
  };
}

function materializeHeapReadExpression(
  read: Expr,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState,
  prelude: string[]
): string {
  if (isAttSelection(read) && read.attref.index) {
    const declaration = read.attref.ref?.ref;
    const fieldName = declaration ? context.getVarName(declaration) : '/* unresolved */';
    const fieldId = declaration ? context.getStructFieldId(declaration) : -1;
    const fieldTemp = context.getAnonymousVarName('__heapField');
    prelude.push(`${indent}Ps2Value* ${fieldTemp} = ${genStructGet(genExpr(read.receiver, context, state), fieldName, fieldId)};`);
    return genArrayGet(fieldTemp, read.attref.index, context, state);
  }


  if (isIndexSelection(read)) {
    return genArrayGet(genExpr(read.receiver, context, state), read.index, context, state);
  }

  if (isVarRef(read) && read.index) {
    const declaration = read.ref?.ref;
    if (declaration && isStructAttDeclaration(declaration)) {
      const fieldTemp = context.getAnonymousVarName('__heapField');
      prelude.push(`${indent}Ps2Value* ${fieldTemp} = ${genStructGet(state.thisName, context.getVarName(declaration), context.getStructFieldId(declaration))};`);
      return genArrayGet(fieldTemp, read.index, context, state);
    }
  }

  return genExpr(read, context, state);
}

function generateReturnStatement(ret: ReturnStmt, context: Pseudo2GeneratorContext, indent = '', state = DEFAULT_STATE): string {
  const leaks = generateOwnedHeapLeaks(ret.retExpr, context, indent, state);
  if (!ret.retExpr) {
    return [...leaks, `${indent}return ps2_null();`].join('\n');
  }

  const materialized = materializeHeapReads(ret.retExpr, context, indent, state);
  const returnExpr = `ps2_copy_value(${materialized.value})`;
  if (leaks.length === 0) {
    return [...materialized.prelude, `${indent}return ${returnExpr};`].join('\n');
  }

  const resultName = context.getAnonymousVarName('__return');
  return [
    ...materialized.prelude,
    `${indent}Ps2Value* ${resultName} = ${returnExpr};`,
    ...leaks,
    `${indent}return ${resultName};`
  ].join('\n');
}

function generateOwnedHeapLeaks(
  returnedExpr: Expr | undefined,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): string[] {
  return generateHeapLeaks(state.ownedHeapLocals ?? [], returnedExpr, context, indent, state);
}

function generateHeapLeaks(
  heaps: Array<Omit<SpecHeapState, 'stateName'>>,
  returnedExpr: Expr | undefined,
  context: Pseudo2GeneratorContext,
  indent: string,
  state: CGeneratorState
): string[] {
  const returned = returnedExpr ? directSpecReceiver(returnedExpr, context, state) : undefined;
  const heapReceivers = new Set(heaps.map(heap => heap.receiver));
  return heaps
    .filter(heap => {
      if (returned && isHeapContainedBy(heap.receiver, returned, state)) {
        return false;
      }
      const parent = state.heapContainments?.get(heap.receiver);
      return returned !== undefined || !parent || heapReceivers.has(parent);
    })
    .map(heap => {
      const predicate = heap.kind === 'array' ? 'ps2_array_state' : 'ps2_struct_state';
      return `${indent}//@ leak ${predicate}(${heap.receiver}, _);`;
    });
}

function isHeapContainedBy(receiver: string, container: string, state: CGeneratorState): boolean {
  let current = resolveHeapAlias(receiver, state.heapAliases ?? new Map());
  const target = resolveHeapAlias(container, state.heapAliases ?? new Map());
  const visited = new Set<string>();
  while (!visited.has(current)) {
    if (current === target) {
      return true;
    }
    visited.add(current);
    const parent = state.heapContainments?.get(current);
    if (!parent) {
      return false;
    }
    current = resolveHeapAlias(parent, state.heapAliases ?? new Map());
  }
  return false;
}

function directSpecReceiver(expr: Expr, context: Pseudo2GeneratorContext, state: CGeneratorState): string | undefined {
  const unwrapped = unwrapSingletonSpecExpr(expr);
  if (isVarRef(unwrapped) && !unwrapped.index) {
    return resolveHeapAlias(genSpecExpr(unwrapped, context, state), state.heapAliases ?? new Map());
  }
  if (isThisExpr(unwrapped)) {
    return state.thisName;
  }
  return undefined;
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
  const receivers = collectExprHeapReceivers(statement.condition, context, state);
  const phase = context.getAnonymousVarName('assert').replace(/[^a-zA-Z0-9_]/g, '_');
  const heapStates = createSpecHeapStates(receivers, phase, new Map(), context, state);
  const spec = genSpecExpr(statement.condition, context, { ...state, specHeapStates: heapStates });
  const heapChunks = uniqueHeapStates(heapStates).map(heapState => heapStatePredicate(heapState));
  const statefulSpec = [...heapChunks, spec].join(' &*& ');

  switch (statement.kind) {
    case 'assume':
      if (heapChunks.length > 0) {
        throw new Error('Heap model helpers are not supported in @assume. Establish an owned state with a function contract or loop invariant.');
      }
      return `${indent}//@ assume(${spec});`;
    case 'assert':
      return `${indent}//@ assert ${statefulSpec};`;
    case 'open':
    case 'close':
    case 'leak':
      return `${indent}//@ ${statement.kind} ${spec};`;
    default:
      throw new Error(`Unsupported VeriFast statement kind: ${statement.kind}`);
  }
}

function genExpr(expr: Expr, context: Pseudo2GeneratorContext, state = DEFAULT_STATE): string {
  const materialized = state.expressionTemps?.get(expr);
  if (materialized) return materialized;
  if (isIntLiteral(expr)) return `ps2_int(${expr.value})`;
  if (isBoolLiteral(expr)) return `ps2_bool(${expr.value === 'true' ? 1 : 0})`;
  if (isStringLiteral(expr)) {
    const helperName = state.stringLiteralNames?.get(expr.value);
    return helperName ? `${helperName}()` : `ps2_string(${JSON.stringify(expr.value)})`;
  }
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
  if (isIndexSelection(expr)) return genArrayGet(genExpr(expr.receiver, context, state), expr.index, context, state);
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
    const target = expr.ref?.ref;
    const receiver = target ? context.getVarName(target) : '/* unresolved */';
    return expr.index
      ? genSpecArrayElementAccess(receiver, expr.index, context, state)
      : receiver;
  }
  if (isIndexSelection(expr)) {
    const receiver = genSpecExpr(expr.receiver, context, { ...state, specHeapStates: undefined });
    return genSpecArrayElementAccess(receiver, expr.index, context, state);
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

  if (!ops.includes('^')) {
    let chain = `(${genSpecExpr(left, context, state)}`;
    for (let i = 0; i < rights.length; i++) {
      chain += ` ${specOperator(ops[i] ?? ops[0] ?? '?')} ${genSpecExpr(rights[i], context, state)}`;
    }
    return `${chain})`;
  }

  let out = genSpecExpr(left, context, state);
  for (let i = 0; i < rights.length; i++) {
    const op = ops[i] ?? ops[0] ?? '?';
    const right = genSpecExpr(rights[i], context, state);
    out = op === '^'
      ? `ps2_model_power(${out}, ${right})`
      : `(${out} ${specOperator(op)} ${right})`;
  }
  return out;
}

function specOperator(op: string): string {
  if (op === 'mod') {
    return '%';
  }
  return op;
}

function genSpecPredicate(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  switch (expr.kind) {
    case 'vf_value':
      return `(ps2_model_value(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_number':
      return `(ps2_model_kind(${genSingleSpecArg(expr, context, state)}) == ps2_number_kind)`;
    case 'vf_integer':
      return genSpecInteger(expr, context, state);
    case 'vf_array':
      return genSpecHeapKind(expr, context, state, 'array');
    case 'vf_struct':
      return genSpecHeapKind(expr, context, state, 'struct');
    case 'vf_len':
      return genSpecArrayLength(expr, context, state);
    case 'vf_int':
      return `ps2_model_int(${genSingleSpecArg(expr, context, state)})`;
    case 'vf_real':
      return `ps2_model_real(${genSingleSpecArg(expr, context, state)})`;
    case 'vf_ratio':
      return genSpecRatio(expr, context, state);
    case 'vf_bool':
      return `(ps2_model_bool(${genSingleSpecArg(expr, context, state)}) == true)`;
    case 'vf_truthy':
      return genSpecTruthy(expr, context, state);
    case 'vf_string':
      return genSpecString(expr, context, state);
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
    case 'vf_same':
      return genSpecSame(expr, context, state);
    default:
      throw new Error(`Unsupported VeriFast spec helper: ${expr.kind}`);
  }
}

function genSpecHeapKind(
  expr: SpecPredicateExpr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState,
  kind: HeapKind
): string {
  const value = genSingleSpecArg(expr, context, state);
  const modelKind = kind === 'array' ? 'ps2_array_kind' : 'ps2_struct_kind';
  const modelPredicate = kind === 'array' ? 'ps2_model_array' : 'ps2_model_struct';
  return `((ps2_model_kind(${value}) == ${modelKind}) && (${modelPredicate}(${value}) == true))`;
}

function genSpecSame(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_same expects exactly two arguments.');
  }
  return `(${genSpecExpr(args[0], context, state)} == ${genSpecExpr(args[1], context, state)})`;
}

function genSpecInteger(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const value = genSingleSpecArg(expr, context, state);
  return `((ps2_model_kind(${value}) == ps2_number_kind) && (ps2_model_integral(${value}) == true))`;
}

function genSpecRatio(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_ratio expects exactly two arguments.');
  }
  const denominator = unwrapSingletonSpecExpr(args[1]);
  if (!isIntLiteral(denominator) || denominator.value === 0) {
    throw new Error('vf_ratio expects a non-zero integer literal as its second argument.');
  }
  return `(real_of_int(${genSpecExpr(args[0], context, state)}) / ${denominator.value}r)`;
}

function genSpecTruthy(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const value = genSingleSpecArg(expr, context, state);
  return `(ps2_model_kind(${value}) == ps2_undefined_kind || ps2_model_kind(${value}) == ps2_null_kind ? false : ps2_model_kind(${value}) == ps2_bool_kind ? ps2_model_bool(${value}) : ps2_model_kind(${value}) == ps2_number_kind ? ps2_model_real(${value}) != 0 : ps2_model_kind(${value}) == ps2_string_kind ? ps2_model_string_content(${value}) != nil : true)`;
}

function genSpecString(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 1 && args.length !== 2) {
    throw new Error('vf_string expects one or two arguments.');
  }

  const value = genSpecExpr(args[0], context, state);
  const typeFact = `(ps2_model_string(${value}) == true)`;
  if (args.length === 1) {
    return typeFact;
  }

  const expected = unwrapSingletonSpecExpr(args[1]);
  if (!isStringLiteral(expected)) {
    throw new Error('vf_string expects a string literal as its second argument.');
  }
  return `(${typeFact} && (ps2_model_string_content(${value}) == ${genVeriFastStringContent(expected.value)}))`;
}

function genSingleSpecArg(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 1) {
    throw new Error(`${expr.kind} expects exactly one argument.`);
  }
  return genSpecExpr(args[0], context, state);
}

function getBoundHeapState(
  kind: HeapKind,
  receiverExpr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): SpecHeapState | undefined {
  const receiver = genSpecExpr(receiverExpr, context, { ...state, specHeapStates: undefined });
  return getBoundHeapStateForReceiver(kind, receiver, state);
}

function getBoundHeapStateForReceiver(
  kind: HeapKind,
  receiver: string,
  state: CGeneratorState
): SpecHeapState | undefined {
  return state.specHeapStates?.get(heapStateKey(kind, receiver));
}

function genSpecArrayLength(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 1) {
    throw new Error('vf_len expects exactly one argument.');
  }
  const heapState = getBoundHeapState('array', args[0], context, state);
  return heapState
    ? `length(${heapState.stateName})`
    : `ps2_model_array_length(${genSpecExpr(args[0], context, state)})`;
}

function genSpecArrayElement(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_elem expects exactly two arguments.');
  }

  const receiver = genSpecExpr(args[0], context, { ...state, specHeapStates: undefined });
  return genSpecArrayElementAccess(receiver, args[1], context, state);
}

/**
 * Übersetzt einen 1-basierten Pseudo2-Arrayzugriff in das VeriFast-Modell.
 *
 * Ist für den Empfänger ein Heap-Prädikat gebunden, wird direkt aus dessen
 * Zustandsliste gelesen. Ohne gebundenen Zustand bleibt der abstrakte
 * Fixpunktzugriff erhalten. Diese gemeinsame Abbildung wird sowohl für
 * `vf_elem(A, i)` als auch für die natürliche Schreibweise `A[i]` genutzt.
 */
function genSpecArrayElementAccess(
  receiver: string,
  indexExpr: Expr,
  context: Pseudo2GeneratorContext,
  state: CGeneratorState
): string {
  const heapState = getBoundHeapStateForReceiver('array', receiver, state);
  const index = genSpecIndexExpr(indexExpr, context, state);
  return heapState
    ? `nth(${index} - 1, ${heapState.stateName})`
    : `ps2_model_array_item(${receiver}, ${index})`;
}

function genSpecArrayBounds(expr: SpecPredicateExpr, context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  const args = expr.args ?? [];
  if (args.length !== 2) {
    throw new Error('vf_in_bounds expects exactly two arguments.');
  }

  const array = genSpecExpr(args[0], context, state);
  const index = genSpecIndexExpr(args[1], context, state);
  const heapState = getBoundHeapState('array', args[0], context, state);
  const length = heapState ? `length(${heapState.stateName})` : `ps2_model_array_length(${array})`;
  return `((1 <= ${index}) && (${index} <= ${length}))`;
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

  const fieldId = context.getStructFieldId(field);
  const heapState = getBoundHeapState('struct', args[0], context, state);
  return heapState
    ? `ps2_struct_field_lookup(${fieldId}, ${heapState.stateName})`
    : `ps2_model_struct_field(${genSpecExpr(args[0], context, state)}, ${fieldId})`;
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


  if (isIndexSelection(target)) {
    return genArraySet(genExpr(target.receiver, context, state), target.index, value, context, state);
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
  state: CGeneratorState,
  additionalInvariants: string[] = [],
  additionalHeapReceivers: Array<Omit<SpecHeapState, 'stateName'>> = []
): string[] {
  const invariantAnnotations = annotations.filter(annotation => annotation.kind === 'invariant');
  const decreasesAnnotations = annotations.filter(annotation => annotation.kind === 'decreases');
  const heapStates = createLoopSpecHeapStates(annotations, context, state, additionalHeapReceivers);
  const specState = { ...state, specHeapStates: heapStates };
  const generatedInvariant = state.topLevel && state.globalNames.length > 0
    ? state.globalNames.map(name => `${name} |-> _`).join(' &*& ')
    : 'true';
  const invariants = [
    ...uniqueHeapStates(heapStates).map(heapState => heapStatePredicate(heapState)),
    ...invariantAnnotations.map(annotation => genSpecExpr(annotation.condition, context, specState)),
    ...additionalInvariants,
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
    sourceMapped(annotation, `${indent}  //@ decreases ${genSpecExpr(annotation.condition, context, specState)};`, state)
  );

  return [...invariantOutput, ...decreasesOutput];
}

function withLoopSpecHeapStates(
  annotations: LoopAnnotation[],
  context: Pseudo2GeneratorContext,
  state: CGeneratorState,
  additionalHeapReceivers: Array<Omit<SpecHeapState, 'stateName'>> = []
): CGeneratorState {
  return {
    ...state,
    specHeapStates: createLoopSpecHeapStates(annotations, context, state, additionalHeapReceivers)
  };
}

function createLoopSpecHeapStates(
  annotations: LoopAnnotation[],
  context: Pseudo2GeneratorContext,
  state: CGeneratorState,
  additionalHeapReceivers: Array<Omit<SpecHeapState, 'stateName'>> = []
): ReadonlyMap<string, SpecHeapState> {
  const invariantAnnotations = annotations.filter(annotation => annotation.kind === 'invariant');
  const heapReceivers = mergeHeapReceivers(
    additionalHeapReceivers,
    invariantAnnotations.flatMap(annotation => collectExprHeapReceivers(annotation.condition, context, state))
  );
  return createSpecHeapStates(heapReceivers, 'loop', new Map(), context, state);
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
    parts.push(`${comparisonRuntimeFunction(ops[i] ?? '<')}(${genExpr(previous, context, state)}, ${genExpr(rights[i], context, state)})`);
    previous = rights[i];
  }

  return `ps2_bool(${parts.join(' && ')})`;
}

function genOpChain(left: Expr, ops: string[], rights: Expr[], context: Pseudo2GeneratorContext, state: CGeneratorState): string {
  let out = genExpr(left, context, state);

  for (let i = 0; i < rights.length; i++) {
    const op = ops[i] ?? '+';
    const right = unwrapSingletonSpecExpr(rights[i]);
    const literalDivision = op === '/' && isIntLiteral(right)
      ? state.divisionLiteralNames?.get(right.value)
      : undefined;
    out = literalDivision
      ? `${literalDivision}(${out})`
      : `${binaryRuntimeFunction(op)}(${out}, ${genExpr(rights[i], context, state)})`;
  }

  return out;
}

function binaryRuntimeFunction(op: string): string {
  switch (op) {
    case '+': return 'ps2_add';
    case '-': return 'ps2_subtract';
    case '*': return 'ps2_multiply';
    case '/': return 'ps2_divide';
    case '%':
    case 'mod': return 'ps2_modulo';
    case '^': return 'ps2_power';
    default: throw new Error(`Unsupported binary operator for C generator: ${op}`);
  }
}

function comparisonRuntimeFunction(op: string): string {
  switch (op) {
    case '<': return 'ps2_less';
    case '<=': return 'ps2_less_equal';
    case '>': return 'ps2_greater';
    case '>=': return 'ps2_greater_equal';
    default: throw new Error(`Unsupported comparison operator for C generator: ${op}`);
  }
}
