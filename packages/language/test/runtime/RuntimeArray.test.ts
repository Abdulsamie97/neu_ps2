/**
 * @file RuntimeArray.test.ts
 * @brief Prüft Erzeugung, 1-basierte Zugriffe, Zuweisungen, Grenzen und Parameterübergabe von Arrays.
 *
 * Erfolgs- und Fehlerfälle werden über den gemeinsamen JavaScript-Runtime-Testkontext ausgeführt.
 *
 * @author Abdul
 */

import { describe, test } from 'vitest';
import { assertExecResult, assertExecThrows } from '../helpers/runtime-test-utils.js';

/** Ausführungsbasierte Regressionstests der Pseudo2-Arraysemantik. */
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

  test('nested arrays support chained reads and writes', async () => {
    await assertExecResult(`
      var matrix = [[1, 2], [3, 4]]
      matrix[2][1] = 9
      print matrix[1][2]
      print matrix[2][1]
    `, '2 9');
  });

  test('array declarations can contain arrays', async () => {
    await assertExecResult(`
      var row = [1, 2]
      var matrix[2] = row
      matrix[1][2] = 7
      print matrix[2][2]
    `, '7');
  });
});
