import { describe, expect, test } from 'vitest';

import { generateCProgram, generateCProgramWithSourceMap } from '../../src/c-generator-core.js';
import { parseRuntimeProgram } from '../helpers/runtime-test-utils.js';

describe('CGenerator', () => {
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
    expect(c).toContain('ps2_struct_set_model(s_5, "value_3", 0, func_add_0(ps2_array_get(A_0, ps2_int(1)), ps2_int(1)));');
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

    expect(c).toContain('while (ps2_truthy(ps2_bool(ps2_compare("<", x_0, ps2_int(2)))))');
    expect(c).toContain('//@ invariant x_0 |-> _;');
    expect(c).toMatch(/do\s+\/\/@ invariant/);
    expect(c).toContain('while (ps2_as_num(i_1) <= ps2_as_num(');
    expect(c).toContain('if (ps2_truthy(ps2_bool(ps2_equals(x_0, ps2_int(0)))))');
    expect(c).toContain('ps2_throw(ps2_string("bad"));');
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
      @ensures vf_array(result) && vf_len(result) == 2
      func makeArray()
        return [1, 2]

      @requires true
      @ensures vf_array(result) && vf_int(vf_elem(result, 1)) == 7
      func makeArrayWithElement()
        var A[2] = 0
        A[1] = 7
        return A

      struct S
        num value

      @requires true
      @ensures vf_struct(result)
      func makeStruct()
        return new S

      @requires true
      @ensures vf_struct(result) && vf_int(vf_field(result, "value")) == 7
      func makeStructWithField()
        var s = new S
        s.value = 7
        return s
    `);

    expect(c).toContain('fixpoint bool ps2_model_value(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_array(Ps2Value* value);');
    expect(c).toContain('fixpoint bool ps2_model_struct(Ps2Value* value);');
    expect(c).toContain('fixpoint int ps2_model_array_length(Ps2Value* value);');
    expect(c).toContain('fixpoint int ps2_model_int(Ps2Value* value);');
    expect(c).toContain('fixpoint Ps2Value* ps2_model_array_item(Ps2Value* value, int index);');
    expect(c).toContain('fixpoint Ps2Value* ps2_model_struct_field(Ps2Value* value, int field);');
    expect(c).toContain('//@ ensures ((ps2_model_value(result) == true) && (ps2_model_int(result) == 7));');
    expect(c).toContain('//@ ensures ((ps2_model_array(result) == true) && (ps2_model_array_length(result) == 2));');
    expect(c).toContain('//@ ensures ((ps2_model_array(result) == true) && (ps2_model_int(ps2_model_array_item(result, 1)) == 7));');
    expect(c).toContain('//@ ensures (ps2_model_struct(result) == true);');
    expect(c).toContain('//@ ensures ((ps2_model_struct(result) == true) && (ps2_model_int(ps2_model_struct_field(result, 0)) == 7));');
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

    expect(c).toContain('ps2_struct_define(__ps2_obj, 0, "value_0", ps2_undefined());');
    expect(c).toContain('ps2_struct_define(__ps2_obj, 0, "value_1", ps2_undefined());');
    expect(c).toContain('//@ ensures ((ps2_model_struct(result) == true) && (ps2_model_int(ps2_model_struct_field(result, 1)) == 7));');
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
