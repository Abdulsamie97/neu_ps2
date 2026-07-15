// packages/language/src/scoping/pseudo2-scope.ts
/**
 * @file pseudo2-scope.ts
 * @brief Berechnet lexikalische Variablen-, Funktions-, Struct- und Member-Scopes.
 * @author Abdul
 */

import type { AstNode, ReferenceInfo, Scope, AstNodeDescription} from 'langium';
import { AstUtils, DefaultScopeProvider, MapScope, EMPTY_SCOPE } from 'langium';
import type { Pseudo2Services } from '../pseudo2-module.js';

import type {
  Program,
  Instruction,
  Expr,
  VarDecl,
  VarRef,
  FunctionDeclaration,
  StructDeclaration,
  IfStatement
} from '../generated/ast.js';

import {
  isVarRef,
  isAttRef,
  isMethRef,
  isFunctionCall,
  isFunctionDeclaration,
  isStructDeclaration,
  isStructAttDeclaration,
  isStructType,
  isNewExpr,

  isBracedBlock,
  isIndentedBlock,

  isIfStatement,
  isWhileLoop,
  isForLoop,
  isDoWhileLoop,

  isVarDecl,
  isReturnStmt,
  isAssignment,

  isAttSelection,
  isMethSelection,

  isExprStatement,

  isPrintCommand,
  isThrowCommand,
  isCallCommand,
  isVerificationStatement,
  isLoopAnnotation
  
} from '../generated/ast.js';

import { Pseudo2TypeComputer, TypeComputationContext } from '../typing/pseudo2-type-computer.js';

/** Minimale gemeinsame Sicht auf alle benannten Scope-Elemente. */
type Named = { name: string };
/** Aktiviert bei Bedarf ausführliche Scope-Diagnosen auf der Konsole. */
const DEBUG_SCOPE = false;

/**
 * Gibt Scope-Diagnosen nur bei aktiviertem Debug-Schalter aus.
 *
 * @param values Beliebige an `console.log` weiterzureichende Werte.
 */
function debugScope(...values: unknown[]): void {
  if (DEBUG_SCOPE) {
    console.log(...values);
  }
}

/**
 * Erkennt globale Funktionen anhand des expliziten `func`-Schlüsselworts.
 *
 * @param fn Zu prüfende Funktionsdeklaration.
 * @returns `true` für globale Funktionen.
 */
function isGlobalFunctionDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword === true;
}

/**
 * Erkennt schlüsselwortlose Struct-Methoden.
 *
 * @param fn Zu prüfende Funktionsdeklaration.
 * @returns `true` für Methoden.
 */
function isMethodDecl(fn: FunctionDeclaration): boolean {
  return fn.keyword !== true;
}

/**
 * Sprachspezifischer ScopeProvider für Pseudo2-Cross-References.
 *
 * Variablen folgen Quellreihenfolge und lexikalischer Verschattung. Funktionen
 * und Structs sind global, während Attribute und Methoden aus dem statischen
 * Typ des jeweiligen Empfängers bestimmt werden.
 */
export class Pseudo2ScopeProvider extends DefaultScopeProvider {
  /** Erzeugt Langium-Beschreibungen für die berechneten Scope-Elemente. */
  private readonly descProvider: Pseudo2Services['workspace']['AstNodeDescriptionProvider'];
  /** Bestimmt den Struct-Typ von Member-Empfängern. */
  private readonly types = new Pseudo2TypeComputer();

  /**
   * Erstellt den Provider aus den injizierten Pseudo2-Services.
   *
   * @param services Vollständig konfigurierte Pseudo2-Langium-Services.
   */
  constructor(services: Pseudo2Services) {
    super(services);
    this.descProvider = services.workspace.AstNodeDescriptionProvider;
  }

