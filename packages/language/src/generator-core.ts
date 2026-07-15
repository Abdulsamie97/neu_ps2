/**
 * @file generator-core.ts
 * @brief Gemeinsamer JavaScript-Generator für CLI, Weboberfläche und Sprachpaket.
 * @author Abdul
 */

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
  isParameterDecl,
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
import type { Pseudo2Type } from './typing/pseudo2-type.js';
import { PSEUDO2_RUNTIME_PRELUDE } from './runtime/runtime-prelude.js';

/**
 * Kontextabhängiger Zustand während der rekursiven JavaScript-Erzeugung.
 */
type GeneratorState = {
  /** JavaScript-Ausdruck für den aktuellen Pseudo2-`this`-Empfänger. */
  thisName: string;
};

/** Runtime-Wrapperkategorie eines Pseudo2-Werts. */
type RuntimeKind = 'array' | 'scalar' | 'struct';

/** Standardzustand außerhalb ausgelagerter Struct-Methoden. */
const DEFAULT_STATE: GeneratorState = { thisName: 'this' };
/** Expliziter Empfängerparameter generierter freier Methodenfunktionen. */
const METHOD_THIS_NAME = 'mythis';
/** Gemeinsamer Typrechner für Runtime-Klassifikation und Gleichheit. */
const TYPES = new Pseudo2TypeComputer();

/**
 * Erzeugt das vollständige JavaScript eines Pseudo2-Programms.
 *
 * Structs und Funktionen werden vor ausführbare Top-Level-Anweisungen gezogen,
 * damit ihre Deklarationen vor der ersten Verwendung verfügbar sind. Das
 * Ergebnis enthält stets die gemeinsame Observable-Runtime.
 *
 * @param program Zu übersetzender Pseudo2-AST.
 * @param context Vorregistrierter Namenskontext; wird standardmäßig aus dem Programm erzeugt.
 * @returns JavaScript-Runtime und generierter Programmkörper.
 */
export function generateProgram(program: Program, context = Pseudo2GeneratorContext.fromProgram(program)): string {
  const declarations = program.instructions.filter(isTopLevelDeclaration);
  const statements = program.instructions.filter(instruction => !isTopLevelDeclaration(instruction));
  const body = [...declarations, ...statements]
    .map(instruction => generateInstruction(instruction, context, '', DEFAULT_STATE))
    .filter(Boolean)
    .join('\n\n');

  return [PSEUDO2_RUNTIME_PRELUDE, body].filter(Boolean).join('\n\n');
}

/**
 * Erkennt Deklarationen, die vor Top-Level-Ausführung ausgegeben werden müssen.
 *
 * @param instruction Zu prüfende Programmanweisung.
 * @returns `true` für Struct- und Funktionsdeklarationen.
 */
function isTopLevelDeclaration(instruction: Instruction): boolean {
  return isStructDeclaration(instruction) || isFunctionDeclaration(instruction);
}

/**
 * Erzeugt einen Aufruf und ergänzt für Array-Parameter ihre logische Länge.
 *
 * Sobald ein formaler Array-Parameter einen Längenparameter besitzt, werden
 * sämtliche tatsächlichen Argumente einmalig in den Parametern einer sofort
 * aufgerufenen Arrow-Funktion gebunden. Dadurch bleiben Seiteneffekte erhalten
 * und ein Arrayausdruck wird nicht doppelt für Wert und Länge ausgewertet.
 *
 * @param callee Generierter Zielname der Funktion oder Methode.
 * @param formals Formale Pseudo2-Parameter.
 * @param actuals Tatsächliche Aufrufargumente.
 * @param context Namenskontext für temporäre Variablen.
 * @param state Aktueller Generatorzustand.
 * @param leadingArgs Bereits voranzustellende Argumente, insbesondere der Methodenempfänger.
 * @returns JavaScript-Aufrufausdruck.
 */
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

