// packages/language/src/pseudo2-validator.ts

/**
 * @file pseudo2-validator.ts
 * @brief Registriert und implementiert die semantischen Validierungsregeln der Pseudo2-Sprache.
 *
 * Der Validator ergänzt Parser, Scoping und Typberechnung um kontextabhängige Prüfungen.
 * Dazu gehören unter anderem Kontrollfluss, Deklarationsorte, Aufrufkontexte,
 * Typverträglichkeit, Array- und Struct-Zugriffe sowie die Pseudo2-Syntax für
 * VeriFast-Spezifikationen. Diagnosen werden über Langiums ValidationAcceptor
 * an CLI, Tests und Webeditor weitergegeben.
 *
 * @author Abdul
 */

import { AstUtils } from 'langium';
import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import type {
  Pseudo2AstType,
  BracedBlock,
  IndentedBlock,
  IfStatement,
  WhileLoop,
  ForLoop,
  DoWhileLoop,
  FunctionDeclaration,
  FunctionCall,
  ReturnStmt,
  VarDecl,
  Assignment,
  StructDeclaration,
  StructAttDeclaration,
  StructType,
  NewExpr,
  VarRef,
  AttRef,
  MethRef,
  AttSelection,
  IndexSelection,
  MethSelection,
  ThisExpr,
  Variable,
  Program,
  Expr,
  ArrayLiteral,
  Instruction,
  ParameterDecl,
  PrintCommand,
  ThrowCommand,
  CallCommand,
  Addition,
  Equality,
  Comparison,
  Multiplication,
  Exponentiation,
  And,
  Or,
  Not,
  Neg,
  ResultExpr,
  SpecPredicateExpr
} from './generated/ast.js';
import type { Pseudo2Services } from './pseudo2-module.js';

import {
  isProgram,
  isFunctionDeclaration,
  isStructDeclaration,
  isStructAttDeclaration,
  isVarRef,
  isAttSelection,
  isIndexSelection,
  isVarDecl,
  isParameterDecl,
  isReturnStmt,
  isBracedBlock,
  isIndentedBlock,
  isIfStatement,
  isWhileLoop,
  isForLoop,
  isDoWhileLoop,
  isFunctionCall,
  isMethSelection,
  isMethRef,
  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isGrouping,
  isExponentiation,
  isNot,//,
  isIntLiteral,
  isStringLiteral,
  isArrayLiteral,
  isNullLiteral,
  isVerificationAnnotation,
  isVerificationStatement,
  isLoopAnnotation
  //isNeg
} from './generated/ast.js';

import { Pseudo2TypeComputer } from './typing/pseudo2-type-computer.js';
import { TYPE_NUM, TYPE_BOOL, TYPE_STRING, TYPE_ARRAY_UNKNOWN, TYPE_UNKNOWN, TYPE_STRUCT } from './typing/pseudo2-type.js';

/** Diagnosecode für eine allgemeine Typinkompatibilität. */
export const INCOMPATIBLE_TYPES = 'INCOMPATIBLE_TYPES';
/** Diagnosecode für unzulässige oder inkompatible Gleichheitsvergleiche. */
export const INCOMPATIBLE_TYPES_EQ = 'INCOMPATIBLE_TYPES_EQ';
/** Diagnosecode für unzulässige Operanden einer Addition oder Verkettung. */
export const INCOMPATIBLE_TYPES_PLUS = 'INCOMPATIBLE_TYPES_PLUS';
/** Diagnosecode für einen innerhalb seines Namensraums doppelt deklarierten Eintrag. */
export const DUPLICATE_ELEMENT = 'DUPLICATE_ELEMENT';
/** Diagnosecode für unterschiedliche Werttypen in den Rückgaben einer Funktion. */
export const DIFFERENT_TYPES_OF_RETURNS = 'DIFFERENT_TYPES_OF_RETURNS';
/** Diagnosecode für einen nicht druckbaren Wert außerhalb der Pseudo2-Basistypen. */
export const PRINT_EXPECTS_BASE_TYPE = 'PRINT_EXPECTS_BASE_TYPE';
/** Diagnosecode für eine mit `func` markierte, nicht globale Funktion. */
export const FUNC_DECL_ONLY_GLOBAL = 'FUNC_DECL_ONLY_GLOBAL';
/** Diagnosecode für eine außerhalb eines Structs deklarierte Methode. */
export const METH_DECL_ONLY_IN_STRUCT = 'METH_DECL_ONLY_IN_STRUCT';
/** Diagnosecode für den Aufruf einer globalen Funktion über eine Selection. */
export const SELECTION_REQUIRES_METHODCALLS = 'SELECTION_REQUIRES_METHODCALLS';
/** Diagnosecode für eine wertlose Funktion, die unzulässig als Ausdruck verwendet wird. */
export const FUNCTIONCALLS_WO_RETURN_ONLY_AS_INSTRUCTION = 'FUNCTIONCALLS_WO_RETURN_ONLY_AS_INSTRUCTION';
/** Diagnosecode für eine wertlose Methode, die unzulässig als Ausdruck verwendet wird. */
export const METHODCALLS_WO_RETURN_ONLY_AS_INSTRUCTION = 'METHODCALLS_WO_RETURN_ONLY_AS_INSTRUCTION';
/** Diagnosecode für eine Variablendeklaration mit einem leeren Arrayliteral. */
export const VAR_DECL_NO_INIT_WITH_EMPTY_ARRAY = 'VAR_DECL_NO_INIT_WITH_EMPTY_ARRAY';
/** Diagnosecode für eine Variablendeklaration mit `null` als Initialwert. */
export const VAR_DECL_NO_INIT_WITH_NULL = 'VAR_DECL_NO_INIT_WITH_NULL';
/** Diagnosecode für eine Zuweisung an den unveränderlichen Iterator einer for-Schleife. */
export const ASSIGNED_TO_LOOPVAR = 'ASSIGNED_TO_LOOPVAR';
/** Diagnosecode für eine Zuweisung an den speziellen Ausdruck `this`. */
export const ASSIGNED_TO_THIS = 'ASSIGNED_TO_THIS';
/** Diagnosecode für einen Methodenaufruf auf der linken Seite einer Zuweisung. */
export const ASSIGNED_TO_METHOD_CALL = 'ASSIGNED_TO_METHOD_CALL';
/** Diagnosecode für das Mischen von `return` mit und ohne Rückgabewert. */
export const DIFFERENT_KINDS_OF_RETURNS = 'DIFFERENT_KINDS_OF_RETURNS';
/** Diagnosecode für einen nicht auf allen abschließenden Pfaden garantierten Rückgabewert. */
export const MISSING_RETURN_AS_LAST_STATEMENT = 'MISSING_RETURN_AS_LAST_STATEMENT';
// Eigener Code für falsche Anzahl an Funktions-/Methodenparametern
/** Diagnosecode für eine falsche Anzahl tatsächlicher Aufrufargumente. */
export const FUNC_CALL_RIGHT_PARANUM = 'FUNC_CALL_RIGHT_PARANUM';

// Eigener Code für Typfehler bei tatsächlichen Parametern
/** Diagnosecode für ein Argument, dessen Typ nicht zum formalen Parameter passt. */
export const FUNC_CALL_ACTUALPARA_CONFORMSTO_FORMALPARA = 'FUNC_CALL_ACTUALPARA_CONFORMSTO_FORMALPARA';

// Eigener Code für Arrayzugriff auf Nicht-Array
/** Diagnosecode für einen Indexzugriff auf einen skalaren oder Struct-Wert. */
export const ARRAY_ACCESS_ON_PLAIN_TYPE = 'ARRAY_ACCESS_ON_PLAIN_TYPE';

// Eigener Code für unterschiedliche Typen in Array-Literalen
/** Diagnosecode für ein Arrayliteral mit uneinheitlichen Elementtypen. */
export const DIFFERENT_TYPES_OF_ARRAYLIT_ELEMS = 'DIFFERENT_TYPES_OF_ARRAYLIT_ELEMS';

// Eigener Code: return nur innerhalb von Funktionen
/** Diagnosecode für `return` beziehungsweise funktionsgebundene Elemente außerhalb einer Funktion. */
export const ELEMENT_ONLY_WITHIN_FUNCDECL = 'ELEMENT_ONLY_WITHIN_FUNCDECL';

// Eigener Code: this nur innerhalb von Methoden
/** Diagnosecode für `this` außerhalb einer Struct-Methode. */
export const ELEMENT_ONLY_WITHIN_METHDECL = 'ELEMENT_ONLY_WITHIN_METHDECL';

// Eigener Code: formaler und tatsächlicher Parameter müssen bzgl. Array konsistent sein
/** Diagnosecode für eine abweichende Array-Eigenschaft von formalem und tatsächlichem Parameter. */
export const CONSISTENT_ARRAY_TYPE_OF_PARA = 'CONSISTENT_ARRAY_TYPE_OF_PARA';
/** Diagnosecode für `result` außerhalb einer VeriFast-Annotation. */
export const RESULT_ONLY_IN_VERIFAST_ANNOTATION = 'RESULT_ONLY_IN_VERIFAST_ANNOTATION';
/** Diagnosecode für ein `vf_*`-Prädikat außerhalb einer VeriFast-Annotation. */
export const SPEC_PREDICATE_ONLY_IN_VERIFAST_ANNOTATION = 'SPEC_PREDICATE_ONLY_IN_VERIFAST_ANNOTATION';
/** Diagnosecode für eine falsche Argumentanzahl eines `vf_*`-Prädikats. */
export const SPEC_PREDICATE_ARITY = 'SPEC_PREDICATE_ARITY';
/** Diagnosecode für einen nicht als Stringliteral angegebenen Struct-Feldnamen. */
export const SPEC_PREDICATE_FIELD_NAME = 'SPEC_PREDICATE_FIELD_NAME';
/** Diagnosecode für einen nicht als Stringliteral angegebenen erwarteten Stringwert. */
export const SPEC_PREDICATE_STRING_VALUE = 'SPEC_PREDICATE_STRING_VALUE';
/** Diagnosecode für einen ungültigen oder nullwertigen Nenner von `vf_ratio`. */
export const SPEC_PREDICATE_RATIO_DENOMINATOR = 'SPEC_PREDICATE_RATIO_DENOMINATOR';


/**
 * Verknüpft jeden relevanten AST-Knotentyp mit seiner Validierungsmethode.
 *
 * Langium ruft die registrierten Methoden nach dem Parsen und Verlinken eines
 * Dokuments auf. Eine gemeinsame Validatorinstanz stellt dabei Typberechnung und
 * Hilfsanalysen für alle Knoten bereit.
 *
 * @param services Vollständig erzeugte Pseudo2-Dienste mit Registry und Validator.
 */