  /**
   * Berechnet den Scope für die konkrete Cross-Reference.
   *
   * Variablenreferenzen erhalten sichtbare lokale Variablen, Iteratoren,
   * Parameter, Struct-Attribute und globale Variablen. Freie Funktionsaufrufe
   * sehen nur globale Funktionen. Struct-Typen und `new` sehen globale Structs;
   * Memberreferenzen werden anhand des Empfängertyps auf ein Struct eingeschränkt.
   *
   * @param context Langium-Information über Container, Eigenschaft und Referenz.
   * @returns Spezifischer Pseudo2-Scope oder der Langium-Standardscope.
   */
  override getScope(context: ReferenceInfo): Scope {
    const c = context.container;
    const r = context.reference;
      debugScope('CUSTOM SCOPE PROVIDER ACTIVE', context.container.$type, context.property);
    //console.log('[SCOPE] container=', c.$type, 'refText=', (r as any).$refText ?? 'n/a');

    // VarRef.ref
    if (isVarRef(c) && r === c.ref) {
      debugScope('--- VARREF SCOPE START ---');
      debugScope('VarRef text =', c.ref?.$refText ?? c.ref?.ref?.name ?? 'n/a');

      const vars = this.scopeForVarRef(c);
      debugScope('Final vars =', vars.map(v => v.name));
      debugScope('--- VARREF SCOPE END ---');
      return this.scopeFromNamed(vars);
    }

    // FunctionCall.f (global functions)
    if (isFunctionCall(c) && r === c.f) {
      const fns = this.collectGlobalFunctions(c);
    //  console.log('[FUNC SCOPE]', fns.map(f => f.name));
      return this.scopeFromNodes(fns, f => f.name);
    }

    // StructType.struct / NewExpr.type (global structs)
    if (isStructType(c) && r === c.struct) {
      const structs = this.collectStructs(c);
   //   console.log('[STRUCT TYPE SCOPE]', structs.map(s => s.name));
      return this.scopeFromNodes(structs, s => s.name);
    }
    if (isNewExpr(c) && r === c.type) {
      const structs = this.collectStructs(c);
      //console.log('[NEW SCOPE]', structs.map(s => s.name));
      return this.scopeFromNodes(structs, s => s.name);
    }

    // AttRef.ref (member attributes)
    if (isAttRef(c) && r === c.ref) {
      const owner = AstUtils.getContainerOfType(c, isAttSelection);
      if (!owner) {
      //  console.log('[ATT SCOPE] no owner');
        return EMPTY_SCOPE;
      }

      const ctx = new TypeComputationContext();
      const parentType = this.types.typeFor(owner.receiver as Expr, ctx);
     // console.log('[ATT SCOPE] receiver type =', parentType.asString());

      if (!parentType.isStruct || parentType.name === '' || parentType.isUnknown()) {
      //  console.log('[ATT SCOPE] receiver type unknown');
        return EMPTY_SCOPE;
      }

      const sd = this.findStructByName(c, parentType.name);
      //console.log('[ATT SCOPE] struct found =', sd?.name ?? 'none');
      if (!sd) return EMPTY_SCOPE;

      const atts = (sd.children ?? []).filter(isStructAttDeclaration);
      //console.log('[ATT SCOPE] attrs =', atts.map(a => a.name));
      return this.scopeFromNodes(atts, a => a.name);
    }

    // MethRef.f (member methods)
    if (isMethRef(c) && r === c.f) {
      const owner = AstUtils.getContainerOfType(c, isMethSelection);
      if (!owner) {
        //console.log('[METH SCOPE] no owner');
        return EMPTY_SCOPE;
      }

      const ctx = new TypeComputationContext();
      const parentType = this.types.typeFor(owner.receiver as Expr, ctx);
      //console.log('[METH SCOPE] receiver type =', parentType.asString());

      if (!parentType.isStruct || parentType.name === '' || parentType.isUnknown()) {
       // console.log('[METH SCOPE] receiver type unknown');
        return EMPTY_SCOPE;
      }

      const sd = this.findStructByName(c, parentType.name);
     // console.log('[METH SCOPE] struct found =', sd?.name ?? 'none');
      if (!sd) return EMPTY_SCOPE;

    const methods = (sd.children ?? [])
      .filter(isFunctionDeclaration)
      .filter(isMethodDecl);     
      // console.log('[METH SCOPE] methods =', methods.map(m => m.name));
      return this.scopeFromNodes(methods, m => m.name);
    }

    return super.getScope(context);
  }

  /**
   * Erstellt einen abgeschlossenen MapScope aus AST-Knoten.
   *
   * @typeParam T Typ der aufzunehmenden AST-Knoten.
   * @param nodes Sichtbare AST-Knoten.
   * @param nameOf Funktion zur Bestimmung des Scope-Namens.
   * @returns Scope ohne äußeren Fallback.
   */
  private scopeFromNodes<T extends AstNode>(nodes: T[], nameOf: (n: T) => string): Scope {
    const descriptions: AstNodeDescription[] = nodes.map(n =>
      this.descProvider.createDescription(n, nameOf(n))
    );
    return new MapScope(descriptions, EMPTY_SCOPE);
  }

