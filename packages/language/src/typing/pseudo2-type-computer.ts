/**
 * @file pseudo2-type-computer.ts
 * @brief Leitet statische Pseudo2-Typen aus Ausdrücken, Deklarationen, Aufrufen und AST-Kontexten ab.
 * @author Abdul
 */

// packages/language/src/typing/pseudo2-type-computer.ts

import { AstUtils } from 'langium';
import type { AstNode } from 'langium';

import type {
  Expr,
  Addition,
  FunctionCall,
  FunctionDeclaration,
  ReturnStmt,
  VarDecl,
  ParameterDecl,
 // MethRef,
  TypeRef,
  ArrayType,
  StructType,
  ThisExpr,
  NewExpr,
  VarRef,
  AttSelection,
  MethSelection,
  StructAttDeclaration,
  ArrayLiteral,
  SpecPredicateExpr,
  //Exponentiation
} from '../generated/ast.js';

import {
  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isExponentiation,
  isNot,
  isNeg,
  isGrouping,
  isIntLiteral,
  isBoolLiteral,
  isStringLiteral,
  isNullLiteral,
  isNewExpr,
  isThisExpr,
  isVarRef,
  isAttSelection,
  isIndexSelection,
  isMethSelection,
  isFunctionCall,
  isFunctionDeclaration,
  isReturnStmt,
  isVarDecl,
  isParameterDecl,
  isMethRef,
  isStructDeclaration,
  isArrayType,
  isStructType,
  isStructAttDeclaration,
  isArrayLiteral,
  isSpecPredicateExpr
} from '../generated/ast.js';

import {
  Pseudo2Type,
  TYPE_BOOL,
  TYPE_NUM,
  TYPE_STRING,
  TYPE_UNKNOWN,
  TYPE_STRUCT_UNKNOWN,
  TYPE_STRUCT,
  TYPE_ARRAY_NUM
} from './pseudo2-type.js';

/** @brief Eindimensionaler Arraytyp mit noch unbekanntem Elementtyp für lokale Typableitungen. */
export const TYPE_ARRAY_UNKNOWN = Pseudo2Type.create({ name: '', isStruct: false, isArray: true });

/**
 * @brief Verfolgt bereits untersuchte Deklarationen, Funktionen und Ausdrücke zur Zyklenerkennung.
 *
 * Der Type-Computer folgt Initialisierern, Rückgabewerten und Aufrufargumenten rekursiv.
 * Getrennte Mengen verhindern Endlosschleifen, ohne unabhängige Zweige derselben
 * Berechnung zu blockieren. `copy()` erzeugt deshalb vor rekursiven Alternativen Snapshots.
 */
export class TypeComputationContext {
  /** @brief Bereits verfolgte Variablen, Parameter und Structattribute. */
  readonly vars = new Set<VarDecl | ParameterDecl | StructAttDeclaration>();
  /** @brief Bereits verfolgte Funktions- und Methodendeklarationen. */
  readonly fns = new Set<FunctionDeclaration>();
  /** @brief Bereits verfolgte Ausdrucksknoten. */
  readonly exps = new Set<Expr>();

  /**
   * @brief Markiert eine Deklaration im aktuellen Berechnungspfad als besucht.
   * @param v Besuchte Variable, Parameter- oder Structattributdeklaration.
   */
  addVar(v: VarDecl | ParameterDecl | StructAttDeclaration): void { this.vars.add(v); }
  /**
   * @brief Prüft, ob eine Deklaration im aktuellen Berechnungspfad bereits besucht wurde.
   * @param v Zu prüfende Variable, Parameter- oder Structattributdeklaration.
   * @return `true`, wenn die Deklaration in der Besuchsmenge enthalten ist.
   */
  hasVar(v: VarDecl | ParameterDecl | StructAttDeclaration): boolean { return this.vars.has(v); }

  /**
   * @brief Markiert eine Funktion oder Methode im aktuellen Berechnungspfad als besucht.
   * @param f Besuchte Funktions- oder Methodendeklaration.
   */
  addFn(f: FunctionDeclaration): void { this.fns.add(f); }
  /**
   * @brief Prüft, ob eine Funktion oder Methode im aktuellen Berechnungspfad bereits besucht wurde.
   * @param f Zu prüfende Funktions- oder Methodendeklaration.
   * @return `true`, wenn die Deklaration in der Besuchsmenge enthalten ist.
   */
  hasFn(f: FunctionDeclaration): boolean { return this.fns.has(f); }

