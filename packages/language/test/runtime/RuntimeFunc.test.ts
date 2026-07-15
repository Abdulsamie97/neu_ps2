/**
 * @file RuntimeFunc.test.ts
 * @brief Prüft Aufrufe, Parameter, Rückgaben, Rekursion und wertlose Funktionen zur Laufzeit.
 * @author Abdul
 */

import { describe, test } from 'vitest';
import { assertExecResult } from '../helpers/runtime-test-utils.js';

/** Ausführungsbasierte Regressionstests globaler Pseudo2-Funktionen. */
describe('RuntimeTestsFunc', () => {
  test('simple function return', async () => {
    await assertExecResult(`
      func m()
        return 25

      print m()
    `, '25');
  });

  test('function can be called before declaration', async () => {
    await assertExecResult(`
      print m()

      func m()
        return 25
    `, '25');
  });

  test('mutually recursive functions', async () => {
    await assertExecResult(`
      func fak1(n)
        if n < 1
          throw "argument < 1"
        if n==1
          return 1
        return n * fak2(n-1)

      func fak2(n)
        if n < 1
          throw "argument < 1"
        if n==1
          return 1
        return n * fak1(n-1)

      print fak1(5)
      print fak2(5)
    `, '120 120');
  });

  test('function parameter is used in return expression', async () => {
    await assertExecResult(`
      func m(x)
        return x+2

      print m(25)
    `, '27');
  });

  test('scalar parameters are passed by value', async () => {
    await assertExecResult(`
      var x = 1
      var y = 2
      func m(x,y)
        x = x +5
        y= y+5
        return x+y

      print m(x,y)
      print x
      print y
    `, '13 1 2');
  });

  test('array parameter gets logical length', async () => {
    await assertExecResult(`
      func m(A[1..n])
        print n
        for i=1 to n
          print A[i]

      var B = [1,2,3]
      m(B)
    `, '3 1 2 3');
  });

  test('recursive factorial', async () => {
    await assertExecResult(`
      func fac(n)
        if n<0
          throw "negative arguments not allowed"
        if n==0
          return 1
        return n*fac(n-1)

      print fac(5)
    `, '120');
  });

  test('function scoping with shadowing', async () => {
    await assertExecResult(`
      func m(n)
        print x
        var x = n+1
        print x

      var x = 5
      print x
      m(25)
      print x
      m(2)
    `, '5 5 26 5 5 3');
  });

  test('function parameter names shadow globals only inside function', async () => {
    await assertExecResult(`
      var x = 5
      var y = 5

      func foox(x)
        print x

      func fooy(y)
        print x

      func fooz(x)
        var y= 7
        print y

      foox(2)
      fooy(2)
      fooz(2)
    `, '2 5 7');
  });
});