export function registerValidationChecks(services: Pseudo2Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.Pseudo2Validator;

  const checks: ValidationChecks<Pseudo2AstType> = {
    BracedBlock: validator.checkBracedBlock,
    IndentedBlock: validator.checkIndentedBlock,

    IfStatement: validator.checkIfStatement,
    WhileLoop: validator.checkWhileLoop,
    ForLoop: validator.checkForLoop,
    DoWhileLoop: validator.checkDoWhileLoop,

    FunctionDeclaration: validator.checkFunctionDeclaration,
    FunctionCall: validator.checkFunctionCall,
    ReturnStmt: validator.checkReturnStmt,

    VarDecl: validator.checkVarDecl,
    Assignment: validator.checkAssignment,

    StructDeclaration: validator.checkStructDeclaration,
    StructAttDeclaration: validator.checkStructAttDeclaration,
    StructType: validator.checkStructType,
    NewExpr: validator.checkNewExpr,

    Variable: validator.checkVariable,
    VarRef: validator.checkVarRef,
    AttRef: validator.checkAttRef,
    MethRef: validator.checkMethRef,
    AttSelection: validator.checkAttSelection,
    IndexSelection: validator.checkIndexSelection,
    MethSelection: validator.checkMethSelection,
    ThisExpr: validator.checkThisExpr,

    ArrayLiteral: validator.checkArrayLiteral,

    PrintCommand: validator.checkPrintCommand,
    ThrowCommand: validator.checkThrowCommand,
    CallCommand: validator.checkCallCommand,
    
    Equality: validator.checkEquality,
    Comparison: validator.checkComparison,
    Addition: validator.checkAddition,
    Multiplication: validator.checkMultiplication,
    Exponentiation: validator.checkExponentiation,
    And: validator.checkAnd,
    Or: validator.checkOr,
    Not: validator.checkNot,
    Neg: validator.checkNeg,
    ResultExpr: validator.checkResultExpr,
    SpecPredicateExpr: validator.checkSpecPredicateExpr,
  };

  registry.register(checks, validator);
}

/**
 * Implementiert die statischen, nicht rein syntaktischen Regeln von Pseudo2.
 *
 * Öffentliche `check*`-Methoden sind Langium-Validierungschecks. Private Methoden
 * analysieren Kontrollfluss, Typkontexte, Sichtbarkeit und AST-Hüllen gemeinsam,
 * damit die einzelnen Regeln dieselben Sprachannahmen verwenden.
 */
export class Pseudo2Validator {
  /** Berechnet Pseudo2-Typen für Ausdrücke, Referenzen und Typangaben. */
  private readonly types = new Pseudo2TypeComputer();

  /**
   * Meldet Anweisungen, die in einem Block nach einem direkten `return` stehen.
   * @param node Zu prüfender Block mit geschweiften Klammern.
   * @param accept Empfänger für erzeugte Warnungen.
   */
  checkBracedBlock(node: BracedBlock, accept: ValidationAcceptor): void {
    this.checkNoInstructionsAfterReturn(node.instructions ?? [], accept);
  }

  /**
   * Meldet Anweisungen, die in einem eingerückten Block nach einem direkten `return` stehen.
   * @param node Zu prüfender eingerückter Block.
   * @param accept Empfänger für erzeugte Warnungen.
   */
  checkIndentedBlock(node: IndentedBlock, accept: ValidationAcceptor): void {
    this.checkNoInstructionsAfterReturn(node.instructions ?? [], accept);
  }

