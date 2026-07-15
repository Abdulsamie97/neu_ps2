/**
 * @file RuntimeExp.test.ts
 * @brief Prüft Literale, unäre Ausdrücke, Operatorpräzedenz, Vergleiche und Stringverkettung zur Laufzeit.
 * @author Abdul
 */

import { describe, test } from 'vitest';
import { assertExecResult } from '../helpers/runtime-test-utils.js';

/** Ausführungsbasierte Regressionstests der Ausdruckssemantik. */
describe('RuntimeTestsExp', () => {
  test('simple', async () => {
    await assertExecResult(`
      print 34
      print "hello world"
    `, '34 hello world');
  });

  test('constants and unary expressions', async () => {
    await assertExecResult("print 10", '10');
    await assertExecResult("print 'foo'", 'foo');
    await assertExecResult('print true', 'true');
    await assertExecResult('print !true', 'false');
  });

  test('arithmetic and comparisons', async () => {
    await assertExecResult('print 1 * 2', '2');
    await assertExecResult('print 1 / 2', '0.5');
    await assertExecResult('print 7 mod 2', '1');
    await assertExecResult('print 1 - 2', '-1');
    await assertExecResult('print 1 < 2', 'true');
    await assertExecResult('print 1 == 2', 'false');
  });

  test('string and null equality', async () => {
    await assertExecResult("print 'bla' == 'bla'", 'true');
    await assertExecResult("print 'bla' == 'blub'", 'false');
    await assertExecResult("var x = 'bla' print x == 'bla'", 'true');
    await assertExecResult("var x = 'bla' var y = 'bla' print x == y", 'true');
    await assertExecResult('print null == null', 'true');
    await assertExecResult('print null != null', 'false');
  });

  test('boolean and plus chains', async () => {
    await assertExecResult('print true && false', 'false');
    await assertExecResult('print true || false', 'true');
    await assertExecResult('print 1 + 2', '3');
    await assertExecResult("print 'a' + 'b'", 'ab');
    await assertExecResult("print 'a' + 2", 'a2');
    await assertExecResult("print 2 + 'a'", '2a');
    await assertExecResult("print 'a' + true", 'atrue');
    await assertExecResult("print false + 'a'", 'falsea');
  });

  test('operator precedence', async () => {
    await assertExecResult('print true && true || false', 'true');
    await assertExecResult('print false && true || true', 'true');
    await assertExecResult('print true && true || false && true', 'true');
    await assertExecResult('print ! true && false', 'false');
    await assertExecResult('print 3 + 4 * 5', '23');
    await assertExecResult('print 7 / 2', '3.5');
    await assertExecResult('print 7 + 3 mod 2', '8');
    await assertExecResult('print 3 + 4 < 6 * 4', 'true');
    await assertExecResult('print 3 + 4 > 6 * 4', 'false');
    await assertExecResult('print 3 + 9 == 8 + 4', 'true');
  });

  test('variable declarations and assignment', async () => {
    await assertExecResult('var x = 5 print x', '5');
    await assertExecResult('var x = 5 x = 7 print x', '7');
    await assertExecResult('var x = 5 x = x + 7 print x', '12');
    await assertExecResult("var x = 'h' x = x + 'w' print x", 'hw');
    await assertExecResult("var x = 5 var y=x x=7 print x + ''+y", '75');
    await assertExecResult('var x = 5 print 3 + x == 4 + 4', 'true');
  });
});
