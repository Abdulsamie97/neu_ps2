import { describe, test, expect } from 'vitest';
import { AstUtils, EmptyFileSystem, URI, type AstNode, type LangiumDocument } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import {
  //isVarDecl,
  isFunctionCall
} from '../../src/generated/ast.js';

import { createPseudo2Services } from '../../src/pseudo2-module.js';
import {
  INCOMPATIBLE_TYPES
} from '../../src/pseudo2-validator.js';

describe('ParsingTests_LandingPageDoc', () => {
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

    const uri = URI.parse(`memory:/landing-page-doc-test-${docCounter++}.pseudo2`);
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

  // Sammelt alle Knoten eines bestimmten Typs.
  /*function allNodesOfType<T extends AstNode>(
    root: AstNode,
    guard: (node: AstNode) => node is T
  ): T[] {
    const result: T[] = [];

    if (guard(root)) {
      result.push(root);
    }

    for (const n of AstUtils.streamAllContents(root)) {
      if (guard(n)) {
        result.push(n);
      }
    }

    return result;
  }*/

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

  // Prüft, dass an einem Knoten mindestens eine Fehlerdiagnose mit passendem Code auftritt.
  async function assertErrorCodeOnNode<T extends AstNode>(
    input: string,
    guard: (node: AstNode) => node is T,
    expectedCode: string
  ) {
    const { model, document } = await parseModel(input);
    const target = firstNodeOfType(model, guard);

    expect(target).toBeTruthy();

    const targetRange = (target as AstNode).$cstNode?.range;
    const errors = errorDiagnostics(document);

    const matching = errors.filter(d => {
      const sameCode = String(d.code ?? '') === String(expectedCode);
      if (!sameCode) {
        return false;
      }

      if (!targetRange || !d.range) {
        return sameCode;
      }

      return rangesOverlap(targetRange, d.range);
    });

    expect(matching.length).toBeGreaterThan(0);
  }

  // Prüft, dass an irgendeinem passenden Knoten mindestens eine Fehlerdiagnose
  // mit passendem Nachrichtenteil auftritt.
 /* async function assertErrorMessageOnNode<T extends AstNode>(
    input: string,
    guard: (node: AstNode) => node is T,
    messagePart: string
  ) {
    const { model, document } = await parseModel(input);
    const targets = allNodesOfType(model, guard);

    expect(targets.length).toBeGreaterThan(0);

    const errors = errorDiagnostics(document);

    const matching = errors.filter(d => {
      const sameMessage = d.message.includes(messagePart);
      if (!sameMessage) {
        return false;
      }

      if (!d.range) {
        return true;
      }

      return targets.some(target => {
        const targetRange = target.$cstNode?.range;
        if (!targetRange) {
          return false;
        }
        return rangesOverlap(targetRange, d.range!);
      });
    });

    expect(matching.length).toBeGreaterThan(0);
  }*/

  test('hw1', async () => {
    // Testet zwei print-Anweisungen auf getrennten Zeilen.
    const { document } = await parseModel(`
      print("hello")
      print("world")  //one instruction per line :-)
    `);

    assertNoErrors(document);
  });

  test('hw2', async () => {
    // Testet mehrere Anweisungen in einer Zeile wie im Landing-Page-Beispiel.
    const { document } = await parseModel(`
      print("hello")   print("world")  //multiple instructions per line :-(
    `);

    assertNoErrors(document);
  });

  test('euklid', async () => {
    // Testet das Euklid-Beispiel mit while, if/else und String-Verkettung.
    const { document } = await parseModel(`
      var a = 44  // set the first value
      var b = 12  // set the second value

      // saving the original values
      var a_orig = a
      var b_orig = b

      // start the algorithm
      while a != b
          if a>b
              a = a-b
          else
              b = b-a

      print "the greatest common divisor of " + a_orig + " and " + b_orig + " is " + a
    `);

    assertNoErrors(document);
  });

  test('euklid1', async () => {
    // Testet Bedingungen in while und if mit zusätzlichen Klammern.
    const { document } = await parseModel(`
      var a = 44  // set the first value
      var b = 12  // set the second value

      // saving the original values
      var a_orig = a
      var b_orig = b

      // start the algorithm
      while (a != b)
          if (((a>b)))
              a = a-b
          else
              b = b-a

      print "the greatest common divisor of " + a_orig + " and " + b_orig + " is " + a
    `);

    assertNoErrors(document);
  });

  test('comment1', async () => {
    // Testet einzeilige Kommentare.
    const { document } = await parseModel(`
      // this is a comment
      var a = 5   // this is another comment
    `);

    assertNoErrors(document);
  });

  test('comment2', async () => {
    // Testet, dass Kommentarzeichen innerhalb eines Strings kein Kommentar sind.
    const { document } = await parseModel(`
      print(" this is NOT // a comment")
    `);

    assertNoErrors(document);
  });

  test('comment3', async () => {
    // Testet Blockkommentare.
    const { document } = await parseModel(`
      /* var a = 44  // set the first value
      var b = 12  // set the second value
      */

      // another setting
      var a = 36
      var b = 8
    `);

    assertNoErrors(document);
  });

  test('comment4', async () => {
    // Testet, dass Blockkommentarzeichen innerhalb eines Strings kein Kommentar sind.
    const { document } = await parseModel(`
      print(" this is NOT /* a comment")
    `);

    assertNoErrors(document);
  });

  test('varDeclaration1', async () => {
    // Testet eine einfache Variablendeklaration mit anschließendem print.
    const { document } = await parseModel(`
      var x = 5 / 2
      print(x)
    `);

    assertNoErrors(document);
  });

  test('varDeclaration2', async () => {
    const { document } = await parseModel(`
      var x = 5 / 2
      print(x)
      var x = 35
      print(x)
    `);

    // Testet doppelte Variablendeklaration im selben globalen Block.
    // In der aktuellen Langium-Semantik ist das erlaubt:
    // - es darf kein Fehler entstehen
    // - aber es soll eine Warnung für die doppelte lokale Variable geben
    assertNoErrors(document);

    const warnings = (document.diagnostics ?? []).filter(d => d.severity === 2);
    expect(
      warnings.some(w => w.message.includes('Doppelte lokale Variable'))
    ).toBe(true);
  });

  test('varDeclaration3', async () => {
    const { document } = await parseModel(`
      func f()
        var x = 5 / 2
        print x
        var x = 35
        print x
    `);

    // Testet doppelte Variablendeklaration im selben Funktionsblock.
    // In der aktuellen Langium-Semantik ist das erlaubt:
    // - es darf kein Fehler entstehen
    // - aber es soll eine Warnung für die doppelte lokale Variable geben
    assertNoErrors(document);

    const warnings = (document.diagnostics ?? []).filter(d => d.severity === 2);
    expect(
      warnings.some(w => w.message.includes('Doppelte lokale Variable'))
    ).toBe(true);
  });

  test('atomicVar', async () => {
    // Testet skalare Variable, Parameter und Funktionsaufruf.
    const { document } = await parseModel(`
      var x = 5
      print x
      func f(arg)
          print arg
      f(27)
    `);

    assertNoErrors(document);
  });

  test('stringLit', async () => {
    // Testet String-Literale mit doppelten und einfachen Anführungszeichen.
    const { document } = await parseModel(`
      print "this is a string"
      print 'this is another string'
    `);

    assertNoErrors(document);
  });

  test('intLit', async () => {
    // Testet Ganzzahl-Literale inklusive führender Nullen.
    const { document } = await parseModel(`
      var x = 25
      print(x)
      x = 000025
      print(x) // also prints 25
    `);

    assertNoErrors(document);
  });

  test('floatLit', async () => {
    // Testet numerische Ausdrücke mit Division und Potenz.
    const { document } = await parseModel(`
      var x = 7/10
      print(x)
      var y = 2 ^ (1/2)
      print(y)
    `);

    assertNoErrors(document);
  });

  test('booleanLit', async () => {
    // Testet boolesche Literale.
    const { document } = await parseModel(`
      var x = true
      print x
      var y = false
      print y
    `);

    assertNoErrors(document);
  });

  test('typeNumTestOnInteger', async () => {
    // Testet Ganzzahligkeit über mod 1.
    const { document } = await parseModel(`
      var x = 5
      print x mod 1 == 0  // prints true
      x = 5/2
      print x mod 1 == 0  // prints false
    `);

    assertNoErrors(document);
  });

  test('typeStringEscapeBackslash', async () => {
    // Testet Escape-Sequenzen bzw. Backslashes in Strings.
    const { document } = await parseModel(`
      var x = "first line \\\\nsecond line"
      print x
    `);

    assertNoErrors(document);
  });

  test('typeBoolNoConversion', async () => {
    // Testet, dass ein num-Rückgabewert nicht als bool-Bedingung verwendet werden darf.
    await assertErrorCodeOnNode(`
      func m()
          return 0

      if m()  // Syntax error

          print "yes"
    `, isFunctionCall, INCOMPATIBLE_TYPES);
  });

  test('typeStructExample1', async () => {
    // Testet ein einfaches Struct-Beispiel mit rekursivem Attribut.
    const { document } = await parseModel(`
      struct person
          num age
          string name
          person mother

      var p = new person
      p.age = 5
      p.mother = p

      print p.age
      print p.mother.age
    `);

    assertNoErrors(document);
  });

  test('structLimitation1', async () => {
    // Testet das Struct-Beispiel aus der Landing-Page-Dokumentation.
    const { document } = await parseModel(`
      struct person
          num age
          string name
          person mother

      var p = new person
      p.age = 5
      p.mother = p

      print p.age
      print p.mother.age
    `);

    assertNoErrors(document);
  });

  test('structLimitation2', async () => {
    // Testet Structs in Arrays und Attributzugriff auf Array-Elemente.
    const { document } = await parseModel(`
      struct person
          num age
          string name
          person mother

      var p = new person
      p.age = 5
      var A[5] = p

      for i=1 to 5
          print A[i].age  // Syntax error :-(
    `);

    assertNoErrors(document);
  });

  test('structLimitation4', async () => {
    // Testet den Umweg über eine Hilfsvariable bei Structs in Arrays.
    const { document } = await parseModel(`
      struct person
          num age
          string name
          person mother

      var p = new person
      p.age = 5
      var A[5] = p

      var s = new person
      for i=1 to 5
          s = A[i]
          print s.age  // no syntax error :-)

    `);

    assertNoErrors(document);
  });
});