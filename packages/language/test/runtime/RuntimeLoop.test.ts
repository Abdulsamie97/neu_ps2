import { describe, test } from 'vitest';
import { assertExecResult, assertExecThrows } from '../helpers/runtime-test-utils.js';

describe('RuntimeTestsLoop', () => {
  test('for loop with iterator', async () => {
    await assertExecResult(`
      for i = 2 to 5
        print i
    `, '2 3 4 5');
  });

  test('for loop without execution', async () => {
    await assertExecResult(`
      for i = 5 to 2
        print i
    `, '');
  });

  test('for loop keeps outer variable', async () => {
    await assertExecResult(`
      var i = 10
      for j = 2 to 5
        print j
      print i
    `, '2 3 4 5 10');
  });

  test('for loop by step', async () => {
    await assertExecResult(`
      for i = 2 to 5 by 2
        print i
    `, '2 4');
  });

  test('for loop by fractional step', async () => {
    await assertExecResult(`
      for i = 2 to 5 by 1/2
        print i
    `, '2 2.5 3 3.5 4 4.5 5');
  });

  test('for loop target is evaluated once', async () => {
    await assertExecResult(`
      var inner = 0
      var max = 5 + inner
      for i = 2 to max by 2
        print i
        max = max + 1
        inner = inner + 1
    `, '2 4');
  });

  test('for loop step is evaluated once', async () => {
    await assertExecResult(`
      var step = 1
      for i = 2 to 11 by step
        print i
        step = step + 1
    `, '2 3 4 5 6 7 8 9 10 11');
  });

  test('for loop rejects negative step', async () => {
    await assertExecThrows(`
      for i = 5 to 1 by -1
        print i
    `);
  });

  test('for loop without iterator variable', async () => {
    await assertExecResult(`
      var i = 0
      for 2 to 5
        print i
        i = i+1
    `, '0 1 2 3');
  });

  test('for loop without iterator variable by step', async () => {
    await assertExecResult(`
      var i = 0
      for 2 to 5 by 2
        print i
        i = i+1
    `, '0 1');
  });

  test('for loop without iterator rejects negative step', async () => {
    await assertExecThrows(`
      var x = 2
      var i = 0
      for 2 to 5 by -x
        print i
        i = i+1
    `);
  });

  test('downto loop with iterator', async () => {
    await assertExecResult(`
      for i=5 downto 2
        print i
    `, '5 4 3 2');
  });

  test('downto loop with step', async () => {
    await assertExecResult(`
      for i=5 downto 2 by 3/2
        print i
    `, '5 3.5 2');
  });

  test('to loop can be empty', async () => {
    await assertExecResult(`
      var i = 0
      for 5 to 2 by 2
        print i
        i = i+1
    `, '');
  });

  test('downto loop without iterator', async () => {
    await assertExecResult(`
      var i = 0
      for 5 downto 2 by 2
        print i
        i = i+1
    `, '0 1');
  });
});
