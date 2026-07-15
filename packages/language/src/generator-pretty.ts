/**
 * @file generator-pretty.ts
 * @brief Erzeugt eine kanonische Pseudo2-Fassung mit expliziten Blockklammern.
 * @author Abdul
 */

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
  isIndexSelection,
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

/**
 * Konfiguration der formatierten Pseudo2-Ausgabe.
 */
export interface PrettyPseudo2Options {
  /** Pro Verschachtelungsebene verwendete Einrückungszeichen. */
  indent?: string;
}

/**
 * Normalisierter, intern an alle Druckfunktionen weitergereichter Kontext.
 */
interface PrettyContext {
  /** Tatsächlich verwendete Einrückungszeichenfolge. */
  indent: string;
}

/**
 * Druckt ein vollständiges Programm mit expliziten geschweiften Blockklammern.
 *
 * Top-Level-Anweisungen werden durch Leerzeilen getrennt. Eine nicht leere
 * Ausgabe endet immer mit genau einem Zeilenumbruch; ein leeres Programm liefert
 * den Leerstring.
 *
 * @param program Zu formatierender Pseudo2-AST.
 * @param options Optionale Einrückungskonfiguration.
 * @returns Kanonisch formatierter Pseudo2-Quelltext.
 */
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

/**
 * Verteilt eine Anweisung an den passenden spezialisierten Druckpfad.
 *
 * Die Funktion erhält Annotationen und alle sprachlichen Konstrukte. Nicht
 * erkannte AST-Typen werden sichtbar als `<unknown instruction>` ausgegeben,
 * damit der Pretty-Printer auch bei zukünftigen Grammatikergänzungen definiert bleibt.
 *
 * @param instruction Zu druckende Pseudo2-Anweisung.
 * @param level Aktuelle Verschachtelungstiefe.
 * @param ctx Pretty-Print-Kontext.
 * @returns Vollständig eingerückter Anweisungstext.
 */
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

/**
 * Druckt einen Block unabhängig von seiner ursprünglichen Einrückungsform mit Klammern.
 *
 * @param block Braced- oder Indented-Block aus dem AST.
 * @param level Einrückungsebene der schließenden Klammer.
 * @param ctx Pretty-Print-Kontext.
 * @returns `{}` für leere oder mehrzeilige Darstellung für gefüllte Blöcke.
 */
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

/**
 * Druckt Funktionsverträge, Signatur, Parameter und Body einer Funktion oder Methode.
 *
 * Das Schlüsselwort `func` wird nur bei globalen Funktionen ausgegeben; Methoden
 * behalten die in der Grammatik vorgesehene schlüsselwortlose Form.
 *
 * @param fn Zu druckende Funktions- oder Methodendeklaration.
 * @param level Aktuelle Einrückungsebene.
 * @param ctx Pretty-Print-Kontext.
 * @returns Mehrzeilige Deklaration einschließlich Annotationen.
 */
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

/**
 * Stellt Loop-Annotationen unmittelbar vor den bereits gedruckten Schleifentext.
 *
 * @param annotations Invarianten und Varianten in Quellreihenfolge.
 * @param loopText Vollständig gedruckter Schleifenkopf samt Body.
 * @param level Einrückungsebene der Annotationen.
 * @param ctx Pretty-Print-Kontext.
 * @returns Annotationen und Schleife oder unveränderten Schleifentext.
 */
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

/**
 * Druckt einen skalaren oder Array-Parameter.
 *
 * Für Array-Parameter wird der 1-basierte Bereich aus Start und symbolischem
 * Längenparameter rekonstruiert. Fehlt der Start, gilt `1`.
 *
 * @param parameter Zu druckender Parameter.
 * @returns Parametertext für die Funktionssignatur.
 */
function printParameter(parameter: ParameterDecl): string {
  if (!parameter.isArray) {
    return parameter.name;
  }

  const start = parameter.start ?? 1;
  const len = parameter.len?.name ?? '';
  return `${parameter.name}[${start}..${len}]`;
}

