import { describe, test, expect } from 'vitest';
import { AstUtils, EmptyFileSystem, URI, type AstNode, type LangiumDocument } from 'langium';

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
  isPrintCommand
} from '../../src/generated/ast.js';

import { createPseudo2Services } from '../../src/pseudo2-module.js';

describe('ScopeTests', () => {
  let docCounter = 0;

  // Entfernt gemeinsame führende Einrückung aus Template-Strings.
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
  function assertNoDocumentErrors(document: LangiumDocument): void {
    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  // Parst einen Pseudo2-Text mit frischen Services,
  // damit keine vorherigen Testdokumente in den Scope hineinwirken.
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
  function assertVarRefScope(
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'],
    context: VarRef,
    expected: string
  ): void {
    expect(getScopeNamesForVarRef(scopeProvider, context)).toBe(expected);
  }

  // Prüft, ob der Scope einer AttRef genau den erwarteten Namen entspricht.
  function assertAttRefScope(
    scopeProvider: ReturnType<typeof createPseudo2Services>['Pseudo2']['references']['ScopeProvider'],
    context: AttRef,
    expected: string
  ): void {
    expect(getScopeNamesForAttRef(scopeProvider, context)).toBe(expected);
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
    // Für das letzte "print x" sollen beide x-Deklarationen im Scope sichtbar sein.
    const topInstr = model.instructions.at(-1) as IfStatement;
    const printInstr = lastPrintCommand(topInstr);
    expect(printInstr).toBeTruthy();

    const cont = unwrapExpr(printInstr!.param);
    expect(isVarRef(cont)).toBeTruthy();

    assertVarRefScope(scopeProvider, cont as VarRef, 'x, x');
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
});