  /**
   * Erstellt einen abgeschlossenen MapScope aus minimal benannten AST-Objekten.
   *
   * @param nodes Sichtbare Deklarationen in Prioritätsreihenfolge.
   * @returns Scope mit den angegebenen Quellnamen.
   */
  private scopeFromNamed(nodes: Named[]): Scope {
    const astNodes = nodes as unknown as AstNode[];
    const descriptions: AstNodeDescription[] = astNodes.map((n, i) =>
      this.descProvider.createDescription(n, nodes[i].name)
    );
    return new MapScope(descriptions, EMPTY_SCOPE);
  }

  /**
   * Berechnet sämtliche sichtbaren Namen für eine Variablenreferenz.
   *
   * Die Methode behandelt Schleifenannotation, Blockreihenfolge, If-Zweige,
   * Schleifeniteratoren, Funktionsparameter, Methodenattribute und Top-Level
   * getrennt. Innere Deklarationen stehen vor äußeren Namen.
   *
   * @param node Variablenreferenz oder enthaltener AST-Knoten.
   * @returns Sichtbare Deklarationen in Auflösungspriorität.
   */
  private scopeForVarRef(node: AstNode): Named[] {
    const loopAnnotation = AstUtils.getContainerOfType(node, isLoopAnnotation);
    if (loopAnnotation && isForLoop(loopAnnotation.$container) && loopAnnotation.$container.iterator) {
      const loop = loopAnnotation.$container;
      const iterator = loop.iterator!;
      return this.dedupByName([iterator, ...this.scopeForVarRefFrom(loop.$container)]);
    }

    const currentInstr = this.getEnclosingInstruction(node);

    debugScope('[scopeForVarRef] node type =', node.$type);
    debugScope('[scopeForVarRef] currentInstr =', currentInstr?.$type);

    if (currentInstr) {
      const container = currentInstr.$container;
      debugScope('[scopeForVarRef] container =', container?.$type);

      if (isBracedBlock(container) || isIndentedBlock(container)) {
        const locals = this.extractVarDeclsBeforeCurrent(container.instructions ?? [], currentInstr);
        const outer = this.scopeForVarRefFrom(container.$container);

        // Lokale Deklarationen im aktuellen Block vollständig behalten,
        // auch wenn derselbe Name mehrfach vorkommt.
        // Nur äußere Namen, die bereits lokal vorkommen, ausblenden.
        return this.mergeLocalsWithOuter(locals, outer);
      }

      if (isIfStatement(container)) {
        debugScope('[scopeForVarRef] entered IF branch');
        const locals = this.handleIfStatement(container, currentInstr);
        debugScope('[scopeForVarRef] IF locals =', locals.map(v => v.name));

        return this.dedupByName(locals);
      }

      if (isWhileLoop(container) || isDoWhileLoop(container)) {
        return this.dedupByName(this.scopeForVarRefFrom(container.$container));
      }

      if (isForLoop(container)) {
        const iter = container.iterator ? [container.iterator] : [];
    //    console.log('[VAR SCOPE] for iterator =', iter.map(v => v.name));
        return this.dedupByName([...iter, ...this.scopeForVarRefFrom(container.$container)]);
      }

      if (isFunctionDeclaration(container)) {
        const params = this.collectFunctionParameters(container);
        const globals = this.collectGlobalVars(container);
        const structAtts = this.collectEnclosingStructAttributes(container);
    //    console.log('[VAR SCOPE] fn params =', params.map(v => v.name));
     //   console.log('[VAR SCOPE] fn globals =', globals.map(v => v.name));
     //   console.log('[VAR SCOPE] fn structAtts =', structAtts.map(v => v.name));
        return this.dedupByName([...structAtts, ...params, ...globals]);
      }

      if (isFunctionDeclaration(currentInstr)) {
        const params = this.collectFunctionParameters(currentInstr);
        const globals = this.collectGlobalVars(currentInstr);
        const structAtts = this.collectEnclosingStructAttributes(currentInstr);
        return this.dedupByName([...structAtts, ...params, ...globals]);
      }

      const program = this.getProgram(node);
      if (program) {
        const locals = this.extractVarDeclsBeforeCurrent(program.instructions, currentInstr);
      //  console.log('[VAR SCOPE] top locals =', locals.map(v => v.name));
        return this.dedupByName(locals);
      }

      return this.dedupByName(this.scopeForVarRefFrom(container));
    }

    const forLoop = AstUtils.getContainerOfType(node, isForLoop);
    if (forLoop?.iterator) {
      return this.dedupByName([forLoop.iterator, ...this.scopeForVarRefFrom(forLoop.$container)]);
    }

    const enclosingFn = AstUtils.getContainerOfType(node, isFunctionDeclaration);
    if (enclosingFn) {
      const params = this.collectFunctionParameters(enclosingFn);
      const globals = this.collectGlobalVars(enclosingFn);
      const structAtts = this.collectEnclosingStructAttributes(enclosingFn);
      return this.dedupByName([...structAtts, ...params, ...globals]);
    }

    return this.dedupByName(this.collectGlobalVars(node));
  }