/**
 * Druckt eine Struct-Deklaration samt Attributen und Methoden.
 *
 * @param struct Zu druckendes Struct.
 * @param level Aktuelle Einrückungsebene.
 * @param ctx Pretty-Print-Kontext.
 * @returns Ein- oder mehrzeilige Struct-Deklaration.
 */
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

/**
 * Verteilt ein Struct-Kind auf Attribut- oder Methodendruck.
 *
 * @param child Attribut- oder Methodendeklaration.
 * @param level Einrückungsebene innerhalb des Structs.
 * @param ctx Pretty-Print-Kontext.
 * @returns Gedrucktes Struct-Kind.
 */
function printStructChild(child: StructDeclarationChild, level: number, ctx: PrettyContext): string {
  if (isStructAttDeclaration(child)) {
    return printStructAttribute(child, level, ctx);
  }

  return printFunction(child, level, ctx);
}

/**
 * Druckt Typ und Namen eines Struct-Attributs.
 *
 * @param attribute Zu druckende Attributdeklaration.
 * @param level Einrückungsebene innerhalb des Structs.
 * @param ctx Pretty-Print-Kontext.
 * @returns Vollständig eingerückte Attributzeile.
 */
function printStructAttribute(attribute: StructAttDeclaration, level: number, ctx: PrettyContext): string {
  return `${indentation(level, ctx)}${printType(attribute.type)} ${attribute.name}`;
}

/**
 * Rekonstruiert einen Pseudo2-Typ einschließlich beliebig vieler Arraydimensionen.
 *
 * @param type AST-Typreferenz.
 * @returns Pseudo2-Typtext oder sichtbarer Fallback bei ungelösten Typen.
 */
function printType(type: TypeRef): string {
  if (isArrayType(type)) {
    return `${printType(type.base)}${'[]'.repeat(type.dimensions.length)}`;
  }

  if (isNumType(type)) return 'num';
  if (isStringType(type)) return 'string';
  if (isBoolType(type)) return 'bool';
  if (isStructType(type)) return type.struct.ref?.name ?? '<unresolved-struct>';

  return '<unknown-type>';
}

/**
 * Druckt einen Ausdruck rekursiv und erhält seine AST-Auswertungsstruktur.
 *
 * Binäre Ketten werden schrittweise geklammert, Selektionsketten vollständig
 * rekonstruiert und VeriFast-Helfer wie normale Pseudo2-Aufrufe ausgegeben.
 * Ungelöste Cross-References und unbekannte Ausdrücke erhalten sichtbare Fallbacks.
 *
 * @param expr Zu druckender Pseudo2-Ausdruck.
 * @returns Kanonische Ausdrucksdarstellung.
 */
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

  if (isIndexSelection(expr)) {
    return `${printExpr(expr.receiver)}[${printExpr(expr.index)}]`;
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

/**
 * Druckt eine linksassoziative binäre Operatorfolge mit expliziter Klammerung.
 *
 * @param left Erster Operand.
 * @param right Weitere Operanden in AST-Reihenfolge.
 * @param operators Operatoren zwischen den Operanden.
 * @returns Schrittweise geklammerte Ausdruckskette.
 */
function printBinaryChain(left: Expr, right: Expr[], operators: string[]): string {
  let current = printExpr(left);

  for (let i = 0; i < right.length; i++) {
    current = `(${current} ${operators[i] ?? ''} ${printExpr(right[i])})`;
  }

  return current;
}

/**
 * Berechnet die Einrückung einer Verschachtelungsebene.
 *
 * @param level Nichtnegative Einrückungstiefe.
 * @param ctx Kontext mit dem gewählten Einrückungsmuster.
 * @returns Wiederholte Einrückungszeichenfolge.
 */
function indentation(level: number, ctx: PrettyContext): string {
  return ctx.indent.repeat(level);
}
