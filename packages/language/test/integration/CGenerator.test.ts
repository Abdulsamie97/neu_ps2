import { describe, expect, test } from 'vitest';

import { generateCProgram } from '../../src/c-generator-core.js';
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
    expect(c).toContain('static Ps2Value* A_0;');
    expect(c).toContain('Ps2Value* func_add_0(Ps2Value* a_1, Ps2Value* b_2);');
    expect(c).toContain('Ps2Value* create_S_0(void);');
    expect(c).toContain('Ps2Value* func_inc_1(Ps2Value* mythis, Ps2Value* x_4);');
    expect(c).toContain('//@ requires true;');
    expect(c).toContain('ps2_array_set(A_0, ps2_num(1), ps2_num(4));');
    expect(c).toContain('s_5 = ps2_copy_value(create_S_0());');
    expect(c).toContain('ps2_struct_set(s_5, "value_3", func_add_0(ps2_array_get(A_0, ps2_num(1)), ps2_num(1)));');
    expect(c).toContain('ps2_print(func_inc_1(s_5, ps2_num(2)));');
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
    expect(c).toContain('func_first_0(A_2, ps2_num((double)ps2_array_length(A_2)))');
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

    expect(c).toContain('while (ps2_truthy(ps2_bool(ps2_compare("<", x_0, ps2_num(2)))))');
    expect(c).toMatch(/do\s+\{/);
    expect(c).toContain('for (; ps2_as_num(i_1) <= ps2_as_num(');
    expect(c).toContain('if (ps2_truthy(ps2_bool(ps2_equals(x_0, ps2_num(0)))))');
    expect(c).toContain('ps2_throw(ps2_string("bad"));');
  });
});

async function generateC(text: string): Promise<string> {
  const { model, document } = await parseRuntimeProgram(text);
  const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
  expect(errors.map(error => error.message).join('\n')).toBe('');
  return generateCProgram(model);
}