  /**
   * Liefert die berechneten Variablennamen für Scope-Tests und Diagnosen.
   *
   * @param node Zu untersuchende Variablenreferenz.
   * @returns Sichtbare Namen in Auflösungsreihenfolge.
   */
  public debugVarRefScopeNames(node: VarRef): string[] {
    return this.scopeForVarRef(node).map(v => v.name);
  }

  /**
   * Verbindet lokale und äußere Namen unter Beibehaltung lokaler Duplikate.
   *
   * Äußere Deklarationen werden nur dann entfernt, wenn ihr Name bereits lokal
   * vorkommt; so bildet die Liste lexikalische Verschattung ab.
   *
   * @param locals Lokale Deklarationen in Quellpriorität.
   * @param outer Sichtbare Deklarationen äußerer Scopes.
   * @returns Zusammengeführte Scope-Liste.
   */
  private mergeLocalsWithOuter(locals: Named[], outer: Named[]): Named[] {
    const localNames = new Set(locals.map(v => v.name));
    return [...locals, ...outer.filter(v => !localNames.has(v.name))];
  }

  /**
   * Sammelt die Attribute des Structs, das den Ausgangsknoten umschließt.
   *
   * @param from Ausgangsknoten der Containersuche.
   * @returns Struct-Attribute oder eine leere Liste außerhalb einer Methode.
   */
  private collectEnclosingStructAttributes(from: AstNode): Named[] {
    const enclosingStruct = AstUtils.getContainerOfType(from, isStructDeclaration);
    if (!enclosingStruct) return [];
    const attrs = (enclosingStruct.children ?? []).filter(isStructAttDeclaration);
  //  console.log('[VAR SCOPE] enclosing struct attrs =', attrs.map(a => a.name), 'struct=', enclosingStruct.name);
    return attrs;
  }

  /**
   * Berechnet rekursiv sichtbare Variablen aus einem Container und seinen Vorfahren.
   *
   * Direkte Locals, Iteratoren, Struct-Attribute, Parameter und globale Variablen
   * werden in dieser Priorität gesammelt und anschließend nach Namen dedupliziert.
   *
   * @param container Startcontainer oder `undefined`.
   * @returns Sichtbare Namen in Auflösungspriorität.
   */
  private scopeForVarRefFrom(container: AstNode | undefined): Named[] {
    if (!container) return [];

    const directLocals = this.collectVisibleLocalsFromContainer(container);

    const enclosingFn = isFunctionDeclaration(container)
      ? container
      : AstUtils.getContainerOfType(container, isFunctionDeclaration);

    const params = enclosingFn ? this.collectFunctionParameters(enclosingFn) : [];
    const globals = this.collectGlobalVars(container);
    const structAtts = this.collectEnclosingStructAttributes(container);

    const loopIter = isForLoop(container) && container.iterator ? [container.iterator] : [];

    const parent = container.$container;
    const outer = parent ? this.scopeForVarRefFrom(parent) : [];

    return this.dedupByName([
      ...directLocals,
      ...loopIter,
      ...structAtts,
      ...params,
      ...globals,
      ...outer
    ]);
  }

