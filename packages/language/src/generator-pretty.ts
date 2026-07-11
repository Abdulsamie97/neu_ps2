import type {
  Block,
  Expr,
  FunctionDeclaration,
  Instruction,
  LoopAnnotation,
  ParameterDecl,
  Program,
  StructAttDeclaration,
  StructDeclaration,
  StructDeclarationChild,
  TypeRef
} from './generated/ast.js';
import {
  isAddition,
  isAnd,
  isArrayLiteral,
  isArrayType,
  isAssignment,
  isAttSelection,
  isBoolLiteral,
  isBoolType,
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
  isIntLiteral,
  isMethSelection,
  isMultiplication,
  isNeg,
  isNewExpr,
  isNot,
  isNullLiteral,
  isNumType,
  isOr,
  isPrintCommand,
  isResultExpr,
  isReturnStmt,
  isSpecPredicateExpr,
  isStringLiteral,
  isStringType,
  isStructAttDeclaration,
  isStructDeclaration,
  isStructType,
  isThisExpr,
  isThrowCommand,
  isVarDecl,
  isVarRef,
  isVerificationStatement,
  isWhileLoop
} from './generated/ast.js';

export interface PrettyPseudo2Options {
  indent?: string;
}

interface PrettyContext {
  indent: string;
}

export function generatePrettyPseudo2(program: Program, options: PrettyPseudo2Options = {}): string {
  const ctx: PrettyContext = {
    indent: options.indent ?? '  '
  };

  const code = (program.instructions ?? [])
    .map(instruction => printInstruction(instruction, 0, ctx))
    .join('\n\n')
    .trimEnd();

  return code.length > 0 ? `${code}\n` : '';
}

function printInstruction(instruction: Instruction, level: number, ctx: PrettyContext): string {
  const prefix = indentation(level, ctx);

  if (isVarDecl(instruction)) {
    const size = instruction.isArrayVariable && instruction.size ? `[${printExpr(instruction.size)}]` : '';
    const initializer = instruction.initializer ? ` = ${printExpr(instruction.initializer)}` : '';
    return `${prefix}var ${instruction.name}${size}${initializer}`;
  }

  if (isAssignment(instruction)) {
    return `${prefix}${printExpr(instruction.sel)} = ${printExpr(instruction.value)}`;
  }

  if (isExprStatement(instruction)) {
    return `${prefix}${printExpr(instruction.expr)}`;
  }

  if (isReturnStmt(instruction)) {
    return instruction.retExpr ? `${prefix}return ${printExpr(instruction.retExpr)}` : `${prefix}return`;
  }

  if (isPrintCommand(instruction)) {
    return `${prefix}print ${printExpr(instruction.param)}`;
  }

  if (isThrowCommand(instruction)) {
    return `${prefix}throw ${printExpr(instruction.param)}`;
  }

  if (isCallCommand(instruction)) {
    return `${prefix}call ${printExpr(instruction.param)}`;
  }

  if (isVerificationStatement(instruction)) {
    return `${prefix}@${instruction.kind} ${printExpr(instruction.condition)}`;
  }

  if (isIfStatement(instruction)) {
    const elseBlock = instruction.elseBlock ? ` else ${printBlock(instruction.elseBlock, level, ctx)}` : '';
    return `${prefix}if ${printExpr(instruction.condition)} ${printBlock(instruction.thenBlock, level, ctx)}${elseBlock}`;
  }

  if (isWhileLoop(instruction)) {
    return withLoopAnnotations(
      instruction.annotations ?? [],
      `${prefix}while ${printExpr(instruction.condition)} ${printBlock(instruction.body, level, ctx)}`,
      level,
      ctx
    );
  }

  if (isForLoop(instruction)) {
    const iterator = instruction.iterator ? `${instruction.iterator.name} = ` : '';
    const step = instruction.step ? ` by ${printExpr(instruction.step)}` : '';
    return withLoopAnnotations(
      instruction.annotations ?? [],
      `${prefix}for ${iterator}${printExpr(instruction.from)} ${instruction.direction} ${printExpr(instruction.to)}${step} ${printBlock(instruction.body, level, ctx)}`,
      level,
      ctx
    );
  }

  if (isDoWhileLoop(instruction)) {
    return withLoopAnnotations(
      instruction.annotations ?? [],
      `${prefix}do ${printBlock(instruction.body, level, ctx)} while ${printExpr(instruction.condition)}`,
      level,
      ctx
    );
  }

  if (isFunctionDeclaration(instruction)) {
    return printFunction(instruction, level, ctx);
  }

  if (isStructDeclaration(instruction)) {
    return printStruct(instruction, level, ctx);
  }

  return `${prefix}<unknown instruction>`;
}

function printBlock(block: Block, level: number, ctx: PrettyContext): string {
  const instructions = block.instructions ?? [];

  if (instructions.length === 0) {
    return '{}';
  }

  const body = instructions
    .map(instruction => printInstruction(instruction, level + 1, ctx))
    .join('\n');

  return `{\n${body}\n${indentation(level, ctx)}}`;
}