/**
 * Verteilt eine Pseudo2-Anweisung an ihren spezialisierten Generator.
 *
 * Verifikationsanweisungen besitzen im JavaScript-Ziel keine Laufzeitwirkung
 * und erzeugen daher bewusst keinen Code.
 *
 * @param instruction Zu generierende Anweisung.
 * @param context Deklarationsbasierter Namenskontext.
 * @param indent Aktuelle JavaScript-Einrückung.
 * @param state Aktueller `this`- und Methodenstatus.
 * @returns JavaScript-Anweisung oder Leerstring für reine Verifikation.
 * @throws Error Bei nicht unterstützten AST-Anweisungstypen.
 */
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

/**
 * Erzeugt einen JavaScript-Block mit rekursiv generierten Anweisungen.
 *
 * @param block Pseudo2-Block.
 * @param context Namenskontext.
 * @param indent Einrückung der Blockklammern.
 * @param state Aktueller Generatorzustand.
 * @returns Leerer oder mehrzeiliger JavaScript-Block.
 */
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

/**
 * Erzeugt eine JavaScript-If-Anweisung mit optionalem Else-Block.
 *
 * @param ifStatement Pseudo2-Verzweigung.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Verzweigung.
 */
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

/**
 * Erzeugt eine JavaScript-While-Schleife.
 *
 * @param loop Pseudo2-While-Schleife.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-While-Anweisung.
 */
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

/**
 * Erzeugt eine auf- oder absteigende JavaScript-For-Schleife.
 *
 * Start, Ende und Schrittweite werden jeweils in ObservableScalars gebunden.
 * Vor dem Schleifenstart wird eine nichtpositive Schrittweite als Laufzeitfehler
 * abgewiesen. Die Quellrichtung bestimmt Vergleich und Additionsrichtung.
 *
 * @param loop Pseudo2-For-Schleife.
 * @param context Namenskontext für Iterator und Hilfsvariablen.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns Initialisierung, Schrittprüfung und JavaScript-For-Schleife.
 */
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

/**
 * Erzeugt eine JavaScript-Do-While-Schleife.
 *
 * @param loop Pseudo2-Do-While-Schleife.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Do-While-Anweisung.
 */
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

/**
 * Erzeugt eine Struct-Factory und freie JavaScript-Funktionen für alle Methoden.
 *
 * Neue Struct-Instanzen werden über `__ps2_struct` mit allen deklarierten
 * Feldern als `undefined` angelegt. Methoden erhalten einen expliziten
 * `mythis`-Parameter und werden nicht als JavaScript-Klassenmethoden ausgegeben.
 *
 * @param structDecl Zu übersetzende Struct-Deklaration.
 * @param context Namenskontext für Factory, Felder und Methoden.
 * @param indent Aktuelle Einrückung.
 * @returns Factory-Funktion und nachfolgende Methodenfunktionen.
 */
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

/**
 * Unterscheidet eine schlüsselwortlose Struct-Methode von einer globalen Funktion.
 *
 * @param fn Zu prüfende Funktionsdeklaration.
 * @returns `true`, wenn das `func`-Schlüsselwort nicht gesetzt ist.
 */
function isMethodDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword !== true;
}

/**
 * Erzeugt eine freie JavaScript-Funktion für eine Struct-Methode.
 *
 * @param fn Methodendeklaration.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @returns Funktion mit explizitem `mythis` als erstem Parameter.
 */
function generateMethodDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = [METHOD_THIS_NAME, ...collectJsParams(fn, context)].join(', ');
  const body = generateFunctionBody(fn, context, indent, { thisName: METHOD_THIS_NAME });
  return `${indent}function ${context.getFunctionName(fn)}(${params}) ${body}`;
}

/**
 * Erzeugt eine globale JavaScript-Funktion.
 *
 * @param fn Globale Pseudo2-Funktionsdeklaration.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @returns JavaScript-Funktionsdeklaration.
 */
function generateFunctionDeclaration(
  fn: FunctionDeclaration,
  context: Pseudo2GeneratorContext,
  indent = ''
): string {
  const params = collectJsParams(fn, context).join(', ');
  const body = generateFunctionBody(fn, context, indent, DEFAULT_STATE);
  return `${indent}function ${context.getFunctionName(fn)}(${params}) ${body}`;
}

