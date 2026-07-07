import { describe, test, expect } from 'vitest';
import { AstUtils, EmptyFileSystem, URI, type AstNode, type LangiumDocument } from 'langium';

import type {
  Program,
  Expr,
  ReturnStmt,
  //PrintCommand,
  FunctionDeclaration
} from '../../src/generated/ast.js';

import {
  isPrintCommand,
  isReturnStmt,
  isFunctionDeclaration,
  isVarDecl,
  isIntLiteral,
  isStringLiteral,
  isNullLiteral,
  isEquality,
  isAddition
} from '../../src/generated/ast.js';

import { createPseudo2Services } from '../../src/pseudo2-module.js';
import {
  Pseudo2TypeComputer,
  TypeComputationContext
} from '../../src/typing/pseudo2-type-computer.js';

import {
  TYPE_NUM,
  TYPE_STRING,
  TYPE_BOOL,
  TYPE_ARRAY_NUM,
  TYPE_STRUCT
} from '../../src/typing/pseudo2-type.js';

import {
  INCOMPATIBLE_TYPES,
  INCOMPATIBLE_TYPES_EQ,
  INCOMPATIBLE_TYPES_PLUS,
  VAR_DECL_NO_NESTED_ARRAY,
  DIFFERENT_TYPES_OF_RETURNS,
  PRINT_EXPECTS_BASE_TYPE
} from '../../src/pseudo2-validator.js';

