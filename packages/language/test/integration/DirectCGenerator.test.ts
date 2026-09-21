import { describe, expect, test } from 'vitest';

import { generateDirectCProgram, generateDirectCProgramWithSourceMap } from '../../src/generators/c/c-generator-direct.js';
import { parseRuntimeProgram } from '../helpers/runtime-test-utils.js';

async function directC(source: string): Promise<string> {
  const { model, document } = await parseRuntimeProgram(source);
  expect((document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message)).toEqual([]);
  return generateDirectCProgram(model);
}

describe('Direct C generator', () => {
  test('emits readable native arithmetic, functions and control flow', async () => {
    const c = await directC(`
      func add(a, b)
        return a + b
      var sum = add(2, 3)
      if sum == 5
        print sum
    `);
    expect(c).toContain('int add(int a, int b)');
    expect(c).toContain('return (a + b);');
    expect(c).toContain('if ((sum == 5))');
    expect(c).toContain('printf("%d\\n", sum);');
    expect(c).not.toContain('Ps2Value');
    expect(c).not.toContain('ps2_binary_op');
  });

  test('uses 1-based indexing and passes explicit array lengths', async () => {
    const c = await directC(`
      func first(A[1..n])
        return A[1]
      var A[3] = 0
      A[1] = 7
      print first(A)
    `);
    expect(c).toContain('int first(Ps2DirectArray_ps2_int_1 A)');
    expect(c).toContain('return A.data[ps2_checked_index(1, A.length)];');
    expect(c).toContain('A[ps2_checked_index(1, ps2_length_0)] = 7;');
    expect(c).toContain('if (index < 1 || index > length) abort();');
    expect(c).toMatch(/Ps2DirectArray_ps2_int_1 ps2_array_argument_\d+ = ps2_array_ref_ps2_int_1\(A, ps2_length_\d+\);/);
    expect(c).toMatch(/first\(ps2_array_argument_\d+\)/);
  });

  test('emits struct fields and free methods without a runtime', async () => {
    const c = await directC(`
      struct Counter
        num value
        inc(n)
          value = value + n
      var counter = new Counter
      call counter.inc(2)
      print counter.value
    `);
    expect(c).toContain('struct Counter {');
    expect(c).toContain('int value;');
    expect(c).toContain('void Counter_inc(struct Counter *mythis, int n)');
    expect(c).toContain('mythis->value = (mythis->value + n);');
    expect(c).toContain('Counter_inc(counter, 2);');
  });

  test('implements string concatenation without generating pointer arithmetic', async () => {
    const c = await directC(`print "a" + "b"`);
    expect(c).toContain('ps2_concat_text');
    expect(c).not.toContain('"a" + "b"');
  });

  test('returns arrays with typed data and length metadata', async () => {
    const c = await directC(`
      func make()
        return [1, 2]
      var values = make()
    `);
    expect(c).toContain('Ps2DirectArray_ps2_int_1 make(void)');
    expect(c).toMatch(/int \* values = ps2_values_array_\d+\.data;/);
    expect(c).toMatch(/int ps2_length_\d+ = ps2_values_array_\d+\.length;/);
  });

  test('preserves native VeriFast contracts and maps errors to Pseudo2 lines', async () => {
    const source = `//@ requires a > 0 &*& a <= INT_MAX - 1
//@ ensures result == a + 1
func inc(a)
  return a + 1
//@ assert false
print inc(2)`;
    const { model } = await parseRuntimeProgram(source);
    const generated = generateDirectCProgramWithSourceMap(model);
    expect(generated.code).toContain('//@ requires (((a > 0) &*& (a <= (INT_MAX - 1))));');
    expect(generated.code).toContain('//@ ensures ((result == (a + 1)));');
    const assertLine = generated.code.split('\n').findIndex(line => line.includes('//@ assert (false);')) + 1;
    expect(generated.sourceMap).toContainEqual({ generatedLine: assertLine, sourceLine: 5 });
  });

  test('renders array, struct and string content assertions as native VeriFast specs', async () => {
    const c = await directC(`
      struct Box
        num value
      var values = [2, 4]
      //@ assert values[1] == 2
      var item = new Box
      item.value = 5
      //@ assert item.value == 5
      var text = "abc"
      //@ assert text == "abc"
    `);
    expect(c).toMatch(/\/\/@ assert \(values\[0\.\.ps2_length_\d+\] \|-> \?ps2_assert_values_\d+\) &\*& \(\(nth\(1 - 1, ps2_assert_values_\d+\) == 2\)\);/);
    expect(c).toContain('//@ assert (item->value |-> 5);');
    expect(c).toContain('[_]string((char *)text, cons((char)97,');
    expect(c).toContain('free(item);');
  });

  test('rejects native floating-point contracts without a sound rational model', async () => {
    await expect(directC(`
      //@ ensures result > 0
      func half(a)
        return a / 2
    `)).rejects.toThrow(/Gleitkomma-\/Rationalmodell/);
  });

  test('rejects unannotated fractional programs in verification mode with the same clear boundary', async () => {
    await expect(directC(`
      var value = 3 / 2
      print value
    `)).rejects.toThrow(/ausfuehrbare Direct-C-Modus unterstuetzt/);
  });

  test('keeps fractional arithmetic executable in implementation mode', async () => {
    const source = `
      //@ ensures result > 0
      func half(a)
        return a / 2
      print half(5)
    `;
    const { model, document } = await parseRuntimeProgram(source);
    expect((document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message)).toEqual([]);
    const c = generateDirectCProgram(model, { runtime: 'implementation' });
    expect(c).toContain('double half(double a)');
    expect(c).toContain('return (a / 2.0);');
  });

  test('emits floating literals for both operands of native division', async () => {
    const { model, document } = await parseRuntimeProgram(`
      var value = 3 / 2
      print value
    `);
    expect((document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message)).toEqual([]);
    const c = generateDirectCProgram(model, { runtime: 'implementation' });
    expect(c).toContain('double value = (3.0 / 2.0);');
    expect(c).toContain('printf("%.15g\\n", value);');
  });

  test('uses string content comparison and avoids VeriFast-reserved identifiers', async () => {
    const c = await directC(`
      struct Box
        num value
      var box = new Box
      var text = "abc"
      if text == "abc"
        print box.value
    `);
    expect(c).toContain('struct Box * ps2_box');
    expect(c).toContain('ps2_text_equal_nonnull(text, "abc")');
  });

  test('passes raw proof commands and loop variants to native VeriFast syntax', async () => {
    const c = await directC(`
      //@ terminates
      func count(n)
        var value = 0
        //@ invariant value <= n
        //@ decreases n - value
        while value < n
          value = value + 1
        @assert "true"
        return value
    `);
    expect(c).toContain('//@ terminates;');
    expect(c).toContain('//@ decreases (n - value);');
    expect(c).toContain('//@ assert (true);');
  });

  test('uses recursively verified pointer descriptors for nested array reads and writes', async () => {
    const c = await directC(`
      func update(matrix[1..rows], row, column, value)
        matrix[row][column] = value
        return matrix[row][column]
      var matrix = [[1, 2], [3, 4]]
      print update(matrix, 2, 1, 9)
    `);
    expect(c).toContain('Ps2DirectArray_ps2_int_1 **data;');
    expect(c).toContain('static int ps2_array_get_ps2_int_2');
    expect(c).toContain('static void ps2_array_set_ps2_int_2');
    expect(c).toContain('ps2_array_set_ps2_int_2(matrix, row, column, value);');
    expect(c).toContain('return ps2_array_get_ps2_int_2(matrix, row, column);');
  });

  test('materializes array arguments before declarations, assignments and print calls', async () => {
    const c = await directC(`
      func first(A[1..n])
        return A[1]
      var values = [3, 4]
      var answer = first(values)
      answer = first(values)
      print first(values)
    `);
    const descriptorBindings = c.match(/Ps2DirectArray_ps2_int_1 ps2_array_argument_\d+ = ps2_array_ref_ps2_int_1\(values, ps2_length_\d+\);/g) ?? [];
    expect(descriptorBindings).toHaveLength(3);
    expect(c).not.toMatch(/first\(ps2_array_ref_ps2_int_1\(/);
  });

  test('prints arrays, nested arrays and structs with typed native helpers', async () => {
    const source = `
      struct Box
        num value
      var values = [1, 2]
      var matrix = [[1, 2], [3, 4]]
      var box = new Box
      print values
      print matrix
      print box
    `;
    const { model, document } = await parseRuntimeProgram(source);
    expect((document.diagnostics ?? []).filter(d => d.severity === 1).map(d => d.message)).toEqual([]);
    const c = generateDirectCProgram(model, { runtime: 'implementation' });
    expect(c).toContain('static void ps2_write_Ps2DirectArray_ps2_int_1');
    expect(c).toContain('static void ps2_write_Ps2DirectArray_ps2_int_2');
    expect(c).toMatch(/ps2_print_Ps2DirectArray_ps2_int_1\(ps2_array_ref_ps2_int_1\(values, ps2_length_\d+\)\);/);
    expect(c).toMatch(/ps2_print_Ps2DirectArray_ps2_int_2\(ps2_array_ref_ps2_int_2\(matrix, ps2_length_\d+\)\);/);
    expect(c).toMatch(/ps2_print_direct_struct\((?:ps2_)?box\);/);
  });

  test('evaluates string-returning calls once in equality checks', async () => {
    const c = await directC(`
      func text()
        return "value"
      if text() == "value"
        print "equal"
    `);
    expect(c).toContain('bool ps2_text_equal');
    expect(c).toContain('if (ps2_text_equal_nonnull(text(), "value"))');
  });

});
