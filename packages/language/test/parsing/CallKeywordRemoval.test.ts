/**
 * @file CallKeywordRemoval.test.ts
 * @brief Prueft Aufrufe ohne das entfernte Pseudo2-Kommando call.
 * @author Abdul
 */

import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createPseudo2Services } from '../../src/pseudo2-module.js';
import { METHODCALLS_WO_RETURN_ONLY_AS_INSTRUCTION } from '../../src/pseudo2-validator.js';

let documentId = 0;

async function validate(source: string) {
  const services = createPseudo2Services(EmptyFileSystem);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse(`memory:/call-removal-${documentId++}.pseudo2`)
  );
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  return document;
}

describe('Aufrufe ohne call-Kommando', () => {
  test('akzeptiert wertlose Funktionen und Methoden als eigenstaendige Anweisungen', async () => {
    const document = await validate([
      'func say()',
      '  print "ok"',
      'struct Box',
      '  num value',
      '  set(n)',
      '    this.value = n',
      'var box = new Box',
      'say()',
      'box.set(3)'
    ].join('\n'));

    expect(document.parseResult.parserErrors).toHaveLength(0);
    expect(document.diagnostics?.filter(diagnostic => diagnostic.severity === 1)).toEqual([]);
  });

  test('lehnt eine wertlose Methode weiterhin als Wert ab', async () => {
    const document = await validate([
      'struct Box',
      '  num value',
      '  set(n)',
      '    this.value = n',
      'var box = new Box',
      'print box.set(3)'
    ].join('\n'));

    expect(document.diagnostics?.map(diagnostic => diagnostic.code)).toContain(
      METHODCALLS_WO_RETURN_ONLY_AS_INSTRUCTION
    );
  });

  test.each([
    'func say()\n  print "ok"\ncall say()',
    'var call = 1\nfunc say()\n  print "ok"\ncall say()'
  ])('lehnt die alte Schreibweise ab', async source => {
    const document = await validate(source);
    expect(document.diagnostics?.some(diagnostic => diagnostic.severity === 1)).toBe(true);
  });
});