  /**
   * @brief Markiert einen Ausdruck im aktuellen Berechnungspfad als besucht.
   * @param e Besuchter Ausdrucksknoten.
   */
  addExp(e: Expr): void { this.exps.add(e); }
  /**
   * @brief Prüft, ob ein Ausdruck im aktuellen Berechnungspfad bereits besucht wurde.
   * @param e Zu prüfender Ausdrucksknoten.
   * @return `true`, wenn der Ausdruck in der Besuchsmenge enthalten ist.
   */
  hasExp(e: Expr): boolean { return this.exps.has(e); }

  /**
   * @brief Kopiert alle Besuchsmengen für einen unabhängigen rekursiven Berechnungszweig.
   * @return Neuer Kontext mit denselben bisher besuchten AST-Elementen.
   */
  copy(): TypeComputationContext {
    const c = new TypeComputationContext();
    for (const v of this.vars) c.vars.add(v);
    for (const f of this.fns) c.fns.add(f);
    for (const e of this.exps) c.exps.add(e);
    return c;
  }
}

/**
 * @brief Berechnet Pseudo2-Typen durch strukturelle Fallunterscheidung über den AST.
 *
 * Literale und Operatoren besitzen direkte Regeln. Referenzen folgen ihren
 * Deklarationen, Funktionsaufrufe analysieren Rückgaben und untypisierte Parameter
 * können Struct- oder Arraytypen aus nichtrekursiven Aufrufstellen übernehmen.
 */
