/**
 * @file generator-context.ts
 * @brief Vergibt eindeutige Zielnamen und Struct-Feld-IDs für alle Generatoren.
 * @author Abdul
 */

import { AstUtils } from 'langium';
import type { FunctionDeclaration, Program, StructAttDeclaration, StructDeclaration, Variable } from './generated/ast.js';
import {
  isFunctionDeclaration,
  isStructAttDeclaration,
  isStructDeclaration,
  isVariable
} from './generated/ast.js';

/**
 * Normalisiert einen Pseudo2-Namen zu einem gültigen JavaScript-/C-Bezeichner.
 *
 * Ungültige Zeichen werden durch Unterstriche ersetzt. Beginnt das Ergebnis
 * nicht mit Buchstabe, Unterstrich oder Dollarzeichen, wird ein Unterstrich
 * vorangestellt.
 *
 * @param name Quellbezeichner aus dem Pseudo2-Programm.
 * @returns Für die Zielsprachen geeigneter Basisbezeichner.
 */
function targetIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/**
 * Deklarationsbasierter Namenskontext für JavaScript- und C-Generierung.
 *
 * Namen werden an konkrete AST-Deklarationen gebunden. Dadurch bleiben
 * gleichnamige Variablen aus unterschiedlichen Scopes in der Ausgabe eindeutig.
 */
export class Pseudo2GeneratorContext {
  /** Generierte Namen aller Variablen, Parameter und Struct-Attribute. */
  private readonly variableNames = new Map<Variable, string>();
  /** Generierte Namen globaler Funktionen und Methoden. */
  private readonly functionNames = new Map<FunctionDeclaration, string>();
  /** Generierte Factory-Namen aller Structs. */
  private readonly structFactoryNames = new Map<StructDeclaration, string>();
  /** Programmweit eindeutige numerische IDs für Struct-Felder. */
  private readonly structFieldIds = new Map<StructAttDeclaration, number>();
  /** Struct-Felder gruppiert nach ihrem ursprünglichen Quellnamen. */
  private readonly structFieldsBySourceName = new Map<string, StructAttDeclaration[]>();
  /** Gemeinsamer Zähler für benannte und anonyme Variablen. */
  private variableCounter = 0;
  /** Gemeinsamer Zähler für benannte und anonyme Funktionen. */
  private functionCounter = 0;
  /** Zähler für Struct-Factory-Namen. */
  private structCounter = 0;
  /** Zähler für numerische Struct-Feld-IDs. */
  private structFieldCounter = 0;

  /**
   * Erstellt und füllt einen Namenskontext für ein vollständiges Programm.
   *
   * @param program Zu registrierender Pseudo2-AST.
   * @returns Vollständig initialisierter Generator-Kontext.
   */
  static fromProgram(program: Program): Pseudo2GeneratorContext {
    const context = new Pseudo2GeneratorContext();
    context.registerProgram(program);
    return context;
  }

  /**
   * Registriert alle relevanten Deklarationen des Programms in AST-Reihenfolge.
   *
   * @param program Zu durchlaufendes Pseudo2-Programm.
   */
  registerProgram(program: Program): void {
    for (const node of AstUtils.streamAllContents(program)) {
      if (isVariable(node)) {
        this.addVarName(node);
      }
      if (isStructAttDeclaration(node)) {
        this.addStructFieldId(node);
      }
      if (isFunctionDeclaration(node)) {
        this.addFunctionName(node);
      }
      if (isStructDeclaration(node)) {
        this.addStructFactoryName(node);
      }
    }
  }

  /**
   * Vergibt den eindeutigen Zielnamen einer Variablendeklaration.
   *
   * @param variable Zu registrierende Variable, Parameter oder Attribut.
   * @throws Error Wenn dieselbe Deklaration bereits registriert wurde.
   */
  addVarName(variable: Variable): void {
    if (this.variableNames.has(variable)) {
      throw new Error(`Variable '${variable.name}' is already registered.`);
    }
    this.variableNames.set(variable, `${targetIdentifier(variable.name)}_${this.variableCounter++}`);
  }

  /**
   * Liefert den zuvor vergebenen Zielnamen einer Variable.
   *
   * @param variable Registrierte Variablendeklaration.
   * @returns Eindeutiger Zielname.
   * @throws Error Wenn kein Name für die Deklaration registriert ist.
   */
  getVarName(variable: Variable): string {
    const name = this.variableNames.get(variable);
    if (!name) {
      throw new Error(`Could not find generated name for variable '${variable.name}'.`);
    }
    return name;
  }

  /**
   * Reserviert einen eindeutigen temporären Variablennamen.
   *
   * @param prefix Gewünschter, vor der Verwendung normalisierter Namenspräfix.
   * @returns Frischer Zielname aus Präfix und Variablenzähler.
   */
  getAnonymousVarName(prefix = 'anonym'): string {
    return `${targetIdentifier(prefix)}_${this.variableCounter++}`;
  }