function printFunction(fn: FunctionDeclaration, level: number, ctx: PrettyContext): string {
  const prefix = indentation(level, ctx);
  const annotations = (fn.annotations ?? [])
    .map(annotation => annotation.condition
      ? `${prefix}@${annotation.kind} ${printExpr(annotation.condition)}`
      : `${prefix}@${annotation.kind}`);
  const keyword = fn.keyword === true ? 'func ' : '';
  const params = (fn.params ?? []).map(printParameter).join(', ');
  const declaration = `${prefix}${keyword}${fn.name}(${params}) ${printBlock(fn.body, level, ctx)}`;
  return [...annotations, declaration].join('\n');
}

function withLoopAnnotations(
  annotations: LoopAnnotation[],
  loopText: string,
  level: number,
  ctx: PrettyContext
): string {
  if (annotations.length === 0) {
    return loopText;
  }

  const prefix = indentation(level, ctx);
  const annotationLines = annotations.map(annotation => `${prefix}@${annotation.kind} ${printExpr(annotation.condition)}`);
  return [...annotationLines, loopText].join('\n');
}

function printParameter(parameter: ParameterDecl): string {
  if (!parameter.isArray) {
    return parameter.name;
  }

  const start = parameter.start ?? 1;
  const len = parameter.len?.name ?? '';
  return `${parameter.name}[${start}..${len}]`;
}

function printStruct(struct: StructDeclaration, level: number, ctx: PrettyContext): string {
  const prefix = indentation(level, ctx);
  const children = (struct.children ?? [])
    .map(child => printStructChild(child, level + 1, ctx))
    .join('\n');

  if (children.length === 0) {
    return `${prefix}struct ${struct.name} {}`;
  }

  return `${prefix}struct ${struct.name} {\n${children}\n${prefix}}`;
}

function printStructChild(child: StructDeclarationChild, level: number, ctx: PrettyContext): string {
  if (isStructAttDeclaration(child)) {
    return printStructAttribute(child, level, ctx);
  }

  return printFunction(child, level, ctx);
}

function printStructAttribute(attribute: StructAttDeclaration, level: number, ctx: PrettyContext): string {
  return `${indentation(level, ctx)}${printType(attribute.type)} ${attribute.name}`;
}

function printType(type: TypeRef): string {
  if (isArrayType(type)) {
    return `${printType(type.base)}[]`;
  }

  if (isNumType(type)) return 'num';
  if (isStringType(type)) return 'string';
  if (isBoolType(type)) return 'bool';
  if (isStructType(type)) return type.struct.ref?.name ?? '<unresolved-struct>';

  return '<unknown-type>';
}

function printExpr(expr: Expr): string {
  if (isOr(expr)) {
    return printBinaryChain(expr.left, expr.right, expr.right.map(() => '||'));
  }

  if (isAnd(expr)) {
    return printBinaryChain(expr.left, expr.right, expr.right.map(() => '&&'));
  }

  if (isEquality(expr) || isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
    return printBinaryChain(expr.left, expr.right, expr.op);
  }

  if (isNot(expr)) {
    return `!${printExpr(expr.value)}`;
  }

  if (isNeg(expr)) {
    return `-${printExpr(expr.value)}`;
  }

  if (isGrouping(expr)) {
    return `(${printExpr(expr.value)})`;
  }

  if (isIntLiteral(expr)) {
    return String(expr.value);
  }

  if (isStringLiteral(expr)) {
    return JSON.stringify(expr.value);
  }

  if (isBoolLiteral(expr)) {
    return expr.value;
  }

  if (isNullLiteral(expr)) {
    return 'null';
  }

  if (isResultExpr(expr)) {
    return 'result';
  }

  if (isSpecPredicateExpr(expr)) {
    return `${expr.kind}(${(expr.args ?? []).map(printExpr).join(', ')})`;
  }

  if (isThisExpr(expr)) {
    return 'this';
  }

  if (isVarRef(expr)) {
    const index = expr.index ? `[${printExpr(expr.index)}]` : '';
    return `${expr.ref.ref?.name ?? '<unresolved-var>'}${index}`;
  }

  if (isAttSelection(expr)) {
    const index = expr.attref.index ? `[${printExpr(expr.attref.index)}]` : '';
    return `${printExpr(expr.receiver)}.${expr.attref.ref.ref?.name ?? '<unresolved-att>'}${index}`;
  }

  if (isFunctionCall(expr)) {
    const params = (expr.params ?? []).map(printExpr).join(', ');
    return `${expr.f.ref?.name ?? '<unresolved-func>'}(${params})`;
  }

  if (isMethSelection(expr)) {
    const params = (expr.methref.params ?? []).map(printExpr).join(', ');
    return `${printExpr(expr.receiver)}.${expr.methref.f.ref?.name ?? '<unresolved-method>'}(${params})`;
  }

  if (isArrayLiteral(expr)) {
    return `[${(expr.elems ?? []).map(printExpr).join(', ')}]`;
  }

  if (isNewExpr(expr)) {
    return `new ${expr.type.ref?.name ?? '<unresolved-struct>'}`;
  }

  return '<unknown-expr>';
}

function printBinaryChain(left: Expr, right: Expr[], operators: string[]): string {
  let current = printExpr(left);

  for (let i = 0; i < right.length; i++) {
    current = `(${current} ${operators[i] ?? ''} ${printExpr(right[i])})`;
  }

  return current;
}

function indentation(level: number, ctx: PrettyContext): string {
  return ctx.indent.repeat(level);
}