  /**
   * Sammelt lokale Deklarationen, die vor der aktuellen Anweisung sichtbar sind.
   *
   * Block- und If-Zweiggrenzen werden beachtet; Deklarationen aus dem jeweils
   * anderen If-Zweig werden nicht aufgenommen.
   *
   * @param container Zu untersuchender AST-Container.
   * @returns Vor der aktuellen Position deklarierte lokale Variablen.
   */
  private collectVisibleLocalsFromContainer(container: AstNode): VarDecl[] {
    const currentInstr = this.getEnclosingInstruction(container);
    if (!currentInstr) {
      return [];
    }

    if (isBracedBlock(container) || isIndentedBlock(container)) {
      return this.extractVarDeclsBeforeCurrent(container.instructions ?? [], currentInstr);
    }

    if (isIfStatement(container)) {
      const thenInstrs = container.thenBlock?.instructions ?? [];
      const elseInstrs = container.elseBlock?.instructions ?? [];

      if (thenInstrs.includes(currentInstr)) {
        return this.extractVarDeclsBeforeCurrent(thenInstrs, currentInstr);
      }

      if (elseInstrs.includes(currentInstr)) {
        return this.extractVarDeclsBeforeCurrent(elseInstrs, currentInstr);
      }
    }

    return [];
  }

  /**
   * Berechnet lokale und äußere Namen innerhalb des zutreffenden If-Zweigs.
   *
   * @param ifStmt Umschließende If-Anweisung.
   * @param currentInstr Aktuelle Anweisung im Then- oder Else-Zweig.
   * @returns Vorherige Zweigdeklarationen gefolgt von äußeren Namen.
   */
  private handleIfStatement(ifStmt: IfStatement, currentInstr: Instruction): Named[] {
    const thenInstrs: Instruction[] = ifStmt.thenBlock?.instructions ?? [];
    const elseInstrs: Instruction[] = ifStmt.elseBlock?.instructions ?? [];

    debugScope('[handleIfStatement] currentInstr =', currentInstr.$type);
    debugScope('[handleIfStatement] thenInstrs =', thenInstrs.map(i => i.$type));
    debugScope('[handleIfStatement] elseInstrs =', elseInstrs.map(i => i.$type));  


    const inThen = thenInstrs.includes(currentInstr);
    const list = inThen ? thenInstrs : elseInstrs;

    debugScope('[handleIfStatement] inThen =', inThen);
    debugScope('[handleIfStatement] chosen list =', list.map(i => i.$type));

    const locals = this.extractVarDeclsBeforeCurrent(list, currentInstr);
    debugScope('[handleIfStatement] extracted locals =', locals.map(v => v.name));
  
    return [...locals, ...this.scopeForVarRefFrom(ifStmt.$container)];
    
  }

  /**
   * Extrahiert Variablendeklarationen vor einer bestimmten Anweisung.
   *
   * Das Ergebnis wird umgedreht, sodass die zuletzt deklarierte und damit
   * nächstgelegene Variable zuerst aufgelöst wird.
   *
   * @param instrs Anweisungen eines gemeinsamen Containers.
   * @param current Aktuelle Anweisung als exklusive Grenze.
   * @returns Vorherige Variablendeklarationen in umgekehrter Quellreihenfolge.
   */
  private extractVarDeclsBeforeCurrent(instrs: Instruction[], current: Instruction): VarDecl[] {
    const out: VarDecl[] = [];

    debugScope('[extractVarDeclsBeforeCurrent] current =', current.$type);
    debugScope('[extractVarDeclsBeforeCurrent] instrs =', instrs.map(i => i.$type));

    for (const i of instrs) {
      debugScope('[extractVarDeclsBeforeCurrent] visiting =', i.$type);
      if (i === current) {
        debugScope('[extractVarDeclsBeforeCurrent] reached current -> stop');
        break;
      }
      if (isVarDecl(i)) {
        debugScope('[extractVarDeclsBeforeCurrent] found varDecl =', i.name);
        out.push(i);
      }
    }

    return out.reverse();
  }

  /**
   * Entfernt spätere Namensduplikate und erhält jeweils den ersten Treffer.
   *
   * @param vars Deklarationen in gewünschter Prioritätsreihenfolge.
   * @returns Nach Namen deduplizierte Liste.
   */
  private dedupByName(vars: Named[]): Named[] {
    const seen = new Set<string>();
    const out: Named[] = [];
    for (const v of vars) {
      if (!seen.has(v.name)) {
        seen.add(v.name);
        out.push(v);
      }
    }
    return out;
  }

  /**
   * Sucht aufwärts die nächstgelegene eigenständige Pseudo2-Anweisung.
   *
   * @param node Ausgangsknoten der Containersuche.
   * @returns Nächste Anweisung oder `undefined`.
   */
  private getEnclosingInstruction(node: AstNode): Instruction | undefined {
    let n: AstNode | undefined = node;
    while (n) {
      if (this.isInstructionNode(n)) return n as Instruction;
      n = n.$container;
    }
    return undefined;
  }

