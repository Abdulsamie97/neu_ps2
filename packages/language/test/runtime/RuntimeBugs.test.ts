import { describe, test } from 'vitest';
import { assertExecResult } from '../helpers/runtime-test-utils.js';

describe('RuntimeTestsBugs', () => {
  test('nested max functions keep return flow', async () => {
    await assertExecResult(`
      func max3(a,b,c)
        var z = 0
        if a > b
          z = a
        else
          z = b
        if z > c
          return z
        else
          return c

      print max3(1,4,3)

      func max9(a,b,c,d,e,f,s,t,u)
        var x = max3(a,b,c)
        var y = max3(d,e,f)
        var r = max3(s,t,u)

        var z = 0
        if x > y
          z = x
        else
          z = y
        if z > r
          return z
        else
          return r

      print max9(1,2,3,4,5,6,7,8,9)
    `, '4 9');
  });

  test('nested max functions can return another function call', async () => {
    await assertExecResult(`
      func max3(a,b,c)
        var z = 0
        if a > b
          z = a
        else
          z = b
        if z > c
          return z
        else
          return c

      print max3(1,4,3)

      func max9(a,b,c,d,e,f,s,t,u)
        var x = max3(a,b,c)
        var y = max3(d,e,f)
        var r = max3(s,t,u)

        return max3(x,y,r)

      print max9(1,2,3,4,5,6,7,8,9)
    `, '4 9');
  });

  test('array parameter sorting mutates caller array', async () => {
    await assertExecResult(`
      var A = [ 2, 3, 7, 5 ,13, 11 ]

      var t = 0

      func bad_bubble_sort(X[1..n])
        for i=1 to n-1
          for k=i+1 to n
            if X[i] > X[k]
              t=X[i]
              X[i]=X[k]
              X[k]=t

      bad_bubble_sort(A)

      for i=1 to 6
        print A[i]
    `, '2 3 5 7 11 13');
  });

  test('array parameter sorting works with local temp variable', async () => {
    await assertExecResult(`
      var A = [ 2, 3, 7, 5 ,13, 11 ]

      func bad_bubble_sort(X[1..n])
        for i=1 to n-1
          for k=i+1 to n
            if X[i] > X[k]
              var t=X[i]
              X[i]=X[k]
              X[k]=t

      bad_bubble_sort(A)

      for i=1 to 6
        print A[i]
    `, '2 3 5 7 11 13');
  });

  test('linked struct assignment through nested attributes', async () => {
    await assertExecResult(`
      struct L
        num key
        L next

      var p = new L
      p.key = 1

      p.next = new L
      p.next.key = 2
      print p.key
      print p.next.key
    `, '1 2');
  });

  test('linked struct assignment through assigned temporary and nested write', async () => {
    await assertExecResult(`
      struct L
        num key
        L next

      var p = new L
      p.key = 1

      var p2 = new L
      p.next = p2
      p.next.key = 2

      print p.key
      print p.next.key
    `, '1 2');
  });

  test('linked struct assignment through temporary variable', async () => {
    await assertExecResult(`
      struct L
        num key
        L next

      var p = new L
      p.key = 1

      var p2 = new L
      p.next = p2
      p2.key = 2

      print p.key
      print p.next.key
    `, '1 2');
  });
});
