/**
 * @file pseudo2-printer.ts
 * @brief Druckt AST-Fragmente kompakt für Graphviz-Knoten und -Kanten.
 * @author Abdul
 */

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

/**
 * Druckt einen Pseudo2-Ausdruck in einer kompakten, menschenlesbaren Form.
 *
 * Die Funktion erhält Operatorreihenfolge, Selektionsketten und 1-basierte
 * Arrayzugriffe. Bei ungelösten Referenzen wird ein sichtbarer Platzhalter
 * ausgegeben, damit Graphen auch für unvollständige Programme erzeugbar bleiben.
 *
 * @param expr Zu druckender Ausdruck.
 * @returns Kompakte Pseudo2-Repräsentation des Ausdrucks.
 */
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

/**
 * Druckt eine Anweisung als einzeiliges Label für Kontrollflussgraphen.
 *
 * Kontrollstrukturen werden auf Kopf und Bedingung reduziert; ihre Blöcke
 * werden durch den CFG separat repräsentiert. Unbekannte Anweisungstypen fallen
 * auf ihren generierten AST-Typnamen zurück.
 *
 * @param instruction Zu druckende Pseudo2-Anweisung.
 * @returns Kompakte Textdarstellung für ein Graphviz-Label.
 */
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

/**
 * Setzt einen linksassoziativen Ausdruck aus linkem Operand und Operatorfolge zusammen.
 *
 * @param left Erster Operand der Kette.
 * @param ops Operatoren zwischen den Operanden.
 * @param rights Rechte Operanden in Auswertungsreihenfolge.
 * @returns Geklammerte Operatorfolge oder nur der linke Operand.
 */
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

/**
 * Druckt ein Arrayliteral einschließlich verschachtelter Elemente.
 *
 * @param expr Zu druckendes Arrayliteral.
 * @returns Pseudo2-Arrayliteral mit kommaseparierten Elementen.
 */
function printArrayLiteral(expr: ArrayLiteral): string {
  return `[${(expr.elems ?? []).map(printExpr).join(',')}]`;
}

/**
 * Druckt eine Variablenreferenz und gegebenenfalls ihren direkten Arrayindex.
 *
 * @param expr Variablenreferenz aus dem AST.
 * @returns Variablenname, optional gefolgt von `[index]`.
 */
function printVarRef(expr: VarRef): string {
  const name = expr.ref?.ref?.name ?? '/*unresolved*/';
  return expr.index ? `${name}[${printExpr(expr.index)}]` : name;
}

/**
 * Druckt einen Struct-Attributzugriff einschließlich optionalem Attributindex.
 *
 * @param expr Attributselektion mit Empfänger.
 * @returns Zugriff der Form `receiver.field` oder `receiver.field[index]`.
 */
function printAttSelection(expr: AttSelection): string {
  const name = expr.attref.ref?.ref?.name ?? '/*unresolved*/';
  const access = expr.attref.index ? `${name}[${printExpr(expr.attref.index)}]` : name;
  return `${printExpr(expr.receiver)}.${access}`;
}

/**
 * Druckt einen weiteren Index in einer Selektionskette.
 *
 * @param expr Verketteter Arrayzugriff.
 * @returns Zugriff der Form `receiver[index]`.
 */
function printIndexSelection(expr: IndexSelection): string {
  return `${printExpr(expr.receiver)}[${printExpr(expr.index)}]`;
}

/**
 * Druckt einen Methodenaufruf mit explizitem Empfänger und Argumenten.
 *
 * @param expr Methodenselektion aus dem AST.
 * @returns Aufruf der Form `receiver.method(arg1,arg2)`.
 */
function printMethSelection(expr: MethSelection): string {
  const name = expr.methref.f?.ref?.name ?? '/*unresolved*/';
  const params = (expr.methref.params ?? []).map(printExpr).join(',');
  return `${printExpr(expr.receiver)}.${name}(${params})`;
}

/**
 * Druckt einen freien Funktionsaufruf.
 *
 * @param expr Funktionsaufruf aus dem AST.
 * @returns Funktionsname und kommaseparierte Argumentliste.
 */
function printFunctionCall(expr: FunctionCall): string {
  const name = expr.f?.ref?.name ?? '/*unresolved*/';
  const params = (expr.params ?? []).map(printExpr).join(',');
  return `${name}(${params})`;
}