/**
 * Erzeugt Parametervorbereitung und Anweisungen eines Funktionskörpers.
 *
 * @param fn Funktion oder Methode.
 * @param context Namenskontext.
 * @param indent Einrückung der Funktionsklammern.
 * @param state Zustand mit dem korrekten `this`-Empfänger.
 * @returns Leerer oder mehrzeiliger JavaScript-Funktionsblock.
 */
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

/**
 * Erzeugt Runtime-Wrapper für eingehende Funktionsparameter.
 *
 * Arrays werden als ObservableArray übernommen und ihre synthetischen
 * Längenparameter aus der tatsächlichen Arraylänge erzeugt. Andere Parameter
 * werden anhand ihrer abgeleiteten Runtime-Kategorie eingepackt.
 *
 * @param fn Funktion, deren Parameter vorbereitet werden.
 * @param context Namenskontext.
 * @param indent Einrückung innerhalb des Funktionskörpers.
 * @returns JavaScript-Zeilen zur Parameterinitialisierung.
 */
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

/**
 * Sammelt die tatsächlichen JavaScript-Parameter einer Pseudo2-Funktion.
 *
 * Auf einen Array-Parameter folgt sein synthetischer Längenparameter.
 *
 * @param fn Funktion oder Methode.
 * @param context Namenskontext.
 * @returns Generierte Parameternamen in Signaturreihenfolge.
 */
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

/**
 * Erzeugt einen freien Funktionsaufruf als JavaScript-Anweisung.
 *
 * @param call Pseudo2-Funktionsaufruf.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Aufruf mit Semikolon.
 */
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

/**
 * Erzeugt eine Return-Anweisung mit optionalem Rückgabewert.
 *
 * @param ret Pseudo2-Return-Knoten.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Return-Anweisung.
 */
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

/**
 * Erzeugt eine JavaScript-Ausdrucksanweisung.
 *
 * @param stmt Pseudo2-Ausdrucksanweisung.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns Ausdruck mit Semikolon.
 */
function generateExprStatement(
  stmt: ExprStatement,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}${genExpr(stmt.expr, context, state)};`;
}

/**
 * Übersetzt `print` in einen Aufruf von `console.log`.
 *
 * @param cmd Pseudo2-Print-Anweisung.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Ausgabeanweisung.
 */
function generatePrintCommand(
  cmd: PrintCommand,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}console.log(${genExpr(cmd.param, context, state)});`;
}

/**
 * Übersetzt einen Pseudo2-Fehlerwurf in JavaScript-`throw`.
 *
 * @param cmd Pseudo2-Throw-Anweisung.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Throw-Anweisung.
 */
function generateThrowCommand(
  cmd: ThrowCommand,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}throw ${genExpr(cmd.param, context, state)};`;
}

/**
 * Erzeugt einen expliziten Call-Befehl als Ausdrucksanweisung.
 *
 * @param cmd Pseudo2-Call-Anweisung.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Ausdruck mit Semikolon.
 */
function generateCallCommand(
  cmd: CallCommand,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}${genExpr(cmd.param, context, state)};`;
}

/**
 * Erzeugt eine skalare, Array- oder Struct-Variablendeklaration.
 *
 * Arraygrößen verwenden die 1-basige Runtime-Erzeugung. Initialisierte skalare
 * und Struct-Werte werden typabhängig gewrappt; fehlende Initialisierungen
 * beginnen als skalarer Nullwert.
 *
 * @param decl Pseudo2-Variablendeklaration.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-`let`-Deklaration.
 */
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

/**
 * Erzeugt eine Zuweisung über den für das Ziel passenden Runtime-Helfer.
 *
 * @param assign Pseudo2-Zuweisung.
 * @param context Namenskontext.
 * @param indent Aktuelle Einrückung.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Zuweisungsanweisung.
 */
function generateAssignment(
  assign: Assignment,
  context: Pseudo2GeneratorContext,
  indent = '',
  state = DEFAULT_STATE
): string {
  return `${indent}${genAssignmentTarget(assign.sel as Expr, genExpr(assign.value, context, state), context, state)};`;
}

