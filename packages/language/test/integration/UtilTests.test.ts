/**
 * @file UtilTests.test.ts
 * @brief Prüft AST-Durchläufe und die Klassifikation von Variablen- und Attribut-Schreibzugriffen.
 * @author Abdul
 */

import { describe, test, expect } from 'vitest';
import { AstUtils, EmptyFileSystem, URI, type AstNode } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import {
  isAssignment,
  isAttSelection,
  isVarRef,
  type AttSelection,
  type VarRef
} from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

/** Integrationssuite für allgemeine AST-Hilfsoperationen. */
describe('UtilTests', () => {
  /** Fortlaufende Nummer für eindeutige In-Memory-Testdokumente. */
  let docCounter = 0;

  // Entfernt gemeinsame führende Einrückung aus Template-Strings,
  // damit die Testprogramme sauber geparst werden können.
  /**
   * Entfernt Leerzeilen am Rand und gemeinsame führende Einrückung.
   * @param text Eingerückter Pseudo2-Template-String.
   * @returns Normalisierter Quelltext.
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
   * Parst und validiert ein Pseudo2-Programm in einem eindeutigen Speicherdokument.
   * @param text Pseudo2-Quelltext.
   * @returns Geparstes Program-AST.
   */
  async function parseModel(text: string): Promise<Program> {
    const services = createPseudo2Services(EmptyFileSystem);
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;

    const uri = URI.parse(`memory:/util-tests-${docCounter++}.pseudo2`);
    const document = documentFactory.fromString(dedent(text), uri);

    await documentBuilder.build([document], { validation: true });
    return document.parseResult.value as Program;
  }

  // Sammelt alle Knoten eines bestimmten Typs innerhalb eines AST-Knotens.
  /**
   * Sammelt Wurzel und Nachfahren, die einen angegebenen Type Guard erfüllen.
   * @param root Ausgangsknoten.
   * @param guard Type Guard des gesuchten AST-Typs.
   * @returns Passende Knoten in Traversierungsreihenfolge.
   */
  function allNodesOfType<T extends AstNode>(
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
  }

  // Prüft für eine VarRef, ob sie auf der linken Seite einer Zuweisung steht.
  // Das entspricht dem alten util-Test "isWriteAccess".
  /** @param node Variablenreferenz. @returns `true`, wenn sie direktes Ziel einer Zuweisung ist. */
  function isWriteAccessVarRef(node: VarRef): boolean {
    const parent = node.$container;
    return isAssignment(parent) && parent.sel === node;
  }

  // Prüft für eine AttSelection, ob sie auf der linken Seite einer Zuweisung steht.
  // Das entspricht dem alten util-Test "isWriteAccess" für Selektionen.
  /** @param node Attributselektion. @returns `true`, wenn sie direktes Ziel einer Zuweisung ist. */
  function isWriteAccessAttSelection(node: AttSelection): boolean {
    const parent = node.$container;
    return isAssignment(parent) && parent.sel === node;
  }

  test('isWriteAccess1', async () => {
    const model = await parseModel(`
      var x= 2
      x = 5
    `);

    const topInstructions = model.instructions;

    // Testet eine VarRef auf der linken Seite einer Assignment.
    // Erwartung: Das ist ein Schreibzugriff.
    const exp = allNodesOfType(topInstructions.at(-1)!, isVarRef)[0];
    expect(exp).toBeTruthy();
    expect(isWriteAccessVarRef(exp!)).toBe(true);
  });

  test('isWriteAccess2', async () => {
    const model = await parseModel(`
      var x= 2
      x = 5
      print(x)
    `);

    const topInstructions = model.instructions;

    // Testet eine VarRef in einem print-Ausdruck.
    // Erwartung: Das ist kein Schreibzugriff.
    const exp = allNodesOfType(topInstructions.at(-1)!, isVarRef)[0];
    expect(exp).toBeTruthy();
    expect(isWriteAccessVarRef(exp!)).toBe(false);
  });

  test('isWriteAccess1_sel', async () => {
    const model = await parseModel(`
      struct S
        num x
      var s = new S
      s.x= 2
    `);

    const topInstructions = model.instructions;

    // Testet eine Attributselektion auf der linken Seite einer Assignment.
    // Erwartung: Das ist ein Schreibzugriff.
    const exp = allNodesOfType(topInstructions.at(-1)!, isAttSelection)[0];
    expect(exp).toBeTruthy();
    expect(isWriteAccessAttSelection(exp!)).toBe(true);
  });

  test('isWriteAccess2_sel', async () => {
    const model = await parseModel(`
      struct S
        num x
      var s = new S
      s.x= 2
      print s.x
    `);

    const topInstructions = model.instructions;

    // Testet eine Attributselektion innerhalb eines print-Ausdrucks.
    // Erwartung: Das ist kein Schreibzugriff.
    const exp = allNodesOfType(topInstructions.at(-1)!, isAttSelection)[0];
    expect(exp).toBeTruthy();
    expect(isWriteAccessAttSelection(exp!)).toBe(false);
  });
});
