/**
 * @file PrinterTests.test.ts
 * @brief Prüft eine kanonische AST-Repräsentation sämtlicher Pseudo2-Ausdrucksklassen.
 *
 * Die Suite parst Ausdrücke in einer neutralen Rückgabefunktion und bildet den AST
 * anschließend deterministisch auf Text ab, um Präzedenz, Ketten und Literale zu prüfen.
 *
 * @author Abdul
 */

import { describe, test, expect } from 'vitest';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';

import type {
  Program,
  Expr,
  //PrintCommand,
  FunctionDeclaration,
  ReturnStmt
} from '../../src/generated/ast.js';

import {
  //isPrintCommand,
  isIntLiteral,
  isBoolLiteral,
  isStringLiteral,
  isNullLiteral,
  isArrayLiteral,
  isGrouping,
  isNot,
  isNeg,
  isOr,
  isAnd,
  isEquality,
  isComparison,
  isAddition,
  isMultiplication,
  isExponentiation,
  isFunctionDeclaration,
  isReturnStmt
} from '../../src/generated/ast.js';

import { createPseudo2Services } from '../../src/pseudo2-module.js';

/** Integrationssuite für Parser-AST und kanonische Ausdrucksrepräsentation. */
describe('PrinterTests', () => {
  /** Fortlaufende Nummer für eindeutige In-Memory-Testdokumente. */
  let docCounter = 0;

  // Entfernt gemeinsame führende Einrückung aus Template-Strings.
  /**
   * Normalisiert gemeinsame Einrückung eines mehrzeiligen Testprogramms.
   * @param text Eingerückter Template-String.
   * @returns Quelltext bei erhaltener relativer Einrückung.
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

  // Parst ein kleines Pseudo2-Programm mit genau einem print-Ausdruck.
  /**
   * Parst und validiert ein Pseudo2-Programm in einem frischen In-Memory-Dokument.
   * @param text Pseudo2-Quelltext.
   * @returns AST-Programm und Dokumentdiagnosen.
   */
  async function parseProgram(text: string): Promise<{ model: Program; document: LangiumDocument }> {
    const services = createPseudo2Services(EmptyFileSystem);
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;

    const uri = URI.parse(`memory:/printer-test-${docCounter++}.pseudo2`);
    const document: LangiumDocument = documentFactory.fromString(dedent(text), uri);

    await documentBuilder.build([document], { validation: true });

    return {
      model: document.parseResult.value as Program,
      document
    };
  }

  // Prüft, dass keine Fehlerdiagnosen im Dokument vorhanden sind.
  /** @param document Validiertes Langium-Dokument, das keine Fehler enthalten darf. */
  function assertNoErrors(document: LangiumDocument): void {
    const errors = (document.diagnostics ?? []).filter(d => d.severity === 1);
    expect(errors.map(e => e.message).join('\n')).toBe('');
  }

  // Parst einen einzelnen Ausdruck in einem neutralen Kontext.
  // Wir packen ihn in eine kleine Testfunktion und lesen dann die return-Expression aus.
  // So testen wir den Ausdruck selbst, ohne dass print Arrays verbietet.
  /**
   * Parst einen Ausdruck als Rückgabewert einer synthetischen Funktion.
   * @param text Pseudo2-Ausdruck.
   * @returns Aufgebauter Ausdrucks-AST.
   */
  async function parseExpression(text: string): Promise<Expr> {
    const { model, document } = await parseProgram(`
      func __printer_test__()
        return ${text}
    `);

    assertNoErrors(document);

    const fn = model.instructions[0];
    expect(fn && isFunctionDeclaration(fn)).toBeTruthy();

    const fnInstrs = (fn as FunctionDeclaration).body?.instructions ?? (fn as any).instructions ?? [];
    const ret = fnInstrs[0];
    expect(ret && isReturnStmt(ret)).toBeTruthy();

    return (ret as ReturnStmt).retExpr!;
  }

  // Formatiert einen Ausdruck in die kanonische Repräsentation
  /**
   * Formatiert Literale, Gruppierungen, unäre Ausdrücke und Operatorbäume rekursiv.
   * @param expr Zu formatierender Ausdrucksknoten.
   * @returns Kanonische Testrepräsentation.
   */
  function reprExpr(expr: Expr): string {
    if (isIntLiteral(expr)) return String(expr.value);
    if (isBoolLiteral(expr)) return String(expr.value);
    if (isStringLiteral(expr)) return `'${escapeSingleQuoted(expr.value)}'`;
    if (isNullLiteral(expr)) return 'null';

    if (isArrayLiteral(expr)) {
      const elems = (expr.elems ?? []).map(e => reprExpr(e)).join(',');
      return `[${elems}]`;
    }

    if (isGrouping(expr)) {
      return `(${reprExpr(expr.value)})`;
    }

    if (isNot(expr)) {
      return `(! ${reprExpr(expr.value)})`;
    }

    if (isNeg(expr)) {
      return `(- ${reprExpr(expr.value)})`;
    }

    if (isOr(expr)) {
      return chainRepr(expr.left, '||', expr.right ?? []);
    }

    if (isAnd(expr)) {
      return chainRepr(expr.left, '&&', expr.right ?? []);
    }

    if (isEquality(expr)) {
      return opChainRepr(expr.left, expr.op ?? [], expr.right ?? []);
    }

    if (isComparison(expr)) {
      return opChainRepr(expr.left, expr.op ?? [], expr.right ?? []);
    }

    if (isAddition(expr)) {
      return opChainRepr(expr.left, expr.op ?? [], expr.right ?? []);
    }

    if (isMultiplication(expr)) {
      return opChainRepr(expr.left, expr.op ?? [], expr.right ?? []);
    }

    if (isExponentiation(expr)) {
      return opChainRepr(expr.left, expr.op ?? [], expr.right ?? []);
    }

    return '/*expr*/';
  }

  // Formatiert logische Operator-Ketten.
  /**
   * Formatiert eine Kette mit einem einheitlichen logischen Operator.
   * @param left Erster Operand.
   * @param op Operator zwischen allen Operanden.
   * @param rights Weitere Operanden.
   * @returns Einzeloperand oder geklammerte Kette.
   */
  function chainRepr(left: Expr, op: string, rights: Expr[]): string {
    const parts = [reprExpr(left), ...rights.map(r => reprExpr(r))];
    if (parts.length === 1) {
      return parts[0];
    }
    return `(${parts.join(` ${op} `)})`;
  }

  // Formatiert Operator-Ketten mit expliziter Operatorliste.
  /**
   * Formatiert eine Kette, deren Verknüpfungen jeweils einen eigenen Operator besitzen.
   * @param left Erster Operand.
   * @param ops Operatoren der nachfolgenden Operanden.
   * @param rights Weitere Operanden.
   * @returns Einzeloperand oder geklammerte Operatorfolge.
   */
  function opChainRepr(left: Expr, ops: string[], rights: Expr[]): string {
    if (rights.length === 0) {
      return reprExpr(left);
    }

    let out = `(${reprExpr(left)}`;
    for (let i = 0; i < rights.length; i++) {
      out += ` ${ops[i] ?? '?'} ${reprExpr(rights[i])}`;
    }
    out += ')';
    return out;
  }

  // Escaped einfache Quotes für die Test-Repräsentation.
  /** @param value Roher Stringwert. @returns Für eine einfach gequotete Darstellung maskierter Inhalt. */
  function escapeSingleQuoted(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

    // Hilfsfunktion wie das alte ParseUtil.assertRepr(...).
    /**
     * Parst einen Ausdruck und vergleicht seine kanonische AST-Repräsentation.
     * @param input Pseudo2-Ausdruck.
     * @param expected Erwartete Repräsentation.
     */
    async function assertRepr(input: string, expected: string): Promise<void> {
      const expr = await parseExpression(input);
      expect(reprExpr(expr)).toBe(expected);
    }

  test('notExp', async () => {
    // Testet die Repräsentation einer logischen Negation.
    await assertRepr('!true', '(! true)');
  });

  test('multiExp', async () => {
    // Testet die Repräsentation einer Multiplikation.
    await assertRepr('1 * 2', '(1 * 2)');
  });

  test('divExp', async () => {
    // Testet die Repräsentation einer Division.
    await assertRepr('1 / 2', '(1 / 2)');
  });

  test('modExp', async () => {
    // Testet die Repräsentation einer Modulo-Operation.
    await assertRepr('1 mod 2', '(1 mod 2)');
  });

  test('expoExp', async () => {
    // Testet die Repräsentation einer Potenz.
    await assertRepr('1 ^ 2', '(1 ^ 2)');
  });

  test('minusExp', async () => {
    // Testet die Repräsentation einer Subtraktion.
    await assertRepr('1 - 2', '(1 - 2)');
  });

  test('comparisonExp', async () => {
    // Testet die Repräsentation eines Vergleichs.
    await assertRepr('1 < 2', '(1 < 2)');
  });

  test('equalityExp', async () => {
    // Testet die Repräsentation eines Gleichheitsvergleichs.
    await assertRepr('1 == 2', '(1 == 2)');
  });

  test('andExp', async () => {
    // Testet die Repräsentation eines logischen Und.
    await assertRepr('true && false', '(true && false)');
  });

  test('orExp', async () => {
    // Testet die Repräsentation eines logischen Oder.
    await assertRepr('true || false', '(true || false)');
  });

  test('numericPlus', async () => {
    // Testet die Repräsentation einer numerischen Addition.
    await assertRepr('1 + 2', '(1 + 2)');
  });

  test('stringPlus', async () => {
    // Testet die Repräsentation einer String-Verkettung.
    await assertRepr("'a' + 'b'", "('a' + 'b')");
  });

  test('numAndStringPlus', async () => {
    // Testet die Repräsentation von String plus Zahl.
    await assertRepr("'a' + 2", "('a' + 2)");
  });

  test('numAndStringPlus2', async () => {
    // Testet die Repräsentation von Zahl plus String.
    await assertRepr("2 + 'a'", "(2 + 'a')");
  });

  test('boolAndStringPlus', async () => {
    // Testet die Repräsentation von String plus Bool.
    await assertRepr("'a' + true", "('a' + true)");
  });

  test('boolAndStringPlus2', async () => {
    // Testet die Repräsentation von Bool plus String.
    await assertRepr("false + 'a'", "(false + 'a')");
  });

  test('arrayLitEmpty', async () => {
    // Testet die Repräsentation eines leeren Array-Literals.
    await assertRepr('[]', '[]');
  });

  test('arrayLitEmpty1', async () => {
    // Testet die Repräsentation eines leeren Array-Literals mit zusätzlichen Leerzeichen.
    await assertRepr('[   ]', '[]');
  });

  test('arrayLit1', async () => {
    // Testet die Repräsentation eines Array-Literals mit einem Element.
    await assertRepr('[ 1  ]', '[1]');
  });

  test('arrayLit2', async () => {
    // Testet die Repräsentation eines Array-Literals mit mehreren Elementen.
    await assertRepr('[ 1, 6, 5  ]', '[1,6,5]');
  });
});