  /**
   * Stellt sicher, dass die Bedingung einer if-Anweisung den Typ `bool` besitzt.
   * Unbekannte Typen werden nicht erneut beanstandet, da sie meist eine Folgediagnose wären.
   * @param node Zu prüfende if-Anweisung.
   * @param accept Empfänger für Typfehler.
   */
  checkIfStatement(node: IfStatement, accept: ValidationAcceptor): void {
    const conditionType = this.types.typeFor(node.condition);
    if (!conditionType.isSameAs(TYPE_BOOL) && !conditionType.isUnknown()) {
      accept('error', `if-Bedingung muss vom Typ bool sein, ist aber '${conditionType.asString()}'.`, {
        node,
        property: 'condition',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Stellt sicher, dass die Bedingung einer while-Schleife den Typ `bool` besitzt.
   * @param node Zu prüfende while-Schleife.
   * @param accept Empfänger für Typfehler.
   */
  checkWhileLoop(node: WhileLoop, accept: ValidationAcceptor): void {
    const conditionType = this.types.typeFor(node.condition);
    if (!conditionType.isSameAs(TYPE_BOOL) && !conditionType.isUnknown()) {
      accept('error', `while-Bedingung muss vom Typ bool sein, ist aber '${conditionType.asString()}'.`, {
        node,
        property: 'condition',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Prüft Startwert, Endwert und optionale Schrittweite einer for-Schleife auf `num`.
   * Zusätzlich werden der Iterator und alle im Schleifenrumpf enthaltenen lokalen
   * Variablen als gemeinsamer Schleifen-Namensraum auf doppelte Namen geprüft.
   * @param node Zu prüfende for-Schleife.
   * @param accept Empfänger für Typ- und Duplikatfehler.
   */
  checkForLoop(node: ForLoop, accept: ValidationAcceptor): void {

    const fromType = this.types.typeFor(node.from);
    if (!fromType.isSameAs(TYPE_NUM) && !fromType.isUnknown()) {
      accept('error', `for-Startwert muss vom Typ num sein, ist aber '${fromType.asString()}'.`, {
        node,
        property: 'from',
        code: INCOMPATIBLE_TYPES
      });
    }

    const toType = this.types.typeFor(node.to);
    if (!toType.isSameAs(TYPE_NUM) && !toType.isUnknown()) {
      accept('error', `for-Endwert muss vom Typ num sein, ist aber '${toType.asString()}'.`, {
        node,
        property: 'to',
        code: INCOMPATIBLE_TYPES
      });
    }

    if (node.step) {
      const stepType = this.types.typeFor(node.step);
      if (!stepType.isSameAs(TYPE_NUM) && !stepType.isUnknown()) {
        accept('error', `for-Schrittweite muss vom Typ num sein, ist aber '${stepType.asString()}'.`, {
          node,
          property: 'step',
          code: INCOMPATIBLE_TYPES
        });
      }
    }

    // im Namespace der For-Schleife dürfen keine doppelten (beibehalten??)
    // Variablennamen vorkommen, inklusive Loop-Iterator
    const loopVars: VarDecl[] = [];

    if (node.iterator) {
      loopVars.push(node.iterator);
    }

    for (const n of AstUtils.streamAllContents(node.body)) {
      if (isVarDecl(n) && !this.isLengthParameterDecl(n)) {
        loopVars.push(n);
      }
    }

    this.reportDuplicateVarDecls(loopVars, accept);

  }

  /**
   * Stellt sicher, dass die Abschlussbedingung einer do-while-Schleife `bool` ist.
   * @param node Zu prüfende do-while-Schleife.
   * @param accept Empfänger für Typfehler.
   */
  checkDoWhileLoop(node: DoWhileLoop, accept: ValidationAcceptor): void {
    const conditionType = this.types.typeFor(node.condition);
    if (!conditionType.isSameAs(TYPE_BOOL) && !conditionType.isUnknown()) {
      accept('error', `do-while-Bedingung muss vom Typ bool sein, ist aber '${conditionType.asString()}'.`, {
        node,
        property: 'condition',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Validiert Deklarationsort, Parameter, Rückgaben und Abschluss einer Funktion oder Methode.
   *
   * Globale Funktionen müssen `func` tragen, methodenartige Deklarationen müssen in
   * einem Struct liegen. Parameter einschließlich impliziter Array-Längenparameter
   * müssen eindeutig sein. Außerdem werden globale Funktionsduplikate, gemischte
   * Rückgabearten, inkonsistente Rückgabetypen und fehlende sichere Rückgabepfade gemeldet.
   *
   * @param node Zu prüfende Funktions- oder Methodendeklaration.
   * @param accept Empfänger für Fehler und Kontrollflusswarnungen.
   */
  checkFunctionDeclaration(node: FunctionDeclaration, accept: ValidationAcceptor): void {
    const container = node.$container;

    // func-Deklarationen müssen global sein
    if (node.keyword === true && !isProgram(container)) {
      accept('error', "Funktionen mit dem Schlüsselwort 'func' müssen global deklariert werden.", {
        node,
        property: 'name',
        code: FUNC_DECL_ONLY_GLOBAL
      });
    }

    // methodenartige Deklarationen ohne 'func' nur im Struct
    if (node.keyword !== true && !isStructDeclaration(container)) {
      accept('error', "Methoden ohne 'func' dürfen nur innerhalb einer Struct-Deklaration stehen.", {
        node,
        property: 'name',
        code: METH_DECL_ONLY_IN_STRUCT
      });
    }

    // Optionale strengere Prüfung für doppelte lokale Variablen
    // (außer Loop-Iteratoren) nicht doppelt vorkommen
    //this.reportDuplicateVarDecls(this.getFunctionLocalVarDecls(node), accept);
    const seen = new Set<string>();

    // 1. Parameter prüfen
    for (const p of node.params ?? []) {
      if (seen.has(p.name)) {
        accept('error', `Doppelter Parametername '${p.name}'.`, {
          node: p,
          property: 'name',
          code: DUPLICATE_ELEMENT
        });
      } else {
        seen.add(p.name);
      }

      if (p.isArray) {
        if (p.start !== undefined && p.start < 0) {
          accept('error', `Array-Parameter '${p.name}' darf keinen negativen Startindex haben.`, {
            node: p,
            property: 'start'
          });
        }

        if (!p.len) {
          accept('error', `Array-Parameter '${p.name}' benötigt einen Längenparameter.`, {
            node: p,
            property: 'name'
          });
        } else if (seen.has(p.len.name)) {
          accept('error', `Doppelter Parametername '${p.len.name}'.`, {
            node: p.len,
            property: 'name',
            code: DUPLICATE_ELEMENT
          });
        } else {
          seen.add(p.len.name);
        }
      }
    }

    // 2. Doppelte globale Funktionen prüfen
    const parentStruct = AstUtils.getContainerOfType(node.$container, isStructDeclaration);
    if (!parentStruct) {
      const program = this.getProgram(node);
      if (program) {
        const functions = program.instructions.filter(isFunctionDeclaration);
        const index = functions.indexOf(node);
        const previousWithSameName = functions.slice(0, index).find(f => f.name === node.name);

        if (previousWithSameName) {
          accept('error', `Doppelte globale Funktion '${node.name}'.`, {
            node,
            property: 'name',
            code: DUPLICATE_ELEMENT
          });
        }
      }
    }

    // 3. return mit und ohne Wert nicht mischen
    const allReturns = this.allReturns(node);
    const returnsWithValue = allReturns.filter(r => r.retExpr);
    const returnsWithoutValue = allReturns.filter(r => !r.retExpr);

    if (returnsWithValue.length > 0 && returnsWithoutValue.length > 0) {
      for (const r of allReturns) {
        accept('error', `Funktion '${node.name}' mischt return mit und ohne Wert.`, {
          node: r,
          code: DIFFERENT_KINDS_OF_RETURNS
        });
      }
    }

    // 4. Rückgabetypen prüfen
    if (returnsWithValue.length > 1) {
      const firstType = this.types.typeFor(returnsWithValue[0].retExpr);

      for (let i = 1; i < returnsWithValue.length; i++) {
        const currentType = this.types.typeFor(returnsWithValue[i].retExpr);

        if (
          !currentType.isSameAsIgnoringUnknown(firstType) &&
          !firstType.isUnknown() &&
          !currentType.isUnknown()
        ) {
          accept(
            'error',
            `Inkonsistente Rückgabetypen in Funktion '${node.name}': '${firstType.asString()}' und '${currentType.asString()}'.`,
            {
              node: returnsWithValue[i],
              property: 'retExpr',
              code: DIFFERENT_TYPES_OF_RETURNS
            }
          );
        }
      }
    }
    // 5. Wenn die Funktion irgendwo einen Wert zurückgibt,
    // sollte sie auch sinnvoll mit return/throw enden
    if (returnsWithValue.length > 0 && !this.finishesByReturn(node.body?.instructions ?? [])) {
      accept('warning', `Die Funktion '${node.name}' gibt Werte zurück, endet aber nicht sicher mit return.`, {
        node,
        code: MISSING_RETURN_AS_LAST_STATEMENT
      });
    }
  }

  /**
   * Ermittelt konservativ, ob die übergebene Anweisungsfolge sicher durch `return`
   * oder `throw` endet. Bei einer abschließenden if-Anweisung müssen beide Zweige enden.
   * Schleifen werden nicht als garantierter Abschluss betrachtet.
   *
   * @param instructions Anweisungsfolge eines Funktions- oder Verzweigungsblocks.
   * @returns `true`, wenn jeder hier modellierte Abschlussweg einen Wert zurückgibt oder wirft.
   */
  private finishesByReturn(instructions: Instruction[]): boolean {
    if (instructions.length === 0) {
      return false;
    }

    const last = instructions[instructions.length - 1] as any;

    if (isReturnStmt(last)) {
      return true;
    }

    if (last.$type === 'ThrowCommand') {
      return true;
    }

    if (isIfStatement(last)) {
      const thenFinished = this.finishesByReturn(last.thenBlock?.instructions ?? []);
      const elseFinished = last.elseBlock
        ? this.finishesByReturn(last.elseBlock.instructions ?? [])
        : false;

      return thenFinished && elseFinished;
    }

    return false;
  }

  /**
   * Sammelt sämtliche, auch in verschachtelten Blöcken liegenden return-Anweisungen einer Funktion.
   * @param fn Funktion oder Methode, deren Rückgaben gesucht werden.
   * @returns Return-Knoten in AST-Durchlaufreihenfolge.
   */
  private allReturns(fn: FunctionDeclaration): ReturnStmt[] {
    const out: ReturnStmt[] = [];
    for (const n of AstUtils.streamAllContents(fn)) {
      if (isReturnStmt(n)) {
        out.push(n);
      }
    }
    return out;
  }
  
  /**
   * Prüft eine globale Funktionsreferenz, ihren Verwendungskontext, die Argumentanzahl
   * und die mit den formalen Parametern ableitbaren Argumenttypen.
   * @param node Zu prüfender Funktionsaufruf.
   * @param accept Empfänger für Verlinkungs-, Kontext- und Argumentfehler.
   */
  checkFunctionCall(node: FunctionCall, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Funktion.', { node, property: 'f' });
      return;
    }

    const target = node.f?.ref;
    if (!target) return;

    // Wenn die Funktion keinen Rückgabewert hat, darf sie nicht als Ausdruck benutzt werden
    if (!this.isStatementFunctionCall(node) && !this.hasReturnValue(target)) {
      accept('error', `Funktion '${target.name}' gibt keinen Wert zurück und kann nicht als Ausdruck verwendet werden.`, {
        node,
        property: 'f',
        code: FUNCTIONCALLS_WO_RETURN_ONLY_AS_INSTRUCTION
      });
    }

    const expected = target.params?.length ?? 0;
    const actual = node.params?.length ?? 0;

    if (actual < expected) {
      accept('error', `Zu wenige Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params',
        code: FUNC_CALL_RIGHT_PARANUM
      });
      return;
    } else if (actual > expected) {
      accept('error', `Zu viele Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params',
        code: FUNC_CALL_RIGHT_PARANUM
      });
      return;
    }

    this.checkArgumentTypes(node, target, node.params ?? [], accept);
  }

  /**
   * Prüft, ob eine Funktion mindestens eine return-Anweisung mit Ausdruck enthält.
   * @param fn Zu untersuchende Funktion oder Methode.
   * @returns `true`, wenn mindestens ein Rückgabewert vorhanden ist.
   */
  private hasReturnValue(fn: FunctionDeclaration): boolean {
    return this.allReturns(fn).some(r => r.retExpr);
  }

  /**
   * Bestimmt anhand der umgebenden AST-Knoten, ob ein Funktionsaufruf als eigenständige
   * Anweisung und nicht als benötigter Wert verwendet wird.
   * @param node Einzuordnender Funktionsaufruf.
   * @returns `true` für Anweisungs- beziehungsweise `call`-Kontext, sonst `false`.
   */
  private isStatementFunctionCall(node: FunctionCall): boolean {
    let current: any = node.$container;

    while (current) {
      if (
        current.$type === 'ExprStatement' ||
        current.$type === 'CallCommand' ||
        isBracedBlock(current) ||
        isIndentedBlock(current) ||
        current.$type === 'Program'
      ) {
        return true;
      }

      if (
        current.$type === 'VarDecl' ||
        current.$type === 'Assignment' ||
        current.$type === 'ReturnStmt' ||
        current.$type === 'PrintCommand' ||
        current.$type === 'ThrowCommand'
      ) {
        return false;
      }

      current = current.$container;
    }

    return false;
  }

  /**
   * Beschränkt return-Anweisungen auf den lexikalischen Inhalt einer Funktion oder Methode.
   * @param node Zu prüfende return-Anweisung.
   * @param accept Empfänger für einen ungültigen Deklarationskontext.
   */
  checkReturnStmt(node: ReturnStmt, accept: ValidationAcceptor): void {
    const fn = AstUtils.getContainerOfType(node, isFunctionDeclaration);

    // return darf nur innerhalb einer Funktion vorkommen
    if (!fn) {
      accept('error', 'return darf nur innerhalb einer Funktion verwendet werden.', {
        node,
        code: ELEMENT_ONLY_WITHIN_FUNCDECL
      });
    }
  }

  /**
   * Prüft eine Variablendeklaration auf Namenskonflikte, Verschattung und gültige Initialisierung.
   *
   * Implizite Längenvariablen von Array-Parametern werden übersprungen. Normale
   * Deklarationen werden gegen Geschwister, Funktionsparameter und äußere sichtbare
   * Namen geprüft. Leere Arrayliterale und `null` sind als Initialwert verboten;
   * bei expliziten Arrayvariablen muss außerdem die Größe numerisch sein.
   *
   * @param node Zu prüfende Variablendeklaration.
   * @param accept Empfänger für Fehler und Verschattungswarnungen.
   */
  checkVarDecl(node: VarDecl, accept: ValidationAcceptor): void {
    if (this.isLengthParameterDecl(node)) {
      return;
    }

    const siblings = this.getSiblingVarDecls(node);
    const index = siblings.indexOf(node);
    const previousSame = siblings.slice(0, index).find(v => v.name === node.name);

    if (previousSame) {
      accept('warning', `Doppelte lokale Variable '${node.name}' im selben Block.`, {
        node,
        property: 'name'
      });
      return;
    }

    const enclosingFn = AstUtils.getContainerOfType(node, isFunctionDeclaration);
    if (enclosingFn) {
      const sameParam = (enclosingFn.params ?? []).find(p => p.name === node.name);
      if (sameParam) {
        accept('error', `Doppelte Deklaration von '${node.name}' in derselben Funktion.`, {
          node,
          property: 'name',
          code: DUPLICATE_ELEMENT
        });
        return;
      }
    }

    const outer = this.findOuterVisibleName(node, node.name);
    if (outer) {
      accept('warning', `Variable '${node.name}' überschattet eine äußere Deklaration.`, {
        node,
        property: 'name'
      });
    }

    // -----------------------------
    // Array-Deklarationen prüfen
    // -----------------------------
    // Initialisierer erst auf den eigentlichen Kern-Ausdruck reduzieren,
    // weil einfache Literale oft noch in Ausdrucks-Hüllen stecken.
    const initCore = node.initializer ? this.unwrapExpr(node.initializer) : undefined;

    // Kein leeres Array als Initialwert
    if (initCore && isArrayLiteral(initCore)) {
      if ((initCore.elems ?? []).length === 0) {
        accept('error', 'Variable kann nicht mit einem leeren Array initialisiert werden.', {
          node,
          property: 'initializer',
          code: VAR_DECL_NO_INIT_WITH_EMPTY_ARRAY
        });
      }
    }

    // Kein null als Initialwert
    if (initCore && isNullLiteral(initCore)) {
      accept('error', 'Variable kann nicht mit null initialisiert werden.', {
        node,
        property: 'initializer',
        code: VAR_DECL_NO_INIT_WITH_NULL
      });
    }

    const isArrayVar = (node as any).isArrayVariable === true;

    if (!isArrayVar) {
      return;
    }

    // Größe/Länge muss num sein
    const sizeExpr = node.size;
    if (sizeExpr) {
      const sizeType = this.types.typeFor(sizeExpr);
      if (!sizeType.isSameAs(TYPE_NUM) && !sizeType.isUnknown()) {
        accept('error', 'Array-Größe muss vom Typ num sein.', {
          node,
          property: 'size',
          code: INCOMPATIBLE_TYPES
        });
      }
    }
  }

  /**
   * Erkennt die intern als VarDecl modellierte Längenvariable eines Array-Parameters.
   * @param v Zu klassifizierende Variablendeklaration.
   * @returns `true`, wenn eine Parameterdeklaration der umgebenden Funktion `v` als Länge verwendet.
   */
  private isLengthParameterDecl(v: VarDecl): boolean {
    const parent: any = v.$container;
    if (!parent || !isFunctionDeclaration(parent)) {
      return false;
    }

    return (parent.params ?? []).some((p: ParameterDecl) => p.len === v);
  }

  /**
   * Validiert die linke und rechte Seite einer Zuweisung.
   *
   * Zuweisbar sind Variablen, Struct-Attribute und Arrayelemente. `this`,
   * Methodenaufrufe und for-Iteratoren sind schreibgeschützt beziehungsweise keine
   * L-Werte. Nach dieser Strukturprüfung muss der rechte Typ zum linken Typ konform sein.
   *
   * @param node Zu prüfende Zuweisung.
   * @param accept Empfänger für L-Wert- und Typfehler.
   */
  checkAssignment(node: Assignment, accept: ValidationAcceptor): void {
    const leftExpr = node.sel as Expr;
    const validLValue = isVarRef(leftExpr) || isAttSelection(leftExpr) || isIndexSelection(leftExpr);
    const left = node.sel as Expr;

    // this darf nie links stehen
    if (left.$type === 'ThisExpr') {
      accept('error', "'this' darf nicht auf der linken Seite einer Zuweisung stehen.", {
        node,
        property: 'sel',
        code: ASSIGNED_TO_THIS
      });
      return;
    }

    // Methodenaufruf darf nie links stehen
    if (isMethSelection(left)) {
      accept('error', 'Ein Methodenaufruf darf nicht auf der linken Seite einer Zuweisung stehen.', {
        node,
        property: 'sel',
        code: ASSIGNED_TO_METHOD_CALL
      });
      return;
    }

    // Schleifenvariable darf nicht zugewiesen werden
    if (isVarRef(left)) {
      const target = left.ref?.ref;
      if (target) {
        const loop = AstUtils.getContainerOfType(target, isForLoop);
        if (loop && loop.iterator === target) {
          accept('error', `Schleifenvariable '${target.name}' darf nicht zugewiesen werden.`, {
            node,
            property: 'sel',
            code: ASSIGNED_TO_LOOPVAR
          });
          return;
        }
      }
    }

    if (!validLValue) {
      accept('error', 'Linke Seite einer Zuweisung muss eine Variable oder ein Attributzugriff sein.', {
        node,
        property: 'sel'
      });
      return;
    }

    const leftType = this.types.typeFor(leftExpr);
    const rightType = this.types.typeFor(node.value);

    if (!this.isAssignable(rightType, leftType)) {
      accept(
        'error',
        `Typfehler bei Zuweisung: '${rightType.asString()}' ist nicht zuweisbar zu '${leftType.asString()}'.`,
        { node, 
          property: 'value',
          code: INCOMPATIBLE_TYPES
        }
        
      );
    }
  }

  /**
   * Prüft einen Struct auf einen eindeutigen globalen Namen und eindeutige Kindnamen.
   * Attribute und Methoden teilen sich dabei denselben Namensraum innerhalb des Structs.
   * @param node Zu prüfende Struct-Deklaration.
   * @param accept Empfänger für Duplikatfehler.
   */
  checkStructDeclaration(node: StructDeclaration, accept: ValidationAcceptor): void {
    const program = this.getProgram(node);
    if (program) {
      const structs = program.instructions.filter(isStructDeclaration);
      const index = structs.indexOf(node);
      const previousWithSameName = structs.slice(0, index).find(s => s.name === node.name);

      if (previousWithSameName) {
        accept('error', `Doppelte Struct-Deklaration '${node.name}'.`, {
          node,
          property: 'name',
          code: DUPLICATE_ELEMENT
        });
      }
    }

    const seenChildren = new Set<string>();

    for (const child of node.children ?? []) {
      const name = (child as { name?: string }).name;
      if (!name) continue;

      if (seenChildren.has(name)) {
        accept('error', `Doppeltes Struct-Element '${name}' in Struct '${node.name}'.`, {
          node: child,
          property: 'name',
          code: DUPLICATE_ELEMENT
        });
      } else {
        seenChildren.add(name);
      }
    }
  }

  /**
   * Erweiterungspunkt für eigenständige Regeln an Struct-Attributdeklarationen.
   * Die aktuell erforderlichen Prüfungen erfolgen über Struct-Duplikatprüfung,
   * Typverlinkung und Zugriffsvalidierung; deshalb erzeugt dieser Hook keine Diagnose.
   * @param node Registrierte Struct-Attributdeklaration.
   * @param accept Empfänger für zukünftig ergänzte Diagnosen.
   */
  checkStructAttDeclaration(node: StructAttDeclaration, accept: ValidationAcceptor): void {}

  /**
   * Meldet eine Typangabe, deren referenzierter Struct nicht aufgelöst werden konnte.
   * @param node Zu prüfende Struct-Typreferenz.
   * @param accept Empfänger für Verlinkungsfehler.
   */
  checkStructType(node: StructType, accept: ValidationAcceptor): void {
    if (node.struct && !node.struct.ref) {
      accept('error', 'Unbekannter Struct-Typ.', { node, property: 'struct' });
    }
  }

  /**
   * Meldet einen new-Ausdruck, dessen Ziel-Struct nicht aufgelöst werden konnte.
   * @param node Zu prüfender new-Ausdruck.
   * @param accept Empfänger für Verlinkungsfehler.
   */
  checkNewExpr(node: NewExpr, accept: ValidationAcceptor): void {
    if (node.type && !node.type.ref) {
      accept('error', 'Unbekannter Struct-Typ in new.', { node, property: 'type' });
    }
  }

  /**
   * Erweiterungspunkt für Regeln, die für alle Variablenarten gelten sollen.
   * Konkrete Parameter-, lokale Variablen- und Attributregeln werden derzeit von
   * den jeweils spezifischeren AST-Checks abgedeckt.
   * @param node Registrierter Variablenknoten.
   * @param accept Empfänger für zukünftig ergänzte Diagnosen.
   */
  checkVariable(node: Variable, accept: ValidationAcceptor): void {}

  /**
   * Prüft die Auflösung einer Variablenreferenz und einen optional direkt angehängten Index.
   * Das referenzierte Ziel muss als Array deklariert oder als Arraytyp inferiert sein;
   * der Indexausdruck muss den Typ `num` besitzen.
   * @param node Zu prüfende Variablenreferenz.
   * @param accept Empfänger für Verlinkungs-, Array- und Indexfehler.
   */
  checkVarRef(node: VarRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekannte Variable.', { node, property: 'ref' });
      return;
    }

    if (node.index) {
      const target = node.ref?.ref;
      if (!target) return;

      let isArrayTarget = false;

      if (isParameterDecl(target)) {
        isArrayTarget = target.isArray === true;
      } else if (isStructAttDeclaration(target)) {
        const t = this.types.typeForTypeRef(target.type);
        isArrayTarget = t.isArrayType();
      } else if (isVarDecl(target)) {
        if ((target as any).isArrayVariable === true) {
          isArrayTarget = true;
        } else if (target.initializer) {
          const t = this.types.typeFor(target.initializer);
          isArrayTarget = t.isArrayType();
        }
      }

      if (!isArrayTarget) {
        accept('error', 'Indexzugriff ist nur auf Array-Typen erlaubt.', {
          node,
          property: 'index',
          code: ARRAY_ACCESS_ON_PLAIN_TYPE
        });
      }

      const indexType = this.types.typeFor(node.index);
      if (!indexType.isSameAs(TYPE_NUM) && !indexType.isUnknown()) {
        accept('error', 'Der Array-Index muss vom Typ num sein.', {
          node,
          property: 'index',
          code: INCOMPATIBLE_TYPES
        });
      }
    }
  }

  /**
   * Prüft die Auflösung einer Attributreferenz und einen optionalen Arrayindex.
   * Bei indexiertem Zugriff muss der Attributtyp ein Array und der Index numerisch sein.
   * @param node Zu prüfende Attributreferenz.
   * @param accept Empfänger für Verlinkungs-, Array- und Indexfehler.
   */
  checkAttRef(node: AttRef, accept: ValidationAcceptor): void {
    if (node.ref && !node.ref.ref) {
      accept('error', 'Unbekanntes Attribut.', { node, property: 'ref' });
      return;
    }

    if (node.index) {
      const att = node.ref?.ref;
      if (!att?.type) return;

      const attType = this.types.typeForTypeRef(att.type);
      if (!attType.isArrayType()) {
        accept('error', 'Indexzugriff ist nur auf Array-Typen erlaubt.', {
          node,
          property: 'index',
          code: ARRAY_ACCESS_ON_PLAIN_TYPE
        });
      }

      const indexType = this.types.typeFor(node.index);
      if (!indexType.isSameAs(TYPE_NUM) && !indexType.isUnknown()) {
        accept('error', 'Der Array-Index muss vom Typ num sein.', {
          node,
          property: 'index',
          code: INCOMPATIBLE_TYPES
        });
      }
    }
  }

  /**
   * Validiert die innerhalb einer Methoden-Selection gespeicherte Methodenreferenz.
   *
   * Das Ziel muss aufgelöst und eine echte Struct-Methode ohne `func` sein.
   * Wertlose Methoden sind nur im `call`-Kontext erlaubt. Abschließend werden
   * Argumentanzahl und Argumenttypen gegen die Methodendeklaration geprüft.
   *
   * @param node Zu prüfende Methodenreferenz mit Argumenten.
   * @param accept Empfänger für Auflösungs-, Kontext- und Argumentfehler.
   */
  checkMethRef(node: MethRef, accept: ValidationAcceptor): void {
    if (node.f && !node.f.ref) {
      accept('error', 'Unbekannte Methode/Funktion.', { node, property: 'f' });
      return;
    }

    const target = node.f?.ref;
    if (!target) return;

    // Methoden ohne Rückgabewert dürfen nur per "call" als Instruktion benutzt werden
    if (!this.hasReturnValue(target) && !this.isInsideCallCommand(node)) {
      accept('error', `Methode '${target.name}' gibt keinen Wert zurück und darf nur mit 'call' als Instruktion verwendet werden.`, {
        node,
        property: 'f',
        code: METHODCALLS_WO_RETURN_ONLY_AS_INSTRUCTION
      });
      return;
    }

    // In Selections dürfen nur echte Methoden stehen, keine globalen Funktionen mit func
    if (target.keyword === true) {
      accept('error', 'In einer Selection dürfen nur Methoden aufgerufen werden, keine globalen Funktionen.', {
        node,
        property: 'f',
        code: SELECTION_REQUIRES_METHODCALLS
      });
      return;
    }

    const expected = target.params?.length ?? 0;
    const actual = node.params?.length ?? 0;

    // Eigener Code für falsche Parameteranzahl
    if (actual < expected) {
      accept('error', `Zu wenige Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params',
        code: FUNC_CALL_RIGHT_PARANUM
      });
      return;
    } else if (actual > expected) {
      accept('error', `Zu viele Argumente: erwartet ${expected}, erhalten ${actual}.`, {
        node,
        property: 'params',
        code: FUNC_CALL_RIGHT_PARANUM
      });
      return;
    }

    this.checkArgumentTypes(node, target, node.params ?? [], accept);
  }

  /**
   * Sucht in der Containerkette nach einem expliziten `call`-Kommando.
   * @param node Ausgangsknoten der Suche.
   * @returns `true`, wenn der Knoten innerhalb eines CallCommand liegt.
   */
  private isInsideCallCommand(node: AstNode): boolean {
    let current: AstNode | undefined = node;
    while (current) {
      if (current.$type === 'CallCommand') {
        return true;
      }
      current = current.$container;
    }
    return false;
  }

  /**
   * Prüft, ob der Empfänger eines Attributzugriffs ein Struct ist und das gewählte
   * Attribut im anhand des Empfängertyps bestimmten Struct tatsächlich existiert.
   * @param node Zu prüfende Attribut-Selection.
   * @param accept Empfänger für Typ- und Existenzfehler.
   */
  checkAttSelection(node: AttSelection, accept: ValidationAcceptor): void {
    const receiverType = this.types.typeFor(node.receiver);

    if (!receiverType.isStructType() && !receiverType.isUnknown()) {
      accept('error', `Attributzugriff nur auf Struct-Typen erlaubt, erhalten '${receiverType.asString()}'.`, {
        node,
        property: 'receiver',
        code: INCOMPATIBLE_TYPES
      });
      return;
    }

    const structName = this.types.structNameOf(node.receiver);
    if (!structName) return;

    const struct = this.findStructByName(node, structName);
    if (!struct) return;

    const attName = node.attref.ref?.ref?.name;
    if (!attName) return;

    const exists = (struct.children ?? [])
      .filter(isStructAttDeclaration)
      .some(a => a.name === attName);

    if (!exists) {
      accept('error', `Attribut '${attName}' existiert nicht in Struct '${structName}'.`, {
        node,
        property: 'attref'
      });
    }
  }
////////////////////////
  /**
   * Prüft Empfängertyp, Rückgabekontext und Existenz einer ausgewählten Struct-Methode.
   * Die Detailprüfung der Methodenreferenz und ihrer Argumente erfolgt zusätzlich in
   * `checkMethRef`.
   * @param node Zu prüfende Methoden-Selection.
   * @param accept Empfänger für Typ-, Kontext- und Existenzfehler.
   */
  checkMethSelection(node: MethSelection, accept: ValidationAcceptor): void {
    const receiverType = this.types.typeFor(node.receiver);

    if (!receiverType.isStructType() && !receiverType.isUnknown()) {
      accept('error', `Methodenaufruf nur auf Struct-Typen erlaubt, erhalten '${receiverType.asString()}'.`, {
        node,
        property: 'receiver',
        code: INCOMPATIBLE_TYPES
      });
      return;
    }

    const structName = this.types.structNameOf(node.receiver);
    if (!structName) return;

    const struct = this.findStructByName(node, structName);
    if (!struct) return;

    const methodName = node.methref.f?.ref?.name;
    if (!methodName) return;

    const target = node.methref.f?.ref;
    if (!target) return;

    if (!this.isStatementMethodCall(node) && !this.hasReturnValue(target)) {
      accept('error', `Methode '${target.name}' gibt keinen Wert zurück und kann nicht als Ausdruck verwendet werden.`, {
        node,
        property: 'methref',
        code: METHODCALLS_WO_RETURN_ONLY_AS_INSTRUCTION
      });
    }

    const exists = (struct.children ?? [])
      .filter(isFunctionDeclaration)
      .filter(m => m.keyword !== true)
      .some(m => m.name === methodName);

    if (!exists) {
      accept('error', `Methode '${methodName}' existiert nicht in Struct '${structName}'.`, {
        node,
        property: 'methref'
      });
    }
  }

  /**
   * Unterscheidet eine als eigenständige Anweisung verwendete Methodenselektion von
   * einer Selektion, deren Ergebnis in einem Ausdruck benötigt wird.
   * @param node Einzuordnende Methodenselektion.
   * @returns `true` im ExprStatement- oder CallCommand-Kontext, sonst `false`.
   */
  private isStatementMethodCall(node: MethSelection): boolean {
    let current: any = node.$container;

    while (current) {
      if (current.$type === 'ExprStatement' || current.$type === 'CallCommand') {
        return true;
      }

      if (
        current.$type === 'VarDecl' ||
        current.$type === 'Assignment' ||
        current.$type === 'ReturnStmt' ||
        current.$type === 'PrintCommand' ||
        current.$type === 'ThrowCommand'
      ) {
        return false;
      }

      current = current.$container;
    }

    return false;
  }

  /**
   * Sucht eine globale Struct-Deklaration anhand ihres Quellnamens.
   * @param node Beliebiger Knoten desselben Pseudo2-Dokuments.
   * @param name Gesuchter Struct-Name.
   * @returns Passende Deklaration oder `undefined`, wenn sie nicht existiert.
   */
  private findStructByName(node: { $container?: unknown }, name: string): StructDeclaration | undefined {
    const program = this.getProgram(node);
    return program?.instructions
      .filter(isStructDeclaration)
      .find(s => s.name === name);
  }

  /**
   * Beschränkt `this` auf methodenartige FunctionDeclarations innerhalb eines Structs.
   * Globale Funktionen und freie Quellbereiche dürfen den Ausdruck nicht verwenden.
   * @param node Zu prüfender this-Ausdruck.
   * @param accept Empfänger für ungültige Verwendungskontexte.
   */
  checkThisExpr(node: ThisExpr, accept: ValidationAcceptor): void {
    const fn = AstUtils.getContainerOfType(node, isFunctionDeclaration);

    // Fall 1:
    // "this" darf überhaupt nur innerhalb einer FunctionDeclaration vorkommen
    if (!fn) {
      accept('error', "'this' darf nur innerhalb einer Funktion verwendet werden.", {
        node,
        code: ELEMENT_ONLY_WITHIN_FUNCDECL
      });
      return;
    }

    const struct = AstUtils.getContainerOfType(fn.$container, isStructDeclaration);

    // Fall 2:
    // Innerhalb einer Funktion ist "this" nur erlaubt,
    // wenn diese Funktion eine Struct-Methode ist
    // (also in einem Struct liegt und KEIN func-Keyword hat)
    if (!struct || fn.keyword === true) {
      accept('error', "'this' darf nur innerhalb einer Struct-Methode verwendet werden.", {
        node,
        code: ELEMENT_ONLY_WITHIN_METHDECL
      });
    }
  }

  /**
   * Stellt für nichtleere Arrayliterale einen einheitlichen Elementtyp sicher.
   * Unbekannte Teiltypen werden über die tolerante Typgleichheit der Typkomponente behandelt.
   * @param node Zu prüfendes Arrayliteral.
   * @param accept Empfänger für abweichende Elementtypen.
   */
  checkArrayLiteral(node: ArrayLiteral, accept: ValidationAcceptor): void {
    const elems = node.elems ?? [];
    if (elems.length === 0) {
      return;
    }

    if (elems.length <= 1) {
      return;
    }

    const firstType = this.types.typeFor(elems[0]);

    for (let i = 1; i < elems.length; i++) {
      const currentType = this.types.typeFor(elems[i]);

      if (!currentType.isSameAsIgnoringUnknown(firstType)) {
        accept('error', 'Alle Elemente eines Array-Literals müssen denselben Typ haben.', {
          node,
          property: 'elems',
          index: i,
          code: DIFFERENT_TYPES_OF_ARRAYLIT_ELEMS
        });
      }
    }
  }

  /**
   * Beschränkt die Ausgabe von `print` auf skalare Pseudo2-Basistypen.
   * @param node Zu prüfendes print-Kommando.
   * @param accept Empfänger für nicht druckbare Typen.
   */
  checkPrintCommand(node: PrintCommand, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.param);
    if (!t.isUnknown() && !t.isBaseType()) {
      accept('error', `print erwartet einen Basistyp, ist aber '${t.asString()}'.`, {
        node,
        property: 'param',
        code: PRINT_EXPECTS_BASE_TYPE
      });
    }
  }

  /**
   * Stellt sicher, dass `throw` einen String als Fehlermeldung erhält.
   * @param node Zu prüfendes throw-Kommando.
   * @param accept Empfänger für Typfehler.
   */
  checkThrowCommand(node: ThrowCommand, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.param);
    if (!t.isUnknown() && !t.isSameAs(TYPE_STRING)) {
      accept('error', `throw erwartet einen Wert vom Typ string, ist aber '${t.asString()}'.`, {
        node,
        property: 'param',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Verlangt als Operand von `call` einen globalen Funktions- oder Methodenaufruf.
   * Ausdruckshüllen werden vor der Klassifikation entfernt.
   * @param node Zu prüfendes call-Kommando.
   * @param accept Empfänger für nicht aufrufbare Ausdrücke.
   */
  checkCallCommand(node: CallCommand, accept: ValidationAcceptor): void {
    if (!this.isCallableExpr(node.param)) {
      accept('error', 'call erwartet einen aufrufbaren Ausdruck, z. B. f() oder obj.m().', {
        node,
        property: 'param'
      });
    }
  }

  /**
   * Vergleicht tatsächliche Aufrufargumente mit den formalen Parametern einer Funktion.
   *
   * Zuerst muss die Array-Eigenschaft übereinstimmen. Für skalare Parameter wird der
   * erwartete Typ aus ihrer Verwendung im Funktionsrumpf abgeleitet und anschließend
   * mit der allgemeinen Zuweisungskonformität geprüft. Array-Elementtypen bleiben an
   * dieser Stelle bewusst offen, da Pseudo2 sie nicht am Parameter deklariert.
   *
   * @param callNode Aufrufknoten, an dem eine Diagnose markiert wird.
   * @param target Aufgelöste Funktions- oder Methodendeklaration.
   * @param args Tatsächliche Argumentausdrücke in Aufrufreihenfolge.
   * @param accept Empfänger für Array- und Typfehler.
   */
  private checkArgumentTypes(
    callNode: FunctionCall | MethRef,
    target: FunctionDeclaration,
    args: Expr[],
    accept: ValidationAcceptor
  ): void {
    const params = target.params ?? [];
    const count = Math.min(params.length, args.length);

    for (let i = 0; i < count; i++) {
      const param = params[i];
      const arg = args[i];

      const expectedType = this.expectedParameterType(param);
      const actualType = this.types.typeFor(arg);

      if (param.isArray && !actualType.isArrayType() && !actualType.isUnknown()) {
        accept(
          'error',
          `Argument ${i + 1} muss ein Array sein, weil der formale Parameter '${param.name}' ein Array-Parameter ist.`,
          {
            node: callNode,
            property: 'params',
            index: i,
            code: CONSISTENT_ARRAY_TYPE_OF_PARA
          }
        );
        continue;
      }

      if (!param.isArray && actualType.isArrayType()) {
        accept(
          'error',
          `Argument ${i + 1} darf kein Array sein, weil der formale Parameter '${param.name}' kein Array-Parameter ist.`,
          {
            node: callNode,
            property: 'params',
            index: i,
            code: CONSISTENT_ARRAY_TYPE_OF_PARA
          }
        );
        continue;
      }

      // Array parameters do not declare their element type. Their concrete depth and
      // element type are inferred from call sites and usages inside the function.
      if (param.isArray) {
        continue;
      }

      // Wenn der erwartete Typ noch unbekannt ist, hier nichts weiter prüfen
      if (expectedType.isUnknown()) {
        continue;
      }

      // Normale Typkonformität der Argumente prüfen
      if (!this.isAssignable(actualType, expectedType)) {
        accept(
          'error',
          `Argument ${i + 1} hat falschen Typ: erwartet '${expectedType.asString()}', erhalten '${actualType.asString()}'.`,
          {
            node: callNode,
            property: 'params',
            index: i,
            code: FUNC_CALL_ACTUALPARA_CONFORMSTO_FORMALPARA
          }
        );
      }
    }
  }
///
  /**
   * Vereinigt zwei aus verschiedenen Verwendungen abgeleitete Erwartungstypen.
   * Unbekannte beziehungsweise teilweise unbekannte Typen werden durch die jeweils
   * präzisere kompatible Information ersetzt; widersprüchliche Typen ergeben `unknown`.
   *
   * @param a Erste Typannahme.
   * @param b Zweite Typannahme.
   * @returns Gemeinsamer möglichst präziser Typ oder `TYPE_UNKNOWN` bei einem Konflikt.
   */
  private mergeExpectedTypes(
  a: ReturnType<Pseudo2TypeComputer['typeFor']>,
  b: ReturnType<Pseudo2TypeComputer['typeFor']>
): ReturnType<Pseudo2TypeComputer['typeFor']> {
  if (a.isUnknown()) {
    return b;
  }

  if (b.isUnknown()) {
    return a;
  }

  if (a.isSameAs(b)) {
    return a;
  }

  if (a.isSameAsIgnoringUnknown(b)) {
    return a.isPartiallyUnknown() ? b : a;
  }

  if (b.isSameAsIgnoringUnknown(a)) {
    return b.isPartiallyUnknown() ? a : b;
  }

  return TYPE_UNKNOWN;
}

  /**
   * Bestimmt den erwarteten Typ eines formalen Parameters.
   * Array-Parameter erhalten einen abstrakten Arraytyp, skalare Parameter werden aus
   * ihren Verwendungen im Funktionsrumpf inferiert.
   * @param param Zu untersuchender formaler Parameter.
   * @returns Erwarteter Parameter- beziehungsweise Arraytyp.
   */
  private expectedParameterType(param: ParameterDecl): ReturnType<Pseudo2TypeComputer['typeFor']> {
    if (param.isArray) {
      return TYPE_ARRAY_UNKNOWN;
    }

    return this.inferParameterTypeFromFunctionBody(param);
  }

  /**
   * Leitet den Typ eines untypisierten skalaren Parameters aus sämtlichen Referenzen
   * innerhalb seiner Funktion ab und vereinigt die gefundenen Nutzungskontexte.
   * @param param Parameter, dessen erwarteter Typ gesucht wird.
   * @returns Inferierter Typ oder `TYPE_UNKNOWN`, wenn keine eindeutige Aussage möglich ist.
   */
  private inferParameterTypeFromFunctionBody(param: ParameterDecl): ReturnType<Pseudo2TypeComputer['typeFor']> {
    const fn = AstUtils.getContainerOfType(param, isFunctionDeclaration);
    if (!fn) {
      return TYPE_UNKNOWN;
    }

    let inferred = TYPE_UNKNOWN;

    for (const n of AstUtils.streamAllContents(fn)) {
      if (isVarRef(n) && n.ref?.ref === param) {
        const usageType = this.inferTypeFromUsage(n);
        inferred = this.mergeExpectedTypes(inferred, usageType);
      }
    }

    return inferred;
  }


  /**
   * Untersucht die Containerkette einer Parameterreferenz auf einen typbestimmenden Kontext.
   *
   * Boolesche Bedingungen, numerische Operatoren, Indexierung und Struct-Selektionen
   * liefern konkrete Erwartungen. Gleichheit übernimmt nach Möglichkeit den Typ des
   * anderen Operanden. Verschachtelte Aufrufe und reine `+`-Verkettungen bleiben
   * absichtlich unbekannt, um keine zu strenge Annahme zu erzeugen.
   *
   * @param ref Referenz auf den zu inferierenden Parameter.
   * @returns Aus der nächsten aussagekräftigen Verwendung abgeleiteter Typ.
   */
  private inferTypeFromUsage(ref: VarRef): ReturnType<Pseudo2TypeComputer['typeFor']> {
    let current: any = ref.$container;

    while (current) {
      if (isFunctionDeclaration(current)) {
        return TYPE_UNKNOWN;
      }

      if (isFunctionCall(current) && (current.params ?? []).some((p: Expr) => this.exprContainsNode(p, ref))) {
        return TYPE_UNKNOWN;
      }

      if (isMethRef(current) && (current.params ?? []).some((p: Expr) => this.exprContainsNode(p, ref))) {
        return TYPE_UNKNOWN;
      }

      // Equality-Kontext: x == y oder x != y
      // Der Typ eines Operanden soll sich möglichst aus dem anderen Operanden ergeben,
      // nicht aus dem äußeren if/while-Bool-Kontext.
      if (isEquality(current) && (current.right?.length ?? 0) > 0) {
        const operands = [current.left, ...(current.right ?? [])];

        const otherOperands = operands.filter((e: Expr) => !this.exprContainsNode(e, ref));
        const otherOperandTypes = otherOperands.map((e: Expr) => this.types.typeFor(e));

        for (const t of otherOperandTypes) {
          if (!t.isUnknown()) {
            return t;
          }
        }

        return TYPE_UNKNOWN;
      }

      // bool-Kontext
      if (isIfStatement(current) && this.exprContainsNode(current.condition, ref)) {
        return TYPE_BOOL;
      }

      if (isWhileLoop(current) && this.exprContainsNode(current.condition, ref)) {
        return TYPE_BOOL;
      }

      if (isDoWhileLoop(current) && this.exprContainsNode(current.condition, ref)) {
        return TYPE_BOOL;
      }

      if (isNot(current) && this.exprContainsNode(current.value, ref)) {
        return TYPE_BOOL;
      }

      if (isAnd(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_BOOL;
      }

      if (isOr(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_BOOL;
      }

      // Array-Kontext
      if (ref.index) {
        return TYPE_ARRAY_UNKNOWN;
      }

      if (isVarRef(current) && current.ref?.ref === ref.ref?.ref && current.index) {
        return TYPE_ARRAY_UNKNOWN;
      }

      // Struct-Kontext: x.age
      if (isAttSelection(current) && current.receiver === ref) {
        const attDecl = current.attref.ref?.ref;
        const ownerStruct = attDecl ? AstUtils.getContainerOfType(attDecl, isStructDeclaration) : undefined;

        if (ownerStruct) {
          return TYPE_STRUCT(ownerStruct.name);
        }

        return TYPE_STRUCT('');
      }

      // Struct-Kontext: x.m()
      if (isMethSelection(current) && current.receiver === ref) {
        const methodDecl = current.methref.f?.ref;
        const ownerStruct = methodDecl ? AstUtils.getContainerOfType(methodDecl, isStructDeclaration) : undefined;

        if (ownerStruct) {
          return TYPE_STRUCT(ownerStruct.name);
        }

        return TYPE_STRUCT('');
      }

      // numerischer Kontext
      if (isMultiplication(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      if (isExponentiation(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      if (isComparison(current) && (current.right?.length ?? 0) > 0) {
        return TYPE_NUM;
      }

      // lockere Addition:
      // string + string, string + num, num + string, string + bool, bool + string sind erlaubt
      // deshalb darf aus x + ... KEIN harter Parametertyp abgeleitet werden
      // Addition/Subtraktion
      if (isAddition(current) && (current.right?.length ?? 0) > 0) {
        // Sobald irgendwo '-' vorkommt, ist der Kontext numerisch.
        // Beispiel: a - 2  => a muss num sein.
        if ((current.op ?? []).some(op => op === '-')) {
          return TYPE_NUM;
        }

        // Für reines '+' bleibt die Inferenz bewusst locker,
        // weil string + num, num + string, string + bool usw. erlaubt sind.
        const operands = [current.left, ...(current.right ?? [])];
        const otherOperands = operands.filter((e: Expr) => !this.exprContainsNode(e, ref));
        const otherOperandTypes = otherOperands.map((e: Expr) => this.types.typeFor(e));

        // Bei Arrays/Structs nichts Hartes ableiten
        if (otherOperandTypes.some(t => t.isArrayType() || t.isStructType())) {
          return TYPE_UNKNOWN;
        }

        return TYPE_UNKNOWN;
      }

      current = current.$container;
    }

    return TYPE_UNKNOWN;
  }

  /**
   * Prüft per Identität, ob ein AST-Knoten ein Ausdruck selbst oder einer seiner
   * transitiven Inhalte ist.
   * @param expr Zu durchsuchender Ausdruck.
   * @param node Gesuchter AST-Knoten.
   * @returns `true`, wenn `node` im Ausdruck enthalten ist.
   */
  private exprContainsNode(expr: Expr | undefined, node: AstNode): boolean {
    if (!expr) {
      return false;
    }

    if (expr === node) {
      return true;
    }

    for (const child of AstUtils.streamAllContents(expr)) {
      if (child === node) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validiert die Pseudo2-Überladung von `+` und die numerische Subtraktion.
   *
   * Strings dürfen mit skalaren Zahlen, booleschen Werten und Strings verkettet werden.
   * Ohne String sind nur numerische Operanden zulässig; Arrays und Structs sind immer
   * verboten. Unbekannte Typen lösen keine zusätzliche Folgediagnose aus.
   *
   * @param node Zu prüfende Additionskette.
   * @param accept Empfänger für unzulässige Operanden.
   */
  checkAddition(node: Addition, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) {
      return;
    }

    const operands = [node.left, ...(node.right ?? [])];
    const types = operands.map(e => this.types.typeFor(e));

    const hasString = types.some(t => t.isSameAs(TYPE_STRING));
    const hasBool = types.some(t => t.isSameAs(TYPE_BOOL));
    const hasStruct = types.some(t => t.isStructType());
    const hasArray = types.some(t => t.isArrayType());

    // Array/Struct bei + bleiben verboten
    if (hasStruct || hasArray) {
      accept(
        'error',
        `Ungültige Addition: '+' erlaubt keine Arrays oder Structs.`,
        { node,
          code: INCOMPATIBLE_TYPES_PLUS
        }
      );
      return;
    }

    // Sobald string beteiligt ist, ist string-Verkettung erlaubt
    // -> string+string, string+num, num+string, string+bool, bool+string
    if (hasString) {
      return;
    }

    // Ohne string bleibt nur num+num erlaubt
    if (hasBool) {
      accept(
        'error',
        `Ungültige Addition: bool ist nur in String-Verkettung mit '+' erlaubt.`,
        { node, 
          code: INCOMPATIBLE_TYPES_PLUS 
        }
      );
      return;
    }

    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      if (!t.isSameAs(TYPE_NUM) && !t.isUnknown()) {
        accept(
          'error',
          `Ungültiger Operand für '+': erwartet num oder string, erhalten '${t.asString()}'.`,
          {
            node,
            property: i === 0 ? 'left' : 'right',
            index: i === 0 ? undefined : i - 1,
            code: INCOMPATIBLE_TYPES_PLUS
          } as any
        );
        return;
      }
    }
  }

  /**
   * Verlangt für Multiplikation, Division, Rest und `mod` ausschließlich `num`-Operanden.
   * @param node Zu prüfende Multiplikationskette.
   * @param accept Empfänger für Typfehler.
   */
  checkMultiplication(node: Multiplication, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_NUM, accept, `Operatoren '*', '/', '%' und 'mod' erwarten num.`, INCOMPATIBLE_TYPES);
  }

  /**
   * Verlangt für Basis und Exponent des Potenzoperators ausschließlich `num`.
   * @param node Zu prüfende Potenzkette.
   * @param accept Empfänger für Typfehler.
   */
  checkExponentiation(node: Exponentiation, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_NUM, accept, `Potenzoperator '^' erwartet num.`, INCOMPATIBLE_TYPES);
  }

  /**
   * Verlangt für alle Operanden einer logischen UND-Verknüpfung den Typ `bool`.
   * @param node Zu prüfende UND-Kette.
   * @param accept Empfänger für Typfehler.
   */
  checkAnd(node: And, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_BOOL, accept, `Operator '&&' erwartet bool.`, INCOMPATIBLE_TYPES);
  }

  /**
   * Verlangt für alle Operanden einer logischen ODER-Verknüpfung den Typ `bool`.
   * @param node Zu prüfende ODER-Kette.
   * @param accept Empfänger für Typfehler.
   */
  checkOr(node: Or, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_BOOL, accept, `Operator '||' erwartet bool.`, INCOMPATIBLE_TYPES);
  }

  /**
   * Verlangt für den Operanden der logischen Negation den Typ `bool`.
   * @param node Zu prüfender Negationsausdruck.
   * @param accept Empfänger für Typfehler.
   */
  checkNot(node: Not, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.value);
    if (!t.isSameAs(TYPE_BOOL) && !t.isUnknown()) {
      accept('error', `Operator '!' erwartet bool, erhalten '${t.asString()}'.`, {
        node,
        property: 'value',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Verlangt für das unäre Minus einen numerischen Operanden.
   * @param node Zu prüfender Vorzeichenausdruck.
   * @param accept Empfänger für Typfehler.
   */
  checkNeg(node: Neg, accept: ValidationAcceptor): void {
    const t = this.types.typeFor(node.value);

    if (!t.isSameAs(TYPE_NUM) && !t.isUnknown()) {
      accept('error', `Vorzeichen '-' erwartet num, erhalten '${t.asString()}'.`, {
        node,
        property: 'value',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Prüft einen allgemeinen IndexSelection-Knoten auf Arrayempfänger und numerischen Index.
   * Diese Regel deckt insbesondere verschachtelte und aus Selektionen entstandene Zugriffe ab.
   * @param node Zu prüfende Index-Selection.
   * @param accept Empfänger für Empfänger- und Indextypfehler.
   */
  checkIndexSelection(node: IndexSelection, accept: ValidationAcceptor): void {
    const receiverType = this.types.typeFor(node.receiver);
    if (!receiverType.isArrayType() && !receiverType.isUnknown()) {
      accept('error', 'Indexzugriff ist nur auf Array-Typen erlaubt.', {
        node,
        property: 'index',
        code: ARRAY_ACCESS_ON_PLAIN_TYPE
      });
    }

    const indexType = this.types.typeFor(node.index);
    if (!indexType.isSameAs(TYPE_NUM) && !indexType.isUnknown()) {
      accept('error', 'Der Array-Index muss vom Typ num sein.', {
        node,
        property: 'index',
        code: INCOMPATIBLE_TYPES
      });
    }
  }

  /**
   * Beschränkt den VeriFast-Platzhalter `result` auf Spezifikationen und Annotationen.
   * @param node Zu prüfender result-Ausdruck.
   * @param accept Empfänger für einen ungültigen Verwendungskontext.
   */
  checkResultExpr(node: ResultExpr, accept: ValidationAcceptor): void {
    if (!this.isInsideVeriFastAnnotation(node)) {
      accept('error', "'result' darf nur in VeriFast-Annotationen verwendet werden.", {
        node,
        code: RESULT_ONLY_IN_VERIFAST_ANNOTATION
      });
    }
  }

  /**
   * Validiert Kontext und argumentspezifische Syntax eines eingebauten `vf_*`-Prädikats.
   *
   * Je nach Prädikat sind ein oder zwei Argumente erforderlich. `vf_field` benötigt
   * einen literalen Feldnamen, die optionale Inhaltsprüfung von `vf_string` ein
   * Stringliteral und `vf_ratio` einen von null verschiedenen ganzzahligen Nenner.
   *
   * @param node Zu prüfender Spezifikationsprädikatausdruck.
   * @param accept Empfänger für Kontext-, Stelligkeits- und Literalfehler.
   */
  checkSpecPredicateExpr(node: SpecPredicateExpr, accept: ValidationAcceptor): void {
    if (!this.isInsideVeriFastAnnotation(node)) {
      accept('error', `'${node.kind}' darf nur in VeriFast-Annotationen verwendet werden.`, {
        node,
        code: SPEC_PREDICATE_ONLY_IN_VERIFAST_ANNOTATION
      });
    }

    const actualArity = (node.args ?? []).length;
    const expectedArity = node.kind === 'vf_elem' || node.kind === 'vf_field' || node.kind === 'vf_in_bounds' || node.kind === 'vf_ratio' || node.kind === 'vf_same' ? 2 : 1;
    const validArity = node.kind === 'vf_string'
      ? actualArity === 1 || actualArity === 2
      : actualArity === expectedArity;
    if (!validArity) {
      const expectation = node.kind === 'vf_string'
        ? 'ein oder zwei Argumente'
        : expectedArity === 1 ? 'ein Argument' : 'zwei Argumente';
      accept('error', `'${node.kind}' erwartet genau ${expectation}.`, {
        node,
        property: 'args',
        code: SPEC_PREDICATE_ARITY
      });
    }

    if (node.kind === 'vf_field' && node.args[1] && !isStringLiteral(this.unwrapSingletonExpr(node.args[1]))) {
      accept('error', "'vf_field' erwartet als zweites Argument einen Feldnamen als Stringliteral.", {
        node,
        property: 'args',
        code: SPEC_PREDICATE_FIELD_NAME
      });
    }

    if (node.kind === 'vf_string' && node.args[1] && !isStringLiteral(this.unwrapSingletonExpr(node.args[1]))) {
      accept('error', "'vf_string' erwartet als zweites Argument einen konkreten String als Stringliteral.", {
        node,
        property: 'args',
        code: SPEC_PREDICATE_STRING_VALUE
      });
    }

    if (node.kind === 'vf_ratio' && node.args[1]) {
      const denominator = this.unwrapSingletonExpr(node.args[1]);
      if (!isIntLiteral(denominator) || denominator.value === 0) {
        accept('error', "'vf_ratio' erwartet als zweites Argument ein von null verschiedenes Ganzzahlliteral.", {
          node,
          property: 'args',
          code: SPEC_PREDICATE_RATIO_DENOMINATOR
        });
      }
    }
  }

  /**
   * Entfernt rekursiv Klammern und operatorische Einzeloperand-Hüllen von einem Ausdruck.
   * Diese kompakte Variante wird für Prüfungen verwendet, die den konkreten Literaltyp
   * hinter der durch die Grammatik erzeugten Präzedenzstruktur benötigen.
   * @param expr Zu reduzierender Ausdruck.
   * @returns Innerster Ausdruck, sobald keine reine Einzeloperand-Hülle mehr vorliegt.
   */
  private unwrapSingletonExpr(expr: Expr): Expr {
    if ((isOr(expr) || isAnd(expr) || isEquality(expr) || isComparison(expr) || isAddition(expr) || isMultiplication(expr) || isExponentiation(expr)) && (expr.right?.length ?? 0) === 0) {
      return this.unwrapSingletonExpr(expr.left);
    }
    if (isGrouping(expr)) {
      return this.unwrapSingletonExpr(expr.value);
    }
    return expr;
  }

  /**
   * Prüft, ob ein Ausdruck in einer Funktionsspezifikation, einer Verifikationsanweisung
   * oder einer Schleifenannotation liegt.
   * @param node Ausgangsknoten für die Containersuche.
   * @returns `true` innerhalb eines von Pseudo2 unterstützten VeriFast-Kontexts.
   */
  private isInsideVeriFastAnnotation(node: AstNode): boolean {
    return Boolean(
      AstUtils.getContainerOfType(node, isVerificationAnnotation) ||
      AstUtils.getContainerOfType(node, isVerificationStatement) ||
      AstUtils.getContainerOfType(node, isLoopAnnotation)
    );
  }

  /**
   * Prüft die Operanden von `==` und `!=` auf zulässige Vergleichbarkeit.
   *
   * Arrays sind nicht direkt vergleichbar. Struct-Werte dürfen miteinander verglichen
   * werden, wodurch insbesondere Nullvergleiche nach der Typmodellierung möglich sind.
   * Skalare Operanden müssen denselben bekannten Typ besitzen.
   *
   * @param node Zu prüfende Gleichheitskette.
   * @param accept Empfänger für unzulässige Vergleiche.
   */
  checkEquality(node: Equality, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) {
      return;
    }

    const operands = [node.left, ...(node.right ?? [])];
    const types = operands.map(e => this.types.typeFor(e));

    const first = types[0];

    for (let i = 1; i < types.length; i++) {
      const current = types[i];

      if (first.isUnknown() || current.isUnknown()) {
        continue;
      }

      // Arrays bleiben verboten
      if (first.isArrayType() || current.isArrayType()) {
        accept(
          'error',
          `Vergleich nicht erlaubt: Arrays können nicht mit '==' oder '!=' verglichen werden.`,
          { node,
            code: INCOMPATIBLE_TYPES_EQ
           }
        );
        return;
      }

      // Struct-Vergleiche sind erlaubt, z. B. head.ptr == null
      if (first.isStructType() || current.isStructType()) {
        if (first.isStructType() && current.isStructType()) {
          continue;
        }

        accept(
          'error',
          `Typfehler im Vergleich: '${first.asString()}' kann nicht mit '${current.asString()}' verglichen werden.`,
          { node,
            code: INCOMPATIBLE_TYPES_EQ
           }
        );
        return;
      }

      if (!first.isSameAs(current)) {
        accept(
          'error',
          `Typfehler im Vergleich: '${first.asString()}' kann nicht mit '${current.asString()}' verglichen werden.`,
          { node,
            code: INCOMPATIBLE_TYPES_EQ
           }
        );
        return;
      }
    }
  }

  /**
   * Verlangt für ordnende Vergleiche ausschließlich numerische Operanden.
   * @param node Zu prüfende Vergleichskette.
   * @param accept Empfänger für Typfehler.
   */
  checkComparison(node: Comparison, accept: ValidationAcceptor): void {
    if ((node.right?.length ?? 0) === 0) return;

    const operands = [node.left, ...(node.right ?? [])];
    this.requireAllTypes(node, operands, TYPE_NUM, accept, `Vergleichsoperatoren '<', '<=', '>' und '>=' erwarten num.`);
  }


  /**
   * Klassifiziert den Kern eines Ausdrucks als globalen Funktions- oder Methodenaufruf.
   * @param expr Zu klassifizierender Ausdruck einschließlich möglicher AST-Hüllen.
   * @returns `true`, wenn der entpackte Ausdruck aufrufbar ist.
   */
  private isCallableExpr(expr: Expr): boolean {
    const core = this.unwrapExpr(expr);
    return isFunctionCall(core) || isMethSelection(core);
  }
 
  /**
   * Meldet alle nach einem direkten return im selben Block folgenden Anweisungen als unerreichbar.
   * Die tiefergehende Pfadanalyse von Verzweigungen erfolgt separat über `finishesByReturn`.
   * @param instructions Anweisungen eines einzelnen Blocks in Quellreihenfolge.
   * @param accept Empfänger für Unerreichbarkeitswarnungen.
   */
  private checkNoInstructionsAfterReturn(instructions: Instruction[], accept: ValidationAcceptor): void {
    let foundReturn = false;

    for (const instr of instructions) {
      if (foundReturn) {
        accept('warning', 'Diese Anweisung ist nicht erreichbar, weil davor bereits return steht.', {
          node: instr
        });
      }

      if (isReturnStmt(instr)) {
        foundReturn = true;
      }
    }
  }

  /**
   * Entfernt iterativ alle durch die Ausdrucksgrammatik erzeugten Hüllen ohne rechten Operanden.
   * Neben Gruppierungen werden die Präzedenzstufen von ODER bis Potenz berücksichtigt.
   * @param expr Zu entpackender Ausdruck.
   * @returns Semantischer Kernausdruck.
   */
  private unwrapExpr(expr: Expr): Expr {
    let current: Expr = expr;

    while (true) {
      if (isGrouping(current)) {
        current = current.value;
        continue;
      }

      if (isOr(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isAnd(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isEquality(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isComparison(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isAddition(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isMultiplication(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      if (isExponentiation(current) && (current.right?.length ?? 0) === 0) {
        current = current.left;
        continue;
      }

      return current;
    }
  }
  // sammelt alle lokalen Variablendeklarationen einer Funktion,
  // aber ohne Loop-Iteratoren und ohne Längenparameter von Array-Parametern.
  /*private getFunctionLocalVarDecls(fn: FunctionDeclaration): VarDecl[] {
    const result: VarDecl[] = [];

    for (const n of AstUtils.streamAllContents(fn)) {
      if (isVarDecl(n)) {
        if (this.isLengthParameterDecl(n)) {
          continue;
        }

        // Loop-Iteratoren werden separat im ForLoop-Check behandelt
        const loop = AstUtils.getContainerOfType(n, isForLoop);
        if (loop && loop.iterator === n) {
          continue;
        }

        result.push(n);
      }
    }

    return result;
  }*/

  // Prüft doppelte Namen in einer Liste von Variablendeklarationen
  /**
   * Meldet ab dem jeweils zweiten Auftreten jeden doppelten Variablennamen in einer Liste.
   * @param vars Gemeinsam zu betrachtende Variablendeklarationen.
   * @param accept Empfänger für Duplikatfehler.
   */
  private reportDuplicateVarDecls(
    vars: VarDecl[],
    accept: ValidationAcceptor
  ): void {
    const seen = new Map<string, VarDecl>();

    for (const v of vars) {
      const prev = seen.get(v.name);
      if (prev) {
        accept('error', `Doppelte Variable '${v.name}'.`, {
          node: v,
          property: 'name',
          code: DUPLICATE_ELEMENT
        });
      } else {
        seen.set(v.name, v);
      }
    }
  }

  /**
   * Prüft eine Operandenliste gegen einen einheitlich erwarteten Typ und beendet sich
   * nach dem ersten bekannten abweichenden Typ. Unbekannte Typen werden übersprungen,
   * damit die Primärdiagnose an ihrer Entstehungsstelle bleibt.
   *
   * @param node AST-Knoten, an dem ein Fehler markiert wird.
   * @param operands Zu prüfende Ausdrücke.
   * @param expected Erforderlicher Pseudo2-Typ.
   * @param accept Empfänger für Typfehler.
   * @param message Operatorspezifischer Anfang der Diagnosemeldung.
   * @param code Optionaler stabiler Diagnosecode.
   */
  private requireAllTypes(
    node: unknown,
    operands: Expr[],
    expected: ReturnType<Pseudo2TypeComputer['typeFor']>,
    accept: ValidationAcceptor,
    message: string,
    code?: string
  ): void {
    for (const operand of operands) {
      const actual = this.types.typeFor(operand);

      if (actual.isUnknown()) {
        continue;
      }

      if (!actual.isSameAs(expected)) {
        accept('error', `${message} Erhalten: '${actual.asString()}'.`, {
          node: node as any,
          code
        });
        return;
      }
    }
  }

  /**
   * Ermittelt die Variablendeklarationen, die mit `node` denselben unmittelbaren
   * Block-Namensraum teilen. Verzweigungszweige werden getrennt behandelt; für
   * unbekannte Container wird auf den globalen Programmbereich zurückgefallen.
   *
   * @param node Deklaration, deren Geschwister gesucht werden.
   * @returns Variablendeklarationen desselben direkten Gültigkeitsbereichs.
   */
  private getSiblingVarDecls(node: VarDecl): VarDecl[] {
    const container: any = node.$container;

    if (!container) {
      const program = this.getProgram(node);
      return program ? program.instructions.filter(isVarDecl) : [];
    }

    if (isBracedBlock(container)) {
      return (container.instructions ?? []).filter(isVarDecl);
    }

    if (isIndentedBlock(container)) {
      return (container.instructions ?? []).filter(isVarDecl);
    }

    if (isFunctionDeclaration(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    if (isIfStatement(container)) {
      const thenVars: VarDecl[] = (container.thenBlock?.instructions ?? []).filter(isVarDecl);
      if (thenVars.includes(node)) {
        return thenVars;
      }

      const elseVars: VarDecl[] = (container.elseBlock?.instructions ?? []).filter(isVarDecl);
      if (elseVars.includes(node)) {
        return elseVars;
      }

      return [];
    }

    if (isWhileLoop(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    if (isForLoop(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    if (isDoWhileLoop(container)) {
      return (container.body?.instructions ?? []).filter(isVarDecl);
    }

    const program = this.getProgram(node);
    return program ? program.instructions.filter(isVarDecl) : [];
  }

  /**
   * Sucht nach einer gleichnamigen Deklaration, die am Ort einer neuen Variablen bereits
   * aus einem äußeren Bereich sichtbar ist. Berücksichtigt werden Parameter,
   * Struct-Attribute, vorherige Blockvariablen und globale Variablen.
   *
   * @param node Neue Variablendeklaration, deren Verschattung geprüft wird.
   * @param name Zu suchender Quellname.
   * @returns Die überschattete Variable oder `undefined`, falls keine sichtbar ist.
   */
  private findOuterVisibleName(node: VarDecl, name: string): Variable | undefined {
    let current: AstNodeLike | undefined = node.$container;

    while (current) {
      if (isFunctionDeclaration(current)) {
        const param = (current.params ?? []).find((p: ParameterDecl) => p.name === name);
        if (param) return param;

        const parentStruct = AstUtils.getContainerOfType(current.$container, isStructDeclaration);
        if (parentStruct) {
          const att = (parentStruct.children ?? []).filter(isStructAttDeclaration).find(a => a.name === name);
          if (att) return att;
        }
      }

      if (isBracedBlock(current) || isIndentedBlock(current)) {
        const instrs = current.instructions ?? [];
        const currentInstr = this.getEnclosingInstruction(node);
        if (currentInstr) {
          const idx = instrs.indexOf(currentInstr);
          const prev = instrs.slice(0, idx).filter(isVarDecl).find(v => v.name === name);
          if (prev) return prev;
        }
      }

      current = current.$container as AstNodeLike | undefined;
    }

    const program = this.getProgram(node);
    return program?.instructions
      .filter(isVarDecl)
      .find(v => v !== node && v.name === name);
  }

  /**
   * Steigt von einer Variablendeklaration bis zum nächsten als Instruction behandelten
   * Container auf. Das Ergebnis dient dazu, nur vorherige Anweisungen desselben Blocks
   * in die Sichtbarkeitssuche einzubeziehen.
   * @param node Ausgangsdeklaration.
   * @returns Nächste umgebende Instruction oder `undefined` außerhalb des ASTs.
   */
  private getEnclosingInstruction(node: VarDecl): Instruction | undefined {
    let n: AstNodeLike | undefined = node;
    while (n) {
      if (this.isInstructionNode(n)) {
        return n as Instruction;
      }
      n = n.$container as AstNodeLike | undefined;
    }
    return undefined;
  }

  /**
   * Prüft, ob ein strukturell typisierter AST-Knoten zu den hier für die
   * Sichtbarkeitsanalyse relevanten Instruction-Arten gehört.
   * @param n Zu klassifizierender AST-Knoten.
   * @returns `true` für Blöcke, Kontrollstrukturen, Deklarationen und Variablen.
   */
  private isInstructionNode(n: AstNodeLike): boolean {
    return (
      isBracedBlock(n as any) ||
      isIndentedBlock(n as any) ||
      isIfStatement(n as any) ||
      isWhileLoop(n as any) ||
      isForLoop(n as any) ||
      isDoWhileLoop(n as any) ||
      isFunctionDeclaration(n as any) ||
      isStructDeclaration(n as any) ||
      isVarDecl(n as any)
    );
  }

  /**
   * Delegiert die Zuweisungskompatibilität an das zentrale Pseudo2-Typmodell.
   * @param source Typ des zugewiesenen Ausdrucks.
   * @param target Typ des Zuweisungsziels.
   * @returns `true`, wenn `source` gemäß Sprachregeln nach `target` konform ist.
   */
  private isAssignable(
    source: ReturnType<Pseudo2TypeComputer['typeFor']>,
    target: ReturnType<Pseudo2TypeComputer['typeFor']>
  ): boolean {
    return source.isConformingTo(target);
  }

  /**
   * Liefert das Wurzelprogramm des Langium-Dokuments, das den übergebenen Knoten enthält.
   * @param node Knoten mit Langium-Container- und Dokumentzuordnung.
   * @returns Als Pseudo2-Programm typisiertes Parse-Ergebnis.
   */
  private getProgram(node: { $container?: unknown }): Program | undefined {
    const doc = AstUtils.getDocument(node as any);
    return doc.parseResult.value as Program;
  }
}

/** Minimale strukturelle AST-Sicht für Hilfen, die ausschließlich die Containerkette benötigen. */
type AstNodeLike = {
  /** Optionaler übergeordneter AST-Knoten. */
  $container?: unknown;
};
