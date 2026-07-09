import { describe, test } from 'vitest';
import { assertExecResult, assertExecThrows } from '../helpers/runtime-test-utils.js';

describe('RuntimeTestsArray', () => {
  test('array declaration initializes all cells', async () => {
    await assertExecResult(`
      var res = ""
      var A[5] = 2

      for i=1 to 5
        res = res + A[i]
      print res
    `, '22222');
  });

  test('array size can be an expression', async () => {
    await assertExecResult(`
      var res = ""
      var A[5*3+2] = 2

      for i=1 to 5
        res = res + A[i]
      print res
    `, '22222');
  });

  test('array size can use variables', async () => {
    await assertExecResult(`
      var size = 20
      var res = ""
      var A[size/2] = 2

      for i=1 to 5
        res = res + A[i]
      print res
    `, '22222');
  });

  test('array access checks bounds', async () => {
    await assertExecThrows(`
      var res = ""
      var A[5] = 2

      for i=1 to 5+1
        res = res + A[i]
      print res
    `);
  });

  test('array variable initializer keeps reference semantics', async () => {
    await assertExecResult(`
      var res = ""
      var B[6] = 2

      var A = B

      for i=1 to 5
        res = res + A[i]
      print res
    `, '22222');
  });

  test('array aliases observe writes', async () => {
    await assertExecResult(`
      var res = ""
      var B[6] = 2

      var A = B

      B[3] = 8

      for i=1 to 5
        res = res + A[i]
      print res
    `, '22822');
  });

  test('array literal initializes a normal array', async () => {
    await assertExecResult(`
      var res = ""

      var A = [1,2,3,4,5,6]

      for i=1 to 5
        res = res + A[i]
      print res
    `, '12345');
  });

  test('array literal evaluates element expressions immediately', async () => {
    await assertExecResult(`
      var res = ""

      var x = 3

      var A = [1,2,x,4,5,6]

      x = 8

      for i=1 to 5
        res = res + A[i]
      print res
    `, '12345');
  });

  test('empty array literal has length zero', async () => {
    await assertExecResult(`
      var A = [1,2]

      func printLen(X[1..n])
        print n

      printLen(A)
      A = []
      printLen(A)
    `, '2 0');
  });
});
