/**
 * @file VeriFastExpressionBoundary.test.ts
 * @brief Prueft die syntaktische Grenze zwischen Pseudo2- und VeriFast-Ausdruecken.
 * @author Abdul
 */

import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createPseudo2Services, generateCProgram, type Program } from 'pseudo2-language';

let documentId = 0;

function parse(source: string) {
  const services = createPseudo2Services(EmptyFileSystem);
  return services.shared.workspace.LangiumDocumentFactory.fromString(
    source,
    URI.parse(`memory:/verifast-expression-boundary-${documentId++}.pseudo2`)
  );
}

describe('VeriFast-Ausdruecke bleiben in Annotationen', () => {
  test.each([
    'print true &*& false',
    'var value = true &*& false',
    'if true &*& false\n  print 1',
    'print (true &*& false)',
    'print [true &*& false]',
    'func identity(value)\n  return value\nprint identity(true &*& false)'
  ])('lehnt &*& im Pseudo2-Programm ab: %s', source => {
    expect(parse(source).parseResult.parserErrors.length).toBeGreaterThan(0);
  });

  test('akzeptiert && weiterhin als regulaeres UND', () => {
    expect(parse('print true && false').parseResult.parserErrors).toHaveLength(0);
  });

  test('akzeptiert &*& in Vertraegen, Schleifen und Verifikationsanweisungen', () => {
    const document = parse([
      '//@ requires true &*& (true &*& true)',
      '//@ ensures result == 1 &*& true',
      'func one()',
      '  var value = 0',
      '  //@ invariant true &*& (true && true)',
      '  while false',
      '    value = value + 1',
      '  //@ assert true &*& true',
      '  return 1'
    ].join('\n'));

    expect(document.parseResult.parserErrors).toHaveLength(0);
    expect(generateCProgram(document.parseResult.value as Program)).toContain('&*&');
  });

  test('akzeptiert &*& in geklammerten Praedikatsargumenten', () => {
    const document = parse([
      '//@ requires vf_bool(true &*& false) == false',
      'func check()',
      '  return 0'
    ].join('\n'));

    expect(document.parseResult.parserErrors).toHaveLength(0);
  });
});
