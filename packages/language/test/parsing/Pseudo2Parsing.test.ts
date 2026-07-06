import { describe, test, expect } from 'vitest';
import { EmptyFileSystem, URI, type LangiumDocument } from 'langium';

import type { Program } from '../../src/generated/ast.js';
import { createPseudo2Services } from '../../src/pseudo2-module.js';

describe('Pseudo2ParsingTest', () => {
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

  // Parst einen Pseudo2-Text mit frischen Services und liefert Modell + Dokument zurück.
  async function parseModel(text: string): Promise<{ model: Program; document: LangiumDocument }> {
    const services = createPseudo2Services(EmptyFileSystem);
    const documentBuilder = services.shared.workspace.DocumentBuilder;
    const documentFactory = services.shared.workspace.LangiumDocumentFactory;

    const uri = URI.parse(`memory:/pseudo2-parsing-test-${docCounter++}.pseudo2`);
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

    // Minimales Parse-Beispiel: eine einfache Variablendeklaration soll fehlerfrei sein.
    assertNoErrors(document);
  });
});