/**
 * Übersetzt einen beliebigen Pseudo2-Ausdruck rekursiv nach JavaScript.
 *
 * Literale werden direkt ausgegeben, Variablen und Heapwerte über die
 * Observable-Runtime gelesen und Operatorfolgen mit expliziter Klammerung
 * erhalten. Reine VeriFast-Ausdrücke sind im JavaScript-Ziel unzulässig.
 *
 * @param expr Zu übersetzender Ausdruck.
 * @param context Namenskontext.
 * @param state Aktueller Methoden- und `this`-Zustand.
 * @returns JavaScript-Ausdruck oder sichtbarer Fallback für unbekannte AST-Typen.
 * @throws Error Für `result` und `vf_*` außerhalb von VeriFast-Annotationen.
 */
function genExpr(expr: Expr, context: Pseudo2GeneratorContext, state = DEFAULT_STATE): string {
  if (isIntLiteral(expr)) return String(expr.value);
  if (isBoolLiteral(expr)) return String(expr.value);
  if (isStringLiteral(expr)) return JSON.stringify(expr.value);
  if (isNullLiteral(expr)) return 'null';
  if (isResultExpr(expr)) throw new Error('result is only supported inside VeriFast annotations.');
  if (isSpecPredicateExpr(expr)) throw new Error(`${expr.kind} is only supported inside VeriFast annotations.`);
  if (isArrayLiteral(expr)) return genArrayLiteral(expr, context, state);

  if (isNewExpr(expr)) {
    const type = expr.type?.ref;
    return type ? `__ps2_newStruct(${context.getStructFactoryName(type)})` : '/*unresolved*/';
  }

  if (isThisExpr(expr)) return state.thisName;
  if (isVarRef(expr)) return genVarRef(expr, context, state);
  if (isAttSelection(expr)) return genAttSelection(expr, context, state);
  if (isIndexSelection(expr)) return genArrayGet(genExpr(expr.receiver, context, state), expr.index, context, state);
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

/**
 * Erzeugt einen Methodenaufruf auf die freie Methodenfunktion.
 *
 * Der ausgewertete Empfänger wird als erstes Argument vor die Quellargumente
 * gesetzt; Array-Längen werden anschließend wie bei freien Funktionen ergänzt.
 *
 * @param expr Methodenselektion.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Aufrufausdruck.
 */
function genMethSelectionCall(expr: MethSelection, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const receiver = genExpr(expr.receiver, context, state);
  const target = expr.methref.f?.ref;
  const methName = target ? context.getFunctionName(target) : '/*unresolved*/';
  return buildExpandedCall(methName, target?.params, expr.methref.params ?? [], context, state, [receiver]);
}

/**
 * Erzeugt ein ObservableArray aus einem Pseudo2-Arrayliteral.
 *
 * @param expr Arrayliteral.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Aufruf des Runtime-Helfers `__ps2_arrayLiteral`.
 */
function genArrayLiteral(expr: ArrayLiteral, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const elems = (expr.elems ?? []).map(elem => genExpr(elem, context, state));
  return `__ps2_arrayLiteral([${elems.join(', ')}])`;
}

/**
 * Erzeugt den Lesezugriff auf Variable, Methodenattribut oder Arrayelement.
 *
 * Normale Werte werden über `.get()` gelesen. Struct-Felder und 1-basierte
 * Arrayindizes verwenden die dafür vorgesehenen Runtime-Helfer.
 *
 * @param expr Variablenreferenz.
 * @param context Namenskontext.
 * @param state Zustand mit aktuellem Methodenempfänger.
 * @returns JavaScript-Leseausdruck.
 */
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

/**
 * Erzeugt einen Struct-Attributzugriff mit optionalem Arrayindex.
 *
 * @param expr Attributselektion.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns JavaScript-Runtimezugriff.
 */
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

/**
 * Übersetzt ein zulässiges Zuweisungsziel in den passenden Runtime-Schreibzugriff.
 *
 * Unterstützt Variablen, implizite Methodenattribute, explizite
 * Attributselektionen und verkettete Arrayindizes. Der Runtime-Werttyp steuert,
 * ob ein Observable gesetzt oder eine Struct-Referenz neu gewrappt wird.
 *
 * @param target Linke Seite der Pseudo2-Zuweisung.
 * @param value Bereits generierter JavaScript-Ausdruck der rechten Seite.
 * @param context Namenskontext.
 * @param state Aktueller Methoden- und `this`-Zustand.
 * @returns JavaScript-Ausdruck ohne abschließendes Semikolon.
 */
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

  if (isIndexSelection(target)) {
    return genArraySet(genExpr(target.receiver, context, state), target.index, value, context, state);
  }

  return `${genExpr(target, context, state)} = ${value}`;
}