  /**
   * Vergibt eine eindeutige numerische ID für ein Struct-Feld.
   *
   * Zusätzlich wird das Feld für spätere Auflösungen nach Quellname indiziert.
   *
   * @param field Zu registrierende Struct-Attributdeklaration.
   * @throws Error Wenn das Feld bereits registriert wurde.
   */
  addStructFieldId(field: StructAttDeclaration): void {
    if (this.structFieldIds.has(field)) {
      throw new Error(`Struct field '${field.name}' is already registered.`);
    }
    this.structFieldIds.set(field, this.structFieldCounter++);
    const fields = this.structFieldsBySourceName.get(field.name) ?? [];
    fields.push(field);
    this.structFieldsBySourceName.set(field.name, fields);
  }

  /**
   * Liefert die programmweit eindeutige ID eines Struct-Feldes.
   *
   * @param field Registrierte Struct-Attributdeklaration.
   * @returns Numerische Feld-ID.
   * @throws Error Wenn das Feld nicht registriert wurde.
   */
  getStructFieldId(field: StructAttDeclaration): number {
    const id = this.structFieldIds.get(field);
    if (id === undefined) {
      throw new Error(`Could not find generated field id for struct field '${field.name}'.`);
    }
    return id;
  }

  /**
   * Löst einen Feldnamen nur dann auf, wenn er programmweit eindeutig ist.
   *
   * @param name Pseudo2-Quellname des Feldes.
   * @returns Eindeutige Felddeklaration oder `undefined` bei null/mehreren Treffern.
   */
  getUniqueStructFieldBySourceName(name: string): StructAttDeclaration | undefined {
    const fields = this.structFieldsBySourceName.get(name) ?? [];
    return fields.length === 1 ? fields[0] : undefined;
  }

  /**
   * Löst ein Feld anhand von Struct- und Feldquellname auf.
   *
   * @param structName Quellname des besitzenden Structs.
   * @param fieldName Quellname des gesuchten Feldes.
   * @returns Passende Felddeklaration oder `undefined`.
   */
  getStructFieldByStructNameAndSourceName(structName: string, fieldName: string): StructAttDeclaration | undefined {
    const fields = this.structFieldsBySourceName.get(fieldName) ?? [];
    return fields.find(field => AstUtils.getContainerOfType(field, isStructDeclaration)?.name === structName);
  }

  /**
   * Vergibt den eindeutigen Zielnamen einer Funktion oder Methode.
   *
   * @param fn Zu registrierende Funktionsdeklaration.
   * @throws Error Wenn dieselbe Deklaration bereits registriert wurde.
   */
  addFunctionName(fn: FunctionDeclaration): void {
    if (this.functionNames.has(fn)) {
      throw new Error(`Function '${fn.name}' is already registered.`);
    }
    this.functionNames.set(fn, `func_${targetIdentifier(fn.name)}_${this.functionCounter++}`);
  }

  /**
   * Liefert den Zielnamen einer registrierten Funktion oder Methode.
   *
   * @param fn Registrierte Funktionsdeklaration.
   * @returns Eindeutiger Funktionsname mit `func_`-Präfix.
   * @throws Error Wenn die Deklaration nicht registriert ist.
   */
  getFunctionName(fn: FunctionDeclaration): string {
    const name = this.functionNames.get(fn);
    if (!name) {
      throw new Error(`Could not find generated name for function '${fn.name}'.`);
    }
    return name;
  }

  /**
   * Reserviert einen eindeutigen Namen für eine interne Hilfsfunktion.
   *
   * @param prefix Gewünschter Namenspräfix.
   * @returns Frischer, normalisierter Funktionsname.
   */
  getAnonymousFunctionName(prefix = 'anonym'): string {
    return `${targetIdentifier(prefix)}_${this.functionCounter++}`;
  }

  /**
   * Vergibt den eindeutigen Factory-Namen eines Structs.
   *
   * @param structDecl Zu registrierende Struct-Deklaration.
   * @throws Error Wenn das Struct bereits registriert wurde.
   */
  addStructFactoryName(structDecl: StructDeclaration): void {
    if (this.structFactoryNames.has(structDecl)) {
      throw new Error(`Struct '${structDecl.name}' is already registered.`);
    }
    this.structFactoryNames.set(structDecl, `create_${targetIdentifier(structDecl.name)}_${this.structCounter++}`);
  }

  /**
   * Liefert den Factory-Namen eines registrierten Structs.
   *
   * @param structDecl Registrierte Struct-Deklaration.
   * @returns Eindeutiger Factory-Name mit `create_`-Präfix.
   * @throws Error Wenn die Deklaration nicht registriert ist.
   */
  getStructFactoryName(structDecl: StructDeclaration): string {
    const name = this.structFactoryNames.get(structDecl);
    if (!name) {
      throw new Error(`Could not find generated factory name for struct '${structDecl.name}'.`);
    }
    return name;
  }
}
