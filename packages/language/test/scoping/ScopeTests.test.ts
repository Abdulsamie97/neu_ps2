/**
 * @file ScopeTests.test.ts
 * @brief Prüft sichtbare Variablen-, Parameter-, Iterator- und Struct-Attributnamen in Pseudo2-Scope-Kontexten.
 *
 * Die Suite baut frische Dokumente, lokalisiert konkrete Referenzknoten und vergleicht
 * die vom Pseudo2ScopeProvider gelieferten Namen in Schleifen, Funktionen und Selektionen.
 *
 * @author Abdul
 */

import { describe, test, expect } from 'vitest';
import { AstUtils, EmptyFileSystem, URI, type AstNode, type LangiumDocument} from 'langium';

import type {
  Program,
  FunctionDeclaration,
  IfStatement,
  WhileLoop,
  PrintCommand,
  VarRef,
  AttRef,
  AttSelection,
  Expr
} from '../../src/generated/ast.js';

import {
  isVarRef,
  isAttSelection,
  isGrouping,
  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isExponentiation,
  isFunctionDeclaration,
  isPrintCommand,
  isVarDecl,
} from '../../src/generated/ast.js';

import { createPseudo2Services } from '../../src/pseudo2-module.js';
import { Pseudo2ScopeProvider } from '../../src/scoping/pseudo2-scope.js';