export class Pseudo2TypeComputer {
  /**
   * @brief Bestimmt den Typ eines beliebigen Pseudo2-Ausdrucks.
   *
   * Fehlende oder zyklisch erneut besuchte Ausdrücke ergeben `TYPE_UNKNOWN`.
   * Boolesche Vergleiche, Arithmetik, Literale, Gruppierungen, Structkonstruktion,
   * Referenzen, Selektionen und Aufrufe werden an ihre spezialisierten Regeln delegiert.
   * Operatorstufen ohne rechten Operanden reichen den Typ ihres linken Ausdrucks durch.
   *
   * @param e Zu analysierender Ausdruck oder fehlender optionaler AST-Knoten.
   * @param ctx Kontext zur Zyklenerkennung des aktuellen Berechnungspfads.
   * @return Bestmöglich bestimmter, gegebenenfalls unbekannter Pseudo2-Typ.
   */
  typeFor(e: Expr | undefined | null, ctx = new TypeComputationContext()): Pseudo2Type {
    if (!e) return TYPE_UNKNOWN;

    if (ctx.hasExp(e)) return TYPE_UNKNOWN; // cycle protection
    ctx.addExp(e);

    // ---- boolean operators ----
    if (isOr(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;
    if (isAnd(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;

    if (isEquality(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;
    if (isComparison(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_BOOL;

    // ---- arithmetic ----
    if (isAddition(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : this.handlePlus(e, ctx);
    if (isMultiplication(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_NUM;
    if (isExponentiation(e)) return (e.right?.length ?? 0) === 0 ? this.typeFor(e.left, ctx) : TYPE_NUM;

    // ---- unary ----
    if (isNot(e)) return TYPE_BOOL;
    if (isNeg(e)) return TYPE_NUM;

    // ---- literals / grouping ----
    if (isGrouping(e)) return this.typeFor(e.value, ctx);
    if (isIntLiteral(e)) return TYPE_NUM;
    if (isBoolLiteral(e)) return TYPE_BOOL;
    if (isStringLiteral(e)) return TYPE_STRING;
    if (isNullLiteral(e)) return TYPE_STRUCT_UNKNOWN;
    if (isArrayLiteral(e)) return this.handleArrayLiteral(e, ctx);
    if (isSpecPredicateExpr(e)) return this.handleSpecPredicate(e);

    // ---- object / struct ----
    if (isNewExpr(e)) return this.handleNew(e);
    if (isThisExpr(e)) return this.handleThis(e);

    // ---- references / selection ----
    if (isVarRef(e)) return this.handleVarRef(e, ctx);
    if (isAttSelection(e)) return this.handleAttSelection(e, ctx);
    if (isIndexSelection(e)) return this.typeFor(e.receiver, ctx).asBaseType();
    if (isMethSelection(e)) return this.handleMethSelection(e, ctx);
    if (isFunctionCall(e)) return this.handleFunctionCall(e, ctx);

    return TYPE_UNKNOWN;
  }

  /**
   * @brief Liefert den konkreten Structnamen eines Ausdrucks, sofern eindeutig bestimmbar.
   * @param e Zu analysierender Ausdruck.
   * @param ctx Optionaler bestehender Berechnungskontext.
   * @return Structname oder `undefined` für Skalare, Arrays und unbekannte Structs.
   */
  structNameOf(e: Expr, ctx = new TypeComputationContext()): string | undefined {
    const t = this.typeFor(e, ctx);
    return t.isStruct && t.name ? t.name : undefined;
  }

  // ---- handlers ----
  /**
   * @brief Bestimmt den Typ von `this` aus der umgebenden Structdeklaration.
   * @param e Zu analysierender This-Ausdruck.
   * @return Typ des umgebenden Structs oder `TYPE_UNKNOWN` außerhalb eines Structs.
   */
  private handleThis(e: ThisExpr): Pseudo2Type {
    const sd = AstUtils.getContainerOfType(e, isStructDeclaration);
    return sd ? TYPE_STRUCT(sd.name) : TYPE_UNKNOWN;
  }

  /**
   * @brief Bestimmt den Typ eines `new`-Ausdrucks aus seiner aufgelösten Structreferenz.
   * @param e Zu analysierender Konstruktor-Ausdruck.
   * @return Konkret benannter Structtyp oder `TYPE_UNKNOWN` bei ungelöster Referenz.
   */
  private handleNew(e: NewExpr): Pseudo2Type {
    const sd = e.type?.ref;
    return sd ? TYPE_STRUCT(sd.name) : TYPE_UNKNOWN;
  }

  /**
   * @brief Leitet den Arraytyp aus dem ersten Element eines Arrayliterals ab.
   *
   * Ein leeres Literal bleibt `Array(UNKNOWN)`. Bei vorhandenen Elementen wird der
   * Typ des ersten Elements in einem kopierten Kontext bestimmt und um eine Dimension erweitert.
   *
   * @param e Arrayliteral mit null oder mehr Elementausdrücken.
   * @param ctx Aktueller Berechnungskontext.
   * @return Arraytyp des ersten Elements oder unbekannter Arraytyp.
   */
  private handleArrayLiteral(e: ArrayLiteral, ctx: TypeComputationContext): Pseudo2Type {
    const elems = e.elems ?? [];
    if (elems.length === 0) return TYPE_ARRAY_UNKNOWN;
    const firstType = this.typeFor(elems[0], ctx.copy());
    return firstType.asArrayType();
  }

  /**
   * @brief Ordnet eingebaute VeriFast-Prädikatausdrücke ihrem Pseudo2-Ergebnistyp zu.
   * @param e Verifikationsprädikat der Pseudo2-Grammatik.
   * @return `num` für Längen-/Zahlprädikate, unbekannt für Element-/Feldzugriff, sonst `bool`.
   */
  private handleSpecPredicate(e: SpecPredicateExpr): Pseudo2Type {
    if (e.kind === 'vf_len' || e.kind === 'vf_int' || e.kind === 'vf_real' || e.kind === 'vf_ratio') {
      return TYPE_NUM;
    }
    if (e.kind === 'vf_elem' || e.kind === 'vf_field') {
      return TYPE_UNKNOWN;
    }
    return TYPE_BOOL;
  }

  /**
   * @brief Bestimmt, ob eine Additionskette numerische Addition oder Stringverkettung liefert.
   *
   * Unbekannte, Array- oder Structoperanden machen das Ergebnis unbekannt. Sobald ein
   * String beteiligt ist, entsteht ein String. Boolesche Operanden ohne String sind
   * ungültig; ausschließlich numerische Operanden ergeben `num`.
   *
   * @param e Additionsausdruck mit linkem und optionalen rechten Operanden.
   * @param ctx Aktueller Berechnungskontext.
   * @return `string`, `num` oder `TYPE_UNKNOWN` gemäß den Additionsregeln.
   */
  private handlePlus(e: Addition, ctx: TypeComputationContext): Pseudo2Type {
    const parts: Expr[] = [e.left, ...(e.right ?? [])];
    const types = parts.map(p => this.typeFor(p, ctx.copy()));

    // unbekannt bleibt unbekannt
    if (types.some(t => t.isUnknown())) {
      return TYPE_UNKNOWN;
    }

    // Arrays/Structs sind bei + verboten
    if (types.some(t => t.isArrayType() || t.isStructType())) {
      return TYPE_UNKNOWN;
    }

    const hasString = types.some(t => t.isSameAs(TYPE_STRING));
    const hasBool = types.some(t => t.isSameAs(TYPE_BOOL));

    // Sobald string beteiligt ist, wird verkettet
    if (hasString) {
      return TYPE_STRING;
    }

    // bool ohne string bleibt ungültig
    if (hasBool) {
      return TYPE_UNKNOWN;
    }

    return TYPE_NUM;
  }

  /**
   * @brief Folgt einer Variablenreferenz zu Variable, Parameter oder Structattribut.
   *
   * Längenparameter werden als Zahl erkannt. Variablen beziehen ihren Typ aus dem
   * Initialisierer und erhalten bei Arraydeklarationen eine zusätzliche Arrayhülle.
   * Parameter werden über Aufrufstellen inferiert, Structattribute über ihre TypeRef.
   * Ein vorhandener Indexzugriff entfernt jeweils genau eine Arraydimension.
   *
   * @param v Zu analysierende Variablenreferenz.
   * @param ctx Kontext zur Vermeidung rekursiver Deklarationszyklen.
   * @return Abgeleiteter Referenz- oder Elementtyp.
   */
  private handleVarRef(v: VarRef, ctx: TypeComputationContext): Pseudo2Type {
    const target = v.ref?.ref;
    if (!target) return TYPE_UNKNOWN;

    if (isVarDecl(target)) {
      if (this.isLengthParameterDecl(target)) return TYPE_NUM;
      if (ctx.hasVar(target)) return TYPE_UNKNOWN;

      const c2 = ctx.copy();
      c2.addVar(target);

      let t: Pseudo2Type;

      if ((target as any).isArrayVariable === true) {
        if (target.initializer) {
          const initType = this.typeFor(target.initializer, c2);
          t = initType.asArrayType();
        } else {
          t = TYPE_ARRAY_UNKNOWN;
        }
      } else {
        if (!target.initializer) return TYPE_UNKNOWN;
        t = this.typeFor(target.initializer, c2);
      }

      if (v.index) {
        t = t.asBaseType();
      }

      return t;
    }

    if (isParameterDecl(target)) {
      let t = this.handleParameter(target, ctx);
      if (v.index) t = t.asBaseType();
      return t;
    }

    if (isStructAttDeclaration(target)) {
      if (!target.type) return TYPE_UNKNOWN;
      if (ctx.hasVar(target)) return TYPE_UNKNOWN;

      const c2 = ctx.copy();
      c2.addVar(target);

      let t = this.typeForTypeRef(target.type);
      if (v.index) t = t.asBaseType();
      return t;
    }

    return TYPE_UNKNOWN;
  }

  /**
   * @brief Inferiert Struct- und Arraytypen untypisierter Parameter aus realen Aufrufstellen.
   *
   * Ermittelt Position und besitzende Funktion beziehungsweise Methode, durchsucht
   * anschließend das gesamte Dokument nach passenden Aufrufen und ignoriert rekursive
   * Aufrufe innerhalb derselben Deklaration. Nur konkrete Struct- oder Arrayargumente
   * werden übernommen; für Skalare und fehlende Aufrufe bleibt der passende Unknown-Typ.
   *
   * @param p Zu inferierender Funktions- oder Methodenparameter.
   * @param ctx Aktueller Berechnungskontext.
   * @return Gefundener Struct-/Arraytyp oder unbekannter Skalar-/Arraytyp des Parameters.
   */
  private handleParameter(p: ParameterDecl, ctx: TypeComputationContext): Pseudo2Type {
    const defaultUnknown = p.isArray ? TYPE_ARRAY_UNKNOWN : TYPE_UNKNOWN;

    if (ctx.hasVar(p)) {
      return defaultUnknown;
    }

    const parentFn = AstUtils.getContainerOfType(p, isFunctionDeclaration);
    if (!parentFn) {
      return defaultUnknown;
    }

    const idx = (parentFn.params ?? []).indexOf(p);
    if (idx < 0) {
      return defaultUnknown;
    }

    const c2 = ctx.copy();
    c2.addVar(p);

    const root = AstUtils.getDocument(parentFn).parseResult.value;
    const owningStruct = AstUtils.getContainerOfType(parentFn, isStructDeclaration);

    for (const n of AstUtils.streamAllContents(root)) {
      if (!owningStruct) {
        if (!isFunctionCall(n) || n.f?.ref !== parentFn) {
          continue;
        }

        // Rekursive Aufrufe innerhalb derselben Funktion ignorieren
        if (this.isInsideFunction(n, parentFn)) {
          continue;
        }

        const arg = (n.params ?? [])[idx];
        if (!arg) continue;

        const t = this.typeFor(arg, c2.copy());
        if (t.isUnknown()) continue;

        // Nur Struct-/Array-Typen aus Aufrufen übernehmen
        if (t.isStructType() || t.isArrayType()) {
          return t;
        }
      } else {
        if (!isMethRef(n) || n.f?.ref !== parentFn) {
          continue;
        }

        // Rekursive Methodenaufrufe innerhalb derselben Methode ignorieren
        if (this.isInsideFunction(n, parentFn)) {
          continue;
        }

        const arg = (n.params ?? [])[idx];
        if (!arg) continue;

        const t = this.typeFor(arg, c2.copy());
        if (t.isUnknown()) continue;

        if (t.isStructType() || t.isArrayType()) {
          return t;
        }
      }
    }

    return defaultUnknown;
  }

  /**
   * @brief Prüft über die Containerkette, ob ein AST-Knoten innerhalb einer bestimmten Funktion liegt.
   * @param node Mögliche Aufrufstelle.
   * @param fn Funktion oder Methode, gegen deren Containerbereich geprüft wird.
   * @return `true`, wenn `fn` ein direkter oder indirekter Container des Knotens ist.
   */
  private isInsideFunction(node: AstNode, fn: FunctionDeclaration): boolean {
    let current: AstNode | undefined = node.$container;

    while (current) {
      if (current === fn) {
        return true;
      }
      current = current.$container;
    }

    return false;
  }

  /**
   * @brief Bestimmt den Rückgabetyp eines freien Funktionsaufrufs.
   * @param fc Funktionsaufruf mit optional aufgelöster Deklarationsreferenz.
   * @param ctx Aktueller Berechnungskontext.
   * @return Aus der Deklaration abgeleiteter Rückgabetyp oder `TYPE_UNKNOWN`.
   */
  private handleFunctionCall(fc: FunctionCall, ctx: TypeComputationContext): Pseudo2Type {
    const fd = fc.f?.ref;
    if (!fd) return TYPE_UNKNOWN;
    return this.typeForFunctionDeclaration(fd, ctx);
  }

  /**
   * @brief Bestimmt den Rückgabetyp eines ausgewählten Methodenaufrufs.
   * @param ms Methodenselektion mit Empfänger und Methodenreferenz.
   * @param ctx Aktueller Berechnungskontext.
   * @return Aus der Methodendeklaration abgeleiteter Rückgabetyp oder `TYPE_UNKNOWN`.
   */
  private handleMethSelection(ms: MethSelection, ctx: TypeComputationContext): Pseudo2Type {
    const fd = ms.methref.f?.ref;
    if (!fd) return TYPE_UNKNOWN;
    return this.typeForFunctionDeclaration(fd, ctx);
  }

  /**
   * @brief Leitet den Rückgabetyp einer Funktion oder Methode aus ihren Return-Anweisungen ab.
   * @param fd Zu analysierende Funktionsdeklaration.
   * @param ctx Kontext zur Erkennung rekursiver Rückgabetypzyklen.
   * @return Erster konkreter Rückgabetyp oder `TYPE_UNKNOWN`.
   */
  private typeForFunctionDeclaration(fd: FunctionDeclaration, ctx: TypeComputationContext): Pseudo2Type {
    if (ctx.hasFn(fd)) return TYPE_UNKNOWN;
    const c2 = ctx.copy();
    c2.addFn(fd);
    const returnTypes = this.allReturnTypes(fd, c2);
    return this.firstConcreteReturnType(returnTypes);
  }

  /**
   * @brief Berechnet die Typen sämtlicher Return-Anweisungen mit Ausdruck.
   * @param fd Zu untersuchende Funktions- oder Methodendeklaration.
   * @param ctx Gemeinsamer Ausgangskontext, der pro Return-Zweig kopiert wird.
   * @return Rückgabetypen in AST-Reihenfolge.
   */
  private allReturnTypes(fd: FunctionDeclaration, ctx: TypeComputationContext): Pseudo2Type[] {
    const returns = this.allReturnsWithValue(fd);
    return returns.map(r => this.typeFor(r.retExpr!, ctx.copy()));
  }

  /**
   * @brief Wählt aus mehreren Rückgabetypen den ersten vollständig bekannten Typ.
   * @param types Berechnete Rückgabetypen in Quellreihenfolge.
   * @return Erster weder vollständig noch teilweise unbekannter Typ, sonst `TYPE_UNKNOWN`.
   */
  private firstConcreteReturnType(types: Pseudo2Type[]): Pseudo2Type {
    for (const t of types) {
      if (!t.isUnknown() && !t.isPartiallyUnknown()) return t;
    }
    return TYPE_UNKNOWN;
  }

  /**
   * @brief Bestimmt den Typ eines Structattributzugriffs aus der referenzierten Attributdeklaration.
   * @param sel Attributselektion mit optionalem Arrayindex.
   * @param ctx Aktueller Berechnungskontext; für die einheitliche Handler-Signatur mitgeführt.
   * @return Deklarierter Attributtyp, bei Indexzugriff um eine Dimension reduziert.
   */
  private handleAttSelection(sel: AttSelection, ctx: TypeComputationContext): Pseudo2Type {
    const attDecl = sel.attref.ref?.ref;
    if (!attDecl?.type) return TYPE_UNKNOWN;

    let res = this.typeForTypeRef(attDecl.type);
    if (sel.attref.index) res = res.asBaseType();
    return res;
  }

  /**
   * @brief Übersetzt eine explizite Grammatik-TypeRef in das interne Pseudo2-Typmodell.
   *
   * Structtypen verwenden den aufgelösten Structnamen. Arraytypen werden rekursiv
   * vom Basistyp aufgebaut und berücksichtigen alle Dimensionsknoten. Num-, String-
   * und Bool-TypeRefs werden auf ihre kanonischen Konstanten abgebildet.
   *
   * @param tr Typreferenz aus Parameter- oder Structattributdeklaration.
   * @return Interner konkreter Typ oder `TYPE_UNKNOWN` bei ungelösten Referenzen.
   */
  typeForTypeRef(tr: TypeRef): Pseudo2Type {
    if (isStructType(tr as unknown as StructType)) {
      const s = (tr as unknown as StructType).struct?.ref;
      return s ? TYPE_STRUCT(s.name) : TYPE_UNKNOWN;
    }

    if (isArrayType(tr as unknown as ArrayType)) {
      const base = (tr as unknown as ArrayType).base;
      const bt = this.typeForTypeRef(base as unknown as TypeRef);
      const dimensions = (tr as unknown as ArrayType).dimensions?.length ?? 1;
      let result = bt;
      for (let index = 0; index < dimensions; index++) result = result.asArrayType();
      return result;
    }

    const k = (tr as any).$type as string;
    if (k === 'NumType') return TYPE_NUM;
    if (k === 'StringType') return TYPE_STRING;
    if (k === 'BoolType') return TYPE_BOOL;

    return TYPE_UNKNOWN;
  }

  /**
   * @brief Erkennt synthetische Längenvariablen eines Arrayparameters.
   * @param v Zu prüfende Variablendeklaration.
   * @return `true`, wenn ein Parameter der umgebenden Funktion `v` als Längendeklaration referenziert.
   */
  private isLengthParameterDecl(v: VarDecl): boolean {
    const parent: any = v.$container;
    if (!parent || !isFunctionDeclaration(parent)) return false;
    return (parent.params ?? []).some((p: any) => p.len === v);
  }

  /**
   * @brief Sammelt alle Return-Anweisungen mit Rückgabewert innerhalb einer Funktion.
   * @param fd Zu durchlaufende Funktions- oder Methodendeklaration.
   * @return Return-Knoten mit vorhandenem Ausdruck in AST-Reihenfolge.
   */
  private allReturnsWithValue(fd: FunctionDeclaration): ReturnStmt[] {
    const out: ReturnStmt[] = [];
    for (const n of AstUtils.streamAllContents(fd)) {
      if (isReturnStmt(n) && n.retExpr) out.push(n);
    }
    return out;
  }
}

/** @brief Exportiert die vom Type-Computer verwendeten kanonischen Typen über dieses Modul weiter. */
export { TYPE_NUM, TYPE_STRING, TYPE_STRUCT, TYPE_BOOL, TYPE_ARRAY_NUM, TYPE_UNKNOWN };
