/**
 * @file UpdateOperators.test.ts
 * @brief Prueft Syntax, Validierung und JavaScript-Semantik veraendernder Operatoren.
 * @author Abdul
 */

import { describe, expect, test } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import {
  createPseudo2Services,
  generateCProgram,
  generateDirectCProgram,
  generateGraphvizAst,
  generateGraphvizDep,
  generatePrettyPseudo2,
  generateProgram,
  type Program
} from 'pseudo2-language';

let counter = 0;

async function parse(source: string): Promise<{ program: Program; errors: string[]; parserErrors: string[] }> {
  const services = createPseudo2Services(EmptyFileSystem);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(
    source, URI.parse(`memory:/operator-test-${counter++}.pseudo2`)
  );
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
  return {
    program: document.parseResult.value as Program,
    errors: (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1)
      .map(diagnostic => diagnostic.message),
    parserErrors: document.parseResult.parserErrors.map(error => error.message)
  };
}

function run(program: Program): string[] {
  const output: string[] = [];
  const captured = {
    log: (value: unknown) => output.push(String(value)),
    __ps2_write: (value: unknown, ending: string) => output.push(`${String(value)}${ending}`)
  };
  new Function('console', generateProgram(program))(captured);
  return output;
}

describe('Veraendernde Operatoren', () => {
  test('Postfix liefert den alten und Praefix den neuen Wert', async () => {
    const { program, errors } = await parse('var cnt = 1\nprint cnt++\nprint ++cnt\nprint cnt');
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['1', '3', '3']);
    const pretty = generatePrettyPseudo2(program);
    expect(pretty).toContain('cnt++');
    expect(pretty).toContain('++cnt');
  });

  test('Dekrement hat dieselbe Praefix- und Postfix-Semantik', async () => {
    const { program, errors } = await parse('var cnt = 3\nprint cnt--\nprint --cnt\nprint cnt');
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['3', '1', '1']);
    const c = generateCProgram(program);
    expect(c).toContain('ps2_post_dec(&cnt_0)');
    expect(c).toContain('ps2_pre_dec(&cnt_0)');
  });

  test('Praefix und Postfix funktionieren auch als eigene Anweisung', async () => {
    const { program, errors } = await parse('var cnt = 1\n++cnt\ncnt++\nprint cnt');
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['3']);
    expect(generateDirectCProgram(program, { runtime: 'implementation' })).toContain('++cnt;');
  });

  test('Postfix kann in einem arithmetischen Ausdruck verwendet werden', async () => {
    const { program, errors } = await parse('var cnt = 1\nvar value = cnt++ + 1\nprint value\nprint cnt');
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['2', '2']);
    expect(generateCProgram(program)).toMatch(/__update_\d+ = ps2_post_inc\(&cnt_0\)/);
    expect(generateDirectCProgram(program, { runtime: 'implementation' })).toMatch(/ps2_update_\d+ = cnt\+\+/);
  });

  test('Arrayindex verwendet den alten Zaehler und wertet ihn nur einmal aus', async () => {
    const { program, errors } = await parse([
      'var cnt = 1',
      'var A = [0, 0]',
      'A[cnt++] = cnt',
      'print A[1]',
      'print cnt'
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['2', '2']);
    const c = generateCProgram(program);
    expect(c).toContain('ps2_post_inc(&cnt_0)');
    expect(c).toMatch(/__targetIndex_\d+ = ps2_copy_value\(ps2_post_inc\(&cnt_0\)\)/);
    expect(c).toMatch(/ps2_array_set\(A_\d+, __targetIndex_\d+, cnt_0\)/);
  });

  test('Zusammengesetzte Zuweisungen behalten Zahlen- und Stringsemantik', async () => {
    const { program, errors } = await parse([
      'var n = 2', 'n += 3', 'n *= 4', 'n -= 2', 'n /= 3', 'print n',
      'var s = "a"', 's += "b"', 'print s'
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['6', 'ab']);
    expect(generatePrettyPseudo2(program)).toContain('n += 3');
    const c = generateCProgram(program);
    expect(c).toContain('ps2_add(');
    expect(c).toContain('ps2_multiply(');
    expect(c).toContain('ps2_subtract(');
    expect(c).toContain('ps2_divide(');
  });

  test('Array-Zuweisung wertet einen Postfix-Index vor der rechten Seite aus', async () => {
    const { program, errors } = await parse([
      'var cnt = 1', 'var A = [4, 4]', 'A[cnt++] += cnt', 'print A[1]', 'print cnt'
    ].join('\n'));
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['6', '2']);
    const runtimeC = generateCProgram(program);
    expect(runtimeC).toMatch(/__targetIndex_\d+ = ps2_copy_value\(ps2_post_inc\(&cnt_0\)\)/);
    expect(runtimeC).toMatch(/ps2_array_get\(A_\d+, __targetIndex_\d+\)/);
    const c = generateDirectCProgram(program, { runtime: 'implementation' });
    expect(c).toContain('cnt++');
    expect(c).toMatch(/int ps2_index_\d+ = cnt\+\+;/);
    expect(c).toMatch(/A\[ps2_checked_index\(ps2_index_\d+, ps2_length_\d+\)\] = \(ps2_compound_old_/);
  });

  test('Direct C wertet das Postfix-Ziel vor dem rechten Ausdruck aus', async () => {
    const { program, errors } = await parse('var cnt = 1\nvar A = [0, 0]\nA[cnt++] = cnt\nprint A[1]');
    expect(errors).toEqual([]);
    const c = generateDirectCProgram(program, { runtime: 'implementation' });
    expect(c).toMatch(/int ps2_index_\d+ = cnt\+\+;/);
    expect(c).toMatch(/A\[ps2_checked_index\(ps2_index_\d+, ps2_length_\d+\)\] = ps2_assignment_value_\d+;/);
    expect(c.indexOf(' = cnt++;')).toBeLessThan(c.indexOf(' = cnt;'));
  });

  test('Updates auf Strings und Schleifeniteratoren werden abgelehnt', async () => {
    const text = await parse('var s = "a"\ns++');
    expect(text.errors.some(error => error.includes('erwarten num'))).toBe(true);
    const loop = await parse('for i=1 to 2\n    i++');
    expect(loop.errors.some(error => error.includes('Schleifenvariable'))).toBe(true);
    const annotation = await parse('var n = 1\n//@ assert n++ == 1');
    expect(annotation.parserErrors.length).toBeGreaterThan(0);
    const prefixAnnotation = await parse('var n = 1\n//@ assert ++n == 1');
    expect(prefixAnnotation.parserErrors.length).toBeGreaterThan(0);
    const length = await parse('func f(A[1..n])\n    n++');
    expect(length.errors.some(error => error.includes('Arraylaenge'))).toBe(true);
    const repeated = await parse('var cnt = 1\nprint cnt++ + cnt');
    expect(repeated.errors.some(error => error.includes('selben Ausdruck'))).toBe(true);
    const shortCircuit = await parse('var cnt = 1\nprint false && cnt++');
    expect(shortCircuit.errors.some(error => error.includes('bedingt ausgewerteten Seite'))).toBe(true);
    const earlierCall = await parse('func f()\n    return 1\nvar cnt = 1\nprint f() + cnt++');
    expect(earlierCall.errors.some(error => error.includes('getrennten Anweisungen'))).toBe(true);
  });

  test('Graphviz beschriftet Update und Kurzzuweisung', async () => {
    const { program, errors } = await parse('var cnt = 1\ncnt += 2\nprint cnt++');
    expect(errors).toEqual([]);
    expect(generateGraphvizAst(program)).toContain('PostfixUpdate');
    expect(generateGraphvizAst(program)).toContain('+=');
    expect(generateGraphvizDep(program)).toContain('color="red"');
  });

  test('Direct C erlaubt Stringverkettung mit Zahlen bei +=', async () => {
    const { program, errors } = await parse('var s = "a"\ns += 2\nprint s');
    expect(errors).toEqual([]);
    expect(run(program)).toEqual(['a2']);
    expect(generateDirectCProgram(program, { runtime: 'implementation' })).toContain('ps2_concat_text(');
  });
});