  /**
   * Prüft, ob ein AST-Knoten in Pseudo2 als eigenständige Anweisung zählt.
   *
   * @param n Zu prüfender AST-Knoten.
   * @returns `true` für unterstützte Instruktionstypen und freie Call-Anweisungen.
   */
  private isInstructionNode(n: AstNode): boolean {
    return (
      isIfStatement(n) ||
      isWhileLoop(n) ||
      isForLoop(n) ||
      isDoWhileLoop(n) ||
      isFunctionDeclaration(n) ||
      isStructDeclaration(n) ||
      isVarDecl(n) ||
      isAssignment(n) ||
      isReturnStmt(n) ||
      isExprStatement(n) ||
      isPrintCommand(n) ||
      isThrowCommand(n) ||
      isCallCommand(n) ||
      isVerificationStatement(n) ||
      (isFunctionCall(n) && this.isStandaloneFunctionCallInstruction(n))
    );
  }

  /**
   * Erkennt einen Funktionsaufruf, der direkt in Block oder Programm steht.
   *
   * Aufrufe innerhalb größerer Ausdrücke dürfen nicht als umschließende
   * Anweisung behandelt werden.
   *
   * @param node Erwarteter Funktionsaufruf.
   * @returns `true`, wenn sein direkter Container Block oder Programm ist.
   */
  private isStandaloneFunctionCallInstruction(node: AstNode): boolean {
    const parent = node.$container;
    return (
      !!parent &&
      (
        isBracedBlock(parent) ||
        isIndentedBlock(parent) ||
        this.getProgram(node) === parent
      )
    );
  }
  
  /**
   * Sammelt globale Variablen in umgekehrter Quellreihenfolge.
   *
   * @param from Beliebiger Knoten des Dokuments.
   * @returns Globale Variablen mit späteren Deklarationen zuerst.
   */
  private collectGlobalVars(from: AstNode): VarDecl[] {
    const program = this.getProgram(from);
    return program ? [...program.instructions.filter(isVarDecl)].reverse() : [];
  }

  /**
   * Sammelt alle explizit globalen Funktionen des Dokuments.
   *
   * @param from Beliebiger Knoten des Dokuments.
   * @returns Globale Funktionsdeklarationen in Quellreihenfolge.
   */
  private collectGlobalFunctions(from: AstNode): FunctionDeclaration[] {
    const program = this.getProgram(from);
    return program
      ? program.instructions
          .filter(isFunctionDeclaration)
          .filter(isGlobalFunctionDecl)
      : [];
  }

  /**
   * Sammelt formale Parameter und synthetische Array-Längenparameter.
   *
   * @param fn Funktion oder Methode.
   * @returns Benannte Parameter in Signaturreihenfolge.
   */
  private collectFunctionParameters(fn: FunctionDeclaration): Named[] {
  const out: Named[] = [];

  for (const p of fn.params ?? []) {
    out.push(p);
    if (p.isArray && p.len) {
      out.push(p.len);
    }
  }

  return out;
  }

  /**
   * Sammelt alle global deklarierten Structs.
   *
   * @param from Beliebiger Knoten des Dokuments.
   * @returns Struct-Deklarationen in Quellreihenfolge.
   */
  private collectStructs(from: AstNode): StructDeclaration[] {
    const program = this.getProgram(from);
    return program ? program.instructions.filter(isStructDeclaration) : [];
  }

  /**
   * Sucht ein globales Struct anhand seines Quellnamens.
   *
   * @param from Beliebiger Knoten des Dokuments.
   * @param name Gesuchter Struct-Name.
   * @returns Erste passende Deklaration oder `undefined`.
   */
  private findStructByName(from: AstNode, name: string): StructDeclaration | undefined {
    const program = this.getProgram(from);
    if (!program) return undefined;
    return program.instructions.filter(isStructDeclaration).find(sd => sd.name === name);
  }

  /**
   * Liefert die Programmwurzel des Langium-Dokuments eines AST-Knotens.
   *
   * @param node Beliebiger an ein Dokument gebundener AST-Knoten.
   * @returns Geparstes Pseudo2-Programm.
   */
  private getProgram(node: AstNode): Program | undefined {
    const doc = AstUtils.getDocument(node);
    return doc.parseResult.value as unknown as Program;
  }
}