/** Scoping-Regressionssuite für Variablen- und Attributreferenzen. */
describe('ScopeTests', () => {
  /** Fortlaufende Nummer für eindeutige Scope-Testdokumente. */
  let docCounter = 0;

  // Entfernt gemeinsame führende Einrückung aus Template-Strings.
  /** @param text Eingerückter Pseudo2-Quelltext. @returns Normalisierter Quelltext. */
  function dedent(text: string): string {
    const lines = text.replace(/\r/g, '').split('\n');

    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    const indents = lines
      .filter(line => line.trim().length > 0)
      .map(line => line.match(/^ */)?.[0].length ?? 0);

    const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

    return lines.map(line => line.slice(minIndent)).join('\n');
  }

  // Prüft, dass beim Parsen/Bauen keine Fehlerdiagnosen entstanden sind.
  /** @param document Dokument, das keine Fehlerdiagnosen enthalten darf. */
  function assertNoDocumentErrors(document: LangiumDocument): void {
    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  // Parst einen Pseudo2-Text mit frischen Services,
  // damit keine vorherigen Testdokumente in den Scope hineinwirken.
  /**
   * Parst ein Pseudo2-Programm mit isolierten Diensten und liefert zusätzlich den ScopeProvider.
   * @param text Pseudo2-Quelltext.
   * @returns Program-AST, Dokument und zugehöriger ScopeProvider.
   */
  async function parseModel(text: string): Promise<{
    model: Program;
    document: LangiumDocument;
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'];
  }> {
    const services = createPseudo2Services(EmptyFileSystem);
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;
    const scopeProvider = services.Pseudo2.references.ScopeProvider;

    const uri = URI.parse(`memory:/scope-test-${docCounter++}.pseudo2`);
    const document: LangiumDocument = documentFactory.fromString(dedent(text), uri);
    await documentBuilder.build([document], { validation: true });
    assertNoDocumentErrors(document);

    return {
      model: document.parseResult.value as Program,
      document,
      scopeProvider
    };
  }

  // Sucht den letzten PrintCommand innerhalb eines Teilbaums.
  /** @param root Zu durchsuchender AST-Teilbaum. @returns Letztes print-Kommando oder `undefined`. */
  function lastPrintCommand(root: AstNode): PrintCommand | undefined {
    let last: PrintCommand | undefined;

    for (const n of AstUtils.streamAllContents(root)) {
      if (isPrintCommand(n)) {
        last = n;
      }
    }

    return last;
  }

  // Entpackt Ausdruckshüllen der Präzedenzkette, bis der eigentliche Kern-Ausdruck erreicht ist.
  /** @param expr Zu reduzierender Ausdruck. @returns Semantischer Kernausdruck hinter Gruppierungs- und Einzelhüllen. */
  function unwrapExpr(expr: Expr): Expr {
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

  // Liefert die sichtbaren Namen im Scope einer Variablenreferenz.
  /**
   * Fragt Langiums Scope für die `ref`-Eigenschaft einer Variablenreferenz ab.
   * @param scopeProvider Zu testender ScopeProvider.
   * @param context Referenzknoten und Auflösungskontext.
   * @returns Sichtbare Namen in Provider-Reihenfolge.
   */
  function getScopeNamesForVarRef(
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'],
    context: VarRef
  ): string {
    const scope = scopeProvider.getScope({
      container: context,
      property: 'ref',
      reference: context.ref
    });
    return Array.from(scope.getAllElements()).map(e => e.name).join(', ');
  }

  // Liefert die sichtbaren Namen im Scope einer Attributreferenz.
  /**
   * Fragt Langiums Scope für die `ref`-Eigenschaft einer Struct-Attributreferenz ab.
   * @param scopeProvider Zu testender ScopeProvider.
   * @param context Attributreferenz und Auflösungskontext.
   * @returns Sichtbare Attributnamen in Provider-Reihenfolge.
   */
  function getScopeNamesForAttRef(
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'],
    context: AttRef
  ): string {
    const scope = scopeProvider.getScope({
      container: context,
      property: 'ref',
      reference: context.ref
    });
    return Array.from(scope.getAllElements()).map(e => e.name).join(', ');
  }

  // Prüft, ob der Scope einer VarRef genau den erwarteten Namen entspricht.
  /** @param scopeProvider Zu testender Provider. @param context Variablenreferenz. @param expected Erwartete Namensliste. */
  function assertVarRefScope(
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'],
    context: VarRef,
    expected: string
  ): void {
    expect(getScopeNamesForVarRef(scopeProvider, context)).toBe(expected);
  }

  // Prüft, ob der Scope einer AttRef genau den erwarteten Namen entspricht.
  /** @param scopeProvider Zu testender Provider. @param context Attributreferenz. @param expected Erwartete Namensliste. */
  function assertAttRefScope(
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'],
    context: AttRef,
    expected: string
  ): void {
    expect(getScopeNamesForAttRef(scopeProvider, context)).toBe(expected);
  }

  // Sucht im AST den ersten Knoten, der zum gewünschten Typ passt.
  /**
   * Sucht Wurzel und Nachfahren nach dem ersten Knoten eines durch einen Type Guard bestimmten Typs.
   * @param root Ausgangsknoten.
   * @param guard Type Guard des Zieltyps.
   * @returns Erster passender Knoten oder `undefined`.
   */
  function firstNodeOfType<T extends AstNode>(
    root: AstNode,
    guard: (node: AstNode) => node is T
  ): T | undefined {
    if (guard(root)) {
      return root;
    }

    for (const n of AstUtils.streamAllContents(root)) {
      if (guard(n)) {
        return n;
      }
    }

    return undefined;
  }

  test('scopeVarRefSimpleWhile', async () => {
    const { model, scopeProvider } = await parseModel(`
      var flag = true
      var y1 = 2
      var x = 5
      var y2 = 3

      while flag {
        var x = 5 / 2
        print x
      }
    `);

    // Testet den Scope von "x" innerhalb einer while-Schleife.
    // Erwartet wird:
    // - das innere x aus der while-Schleife
    // - danach die vorher deklarierten Variablen y2, y1 und flag
    const topInstr = model.instructions.at(-1) as WhileLoop;
    const printInstr = lastPrintCommand(topInstr);
    expect(printInstr).toBeTruthy();

    const cont = unwrapExpr(printInstr!.param);
    expect(isVarRef(cont)).toBeTruthy();

    assertVarRefScope(scopeProvider, cont as VarRef, 'x, y2, y1, flag');
  });

  test('scopeVarRefSimpleIf', async () => {
    const { model, scopeProvider } = await parseModel(`
      if true {
        var x = 5 / 2
        print x
        var x = 35
        print x
      }
    `);

    // Testet den Scope von "x" in einem if-Block mit zwei x-Deklarationen.
    // Die rohe Kandidatenliste vor MapScope prüfen.
    // Erwartung: Für das letzte "print x" sind beide x-Deklarationen sichtbar.
    const topInstr = model.instructions.at(-1) as IfStatement;
    const printInstr = lastPrintCommand(topInstr);
    expect(printInstr).toBeTruthy();

    const cont = unwrapExpr(printInstr!.param);
    expect(isVarRef(cont)).toBeTruthy();

    const rawNames = (scopeProvider as Pseudo2ScopeProvider).debugVarRefScopeNames(cont as VarRef);
    expect(rawNames.join(', ')).toBe('x, x');
  });

  test('scopeNestedIndentShadowing', async () => {
    // Testet zusätzlichen Indent als inneren Scope:
    // - erstes print x  -> äußeres x
    // - zweites print x -> inneres x
    // - drittes print x -> wieder äußeres x
    const { model, document } = await parseModel(`
      func f()
          var x = 5 / 2
          print x
            var x = 35
            print x
          print x
    `);

    assertNoDocumentErrors(document);

    const fn = firstNodeOfType(model, isFunctionDeclaration);
    expect(fn).toBeTruthy();

    const decls = Array.from(AstUtils.streamAllContents(fn!)).filter(isVarDecl);
    const prints = Array.from(AstUtils.streamAllContents(fn!)).filter(isPrintCommand);

    expect(decls).toHaveLength(2);
    expect(prints).toHaveLength(3);

    const firstExpr = unwrapExpr(prints[0]!.param);
    const secondExpr = unwrapExpr(prints[1]!.param);
    const thirdExpr = unwrapExpr(prints[2]!.param);

    expect(isVarRef(firstExpr)).toBe(true);
    expect(isVarRef(secondExpr)).toBe(true);
    expect(isVarRef(thirdExpr)).toBe(true);

    const firstRef = firstExpr as VarRef;
    const secondRef = secondExpr as VarRef;
    const thirdRef = thirdExpr as VarRef;

    expect(firstRef.ref?.ref).toBe(decls[0]);
    expect(secondRef.ref?.ref).toBe(decls[1]);
    expect(thirdRef.ref?.ref).toBe(decls[0]); //warum gerät in endlose schleife bei delc[1]?
  });

  test('scopeVarRefFuncDecl', async () => {
    const { model, scopeProvider } = await parseModel(`
      func hello_world() {
        print a[1]
      }

      var a[1] = 2
    `);

    // Testet, dass innerhalb einer Funktion auf eine globale Array-Variable "a" zugegriffen werden kann.
    const topInstr = model.instructions[0] as FunctionDeclaration;
    const printInstr = lastPrintCommand(topInstr);
    expect(printInstr).toBeTruthy();

    const cont = unwrapExpr(printInstr!.param);
    expect(isVarRef(cont)).toBeTruthy();

    assertVarRefScope(scopeProvider, cont as VarRef, 'a');
  });

  // Original Xtext test was commented out, so it stays commented out here as well.
  // test('scopeAttRefSimple', async () => {
  //   const { model, scopeProvider } = await parseModel(`
  //     struct treeElem {
  //       num key
  //       treeElem left
  //       treeElem right
  //     }
  //
  //     var root = new treeElem
  //     print root.key
  //   `);
  //
  //   const topInstr = model.instructions.at(-1) as PrintCommand;
  //   const cont = unwrapExpr(topInstr.param);
  //   expect(isAttSelection(cont)).toBeTruthy();
  //   assertAttRefScope(scopeProvider, (cont as AttSelection).attref as AttRef, '');
  // });

  test('scopeAttRefSimple1', async () => {
    const { model, scopeProvider } = await parseModel(`
      struct treeElem {
        num key
        treeElem left
        treeElem right
      }

      var root = new treeElem
      print root.key
    `);

    // Testet den Attribut-Scope für "root.key".
    // Für ein Objekt vom Typ treeElem sollen die Attribute key, left und right sichtbar sein.
    const topInstr = model.instructions.at(-1);
    expect(topInstr && isPrintCommand(topInstr)).toBeTruthy();

    const cont = unwrapExpr((topInstr as PrintCommand).param);
    expect(isAttSelection(cont)).toBeTruthy();

    const attRef = (cont as AttSelection).attref as AttRef;
    expect(attRef).toBeTruthy();

    assertAttRefScope(scopeProvider, attRef, 'key, left, right');
  });

  //temporärer Test:
  test('uses custom scope provider', async () => {
  const { scopeProvider } = await parseModel(`
    var x = 1
  `);

  expect(scopeProvider.constructor.name).toBe('Pseudo2ScopeProvider');
});
});