/**
 * Druckt eine Variablendeklaration mit optionaler Arraygröße und Initialisierung.
 *
 * @param decl Zu druckende Deklaration.
 * @returns Kompakte Deklaration beginnend mit `var`.
 */
function printVarDecl(decl: VarDecl): string {
  const arrayPart = decl.isArrayVariable && decl.size ? `[${printExpr(decl.size)}]` : '';
  const initPart = decl.initializer ? ` = ${printExpr(decl.initializer)}` : '';
  return `var ${decl.name}${arrayPart}${initPart}`;
}

/**
 * Druckt Ziel und Wert einer Zuweisung.
 *
 * @param assign Zu druckende Zuweisung.
 * @returns Zuweisung der Form `ziel = wert`.
 */
function printAssignment(assign: Assignment): string {
  return `${printExpr(assign.sel)} = ${printExpr(assign.value)}`;
}

/**
 * Druckt die Ausdruckskomponente einer Ausdrucksanweisung.
 *
 * @param stmt Ausdrucksanweisung.
 * @returns Gedruckter Ausdruck ohne zusätzliches Semikolon.
 */
function printExprStatement(stmt: ExprStatement): string {
  return printExpr(stmt.expr);
}

/**
 * Druckt eine Return-Anweisung mit optionalem Rückgabewert.
 *
 * @param ret Return-Knoten.
 * @returns `return` oder `return ausdruck`.
 */
function printReturn(ret: ReturnStmt): string {
  return ret.retExpr ? `return ${printExpr(ret.retExpr)}` : 'return';
}

/**
 * Druckt einen Pseudo2-Ausgabebefehl.
 *
 * @param cmd Print-Anweisung.
 * @returns Text der Form `print ausdruck`.
 */
function printPrint(cmd: PrintCommand): string {
  return `print ${printExpr(cmd.param)}`;
}

/**
 * Druckt einen Pseudo2-Fehlerwurf.
 *
 * @param cmd Throw-Anweisung.
 * @returns Text der Form `throw ausdruck`.
 */
function printThrow(cmd: ThrowCommand): string {
  return `throw ${printExpr(cmd.param)}`;
}

/**
 * Druckt einen expliziten Pseudo2-Call-Befehl.
 *
 * @param cmd Call-Anweisung.
 * @returns Text der Form `call ausdruck`.
 */
function printCall(cmd: CallCommand): string {
  return `call ${printExpr(cmd.param)}`;
}

/**
 * Druckt ausschließlich den Kopf einer If-Anweisung.
 *
 * @param stmt If-Anweisung.
 * @returns `if` mit gedruckter Bedingung.
 */
function printIf(stmt: IfStatement): string {
  return `if ${printExpr(stmt.condition)}`;
}

/**
 * Druckt ausschließlich den Kopf einer While-Schleife.
 *
 * @param stmt While-Schleife.
 * @returns `while` mit gedruckter Bedingung.
 */
function printWhile(stmt: WhileLoop): string {
  return `while ${printExpr(stmt.condition)}`;
}

/**
 * Druckt die Bedingung einer Do-While-Schleife in kompakter Form.
 *
 * @param stmt Do-While-Schleife.
 * @returns Text der Form `do while bedingung`.
 */
function printDoWhile(stmt: DoWhileLoop): string {
  return `do while ${printExpr(stmt.condition)}`;
}

/**
 * Druckt Kopf, Richtung und optionale Schrittweite einer For-Schleife.
 *
 * @param stmt For-Schleife.
 * @returns Kompakter For-Schleifenkopf.
 */
function printFor(stmt: ForLoop): string {
  const iterator = stmt.iterator ? `${stmt.iterator.name} = ` : '';
  const step = stmt.step ? ` by ${printExpr(stmt.step)}` : '';
  return `for ${iterator}${printExpr(stmt.from)} ${stmt.direction} ${printExpr(stmt.to)}${step}`;
}

/**
 * Druckt alle Anweisungen eines Blocks als flache, semikolongetrennte Folge.
 *
 * Diese Darstellung ist nur für kurze Graphviz-Labels gedacht und ersetzt
 * keinen vollständigen Pretty-Printer.
 *
 * @param block Braced- oder eingerückter Pseudo2-Block.
 * @returns Blockdarstellung in geschweiften Klammern.
 */
function printBlock(block: Block): string {
  return `{ ${(block.instructions ?? []).map(printInstruction).join('; ')} }`;
}
