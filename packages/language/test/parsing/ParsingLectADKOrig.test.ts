import { describe, test, expect } from 'vitest';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

describe('ParsingTests_LectADKOrig', () => {
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

    const uri = URI.parse(`memory:/lect-adk-orig-test-${docCounter++}.pseudo2`);
    const document: LangiumDocument = documentFactory.fromString(dedent(text), uri);

    await documentBuilder.build([document], { validation: true });

    return {
      model: document.parseResult.value as Program,
      document
    };
  }

  // Prüft, dass keine Fehlerdiagnosen im Dokument vorhanden sind.
  function assertNoErrors(document: LangiumDocument): void {
    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  test('justFirst', async () => {
    const { document } = await parseModel(`
      var a = 5
    `);

    // Minimaler Initialisierungstest
    assertNoErrors(document);
  });

  //
  // Code used by the original slides of ADK from F. Bauernöppel.
  //
  // This syntax is outdated and not supported anymore by pseudo2.
  // The tests stay commented out and are kept only for the purpose of posterity.
  //

  /*
  test('l4_p5_sum', async () => {
    const { document } = await parseModel(`
      sum ( A[1..n]):
        s = 0
        for i = 1 to n
          s = s + A[i]
        return s
    `);
    assertNoErrors(document);
  });

  test('l4_p7_max', async () => {
    const { document } = await parseModel(`
      max( A[1..n] ):
        x = A[1]
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
    const { document } = await parseModel(`
      maxi( A[1..n] ):
        i = 1
        for j = 2 to n
          if A[j] > A[i]
            i = j
        return i
    `);
    assertNoErrors(document);
  });

  test('l4_p9_tausche', async () => {
    const { document } = await parseModel(`
      tausche( A[1..n], i, j ):
        t = A[i]
        A[i] = A[j]
        A[j] = t
    `);
    assertNoErrors(document);
  });

  test('l4_p9_applyTausche', async () => {
    const { document } = await parseModel(`
      A = [9, 12, 8 , 5]
      tausche(A, 2, 3)
    `);
    assertNoErrors(document);
  });

  test('l4_p10_max1', async () => {
    const { document } = await parseModel(`
      max1( A[1..n] ):
        i = maxi( A )
        tausche( A, 1, i )
    `);
    assertNoErrors(document);
  });

  test('l2_p3_quadErgaenzen', async () => {
    const { document } = await parseModel(`
      quadErgaenzen( a, b):
        p = a / 2
        q = p ^2
        x1_quad = b + q
        x1 = sqrt(x1_quad)
        x = x1 - p
        return x
    `);
    assertNoErrors(document);
  });

  test('l2_p7_ggT', async () => {
    const { document } = await parseModel(`
      ggT( a, b):
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
    const { document } = await parseModel(`
      Summe( n ):
        s = 0
        for i = 1 to n
          s = s + i
        return s
    `);
    assertNoErrors(document);
  });

  test('l2_p24_WSumme', async () => {
    const { document } = await parseModel(`
      WSumme( n ):
        s = 0
        i = 1
        while  i <=  n
          s = s + i
          i = i + 1

        return s
    `);
    assertNoErrors(document);
  });

  test('l2_p25_QuadratSumme', async () => {
    const { document } = await parseModel(`
      QuadratSumme( n ):
        s = 0
        for i = 1 to n
          j = i * i
          s = s + j

        return s
    `);
    assertNoErrors(document);
  });

  test('l2_p29_Collatz', async () => {
    const { document } = await parseModel(`
      Collatz( n ):   // n > 0
        while n > 1
        if n mod 2 == 0 //ist gerade
          n = n / 2
        else
          n = 3 * n + 1

        return n
    `);
    assertNoErrors(document);
  });

  // see https://de.wikipedia.org/wiki/Pseudocode
  test('wikipedia_InsertionSort', async () => {
    const { document } = await parseModel(`
      Insertion_Sort(A[1..n]):
         for j=2 to n
            schluessel=A[j]
            //füge A[j] in den sortierten Beginn des Arrays A[1..j-1] ein
            i=j-1
            while i>0 und A[i]>schluessel   // schlüssel ist kein Identifier bei uns
               A[i+1]=A[i]
               i=i-1
            A[i+1]=schluessel
    `);
    assertNoErrors(document);
  });
  */
});