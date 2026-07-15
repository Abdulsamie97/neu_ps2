import { describe, expect, test } from 'vitest';

import { generateCProgram, generateCProgramWithSourceMap } from '../../src/c-generator-core.js';
import { parseRuntimeProgram } from '../helpers/runtime-test-utils.js';

describe('CGenerator', () => {
  test('generates chained array reads and writes for nested arrays', async () => {
    const c = await generateC(`
      func nested()
        var matrix = [[1, 2], [3, 4]]
        matrix[2][1] = 9
        return matrix[1][2]
    `);

    expect(c).toMatch(/Ps2Value\* __heapRead_\d+ = ps2_array_get\(matrix_\d+, ps2_int\(2\)\);/);
    expect(c).toMatch(/ps2_array_set\(__heapRead_\d+, ps2_int\(1\), ps2_int\(9\)\);/);
    expect(c).toMatch(/ps2_array_get\(__heapRead_\d+, ps2_int\(2\)\)/);
  });

  test('releases replaced child ownership after its last container slot is overwritten', async () => {
    const c = await generateC(`
      struct Buffer
        num[] values

      struct Cell
        num value

      func replaceChildren()
        var buffer = new Buffer
        var first[1] = 1
        var second[1] = 2
        buffer.values = first
        buffer.values = second

        var oldCell = new Cell
        var newCell = new Cell
        var cells[1] = oldCell
        cells[1] = newCell
        return buffer
    `);

    expect(c).toMatch(/Ps2Value\* __replacedHeap_\d+ = ps2_struct_get_model\(buffer_\d+, "values_\d+", 0\);\n\s*\/\/@ leak ps2_array_state\(__replacedHeap_\d+, _\);/);
    expect(c).toMatch(/Ps2Value\* __replacedHeap_\d+ = ps2_array_get\(cells_\d+, ps2_int\(1\)\);\n\s*\/\/@ leak ps2_struct_state\(__replacedHeap_\d+, _\);/);
  });

  test('does not treat mutually exclusive branch assignments as sequential replacement', async () => {
    const c = await generateC(`
      struct Buffer
        num[] values

      func choose(flag)
        var buffer = new Buffer
        var first[1] = 1
        var second[1] = 2
        if flag
          buffer.values = first
        else
          buffer.values = second
        return buffer
    `);

    expect(c).not.toContain('__replacedHeap');
  });

  test('guards repeated child replacement inside loops by pointer identity', async () => {
    const c = await generateC(`
      struct Buffer
        num[] values

      func replaceInLoop(flag)
        var buffer = new Buffer
        var first[1] = 1
        var second[1] = 2
        buffer.values = first
        while flag
          buffer.values = second
          flag = false
        return buffer
    `);

    expect(c).toMatch(/if \(__replacedHeap_\d+ != second_\d+\) \{\n\s*\/\/@ leak ps2_array_state\(__replacedHeap_\d+, _\);/);
  });

  test('generates VeriFast-ready C for arrays, functions, structs and methods', async () => {
    const c = await generateC(`
      var A[3] = 0
      A[1] = 4

      func add(a, b)
        return a + b

      struct S
        num value
        inc(x)
          this.value = this.value + x
          return this.value

      var s = new S
      s.value = add(A[1], 1)
      print s.inc(2)
    `);

    expect(c).toContain('typedef struct Ps2Value { int _; } Ps2Value;');
    expect(c).toContain('Ps2Value* ps2_num(double number);');
    expect(c).toContain('Ps2Value* ps2_int(int number);');
    expect(c).toContain('static Ps2Value* A_0;');
    expect(c).toContain('Ps2Value* func_add_0(Ps2Value* a_1, Ps2Value* b_2);');
    expect(c).toContain('Ps2Value* create_S_0(void);');
    expect(c).toContain('Ps2Value* func_inc_1(Ps2Value* mythis, Ps2Value* x_4);');
    expect(c).toContain('//@ requires true;');
    expect(c).toContain('ps2_array_set(A_0, ps2_int(1), ps2_int(4));');
    expect(c).toContain('s_5 = ps2_copy_value(create_S_0());');
    expect(c).toMatch(/Ps2Value\* __heapRead_\d+ = ps2_array_get\(A_0, ps2_int\(1\)\);/);
    expect(c).toMatch(/ps2_struct_set_model\(s_5, "value_3", 0, func_add_0\(__heapRead_\d+, ps2_int\(1\)\)\);/);
    expect(c).toContain('ps2_print(func_inc_1(s_5, ps2_int(2)));');
  });

  test('passes array length parameters like the JavaScript generator', async () => {
    const c = await generateC(`
      func first(A[1..n])
        print n
        return A[1]

      var A[2] = 7
      print first(A)
    `);

    expect(c).toContain('Ps2Value* func_first_0(Ps2Value* A_0, Ps2Value* n_1);');
    expect(c).toContain('func_first_0(A_2, ps2_int(ps2_array_length(A_2)))');
  });

  test('maps Pseudo2 verification annotations to VeriFast comments', async () => {
    const c = await generateC(`
      @requires true
      @ensures "true"
      func verified()
        @assert true
        return 5

      print verified()
    `);

    expect(c).toContain('Ps2Value* func_verified_0(void)');
    expect(c).toContain('//@ requires true;');
    expect(c).toContain('//@ ensures true;');
    expect(c).toContain('//@ assert true;');
  });

  test('creates a C-to-Pseudo2 source map for verification statements', async () => {
    const source = [
      '@requires true',
      '@ensures true',
      'func verified()',
      '  @assert false',
      '  return 5',
      '',
      'print verified()'
    ].join('\n');
    const { model, document } = await parseRuntimeProgram(source);
    const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
    expect(errors.map(error => error.message).join('\n')).toBe('');

    const generated = generateCProgramWithSourceMap(model);
    expect(generated.code).not.toContain('@@pseudo2-source-line');

    const cLines = generated.code.split(/\r?\n/);
    const assertLine = cLines.findIndex(line => line.includes('//@ assert false;')) + 1;
    expect(assertLine).toBeGreaterThan(0);
    expect(generated.sourceMap.find(entry => entry.generatedLine === assertLine)?.sourceLine).toBe(4);
  });

  test('emits control flow constructs and throw support', async () => {
    const c = await generateC(`
      var x = 0
      while x < 2
        x = x + 1

      do
        x = x - 1
      while x > 0

      for i = 1 to 2
        print i

      if x == 0
        print true
      else
        throw "bad"
    `);

    expect(c).toContain('while (ps2_truthy(ps2_bool(ps2_less(x_0, ps2_int(2)))))');
    expect(c).toContain('//@ invariant x_0 |-> _;');
    expect(c).toMatch(/do\s+\/\/@ invariant/);
    expect(c).toContain('while (ps2_less_equal(i_1,');
    expect(c).toContain('i_1 = ps2_copy_value(ps2_add(i_1,');
    expect(c).toContain('if (ps2_truthy(ps2_bool(ps2_equals(x_0, ps2_int(0)))))');
    expect(c).toContain('ps2_throw(ps2_string_literal_0());');
  });

  test('maps loop invariant annotations to VeriFast comments', async () => {
    const source = [
      'var i = 1',
      '@invariant false',
      'while i < 2',
      '  i = i + 1',
      '',
      '@invariant true',
      'for j = 1 to 2',
      '  @assert true'
    ].join('\n');
    const { model, document } = await parseRuntimeProgram(source);
    const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
    expect(errors.map(error => error.message).join('\n')).toBe('');

    const generated = generateCProgramWithSourceMap(model);
    expect(generated.code).toContain('//@ invariant (false)');
    expect(generated.code).toContain('//@ invariant (true)');

    const cLines = generated.code.split(/\r?\n/);
    const falseInvariantLine = cLines.findIndex(line => line.includes('//@ invariant (false)')) + 1;
    const trueInvariantLine = cLines.findIndex(line => line.includes('//@ invariant (true)')) + 1;

    expect(falseInvariantLine).toBeGreaterThan(0);
    expect(trueInvariantLine).toBeGreaterThan(0);
    expect(generated.sourceMap.find(entry => entry.generatedLine === falseInvariantLine)?.sourceLine).toBe(2);
    expect(generated.sourceMap.find(entry => entry.generatedLine === trueInvariantLine)?.sourceLine).toBe(6);
  });

  test('emits result, terminates and ghost verification statements', async () => {
    const c = await generateC(`
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

    expect(c).toContain('//@ ensures (result != 0);');
    expect(c).toContain('//@ terminates;');
    expect(c).toContain('//@ assume(true);');
    expect(c).toContain('//@ open P();');
    expect(c).toContain('//@ close P();');
    expect(c).toContain('//@ leak P();');
  });

  test('emits structured VeriFast model helpers', async () => {
    const c = await generateC(`
      @requires true
      @ensures vf_value(result) && vf_int(result) == 7
      func seven()
        return 7

      @requires true
      @ensures vf_bool(result)
      func yes()
        return true

      @requires true
      @ensures !vf_bool(result)
      func no()
        return false

      @requires true
      @ensures vf_string(result, "hi")
      func text()
        return "hi"

      @requires true
      @ensures vf_null(result)
      func none()
        return null

      @requires true
      @ensures vf_array(result) && vf_len(result) == 2 && vf_int(vf_elem(result, 2)) == 2
      func makeArray()
        return [1, 2]

      @requires vf_array(A) && vf_in_bounds(A, i) && vf_int(vf_elem(A, i)) == 7
      @ensures vf_int(result) == 7
      func getAt(A[1..n], i)
        return A[i]

      @requires true
      @ensures vf_array(result) && vf_int(vf_elem(result, 1)) == 7
      func makeArrayWithElement()
        var A[2] = 0
        A[1] = 7
        return A

      @requires true
      @ensures vf_array(result) && vf_int(vf_elem(result, 1)) == 7 && vf_int(vf_elem(result, 2)) == 7
      func makeFilledArray()
        var A[2] = 7
        return A

      struct S
        num value

      @requires true
      @ensures vf_struct(result) && vf_undefined(vf_field(result, "value"))
      func makeStruct()
        return new S

      @requires true
      @ensures vf_struct(result) && vf_int(vf_field(result, "value")) == 7
      func makeStructWithField()
        var s = new S
        s.value = 7
        return s

      @requires vf_struct(s) && vf_int(vf_field(s, "value")) == 7
      @ensures vf_int(result) == 7
      func readValue(s)
        return s.value

      @requires true
      @ensures vf_int(result) == 7
      func callReadValue()
        var s = new S
        s.value = 7
        return readValue(s)
    `);

    expect(c).toContain('fixpoint bool ps2_model_value(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_array(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_struct(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_bool(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_string(Ps2Value* value);');
    expect(c).toContain('fixpoint list<int> ps2_model_string_content(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_null(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_undefined(Ps2Value* value);');
    expect(c).toContain('fixpoint int ps2_model_array_length(Ps2Value* value);');
    expect(c).toContain('fixpoint int ps2_model_int(Ps2Value* value);');
    expect(c).toContain('fixpoint Ps2Value* ps2_model_array_item(Ps2Value* value, int index);');
    expect(c).toContain('fixpoint Ps2Value* ps2_model_struct_field(Ps2Value* value, int field);');
    expect(c).toContain('predicate ps2_array_state(Ps2Value* value; list<Ps2Value*> items);');
    expect(c).toContain('predicate ps2_struct_builder_state(Ps2Struct* value; int capacity, list<pair<int, Ps2Value*> > fields);');
    expect(c).toContain('predicate ps2_struct_state(Ps2Value* value; list<pair<int, Ps2Value*> > fields);');
    expect(c).toContain('Ps2Value* ps2_array_literal_2(Ps2Value* item_0, Ps2Value* item_1);');
    expect(c).toContain('ps2_array_state(result, cons(item_0, cons(item_1, nil)))');
    expect(c).toContain('Ps2Value* ps2_array_filled_2(Ps2Value* item);');
    expect(c).toContain('ps2_array_state(result, cons(item, cons(item, nil)))');
    expect(c).toContain('return ps2_copy_value(ps2_array_literal_2(ps2_int(1), ps2_int(2)));');
    expect(c).toContain('ps2_array_filled_2(ps2_int(7));');
    expect(c).toContain('//@ ensures ((ps2_model_value(result) == true) && (ps2_model_int(result) == 7));');
    expect(c).toContain('//@ ensures (ps2_model_bool(result) == true);');
    expect(c).toContain('//@ ensures (!(ps2_model_bool(result) == true));');
    expect(c).toContain('//@ ensures ((ps2_model_string(result) == true) && (ps2_model_string_content(result) == cons(104, cons(105, nil))));');
    expect(c).toContain('ps2_model_string_content(result) == ps2_model_string_content(value)');
    expect(c).toContain('ps2_model_string_content(result) == cons(104, cons(105, nil))');
    expect(c).toContain('//@ ensures (ps2_model_null(result) == true);');
    expect(c).toContain('length(__ps2_array_ensures_0) == 2');
    expect(c).toContain('ps2_model_int(nth(2 - 1, __ps2_array_ensures_0)) == 2');
    expect(c).toContain('ps2_array_state(A_0, ?__ps2_array_requires_0)');
    expect(c).toContain('ps2_model_int(nth(ps2_model_int(i_2) - 1, __ps2_array_requires_0)) == 7');
    expect(c).toContain('ps2_model_int(nth(1 - 1, __ps2_array_ensures_0)) == 7');
    expect(c).toContain('ps2_model_int(nth(2 - 1, __ps2_array_ensures_0)) == 7');
    expect(c).toContain('ps2_struct_state(result, ?__ps2_factory_fields)');
    expect(c).toContain('ps2_model_undefined(ps2_struct_field_lookup(0, __ps2_factory_fields)) == true');
    expect(c).not.toContain('//@ assume(ps2_model_undefined(ps2_model_struct_field(__ps2_value, 0)) == true);');
    expect(c).toContain('ps2_model_undefined(ps2_struct_field_lookup(0, __ps2_struct_ensures_0)) == true');
    expect(c).toContain('ps2_model_int(ps2_struct_field_lookup(0, __ps2_struct_ensures_0)) == 7');
    expect(c).toContain('ps2_struct_state(s_7, ?__ps2_struct_requires_0)');
    expect(c).toContain('ps2_model_int(ps2_struct_field_lookup(0, __ps2_struct_requires_0)) == 7');
  });

  test('treats direct annotation array access like vf_elem', async () => {
    const legacy = await generateC(`
      @requires vf_array(matrix) && vf_array(vf_elem(matrix, 1)) && vf_int(vf_elem(vf_elem(matrix, 1), 2)) == 7
      @ensures vf_int(result) == 7
      func read(matrix[1..rows])
        return matrix[1][2]
    `);
    const direct = await generateC(`
      @requires vf_array(matrix) && vf_array(matrix[1]) && vf_int(matrix[1][2]) == 7
      @ensures vf_int(result) == 7
      func read(matrix[1..rows])
        return matrix[1][2]
    `);

    expect(direct).toBe(legacy);
    expect(direct).toContain('ps2_array_state(matrix_0, ?__ps2_array_requires_0)');
    expect(direct).toMatch(/ps2_array_state\(nth\(1 - 1, __ps2_array_requires_0\), \?__ps2_array_requires_\d+\)/);
    expect(direct).toMatch(/ps2_model_int\(nth\(2 - 1, __ps2_array_requires_\d+\)\) == 7/);
  });

  test('keeps direct annotation heap access forbidden in assume', async () => {
    await expect(generateC(`
      func invalidAssume()
        var A[1] = 7
        @assume vf_int(A[1]) == 7
        return 0
    `)).rejects.toThrow('Heap model helpers are not supported in @assume');
  });

  test('emits precise arithmetic, comparison, equality and truthiness contracts', async () => {
    const c = await generateC(`
      @requires true
      @ensures vf_int(result) == 5
      func arithmetic()
        return (2 + 3) * 1

      @requires true
      @ensures vf_int(result) == 2 ^ 3
      func power()
        return 2 ^ 3

      @requires true
      @ensures vf_bool(result)
      func comparison()
        return 2 < 3

      @requires true
      @ensures vf_bool(result)
      func equality()
        return "same" == "same"

      @requires true
      @ensures !vf_bool(result)
      func truthiness()
        return true && false
    `);

    expect(c).toContain('inductive Ps2ModelKind =');
    expect(c).toContain('fixpoint real ps2_model_real(Ps2Value* value);');
    expect(c).toContain('fixpoint int ps2_model_power(int base, int exponent) {');
    expect(c).toContain('ps2_multiply(ps2_add(ps2_int(2), ps2_int(3)), ps2_int(1))');
    expect(c).toContain('ps2_power(ps2_int(2), ps2_int(3))');
    expect(c).toContain('ps2_bool(ps2_less(ps2_int(2), ps2_int(3)))');
    expect(c).toContain('ps2_bool(ps2_equals(ps2_string_literal_0(), ps2_string_literal_0()))');
    expect(c).toContain('ps2_bool(ps2_truthy(ps2_bool(1)) && ps2_truthy(ps2_bool(0)))');
    expect(c).toContain('ps2_model_int(result) == ps2_model_int(left) + ps2_model_int(right)');
    expect(c).toContain('ps2_model_real(result) == ps2_model_real(left) + ps2_model_real(right)');
    expect(c).toContain('ps2_model_string_content(left) == ps2_model_string_content(right)');
    expect(c).toContain('ps2_model_string_content(value) != nil');
  });

  test('resolves vf_field through the concrete result struct type', async () => {
    const c = await generateC(`
      struct Other
        num value

      struct S
        num value

      @requires true
      @ensures vf_struct(result) && vf_int(vf_field(result, "value")) == 7
      func makeStruct()
        var s = new S
        s.value = 7
        return s
    `);

    expect(c).toContain('ps2_struct_define(__ps2_obj, 0, 0, "value_0", ps2_undefined());');
    expect(c).toContain('ps2_struct_define(__ps2_obj, 0, 1, "value_1", ps2_undefined());');
    expect(c).toContain('ps2_model_int(ps2_struct_field_lookup(1, __ps2_struct_ensures_0)) == 7');
  });

  test('selects Z3 for annotated loops that mutate Struct fields', async () => {
    const c = await generateC(`
      struct Counter
        num value

      @requires true
      @ensures vf_struct(result) && vf_int(vf_field(result, "value")) == 1
      func count()
        var counter = new Counter
        counter.value = 0
        var i = 0
        @invariant vf_struct(counter) && vf_integer(vf_field(counter, "value")) && vf_int(vf_field(counter, "value")) == vf_int(i) && vf_integer(i) && vf_int(i) >= 0 && vf_int(i) <= 1
        while i < 1
          counter.value = counter.value + 1
          i = i + 1
        return counter
    `);

    expect(c).toMatch(/^\/\/verifast_options\{prover:Z3v4\.5\}/);
  });

  test('keeps the default prover for array-only loops', async () => {
    const c = await generateC(`
      @requires true
      @ensures vf_array(result) && vf_len(result) == 1
      func fill()
        var values[1] = 0
        var i = 0
        @invariant vf_array(values) && vf_len(values) == 1 && vf_integer(i) && vf_int(i) >= 0 && vf_int(i) <= 1
        while i < 1
          values[1] = i
          i = i + 1
        return values
    `);

    expect(c).not.toContain('//verifast_options{prover:Z3v4.5}');
  });

  test('maps loop decreases annotations to Pseudo2 lines', async () => {
    const source = [
      'var i = 0',
      '@invariant true',
      '@decreases 2',
      'while i < 1',
      '  i = i + 1'
    ].join('\n');
    const { model, document } = await parseRuntimeProgram(source);
    const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
    expect(errors.map(error => error.message).join('\n')).toBe('');

    const generated = generateCProgramWithSourceMap(model);
    expect(generated.code).toContain('//@ decreases 2;');

    const cLines = generated.code.split(/\r?\n/);
    const decreasesLine = cLines.findIndex(line => line.includes('//@ decreases 2;')) + 1;

    expect(decreasesLine).toBeGreaterThan(0);
    expect(generated.sourceMap.find(entry => entry.generatedLine === decreasesLine)?.sourceLine).toBe(3);
  });
});

async function generateC(text: string): Promise<string> {
  const { model, document } = await parseRuntimeProgram(text);
  const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
  expect(errors.map(error => error.message).join('\n')).toBe('');
  return generateCProgram(model);
}
