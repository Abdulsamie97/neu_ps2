/**
 * @file ParsingLectADK.test.ts
 * @brief Prüft die portierten ADK-Lehrbeispiele gegen die aktuelle Pseudo2-Grammatik.
 *
 * Die Suite deckt Variablen, Ausdrücke, Arrays, Kontrollfluss, Funktionen und
 * ausgewählte Struct-Konstrukte anhand kleiner vollständiger Programme ab.
 *
 * @author Abdul
 */

import { describe, test, expect } from 'vitest';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

/** Parsing-Suite der an die aktuelle Syntax angepassten ADK-Beispiele. */
describe('ParsingTests_LectADK', () => {
  /** Fortlaufende Nummer für eindeutige ADK-Testdokumente. */
  let docCounter = 0;

  // Entfernt gemeinsame führende Einrückung aus Template-Strings.
  /**
   * Normalisiert die gemeinsame Einrückung eingebetteter ADK-Programme.
   * @param text Eingerückter Template-String.
   * @returns Parsebarer Pseudo2-Quelltext.
   */
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
  /**
   * Parst und validiert ein ADK-Testprogramm in einem In-Memory-Dokument.
   * @param text Pseudo2-Quelltext.
   * @returns Program-AST und Dokument mit Diagnosen.
   */
  async function parseModel(text: string): Promise<{ model: Program; document: LangiumDocument }> {
    const services = createPseudo2Services(EmptyFileSystem);
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;

    const uri = URI.parse(`memory:/lect-adk-test-${docCounter++}.pseudo2`);
    const document: LangiumDocument = documentFactory.fromString(dedent(text), uri);

    await documentBuilder.build([document], { validation: true });

    return {
      model: document.parseResult.value as Program,
      document
    };
  }

  // Prüft, dass keine Fehlerdiagnosen im Dokument vorhanden sind.
  /** @param document Validiertes Dokument, das keine Fehlerdiagnosen enthalten darf. */
  function assertNoErrors(document: LangiumDocument): void {
    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  test('help_array1', async () => {
    // Testet ein einfaches Array-Literal aus zwei Zahlen.
    const { document } = await parseModel(`
      var a = [4, 45]
    `);

    assertNoErrors(document);
  });

  test('l4_p5_sum', async () => {
    // Testet das Summenbeispiel aus der Vorlesung mit for-Schleife und mehreren returns.
    const { document } = await parseModel(`
      func sum ( A[1..n] )
        var s = 0
        for i = 1 to n
          //s = s + A[4]
          s = s + 3
        return s
        return 25
        var k = 5
    `);

    assertNoErrors(document);
  });

  test('l4_p7_max', async () => {
    // Testet das Maximum-Beispiel mit Arrayzugriffen und if innerhalb einer Schleife.
    const { document } = await parseModel(`
      func max( A[1..n] )
        var x = A[1]
        for i = 2 to n
          // hier ist x das max. von A[1] … bis A[i-1]
          if A[i] > x
            x = A[i]
          // hier ist x das max. von A[1] … bis A[i]
        return  x
    `);

    assertNoErrors(document);
  });

  test('l4_p8_maxi', async () => {
    // Testet das Maxi-Beispiel mit Indexverfolgung des größten Elements.
    const { document } = await parseModel(`
      func maxi( A[1..n] )
        var i = 1
        for j = 2 to n
          if A[j] > A[i]
            i = j
        return i
    `);

    assertNoErrors(document);
  });

  test('l4_p9_tausche', async () => {
    // Testet die Tauschfunktion mit Arrayzugriffen und temporärer Variable.
    const { document } = await parseModel(`
      func tausche( A[1..n], i, j )
        var t = A[i]
        A[i] = A[j]
        A[j] = t
    `);

    assertNoErrors(document);
  });

  test('l4_p9_applyTausche', async () => {
    // Testet die Anwendung der Tauschfunktion auf ein manuell befülltes Array.
    const { document } = await parseModel(`
      func tausche( A[1..n], i, j )
        var t = A[i]
        A[i] = A[j]
        A[j] = t

      //var A = [9, 12, 8 , 5]
      var A[4] = 1
      A[1] = 9
      A[2] = 12
      A[3] = 8
      A[4] = 5

      tausche(A, 2, 3)
    `);

    assertNoErrors(document);
  });

  test('l4_p10_max1', async () => {
    // Testet mehrere Funktionsdefinitionen zusammen: maxi, tausche und max1.
    const { document } = await parseModel(`
      func maxi( A[1..n] )
        var i = 1
        for j = 2 to n
          if A[j] > A[i]
            i = j
        return i

      func tausche( A[1..n], i, j )
        var t = A[i]
        A[i] = A[j]
        A[j] = t

      func max1( A[1..n] )
        var i = maxi( A )
        tausche( A, 1, i )
    `);

    assertNoErrors(document);
  });

  test('l2_p3_quadErgaenzen', async () => {
    // Testet das Beispiel zur quadratischen Ergänzung inklusive Hilfsfunktion sqrt.
    const { document } = await parseModel(`
      //TODO: provide by library??
      func sqrt(x)
        return x

      func quadErgaenzen( a, b)
        var p = a / 2
        var q = p ^2
        var x1_quad = b + q
        var x1 = sqrt(x1_quad)
        var x = x1 - p
        return x
    `);

    assertNoErrors(document);
  });

  test('l2_p7_ggT', async () => {
    // Testet das ggT-Beispiel mit while-Schleife und nachfolgendem Funktionsaufruf.
    const { document } = await parseModel(`
      func ggT( a, b)
        while a != b
          if a > b
            a = a - b
          else
            b = b - a
        return a

      ggT(12, 44) // expected 4 as result
    `);

    assertNoErrors(document);
  });

  test('l2_p23_Summe', async () => {
    // Testet das Summenbeispiel mit einfacher for-Schleife.
    const { document } = await parseModel(`
      func Summe( n )
        var s = 0
        for i = 1 to n
          s = s + i
        return s
    `);

    assertNoErrors(document);
  });

  test('l2_p24_WSumme', async () => {
    // Testet die while-basierte Summenfunktion.
    const { document } = await parseModel(`
      func WSumme( n )
        var s = 0
        var i = 1
        while  i <=  n
          s = s + i
          i = i + 1

        return s
    `);

    assertNoErrors(document);
  });

  test('l2_p25_QuadratSumme', async () => {
    // Testet die Quadratsummenfunktion mit innerer Hilfsvariable in der Schleife.
    const { document } = await parseModel(`
      func QuadratSumme( n )
        var s = 0
        for i = 1 to n
          var j = i * i
          s = s + j

        return s
    `);

    assertNoErrors(document);
  });

  test('l2_p29_Collatz', async () => {
    // Testet das Collatz-Beispiel mit while, if und Kommentaren.
    const { document } = await parseModel(`
      // TODO: next line would raise error (culprit: comment at the end)
      //func Collatz( n )   // n > 0
      func Collatz( n )
        while n > 1
          //if n mod 2 == 0 //ist gerade
          if n mod 2 == 0
            n = n / 2
          else
            n = 3 * n + 1
        return n
    `);

    assertNoErrors(document);
  });

  test('wikipedia_InsertionSort', async () => {
    // Testet das Insertion-Sort-Beispiel aus Wikipedia in der angepassten Pseudo2-Syntax.
    const { document } = await parseModel(`
      func Insertion_Sort(A[1..n])
        for j=2 to n
          var schluessel=A[j]
          //füge A[j] in den sortierten Beginn des Arrays A[1..j-1] ein
          var i=j-1
          // schlüssel ist kein Identifier bei uns
          while i>0 && A[i]>schluessel
            A[i+1]=A[i]
            i=i-1
          A[i+1]=schluessel
    `);

    assertNoErrors(document);
  });
});