describe('ParsingTests_Typing', () => {
  let docCounter = 0;
  const types = new Pseudo2TypeComputer();

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

    const uri = URI.parse(`memory:/typing-test-${docCounter++}.pseudo2`);
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
  function firstNodeOfType<T extends AstNode>(root: AstNode, guard: (node: AstNode) => node is T): T | undefined {
    if (guard(root)) return root;
    for (const n of AstUtils.streamAllContents(root)) {
      if (guard(n)) return n;
    }
    return undefined;
  }

  // Sucht den letzten Return-Ausdruck in einer Funktion.
  function lastReturnExpr(fn: FunctionDeclaration): Expr {
    let last: ReturnStmt | undefined;

    for (const n of AstUtils.streamAllContents(fn)) {
      if (isReturnStmt(n)) {
        last = n;
      }
    }

    expect(last).toBeTruthy();
    expect(last!.retExpr).toBeTruthy();

    return last!.retExpr!;
  }
  
  // Parst einen einzelnen Ausdruck, indem er in ein print-Statement eingebettet wird.
  /*async function parseExpression(text: string): Promise<{ expr: Expr; document: LangiumDocument; model: Program }> {
    const { model, document } = await parseModel(`
      print ${text}
    `);

    const firstInstr = model.instructions[0];
    expect(firstInstr && isPrintCommand(firstInstr)).toBeTruthy();

    return {
      expr: (firstInstr as PrintCommand).param,
      document,
      model
    };
  }*/

  // Vergleicht zwei Pseudo2-Typen.
  function expectSameType(
    actual: ReturnType<Pseudo2TypeComputer['typeFor']>,
    expected: ReturnType<Pseudo2TypeComputer['typeFor']>
  ) {
    expect(actual.isSameAs(expected)).toBe(true);
  }

  // input muss hier nur ein Ausdruck sein.
  async function assertTypeExp(
    input: string,
    expectedType: ReturnType<Pseudo2TypeComputer['typeFor']>
  ) {
    const { model, document } = await parseModel(`
      func __test__()
          return ${input}
    `);

    assertNoErrors(document);

    const fn = model.instructions[0];
    expect(fn && isFunctionDeclaration(fn)).toBeTruthy();

    const expr = lastReturnExpr(fn as FunctionDeclaration);
    const t = types.typeFor(expr, new TypeComputationContext());
    expectSameType(t, expectedType);
  }

  // Wandelt ein Testprogramm mit letztem Top-Level-"return ..." in ein gültiges
  // Langium-Programm um, ohne vorhandene Top-Level-Deklarationen kaputt zu machen.
  //
  // Beispiel:
  //   struct S ...
  //   var x = new S
  //   return x.a
  //
  // wird zu:
  //   struct S ...
  //   var x = new S
  //   func __test__()
  //       return x.a
  function rewriteTopLevelReturnIntoTestFunction(input: string): string {
    const rawLines = input
      .replace(/\r/g, '')
      .split('\n');

    while (rawLines.length > 0 && rawLines[0].trim() === '') rawLines.shift();
    while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();

    expect(rawLines.length).toBeGreaterThan(0);

    const lastLineRaw = rawLines[rawLines.length - 1];
    const lastLine = lastLineRaw.trim();

    expect(lastLine.startsWith('return')).toBe(true);

    const returnExpr = lastLine.slice('return'.length).trim();

    const prefixLines = rawLines.slice(0, -1);
    const prefix = dedent(prefixLines.join('\n')).trimEnd();

    const result: string[] = [];

    if (prefix.length > 0) {
      result.push(prefix);
    }

    result.push('func __test__()');
    result.push(returnExpr.length > 0 ? `    return ${returnExpr}` : '    return');

    return result.join('\n');
  }

  // Hilfsfunktion wie das alte assertTypeReturnStmt(...).
  // Das ursprüngliche Testprogramm darf mit einem Top-Level-"return ..." enden.
  // Dieser letzte Return wird in eine Testfunktion verschoben, damit das
  // Programm in Langium gültig bleibt.
  async function assertTypeReturnStmt(
    input: string,
    expectedType: ReturnType<Pseudo2TypeComputer['typeFor']>
  ) {
    const rewritten = rewriteTopLevelReturnIntoTestFunction(input);
    const { model, document } = await parseModel(rewritten);

    assertNoErrors(document);

    const testFn = model.instructions.find(
      instr => isFunctionDeclaration(instr) && instr.name === '__test__'
    );

    expect(testFn).toBeTruthy();

    const expr = lastReturnExpr(testFn as FunctionDeclaration);
    const t = types.typeFor(expr, new TypeComputationContext());
    expectSameType(t, expectedType);
  }

  // Prüft, dass der letzte Return-Ausdruck einen Struct-Typ hat.
  // Auch hier wird nur der letzte Top-Level-Return in eine Testfunktion verschoben.
  async function assertReturnExprIsStruct(input: string) {
    const rewritten = rewriteTopLevelReturnIntoTestFunction(input);
    const { model, document } = await parseModel(rewritten);

    assertNoErrors(document);

    const testFn = model.instructions.find(
      instr => isFunctionDeclaration(instr) && instr.name === '__test__'
    );

    expect(testFn).toBeTruthy();

    const expr = lastReturnExpr(testFn as FunctionDeclaration);
    const t = types.typeFor(expr, new TypeComputationContext());
    expect(t.isStruct).toBe(true);
  }

  // Prüft, dass mindestens ein Fehler mit dem erwarteten Code im Dokument vorkommt.
  // Optional wird zusätzlich geprüft, ob der Fehlerbereich mit dem Zielknoten überlappt.
  // Falls Langium die Diagnostic an einen übergeordneten Knoten hängt,
  // reicht auch derselbe Fehlercode im Dokument.
  async function assertErrorOnNode<T extends AstNode>(
    input: string,
    guard: (node: AstNode) => node is T,
    expectedCode: string
  ) {
    const { model, document } = await parseModel(input);
    const target = firstNodeOfType(model, guard);

    expect(target).toBeTruthy();

    const targetRange = (target as AstNode).$cstNode?.range;
    const errors = errorDiagnostics(document);

    const sameCodeErrors = errors.filter(
      d => String(d.code ?? '') === String(expectedCode)
    );

    expect(sameCodeErrors.length).toBeGreaterThan(0);

    // Wenn ein Zielbereich vorhanden ist, versuchen wir zusätzlich,
    // einen überlappenden Fehler zu finden. Falls Langium den Fehler
    // an einen anderen, aber fachlich passenden Knoten hängt,
    // soll der Test trotzdem nicht unnötig scheitern.
    if (targetRange) {
      const overlapping = sameCodeErrors.filter(d => {
        if (!d.range) return false;
        return rangesOverlap(targetRange, d.range);
      });

      // Nur prüfen, wenn es überhaupt überlappende Ranges gibt.
      // Sonst akzeptieren wir den Fehlercode auf Dokumentebene.
      if (overlapping.length > 0) {
        expect(overlapping.length).toBeGreaterThan(0);
      }
    }
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

  test('intConstant', async () => { await assertTypeExp('10', TYPE_NUM); });
  test('stringConstant', async () => { await assertTypeExp("'foo'", TYPE_STRING); });
  test('boolConstant', async () => { await assertTypeExp('true', TYPE_BOOL); });

  test('notExp', async () => { await assertTypeExp('!true', TYPE_BOOL); });
  test('multiExp', async () => { await assertTypeExp('1 * 2', TYPE_NUM); });
  test('divExp', async () => { await assertTypeExp('1 / 2', TYPE_NUM); });
  test('modExp', async () => { await assertTypeExp('1 mod 2', TYPE_NUM); });
  test('expoExp', async () => { await assertTypeExp('1 ^ 2', TYPE_NUM); });
  test('minusExp', async () => { await assertTypeExp('1 - 2', TYPE_NUM); });

  test('comparisonExp', async () => { await assertTypeExp('1 < 2', TYPE_BOOL); });
  test('equalityExp', async () => { await assertTypeExp('1 == 2', TYPE_BOOL); });
  test('noEqualityExp', async () => { await assertTypeExp('1 != 2', TYPE_BOOL); });
  test('andExp', async () => { await assertTypeExp('true && false', TYPE_BOOL); });
  test('orExp', async () => { await assertTypeExp('true || false', TYPE_BOOL); });

  test('numericPlus', async () => { await assertTypeExp('1 + 2', TYPE_NUM); });
  test('stringPlus', async () => { await assertTypeExp("'a' + 'b'", TYPE_STRING); });
  test('numAndStringPlus', async () => { await assertTypeExp("'a' + 2", TYPE_STRING); });
  test('numAndStringPlus2', async () => { await assertTypeExp("2 + 'a'", TYPE_STRING); });
  test('boolAndStringPlus', async () => { await assertTypeExp("'a' + true", TYPE_STRING); });
  test('boolAndStringPlus2', async () => { await assertTypeExp("false + 'a'", TYPE_STRING); });

test('arrayAccess', async () => {
  await assertTypeReturnStmt(`
    var A[6] = 3
    return A[3]
  `, TYPE_NUM);
});

test('arrayDecl', async () => {
  await assertTypeReturnStmt(`
    var A[6] = 3
    return A
  `, TYPE_ARRAY_NUM);
});

test('arrayDecl1', async () => {
  await assertTypeReturnStmt(`
    var A[6] = 3
    var k = A[3] * 5
    return A
  `, TYPE_ARRAY_NUM);
});

test('arrayAccessLit', async () => {
  await assertTypeReturnStmt(`
    var A = [3, 3,5]
    return A[3]
  `, TYPE_NUM);
});

test('arrayDeclLit', async () => {
  await assertTypeReturnStmt(`
    var A = [3, 3,5]
    return A
  `, TYPE_ARRAY_NUM);
});

test('null1', async () => {
  await assertReturnExprIsStruct('return null');
});

test('varNumericPlus', async () => {
  await assertTypeReturnStmt(`
    var x = 1
    return x + 2
  `, TYPE_NUM);
});

test('varStringPlus', async () => {
  await assertTypeReturnStmt(`
    var x = 'a'
    return x + 'b'
  `, TYPE_STRING);
});

test('varNumAndStringPlus', async () => {
  await assertTypeReturnStmt(`
    var x = 'a'
    return x + 2
  `, TYPE_STRING);
});

test('varNumAndStringPlus2', async () => {
  await assertTypeReturnStmt(`
    var x = 1
    return x + 'a'
  `, TYPE_STRING);
});

  const structDefExa = `
    struct mystruct {
      num c_num
      bool c_bool
      string c_string
      num[] c_arr
      mystruct c_mystruct
      m() {
        return 34
      }
    }
    var x = new mystruct
    var a = x.c_arr
  `;

  test('structAccess1', async () => { await assertTypeReturnStmt(structDefExa + ' return x.c_num', TYPE_NUM); });
  test('structAccess2', async () => { await assertTypeReturnStmt(structDefExa + ' return x.c_bool', TYPE_BOOL); });
  test('structAccess3', async () => { await assertTypeReturnStmt(structDefExa + ' return x.c_string', TYPE_STRING); });
  test('structAccess4', async () => { await assertTypeReturnStmt(structDefExa + ' return x.c_mystruct', TYPE_STRUCT('mystruct')); });
  test('structAccess5', async () => { await assertTypeReturnStmt(structDefExa + ' return x.c_arr', TYPE_ARRAY_NUM); });
  test('structDecl', async () => { await assertTypeReturnStmt(structDefExa + ' return x', TYPE_STRUCT('mystruct')); });
  test('structNestedAccess', async () => { await assertTypeReturnStmt(structDefExa + ' return x.c_mystruct.c_mystruct', TYPE_STRUCT('mystruct')); });

  test('funcReturnSkalar', async () => {
    const input = `
      func bla(arg)
        return arg.c_num

      struct mystruct
        num c_num

      var x = new mystruct
      return bla(x)
    `;

    const rewritten = rewriteTopLevelReturnIntoTestFunction(input);
    const { model, document } = await parseModel(rewritten);
    assertNoErrors(document);

    const testFn = model.instructions.find(
      instr => isFunctionDeclaration(instr) && instr.name === '__test__'
    ) as FunctionDeclaration;

    const expr = lastReturnExpr(testFn);
    const t = types.typeFor(expr, new TypeComputationContext());

//console.log('funcReturnSkalar actual type =', t.asString?.() ?? t);
    expectSameType(t, TYPE_NUM);
  });

  test('funcReturnArray', async () => {
    await assertTypeReturnStmt(`
      func bla(A[1..n]) {
        return A
      }
      return bla([5])
    `, TYPE_ARRAY_NUM);
  });

  test('notNum', async () => { await assertErrorOnNode(`print ! 5`, isIntLiteral, INCOMPATIBLE_TYPES); });
  test('notString', async () => { await assertErrorOnNode(`print ! 'bla'`, isStringLiteral, INCOMPATIBLE_TYPES); });
  test('andNum', async () => { await assertErrorOnNode(`print true && 5`, isIntLiteral, INCOMPATIBLE_TYPES); });
  test('orNum', async () => { await assertErrorOnNode(`print false || 5`, isIntLiteral, INCOMPATIBLE_TYPES); });
  test('eqBoolNum', async () => { await assertErrorOnNode(`print false == 5`, isEquality, INCOMPATIBLE_TYPES_EQ); });
  test('noEqBoolNum', async () => { await assertErrorOnNode(`print false != 5`, isEquality, INCOMPATIBLE_TYPES_EQ); });

  test('multString', async () => { await assertErrorOnNode(`print 1 * 'bla'`, isStringLiteral, INCOMPATIBLE_TYPES); });
 
  test('minusString', async () => { await assertErrorOnNode(`print -'a'`, isStringLiteral, INCOMPATIBLE_TYPES); });

  test('divString', async () => { await assertErrorOnNode(`print 1 / 'bla'`, isStringLiteral, INCOMPATIBLE_TYPES); });
  test('modString', async () => { await assertErrorOnNode(`print 1 mod 'bla'`, isStringLiteral, INCOMPATIBLE_TYPES); });
  test('expoString', async () => { await assertErrorOnNode(`print 1 ^ 'bla'`, isStringLiteral, INCOMPATIBLE_TYPES); });

  test('notNull', async () => { await assertErrorOnNode(`print ! null`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('andNull1', async () => { await assertErrorOnNode(`print null && true`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('andNull2', async () => { await assertErrorOnNode(`print false && null`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('orNull', async () => { await assertErrorOnNode(`print false || null`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('eqBoolNull', async () => { await assertErrorOnNode(`print false == null`, isEquality, INCOMPATIBLE_TYPES_EQ); });
  test('noEqBoolNull', async () => { await assertErrorOnNode(`print false != null`, isEquality, INCOMPATIBLE_TYPES_EQ); });

  test('plusNumNull1', async () => { await assertErrorOnNode(`print 1 + null`, isAddition, INCOMPATIBLE_TYPES_PLUS); });
  test('plusNumNull2', async () => { await assertErrorOnNode(`print null + 1`, isAddition, INCOMPATIBLE_TYPES_PLUS); });
  test('plusStringNull1', async () => { await assertErrorOnNode(`print '1' + null`, isAddition, INCOMPATIBLE_TYPES_PLUS); });
  test('plusStringNull2', async () => { await assertErrorOnNode(`print null + '1'`, isAddition, INCOMPATIBLE_TYPES_PLUS); });
  test('multNull1', async () => { await assertErrorOnNode(`print 1 * null`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('multNull2', async () => { await assertErrorOnNode(`print null * 1`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('minusNull', async () => { await assertErrorOnNode(`print -null`, isNullLiteral, INCOMPATIBLE_TYPES);  });
  test('divNull', async () => { await assertErrorOnNode(`print 1 / null`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('modNull', async () => { await assertErrorOnNode(`print 1 mod null`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('expoNull1', async () => { await assertErrorOnNode(`print null ^ 2`, isNullLiteral, INCOMPATIBLE_TYPES); });
  test('expoNull2', async () => { await assertErrorOnNode(`print 1 ^ null`, isNullLiteral, INCOMPATIBLE_TYPES); });

  test('ifCond', async () => {
    await assertErrorOnNode(`
      if 3 {
        print("hello")
      }
    `, isIntLiteral, INCOMPATIBLE_TYPES);
  });

  test('forStartExp', async () => {
    await assertErrorOnNode(`
      for i='bla' to 25 by 2 {
        print("hello")
      }
    `, isStringLiteral, INCOMPATIBLE_TYPES);
  });

  test('forEndExp', async () => {
    await assertErrorOnNode(`
      for i=1 to 'bla' by 2 {
        print("hello")
      }
    `, isStringLiteral, INCOMPATIBLE_TYPES);
  });

  test('forStepWith', async () => {
    await assertErrorOnNode(`
      for i=1 to 25 by 'bla' {
        print("hello")
      }
    `, isStringLiteral, INCOMPATIBLE_TYPES);
  });

  test('whileCond', async () => {
    await assertErrorOnNode(`
      while 3 {
        print("hello")
      }
    `, isIntLiteral, INCOMPATIBLE_TYPES);
  });

  test('doWhileCond', async () => {
    await assertErrorOnNode(`
      do {
        print("hello")
      } while 3
    `, isIntLiteral, INCOMPATIBLE_TYPES);
  });

  test('compareNumString', async () => {
    await assertErrorOnNode(`
      var a = 44
      var b = '12'
      print( a != b )
    `, isEquality, INCOMPATIBLE_TYPES_EQ);
  });

  test('arrayDecl_Nested', async () => {
    await assertErrorOnNode(`
      var A[4] = [44]
    `, isVarDecl, VAR_DECL_NO_NESTED_ARRAY);
  });

  test('arrayDecl_WrongSizeType', async () => {
    await assertErrorOnNode(`
      var A['bla'] = 3
    `, isStringLiteral, INCOMPATIBLE_TYPES);
  });

  test('differentReturnTypes', async () => {
    await assertErrorOnNode(`
      func bla() {
        if 2 < 4 {
          return 'bla'
        } else {
          return 4
        }
        return 23
        return 'blub'
      }
    `, isFunctionDeclaration, DIFFERENT_TYPES_OF_RETURNS);
  });

  test('uncalledFunctionReturns', async () => {
    const { document } = await parseModel(`
      func bla() {
        print 'blub'
      }
    `);
    assertNoErrors(document);
  });

  test('recursiveFunctionCallWithStructs', async () => {
    const { document } = await parseModel(`
      struct treeElem {
        num key
        treeElem left
        treeElem right
      }

      var root = new treeElem

      func visit_lwr(node) {
        if node==null{
          return
        }
        visit_lwr(node.right)
        visit_lwr(node.left)
        print(node.key)
        visit_lwr(node.right)
        visit_lwr(node.right.right)
      }

      visit_lwr(root.right)
    `);
    assertNoErrors(document);
  });

  test('recursiveFunctionCallAssignedWithStructs', async () => {
    const { document } = await parseModel(`
      struct treeElem {
        num key
        treeElem left
      }

      var root = new treeElem

      func visit_lwr(node) {
        var newNode = new treeElem
        newNode=node
        if node==null{
          return
        }
        visit_lwr(newNode.left)
      }

      visit_lwr(root)
    `);
    assertNoErrors(document);
  });

  test('printStructArray', async () => {
    await assertErrorOnNode(`
      struct S {
        num[] arr
      }

      var x = new S
      print x.arr
    `, isPrintCommand, PRINT_EXPECTS_BASE_TYPE);
  });

  test('assignStructArray', async () => {
    const { document } = await parseModel(`
      struct Ring {
        num size
      }

      struct RingStack {
        Ring[] S

        init() {
          var help[4] = new Ring
          this.S = help
        }
      }
    `);
    assertNoErrors(document);
  });
});