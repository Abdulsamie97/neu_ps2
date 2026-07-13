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
  IfStatement,
  IndexSelection,
  Instruction,
  MethSelection,
  PrintCommand,
  ReturnStmt,
  ThrowCommand,
  VarDecl,
  VarRef,
  WhileLoop
} from '../generated/ast.js';
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
  isReturnStmt,
  isSpecPredicateExpr,
  isStringLiteral,
  isThrowCommand,
  isVarDecl,
  isVarRef,
  isVerificationStatement,
  isWhileLoop
} from '../generated/ast.js';

export function printExpr(expr: Expr): string {
  if (isIntLiteral(expr)) return String(expr.value);
  if (isBoolLiteral(expr)) return String(expr.value);
  if (isStringLiteral(expr)) return JSON.stringify(expr.value);
  if (isNullLiteral(expr)) return 'null';
  if (isResultExpr(expr)) return 'result';
  if (isSpecPredicateExpr(expr)) return `${expr.kind}(${(expr.args ?? []).map(printExpr).join(',')})`;
  if (isGrouping(expr)) return `(${printExpr(expr.value)})`;
  if (isNot(expr)) return `(! ${printExpr(expr.value)})`;
  if (isNeg(expr)) return `(- ${printExpr(expr.value)})`;
  if (isArrayLiteral(expr)) return printArrayLiteral(expr);
  if (isNewExpr(expr)) return `new ${expr.type?.ref?.name ?? '/*unresolved*/'}`;
  if (isVarRef(expr)) return printVarRef(expr);
  if (isAttSelection(expr)) return printAttSelection(expr);
  if (isIndexSelection(expr)) return printIndexSelection(expr);
  if (isMethSelection(expr)) return printMethSelection(expr);
  if (isFunctionCall(expr)) return printFunctionCall(expr);

  if (isOr(expr)) return printRepeated(expr.left, ['||'], expr.right);
  if (isAnd(expr)) return printRepeated(expr.left, ['&&'], expr.right);
  if (isEquality(expr) || isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) {
    return printRepeated(expr.left, expr.op ?? [], expr.right ?? []);
  }

  return expr.$type;
}

export function printInstruction(instruction: Instruction): string {
  if (isVarDecl(instruction)) return printVarDecl(instruction);
  if (isAssignment(instruction)) return printAssignment(instruction);
  if (isExprStatement(instruction)) return printExprStatement(instruction);
  if (isReturnStmt(instruction)) return printReturn(instruction);
  if (isPrintCommand(instruction)) return printPrint(instruction);
  if (isThrowCommand(instruction)) return printThrow(instruction);
  if (isCallCommand(instruction)) return printCall(instruction);
  if (isVerificationStatement(instruction)) return `@${instruction.kind} ${printExpr(instruction.condition)}`;
  if (isIfStatement(instruction)) return printIf(instruction);
  if (isWhileLoop(instruction)) return printWhile(instruction);
  if (isDoWhileLoop(instruction)) return printDoWhile(instruction);
  if (isForLoop(instruction)) return printFor(instruction);
  if (isBracedBlock(instruction) || isIndentedBlock(instruction)) return printBlock(instruction);

  return instruction.$type;
}

function printRepeated(left: Expr, ops: string[], rights: Expr[]): string {
  if (rights.length === 0) {
    return printExpr(left);
  }

  let out = `(${printExpr(left)}`;
  for (let i = 0; i < rights.length; i++) {
    out += ` ${ops[i] ?? '?'} ${printExpr(rights[i])}`;
  }
  return `${out})`;
}

function printArrayLiteral(expr: ArrayLiteral): string {
  return `[${(expr.elems ?? []).map(printExpr).join(',')}]`;
}

function printVarRef(expr: VarRef): string {
  const name = expr.ref?.ref?.name ?? '/*unresolved*/';
  return expr.index ? `${name}[${printExpr(expr.index)}]` : name;
}

function printAttSelection(expr: AttSelection): string {
  const name = expr.attref.ref?.ref?.name ?? '/*unresolved*/';
  const access = expr.attref.index ? `${name}[${printExpr(expr.attref.index)}]` : name;
  return `${printExpr(expr.receiver)}.${access}`;
}

function printIndexSelection(expr: IndexSelection): string {
  return `${printExpr(expr.receiver)}[${printExpr(expr.index)}]`;
}

function printMethSelection(expr: MethSelection): string {
  const name = expr.methref.f?.ref?.name ?? '/*unresolved*/';
  const params = (expr.methref.params ?? []).map(printExpr).join(',');
  return `${printExpr(expr.receiver)}.${name}(${params})`;
}

function printFunctionCall(expr: FunctionCall): string {
  const name = expr.f?.ref?.name ?? '/*unresolved*/';
  const params = (expr.params ?? []).map(printExpr).join(',');
  return `${name}(${params})`;
}

function printVarDecl(decl: VarDecl): string {
  const arrayPart = decl.isArrayVariable && decl.size ? `[${printExpr(decl.size)}]` : '';
  const initPart = decl.initializer ? ` = ${printExpr(decl.initializer)}` : '';
  return `var ${decl.name}${arrayPart}${initPart}`;
}

function printAssignment(assign: Assignment): string {
  return `${printExpr(assign.sel)} = ${printExpr(assign.value)}`;
}

function printExprStatement(stmt: ExprStatement): string {
  return printExpr(stmt.expr);
}

function printReturn(ret: ReturnStmt): string {
  return ret.retExpr ? `return ${printExpr(ret.retExpr)}` : 'return';
}

function printPrint(cmd: PrintCommand): string {
  return `print ${printExpr(cmd.param)}`;
}

function printThrow(cmd: ThrowCommand): string {
  return `throw ${printExpr(cmd.param)}`;
}

function printCall(cmd: CallCommand): string {
  return `call ${printExpr(cmd.param)}`;
}

function printIf(stmt: IfStatement): string {
  return `if ${printExpr(stmt.condition)}`;
}

function printWhile(stmt: WhileLoop): string {
  return `while ${printExpr(stmt.condition)}`;
}

function printDoWhile(stmt: DoWhileLoop): string {
  return `do while ${printExpr(stmt.condition)}`;
}

function printFor(stmt: ForLoop): string {
  const iterator = stmt.iterator ? `${stmt.iterator.name} = ` : '';
  const step = stmt.step ? ` by ${printExpr(stmt.step)}` : '';
  return `for ${iterator}${printExpr(stmt.from)} ${stmt.direction} ${printExpr(stmt.to)}${step}`;
}

function printBlock(block: Block): string {
  return `{ ${(block.instructions ?? []).map(printInstruction).join('; ')} }`;
}