/**
 * Erzeugt einen 1-basierten Array-Lesezugriff über die Runtime.
 *
 * @param array JavaScript-Ausdruck des Arrayempfängers.
 * @param index Pseudo2-Indexausdruck.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Aufruf von `__ps2_arrayGet`.
 */
function genArrayGet(
  array: string,
  index: Expr,
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  return `__ps2_arrayGet(${array}, ${genExpr(index, context, state)})`;
}

/**
 * Erzeugt einen 1-basierten Array-Schreibzugriff über die Runtime.
 *
 * @param array JavaScript-Ausdruck des Arrayempfängers.
 * @param index Pseudo2-Indexausdruck.
 * @param value Zu speichernder JavaScript-Ausdruck.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Aufruf von `__ps2_arraySet`.
 */
function genArraySet(
  array: string,
  index: Expr,
  value: string,
  context: Pseudo2GeneratorContext,
  state: GeneratorState
): string {
  return `__ps2_arraySet(${array}, ${genExpr(index, context, state)}, ${value})`;
}

/**
 * Erzeugt den Runtime-Lesezugriff auf ein Struct-Feld.
 *
 * @param receiver JavaScript-Ausdruck des Struct-Empfängers.
 * @param field Eindeutiger generierter Feldname.
 * @returns Aufruf von `__ps2_structGet`.
 */
function genStructGet(receiver: string, field: string): string {
  return `__ps2_structGet(${receiver}, ${JSON.stringify(field)})`;
}

/**
 * Erzeugt den typabhängigen Runtime-Schreibzugriff auf ein Struct-Feld.
 *
 * @param receiver JavaScript-Ausdruck des Struct-Empfängers.
 * @param field Eindeutiger generierter Feldname.
 * @param value Zu speichernder JavaScript-Ausdruck.
 * @param kind Runtime-Kategorie des Feldes.
 * @returns Aufruf von `__ps2_structSet`.
 */
function genStructSet(receiver: string, field: string, value: string, kind: RuntimeKind): string {
  return `__ps2_structSet(${receiver}, ${JSON.stringify(field)}, ${value}, ${JSON.stringify(kind)})`;
}

/**
 * Erzeugt eine Variablenzuweisung passend zur Runtime-Kategorie.
 *
 * Structvariablen werden als Referenz neu gewrappt; skalare und Array-Wrapper
 * werden über ihre `.set()`-Methode aktualisiert.
 *
 * @param name Generierter Variablenname.
 * @param value Zu speichernder JavaScript-Ausdruck.
 * @param kind Runtime-Kategorie der Variablen.
 * @returns JavaScript-Zuweisung ohne Semikolon.
 */
function genVariableSet(name: string, value: string, kind: RuntimeKind): string {
  if (kind === 'struct') {
    return `${name} = __ps2_wrapValue(${value}, "struct")`;
  }

  return `${name}.set(${value})`;
}

/**
 * Erzeugt eine strikt typisierte JavaScript-Gleichheitskette.
 *
 * Pseudo2-`==` und `!=` werden zu `===` und `!==`. Structoperanden werden
 * zuvor auf ihre Runtime-Referenz reduziert, damit Objektidentität verglichen wird.
 *
 * @param left Erster Operand.
 * @param ops Pseudo2-Gleichheitsoperatoren.
 * @param rights Weitere Operanden.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Geklammerte JavaScript-Gleichheitskette.
 */
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

/**
 * Bereitet einen Operanden für Pseudo2-Gleichheit vor.
 *
 * @param expr Zu vergleichender Ausdruck.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Struct-Referenz oder unveränderter generierter Wert.
 */
function genEqualityArg(expr: Expr, context: Pseudo2GeneratorContext, state: GeneratorState): string {
  const value = genExpr(expr, context, state);
  const type = TYPES.typeFor(expr);

  if (type.isStructType() && !type.isPartiallyUnknown()) {
    return `__ps2_structRef(${value})`;
  }

  return value;
}

