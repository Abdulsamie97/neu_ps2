import { describe, test, expect } from 'vitest';
import { AstUtils, EmptyFileSystem, URI, type AstNode, type LangiumDocument } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import { isVarRef } from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

describe('ParsingTests_CustomTests', () => {
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

  // Parst ein Pseudo2-Programm mit frischen Services.
  async function parseModel(text: string): Promise<{ model: Program; document: LangiumDocument }> {
    const services = createPseudo2Services(EmptyFileSystem);
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;

    const uri = URI.parse(`memory:/custom-test-${docCounter++}.pseudo2`);
    const document: LangiumDocument = documentFactory.fromString(dedent(text), uri);

    await documentBuilder.build([document], { validation: true });

    return {
      model: document.parseResult.value as Program,
      document
    };
  }

  // Liefert alle Fehlerdiagnosen eines Dokuments.
  function errorDiagnostics(document: LangiumDocument) {
    return (document.diagnostics ?? []).filter(d => d.severity === 1);
  }

  // Prüft, dass keine Fehlerdiagnosen vorhanden sind.
  function assertNoErrors(document: LangiumDocument): void {
    const errors = errorDiagnostics(document);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  // Sucht den ersten Knoten eines bestimmten Typs.
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

  // Prüft, dass an einem Knoten mindestens eine Fehlerdiagnose hängt.
  async function assertAnyErrorOnNode<T extends AstNode>(
    input: string,
    guard: (node: AstNode) => node is T
  ) {
    const { model, document } = await parseModel(input);
    const target = firstNodeOfType(model, guard);

    expect(target).toBeTruthy();

    const targetRange = (target as AstNode).$cstNode?.range;
    const errors = errorDiagnostics(document);

    const matching = errors.filter(d => {
      if (!targetRange || !d.range) {
        return true;
      }
      return rangesOverlap(targetRange, d.range);
    });

    expect(matching.length).toBeGreaterThan(0);
  }

  // Prüft, ob sich zwei Ranges überlappen.
  function rangesOverlap(
    a: { start: { line: number; character: number }; end: { line: number; character: number } },
    b: { start: { line: number; character: number }; end: { line: number; character: number } }
  ): boolean {
    const aStart = a.start.line * 100000 + a.start.character;
    const aEnd = a.end.line * 100000 + a.end.character;
    const bStart = b.start.line * 100000 + b.start.character;
    const bEnd = b.end.line * 100000 + b.end.character;

    return aStart <= bEnd && bStart <= aEnd;
  }

  test('functions1', async () => {
    // Testet, dass eine lokale Variable denselben Namen wie die Funktion tragen darf.
    const { document } = await parseModel(`
      func a()
        a = 4
        var a = 4

      var a = 5
    `);

    assertNoErrors(document);
  });

  test('functions2', async () => {
    // Testet, dass globale Variable und Funktion denselben Namen tragen können.
    const { document } = await parseModel(`
      var a = 0

      func a()
        print("bla")
        a = 4
      //  var a = 1
    `);

    assertNoErrors(document);
  });

  test('functions3', async () => {
    // Testet, dass ein Parameter denselben Namen wie die Funktion tragen darf.
    const { document } = await parseModel(`
      func a(a)
        a = 4
    `);

    assertNoErrors(document);
  });

  test('functions4', async () => {
    // Testet einen Array-Parameter mit Längenparameter und Zugriffen auf beide Namen.
    const { document } = await parseModel(`
      func a(a[1..n])
        var k = 1
        n = 4
        a[1] = 1 * n
    `);

    assertNoErrors(document);
  });

  test('forLoops1', async () => {
    // Testet korrektes Scoping des Schleifenparameters in einer for-Schleife.
    const { document } = await parseModel(`
      var l = 3
      for j = 2 to l
        l = j
        l = j + 1
    `);

    assertNoErrors(document);
  });

  test('forLoops2', async () => {
    // Testet, dass ein nicht deklarierter Name im for-Kopf einen Linking-Fehler auslöst.
    await assertAnyErrorOnNode(`
      for 1 to l
        var j = 2
    `, isVarRef);
  });

  test('forLoops3', async () => {
    // Testet, dass der Schleifenparameter außerhalb der Schleife nicht sichtbar ist.
    const { document } = await parseModel(`
      var l = 0
      for k = 0 to l
        var j = 2

      k = 4
    `);

    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    const messages = errors.map(d => d.message);

    expect(
      messages.some(m =>
        m.includes('Could not resolve reference') ||
        m.includes('Unbekannte Variable')
      )
    ).toBe(true);
  });

  test('forLoops4', async () => {
    // Testet geschachtelte for-Schleifen und Nutzung äußerer Variablen.
    const { document } = await parseModel(`
      var l = 0
      for k = 0 to l
        var j = 2
        for 1 to l
          var h = 4
        for 1 to 5
          j = 5
    `);

    assertNoErrors(document);
  });

  test('forLoops5', async () => {
    // Testet eine for-Schleife ohne expliziten Iterator mit Nutzung einer äußeren Variable.
    const { document } = await parseModel(`
      var j = 0

      for 1 to 5
        j = j
        j = j + 1
    `);

    assertNoErrors(document);
  });

  test('forLoops6', async () => {
    // Testet den Fall, dass die nachfolgende Zeile als Schleifenrumpf interpretiert wird.
    const { document } = await parseModel(`
      var j = 0

      for 1 to 5
        // do nothing
        print j  // However, print j is executed as loop body
    `);

    assertNoErrors(document);
  });

  test('forLoops7', async () => {
    // Testet, dass ein leerer Schleifenrumpf mit Leerzeile möglich ist.
    const { document } = await parseModel(`
      var j = 0

      for 1 to 5{
        // do nothing
      }
      print j  // OK, Empty loop body is possible by inserting an empty line
    `);

    assertNoErrors(document);
  });

  test('scoping1', async () => {
    // Testet das Scoping des Längenparameters n innerhalb einer Funktion mit Array-Parameter.
    const { document } = await parseModel(`
      func max( A[1..n] )
        for i = 2 to n
          print "" + i + n + A[1]
          n = 2
          A[i] = 2 * n * i
          var k = 2 * n + A[2 * n]
        return 2
    `);

    assertNoErrors(document);
  });

  test('scoping2', async () => {
    // Testet Array-Scoping: eine Funktion greift auf eine globale Array-Variable zu.
    const { document } = await parseModel(`
      func helloWorld()
        print(a[1])

      var a[1] = 2
      helloWorld()
    `);

    assertNoErrors(document);
  });

  test('scoping3', async () => {
    // Testet Scalar-Scoping: eine Funktion greift auf eine globale skalare Variable zu.
    const { document } = await parseModel(`
      func hello_world()
        print(a)

      var a = 2
    `);

    assertNoErrors(document);
  });

  test('ifThen1', async () => {
    // Testet ein normales if-else mit nachfolgender Anweisung.
    const { document } = await parseModel(`
      if 3 < 6
        print "then"
      else
        print "else"
      print "after if"
    `);

    assertNoErrors(document);
  });

  test('ifThen2', async () => {
    // Testet einen leeren then-Zweig mit else-Zweig.
    const { document } = await parseModel(`
      if 3 < 6 
        //print "then"   // an empty body requires an empty line
      {}
      else
        print "else"
      
      print "after if"
    `);

    assertNoErrors(document);
  });

  test('ifThen3', async () => {
    // Testet leere then- und else-Zweige mit nachfolgender Anweisung.
    const { document } = await parseModel(`
      if 3 < 6
        //print "then"   // an empty body requires an empty line
      {}
      else
        //print "else"
      {}
      print "after if"
    `);

    assertNoErrors(document);
  });
});