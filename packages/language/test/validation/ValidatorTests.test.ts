import { describe, test, expect } from 'vitest';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';
import {
  INCOMPATIBLE_TYPES,
  INCOMPATIBLE_TYPES_EQ,
  VAR_DECL_NO_NESTED_ARRAY,
  DIFFERENT_TYPES_OF_RETURNS,
  DIFFERENT_KINDS_OF_RETURNS,
  PRINT_EXPECTS_BASE_TYPE,
  DUPLICATE_ELEMENT,
  FUNC_DECL_ONLY_GLOBAL,
  METH_DECL_ONLY_IN_STRUCT,
  FUNC_CALL_RIGHT_PARANUM,
  FUNC_CALL_ACTUALPARA_CONFORMSTO_FORMALPARA,
  CONSISTENT_ARRAY_TYPE_OF_PARA,
  VAR_DECL_NO_INIT_WITH_EMPTY_ARRAY,
  VAR_DECL_NO_INIT_WITH_NULL,
  ASSIGNED_TO_LOOPVAR,
  ARRAY_ACCESS_ON_PLAIN_TYPE
} from '../../src/pseudo2-validator.js';

describe('ValidatorTests', () => {
  let docCounter = 0;

  // Entfernt gemeinsame führende Einrückung aus Template-Strings.
  function dedent(text: string): string {
    const lines = text.replace(/\r/g, '').split('\n');

    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

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

    const uri = URI.parse(`memory:/validator-test-${docCounter++}.pseudo2`);
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

  // Liefert alle Warnungen eines Dokuments.
  function warningDiagnostics(document: LangiumDocument) {
    return (document.diagnostics ?? []).filter(d => d.severity === 2);
  }

  // Prüft, dass keine Fehlerdiagnosen vorhanden sind.
  function assertNoErrors(document: LangiumDocument): void {
    const errors = errorDiagnostics(document);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  // Prüft, dass mindestens ein Fehler vorhanden ist.
  function assertHasAnyError(document: LangiumDocument): void {
    expect(errorDiagnostics(document).length).toBeGreaterThan(0);
  }

  // Prüft, dass mindestens eine Warnung vorhanden ist.
  /*function assertHasAnyWarning(document: LangiumDocument): void {
    expect(warningDiagnostics(document).length).toBeGreaterThan(0);
  }*/

  // Prüft, dass ein Fehlercode vorkommt.
  function assertHasErrorCode(document: LangiumDocument, expectedCode: string): void {
    const codes = errorDiagnostics(document).map(d => String(d.code ?? ''));
    expect(codes).toContain(expectedCode);
  }

  // Prüft, dass eine Fehlermeldung einen bestimmten Text enthält.
  /*function assertHasErrorMessage(document: LangiumDocument, messagePart: string): void {
    const messages = errorDiagnostics(document).map(d => d.message);
    expect(messages.some(m => m.includes(messagePart))).toBe(true);
  }*/

  // Prüft, dass eine Warnung einen bestimmten Text enthält.
  function assertHasWarningMessage(document: LangiumDocument, messagePart: string): void {
    const messages = warningDiagnostics(document).map(d => d.message);
    expect(messages.some(m => m.includes(messagePart))).toBe(true);
  }

  // Prüft auf eine typische Linking-/Unbekannt-Referenz-Fehlermeldung.
  function assertHasLinkingLikeError(document: LangiumDocument): void {
    const messages = errorDiagnostics(document).map(d => d.message);
    expect(
      messages.some(m =>
        m.includes('Could not resolve reference') ||
        m.includes('Unbekannte Variable') ||
        m.includes('Unbekannte Funktion') ||
        m.includes('Unbekanntes Attribut') ||
        m.includes('Unbekannte Methode')
      )
    ).toBe(true);
  }

  test('doubleFuncDecl', async () => {
    // Testet doppelte globale Funktionsdeklaration.
    const { document } = await parseModel(`
      var a = true
      func m(a)
        print ("blub")
      var b = 3
      func m(k, i)
        print("bla")
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('doubleParameter', async () => {
    // Testet doppelte Parameternamen in derselben Funktion.
    const { document } = await parseModel(`
      var a = true
      func me(k, i, j, i)
        print("bla")
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('sameVariableAsParameter', async () => {
    // Testet Variable mit gleichem Namen wie ein Parameter.
    const { document } = await parseModel(`
      var a = true
      func m(k, i)
        var i = 7
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('doubleVariableWithinFunction', async () => {
    // Testet doppelte lokale Variable im selben Block.
    // In der aktuellen Langium-Variante ist das erlaubt und gibt nur eine Warnung.
    const { document } = await parseModel(`
      var a = true
      func m(k, i)
        var l = 7
        print("bla")
        var l = 3
    `);

    assertNoErrors(document);
    assertHasWarningMessage(document, 'Doppelte lokale Variable');
  });

  test('doubleGlobalVariableV1', async () => {
    // Testet doppelte globale Variable im selben Block.
    // In der aktuellen Langium-Variante ist das erlaubt und gibt nur eine Warnung.
    const { document } = await parseModel(`
      var a = true
      func m()
        return 4
      var a = 3
    `);

    assertNoErrors(document);
    assertHasWarningMessage(document, 'Doppelte lokale Variable');
  });

  test('doubleGlobalVariableV2', async () => {
    // Testet den alten Grenzfall mit if-Block und späterer globaler Variable.
    // In Langium ist hier vor allem die Referenz auf "a" in der if-Bedingung kritisch.
    const { document } = await parseModel(`
      if a
        var a = false
      else
        var b = true

      var a = 3
    `);

    assertHasAnyError(document);
  });

  test('globalAndLocalVariable', async () => {
    // Testet gleichnamige globale und lokale Variable in unterschiedlichen Scopes.
    const { document } = await parseModel(`
      func m()
        var a = 5
        return 4
      var a = 3
      print m()
    `);

    assertNoErrors(document);
  });

  test('doubleStructDecl', async () => {
    // Testet doppelte Struct-Deklaration.
    const { document } = await parseModel(`
      struct s
        num x
      struct s
        num y
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('sameStructElemInDifferentStructs', async () => {
    // Testet gleichnamige Elemente in verschiedenen Structs.
    const { document } = await parseModel(`
      struct s1
        num x
      struct s
        num x
    `);

    assertNoErrors(document);
  });

  test('doubleStructElementsV1', async () => {
    // Testet doppelte Attribute im selben Struct.
    const { document } = await parseModel(`
      struct s
        num x
        string x
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('doubleStructElementsV2', async () => {
    // Testet Attribut und Methode mit gleichem Namen im selben Struct.
    const { document } = await parseModel(`
      struct s
      {
        num x
        x()
          return 24
      }
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('doubleStructElementsV3', async () => {
    // Testet doppelte Methoden im selben Struct.
    const { document } = await parseModel(`
      struct s
        x()
          return 24
        num y
        x()
          return 24
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('varRef1', async () => {
    // Testet einfache Variablenreferenzen in einer booleschen Bedingung.
    const { document } = await parseModel(`
      var a = true
      var b = false
      if (a && b)
          var k = 4
    `);

    assertNoErrors(document);
  });

  test('cyclicVarDecl', async () => {
    // Testet zyklische Variablendeklaration.
    const { document } = await parseModel(`
      var a = b
      var b = a
    `);

    assertHasLinkingLikeError(document);
  });

  test('arrayAccessNum', async () => {
    // Testet normalen Arrayzugriff auf ein num-Array.
    const { document } = await parseModel(`
      var A[4] = 3
      var b = 12

      var k = A[2]
      print( k != b )
    `);

    assertNoErrors(document);
  });

  test('arrayAccessInFunction', async () => {
    // Testet Arrayzugriff innerhalb einer Funktion.
    const { document } = await parseModel(`
      func sum( A[1..n] )
        var s = 0
        s = s + A[3]
        return s
    `);

    assertNoErrors(document);
  });

  test('arrayAssignment_EmptyLitOK', async () => {
    // Testet Zuweisung eines leeren Array-Literals an ein bestehendes Array.
    const { document } = await parseModel(`
      var A[5] = 3
      A = []
    `);

    assertNoErrors(document);
  });

  test('arrayAccess_PlainVar', async () => {
    // Testet Arrayzugriff auf eine normale Variable.
    const { document } = await parseModel(`
      var A = 3
      var b = A[5]
    `);

    assertHasErrorCode(document, ARRAY_ACCESS_ON_PLAIN_TYPE);
  });

  test('arrayDecvl_EmptyLitWrong', async () => {
    // Testet unzulässige Initialisierung nur mit leerem Array-Literal.
    const { document } = await parseModel(`
      var A = []
    `);

    assertHasErrorCode(document, VAR_DECL_NO_INIT_WITH_EMPTY_ARRAY);
  });

  test('functionIsGlobal', async () => {
    // Testet normale globale Funktion.
    const { document } = await parseModel(`
      var a = 5
      func bla()
        print( 'blub' )
    `);

    assertNoErrors(document);
  });

  test('functionIsNested', async () => {
    // Testet verschachtelte Funktion.
    const { document } = await parseModel(`
      var a = 5
      func bla()
      {
        print( 'blub' )
        func blub()
          print("hello")
      }
    `);

    assertHasErrorCode(document, FUNC_DECL_ONLY_GLOBAL);
  });

  test('methodIsLocal', async () => {
    // Testet Methode innerhalb eines Structs.
    const { document } = await parseModel(`
      struct person
        num age
        birthday()
          return 25

      var a = new person
    `);

    assertNoErrors(document);
  });

  test('methodNotGlobal', async () => {
    // Testet eine Methodensyntax außerhalb eines Structs.
    const { document } = await parseModel(`
      var a = 5
      bla()
        print( 'blub' )
    `);

    assertHasErrorCode(document, METH_DECL_ONLY_IN_STRUCT);
  });

  test('methodNotNested', async () => {
    // Testet eine verschachtelte Methodensyntax innerhalb einer Funktion.
    const { document } = await parseModel(`
      var a = 5
      func bla()
        print( 'blub' )
        blub()
          print("hello")
    `);

    assertHasErrorCode(document, METH_DECL_ONLY_IN_STRUCT);
  });

  test('functionWithoutReturn', async () => {
    // Testet Funktion ohne Return-Wert.
    const { document } = await parseModel(`
      func bla()
        print( 'blub' )
    `);

    assertNoErrors(document);
  });

  test('functionCallWithWrongParaNumber', async () => {
    // Testet Funktionsaufruf mit zu vielen Argumenten.
    const { document } = await parseModel(`
      func bla(x)
        print( 'blub' + x)

      bla("Hello", "bug")
    `);

    assertHasErrorCode(document, FUNC_CALL_RIGHT_PARANUM);
  });

  test('functionWithDifferentReturnKinds', async () => {
    // Testet Mischung von return mit und ohne Wert.
    const { document } = await parseModel(`
      func bla(x)
        var y = 4
        if x < 2
          return
        else
          return('bla')
        x = 25

      bla(5)
    `);

    assertHasErrorCode(document, DIFFERENT_KINDS_OF_RETURNS);
  });

  test('functionWithMultipleReturns1', async () => {
    // Testet mehrere Returns mit kompatiblen num-Typen.
    const { document } = await parseModel(`
      func bla(x)
        var y = 4
        if x < 2
          return 5
        else
          return y + 23
        x = 25

      bla(5)
    `);

    assertNoErrors(document);
  });

  test('functionWithMultipleReturns2', async () => {
    // Testet mehrere Returns mit inkompatiblen Typen.
    const { document } = await parseModel(`
      func bla(x)
        var y = 4
        if x < 2
          return 5
        else
          return 'bla'
        x = 25

      bla(5)
    `);

    assertHasErrorCode(document, DIFFERENT_TYPES_OF_RETURNS);
  });

  test('functionWithMultipleReturns3', async () => {
    // Testet rekursiven Return mit konsistentem Rückgabetyp.
    const { document } = await parseModel(`
      func bla(x)
        var y = 4
        if x < 2
          return 5
        else
          return bla(5)
        x = 25

      bla(5)
    `);

    assertNoErrors(document);
  });

  test('functionWithMultipleReturnsOfStruct', async () => {
    // Testet mehrere Struct-/null-Returns mit kompatiblem Typ.
    const { document } = await parseModel(`
      struct llElem
        num key
        llElem next

      func m(A[1..n])
        var last = new llElem
        last = null

        if n == 0
          return last

        var currElem = new llElem
        return currElem

      m([2,3])
    `);

    assertNoErrors(document);
  });

  test('assignWithReturnType1', async () => {
    // Testet Zuweisung eines num-Rückgabewerts an eine num-Variable.
    const { document } = await parseModel(`
      func bla(x)
        var y = 4
        if x < 2
          return 5
        else
          return bla(5)

      var k = 5
      k = bla(5)
    `);

    assertNoErrors(document);
  });

  test('assignWithReturnType2', async () => {
    // Testet Zuweisung eines num-Rückgabewerts an eine string-Variable.
    const { document } = await parseModel(`
      func bla(x)
        var y = 4
        if x < 2
          return 5
        else
          return bla(5)

      var k = 'blub'
      k = bla(5)
    `);

    assertHasErrorCode(document, INCOMPATIBLE_TYPES);
  });

  test('paraType1', async () => {
    // Testet korrekten Parametertyp bei numerischer Benutzung.
    const { document } = await parseModel(`
      func sum1( a )
        var s = a - 2
        return s

      sum1(5)
    `);

    assertNoErrors(document);
  });

  test('paraType2', async () => {
    // Testet falschen Parametertyp bei numerischer Benutzung.
    const { document } = await parseModel(`
      func sum1(a)
        var s = a - 2
        return s

      sum1('bla')
    `);

    assertHasErrorCode(document, FUNC_CALL_ACTUALPARA_CONFORMSTO_FORMALPARA);
  });

  test('paraArrayType1', async () => {
    // Testet Array-Parameter mit skalarem Argument.
    const { document } = await parseModel(`
      func bla(A[1..n])
        return A

      return bla(5)
    `);

    assertHasErrorCode(document, CONSISTENT_ARRAY_TYPE_OF_PARA);
  });

  test('paraArrayType2', async () => {
    // Testet Skalar-Parameter mit Array-Argument.
    const { document } = await parseModel(`
      func bla(A)
        return A

      return bla([5])
    `);

    assertHasErrorCode(document, CONSISTENT_ARRAY_TYPE_OF_PARA);
  });

  test('paraArrayType3', async () => {
    // Testet korrekten Aufruf eines Array-Parameters.
    const { document } = await parseModel(`
      func bla(A[1..n])
        return A

      bla([5])
    `);

    assertNoErrors(document);
  });

  test('paraReturnRecursive', async () => {
    // Testet rekursive Funktion mit num-Rückgaben.
    const { document } = await parseModel(`
      func count(x)
        if x == 1
          return 3
        else
          return 1 + count(x-1)

      print(count(23))
    `);

    assertNoErrors(document);
  });

  test('varNullInit', async () => {
    // Testet unzulässige Initialisierung einer Variablen nur mit null.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next

      var s = null
    `);

    assertHasErrorCode(document, VAR_DECL_NO_INIT_WITH_NULL);
  });

  test('structCreate', async () => {
    // Testet Erzeugung eines Struct-Objekts.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next

      var s = new Student
    `);

    assertNoErrors(document);
  });

  test('structCreateUse', async () => {
    // Testet normale Verwendung eines Struct-Objekts.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next

      var s = new Student
      s.key = 5
      s.next = null
    `);

    assertNoErrors(document);
  });

  test('structWithMethod', async () => {
    // Testet Struct mit Methode und Methodenaufruf.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next
        m()
          return 24

      var s = new Student
      s.key = 5
      print s.m()
    `);

    assertNoErrors(document);
  });

  test('structWithMethodAndThis', async () => {
    // Testet Struct-Methode mit this-Zugriff.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next
        m(a)
          this.key = this.key + a
          return this.next.key + 24

      var s = new Student
      s.key = 5
      print s.m(2)
    `);

    assertNoErrors(document);
  });

  test('structWithMethodAndUnmatchingCall', async () => {
    // Testet Methodenaufruf mit falscher Argumentanzahl.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next
        m(a)
          this.key = this.key + a
          return this.next.key + 24

      var s = new Student
      s.key = 5
      print s.m()
    `);

    assertHasErrorCode(document, FUNC_CALL_RIGHT_PARANUM);
  });

  test('structWithMethodandFunc', async () => {
    // Testet Kombination aus globaler Funktion und Struct-Methode.
    const { document } = await parseModel(`
      func bla()
        return 34
      struct Student
        num key
        Student next
        m()
          return 24

      var s = new Student
      s.key = 5
      print s.m() + bla()
    `);

    assertNoErrors(document);
  });

  test('multipleStructWithSameMethodname', async () => {
    // Testet gleiche Methodennamen in verschiedenen Structs.
    const { document } = await parseModel(`
      struct S1
        m()
          return 24
      struct S2
        m()
          return 25

      var s1 = new S1
      var s2 = new S1
      print s1.m()
      print s2.m()
    `);

    assertNoErrors(document);
  });

  test('multipleMethodnameSameStruct', async () => {
    // Testet doppelte Methodennamen im selben Struct.
    const { document } = await parseModel(`
      struct S1
        m()
          return 24
        num key
        m()
          return 2

      var s1 = new S1
      print s1.m()
    `);

    assertHasErrorCode(document, DUPLICATE_ELEMENT);
  });

  test('structCreateUseWithNext', async () => {
    // Testet Zugriff auf ein nicht vorhandenes Attribut.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next

      var s = new Student
      s.key = 5
      s.nxt = null
      s.next.key = 23
    `);

    assertHasLinkingLikeError(document);
  });

  test('structCreateUse1', async () => {
    // Testet Typfehler bei Attributzuweisung.
    const { document } = await parseModel(`
      struct Student
        num key
        Student next

      var s = new Student
      s.key = 5
      s.next.key = 'bal'
    `);

    assertHasErrorCode(document, INCOMPATIBLE_TYPES);
  });

  test('structScopingIfCond', async () => {
    // Testet Struct-Attribut in if-Bedingung.
    const { document } = await parseModel(`
      struct Student
        num key

      var s = new Student

      if s.key < 5
        print("hello")
    `);

    assertNoErrors(document);
  });

  test('structScopingIfThen', async () => {
    // Testet Struct-Attribut im then-Zweig.
    const { document } = await parseModel(`
      struct Student
        num key

      var s = new Student

      if 2 < 5
        s.key = 34
        print("hello")
    `);

    assertNoErrors(document);
  });

  test('structScopingWhileCond', async () => {
    // Testet Struct-Attribut in while-Bedingung.
    const { document } = await parseModel(`
      struct Student
        num key

      var s = new Student

      while s.key < 5
        print("hello")
    `);

    assertNoErrors(document);
  });

  test('structScopingWhileBody', async () => {
    // Testet Struct-Attribut im while-Body.
    const { document } = await parseModel(`
      struct Student
        num key

      var s = new Student

      while 2 < 5
        s.key = 34
        print("hello")
    `);

    assertNoErrors(document);
  });

  test('assignmentLoopVar', async () => {
    // Testet Zuweisung an die for-Schleifenvariable.
    const { document } = await parseModel(`
      for i=1 to 5
        print i
        i=i+1
    `);

    assertHasErrorCode(document, ASSIGNED_TO_LOOPVAR);
  });

  test('typeMismatchComparisonBoolNum', async () => {
    // Zusätzlicher Langium-Test: bool und num dürfen nicht mit == verglichen werden.
    const { document } = await parseModel(`
      print false == 5
    `);

    assertHasErrorCode(document, INCOMPATIBLE_TYPES_EQ);
  });

  test('nestedArrayVarDecl', async () => {
    // Zusätzlicher Langium-Test: verschachtelte Arrays in Array-Deklaration sind unzulässig.
    const { document } = await parseModel(`
      var A[4] = [44]
    `);

    assertHasErrorCode(document, VAR_DECL_NO_NESTED_ARRAY);
  });

  test('printStructArray', async () => {
    // Zusätzlicher Langium-Test: print erwartet Basistypen.
    const { document } = await parseModel(`
      struct S
        num[] arr

      var x = new S
      print x.arr
    `);

    assertHasErrorCode(document, PRINT_EXPECTS_BASE_TYPE);
  });
});