/**
 * Leitet die Runtime-Kategorie eines Ausdrucks aus seinem statischen Typ ab.
 *
 * @param expr Pseudo2-Ausdruck.
 * @returns `array`, `struct` oder `scalar`.
 */
function runtimeKindForExpr(expr: Expr): RuntimeKind {
  return runtimeKindForType(TYPES.typeFor(expr));
}

/**
 * Leitet die Runtime-Kategorie eines Struct-Attributs aus seiner Typreferenz ab.
 *
 * @param att Struct-Attributdeklaration.
 * @returns Runtime-Kategorie des Feldes.
 */
function runtimeKindForStructAtt(att: StructAttDeclaration): RuntimeKind {
  return runtimeKindForType(TYPES.typeForTypeRef(att.type));
}

/**
 * Bestimmt die Runtime-Kategorie einer beliebigen Variablendeklaration.
 *
 * Berücksichtigt Attribute, Parameter, synthetische Längenvariablen,
 * Arraydeklarationen und den Typ vorhandener Initialisierer.
 *
 * @param variable Variable oder `undefined` bei ungelöster Referenz.
 * @returns Erkannte Runtime-Kategorie, standardmäßig `scalar`.
 */
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

/**
 * Bestimmt die Runtime-Kategorie eines Funktionsparameters.
 *
 * Explizite Arrayparameter sind direkt bekannt. Für untypisierte skalare
 * Parameter werden alle externen Aufrufstellen der Funktion beziehungsweise
 * Methode untersucht; sobald ein Array- oder Structargument vorkommt, wird
 * dessen Kategorie übernommen.
 *
 * @param param Zu klassifizierender Parameter.
 * @returns Abgeleitete Runtime-Kategorie.
 */
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

/**
 * Reduziert einen statischen Pseudo2-Typ auf eine Runtime-Wrapperkategorie.
 *
 * @param type Berechneter Pseudo2-Typ.
 * @returns `array`, `struct` oder für alle übrigen Typen `scalar`.
 */
function runtimeKindForType(type: Pseudo2Type): RuntimeKind {
  if (type.isArrayType()) {
    return 'array';
  }

  if (type.isStructType()) {
    return 'struct';
  }

  return 'scalar';
}

/**
 * Erkennt eine synthetische Längenvariable eines Arrayparameters.
 *
 * @param variable Zu prüfende Variablendeklaration.
 * @returns `true`, wenn der besitzende Parameter genau diese Länge referenziert.
 */
function isLengthParameterDecl(variable: VarDecl): boolean {
  const parent = variable.$container;
  return isParameterDecl(parent) && parent.len === variable;
}

/**
 * Prüft über die Containerkette, ob ein AST-Knoten innerhalb einer Funktion liegt.
 *
 * Dies verhindert, dass interne rekursive Verwendungen als externe Hinweise für
 * die Parameterkategorie derselben Funktion ausgewertet werden.
 *
 * @param node Ausgangsknoten der Containersuche.
 * @param fn Gesuchte Funktionsdeklaration.
 * @returns `true`, wenn `fn` ein AST-Vorfahre von `node` ist.
 */
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

/**
 * Erzeugt eine Kette mit einem einheitlichen booleschen Operator.
 *
 * @param left Bereits generierter linker Operand.
 * @param op JavaScript-Operator für alle Folgeschritte.
 * @param rights Rechte Pseudo2-Operanden.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Geklammerte JavaScript-Operatorfolge.
 */
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

/**
 * Erzeugt eine arithmetische oder vergleichende Operatorfolge.
 *
 * Pseudo2-`mod` wird auf JavaScript-`%` und Potenz `^` auf `**` abgebildet.
 *
 * @param left Bereits generierter linker Operand.
 * @param ops Operatoren in Quellreihenfolge.
 * @param rights Rechte Pseudo2-Operanden.
 * @param context Namenskontext.
 * @param state Aktueller Generatorzustand.
 * @returns Geklammerte JavaScript-Operatorfolge.
 */
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
