import { describe, expect, test } from 'vitest';

import { generateAllArtifacts } from '../../src/generator-artifacts.js';
import { generatePrettyPseudo2 } from '../../src/generator-pretty.js';
import { parseRuntimeProgram } from '../helpers/runtime-test-utils.js';

describe('PrettyPseudo2Generator', () => {
  test('prints an indented Pseudo2 program with explicit braces', async () => {
    const { model, document } = await parseRuntimeProgram(`
      @requires true
      @ensures true
      func max(a, b)
        if a > b
          return a
        else
          return b

      struct Box
        num value
        inc(x)
          this.value = this.value + x
          return this.value

      func sum(A[1..n])
        var total = 0
        for i = 1 to n by 1
          total = total + A[i]
        return total

      var values[3] = 0
      var literal = [1, 2, 3]
      var box = new Box
      call box.inc(2)
      @assert true
      print "done"
    `);

    expectErrors(document);

    const pretty = generatePrettyPseudo2(model);

    expect(pretty).toBe([
      '@requires true',
      '@ensures true',
      'func max(a, b) {',
      '  if (a > b) {',
      '    return a',
      '  } else {',
      '    return b',
      '  }',
      '}',
      '',
      'struct Box {',
      '  num value',
      '  inc(x) {',
      '    this.value = (this.value + x)',
      '    return this.value',
      '  }',
      '}',
      '',
      'func sum(A[1..n]) {',
      '  var total = 0',
      '  for i = 1 to n by 1 {',
      '    total = (total + A[i])',
      '  }',
      '  return total',
      '}',
      '',
      'var values[3] = 0',
      '',
      'var literal = [1, 2, 3]',
      '',
      'var box = new Box',
      '',
      'call box.inc(2)',
      '',
      '@assert true',
      '',
      'print "done"',
      ''
    ].join('\n'));

    const reparsed = await parseRuntimeProgram(pretty);
    expectErrors(reparsed.document);
  });

  test('can be included in the shared artifact generator', async () => {
    const { model, document } = await parseRuntimeProgram(`
      print "Hallo"
    `);

    expectErrors(document);

    const artifacts = generateAllArtifacts(model, { includeJavaScript: false, includePrettyPseudo2: true, kinds: ['dep'] });
    expect(artifacts.map(artifact => artifact.fileName)).toEqual(['pretty.pseudo2', 'graphvizDep.dot']);
    expect(artifacts[0].code).toBe('print "Hallo"\n');
  });

  test('prints advanced VeriFast annotations', async () => {
    const { model, document } = await parseRuntimeProgram(`
      @requires true
      @ensures result != null
      @terminates
      func verified()
        @assume true
        @open "P()"
        @close "P()"
        @leak "P()"
        return 1
    `);

    expectErrors(document);

    const pretty = generatePrettyPseudo2(model);
    expect(pretty).toBe([
      '@requires true',
      '@ensures (result != null)',
      '@terminates',
      'func verified() {',
      '  @assume true',
      '  @open "P()"',
      '  @close "P()"',
      '  @leak "P()"',
      '  return 1',
      '}',
      ''
    ].join('\n'));

    const reparsed = await parseRuntimeProgram(pretty);
    expectErrors(reparsed.document);
  });

  test('prints structured VeriFast model helper annotations', async () => {
    const { model, document } = await parseRuntimeProgram(`
      @requires true
      @ensures vf_array(result) && vf_len(result) == 2
      func makeArray()
        return [1, 2]

      struct S
        num value

      @requires true
      @ensures vf_struct(result) && vf_int(vf_field(result, "value")) == 7
      func makeStruct()
        var s = new S
        s.value = 7
        return s

      @requires vf_number(x)
      @ensures vf_bool(result) == vf_truthy(x)
      func normalize(x)
        return !(!x)
    `);

    expectErrors(document);

    const pretty = generatePrettyPseudo2(model);
    expect(pretty).toBe([
      '@requires true',
      '@ensures (vf_array(result) && (vf_len(result) == 2))',
      'func makeArray() {',
      '  return [1, 2]',
      '}',
      '',
      'struct S {',
      '  num value',
      '}',
      '',
      '@requires true',
      '@ensures (vf_struct(result) && (vf_int(vf_field(result, "value")) == 7))',
      'func makeStruct() {',
      '  var s = new S',
      '  s.value = 7',
      '  return s',
      '}',
      '',
      '@requires vf_number(x)',
      '@ensures (vf_bool(result) == vf_truthy(x))',
      'func normalize(x) {',
      '  return !(!x)',
      '}',
      ''
    ].join('\n'));

    const reparsed = await parseRuntimeProgram(pretty);
    expectErrors(reparsed.document);
  });

  test('prints while and do-while blocks with braces', async () => {
    const { model, document } = await parseRuntimeProgram(`
      var x = 0
      @invariant true
      @decreases 3
      while x < 3
        x = x + 1
      @invariant "true"
      do
        x = x - 1
      while x > 0
    `);

    expectErrors(document);

    const pretty = generatePrettyPseudo2(model);
    expect(pretty).toBe([
      'var x = 0',
      '',
      '@invariant true',
      '@decreases 3',
      'while (x < 3) {',
      '  x = (x + 1)',
      '}',
      '',
      '@invariant "true"',
      'do {',
      '  x = (x - 1)',
      '} while (x > 0)',
      ''
    ].join('\n'));

    const reparsed = await parseRuntimeProgram(pretty);
    expectErrors(reparsed.document);
  });

  test('prints for-loop invariants with braces', async () => {
    const { model, document } = await parseRuntimeProgram(`
      @invariant true
      for i = 1 to 2
        print i
    `);

    expectErrors(document);

    const pretty = generatePrettyPseudo2(model);
    expect(pretty).toBe([
      '@invariant true',
      'for i = 1 to 2 {',
      '  print i',
      '}',
      ''
    ].join('\n'));

    const reparsed = await parseRuntimeProgram(pretty);
    expectErrors(reparsed.document);
  });

  test('preserves nested array types and chained indices', async () => {
    const { model, document } = await parseRuntimeProgram(`
      struct Grid
        num[][] cells

      var matrix = [[1, 2], [3, 4]]
      matrix[2][1] = 9
    `);
    expectErrors(document);

    const pretty = generatePrettyPseudo2(model);
    expect(pretty).toContain('num[][] cells');
    expect(pretty).toContain('matrix[2][1] = 9');

    const reparsed = await parseRuntimeProgram(pretty);
    expectErrors(reparsed.document);
  });
});

function expectErrors(document: { diagnostics?: Array<{ severity?: number; message: string }> }): void {
  const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
  expect(errors.map(error => error.message).join('\n')).toBe('');
}
