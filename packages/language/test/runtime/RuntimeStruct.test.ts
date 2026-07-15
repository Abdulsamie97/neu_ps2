/**
 * @file RuntimeStruct.test.ts
 * @brief Prüft Struct-Erzeugung, Attribute, Methoden, Aliase, Verkettung und verschachtelte Structs.
 *
 * Die Suite sichert sowohl die aktuelle Runtime als auch portierte historische
 * Struct-Szenarien und deren erwarteten Kontrollfluss ab.
 *
 * @author Abdul
 */

import { describe, test } from 'vitest';
import { assertExecResult, assertExecThrows } from '../helpers/runtime-test-utils.js';

/** Ausführungsbasierte Regressionstests der Pseudo2-Struct- und Methodensemantik. */
describe('RuntimeTestsStruct', () => {
  test('simple struct attribute access', async () => {
    await assertExecResult(`
      struct date
        num day
        num year

      var x = new date
      x.day = 16
      x.year = 2020
      print x.day
      print x.year
    `, '16 2020');
  });

  test('struct array initialized with same instance', async () => {
    await assertExecResult(`
      struct Person
        string name
        num age

      var p1 = new Person
      p1.name = "Jon"
      p1.age = 28

      var arrPerson[3] = p1

      var p2 = arrPerson[2]
      print p2.age
    `, '28');
  });

  test('struct array initialized with new creates different instances', async () => {
    await assertExecResult(`
      struct Person
        string name
        num age

      var arrDiffPerson[3] = new Person

      var p1 = arrDiffPerson[2]
      p1.age = 25

      for i=1 to 3
        var pi = arrDiffPerson[i]
        print i
        print pi.age
    `, '1 undefined 2 25 3 undefined');
  });

  test('struct array element can replace an existing struct variable', async () => {
    await assertExecResult(`
      struct Person
        string name
        num age

      var p1 = new Person
      p1.age = 4

      var arrDiffPerson[3] = new Person

      p1 = arrDiffPerson[2]
      p1.age = 25

      for i=1 to 3
        var pi = arrDiffPerson[i]
        print i
        print pi.age
    `, '1 undefined 2 25 3 undefined');
  });

  test('struct variables compare by reference and support null', async () => {
    await assertExecResult(`
      struct llElem
        num key
        llElem next

      var e6 = new llElem
      e6.key=4
      e6.next=null

      print e6.next == null

      var p = e6

      print p.key
      print p == null
      print p.next == null
      p = p.next
      print p == null
    `, 'true 4 false true true');
  });

  test('new struct is not null', async () => {
    await assertExecResult(`
      struct S
        num k

      var x = new S
      x.k=4

      print x == null
    `, 'false');
  });

  test('struct variable comparisons preserve aliases', async () => {
    await assertExecResult(`
      struct S
        num key

      var x = new S
      var y = new S

      print x == y

      x.key = 5
      y.key = 7

      print x.key
      print y.key
      print x == y

      x = y
      print x.key
      print y.key
      print x == y
    `, 'false 5 7 false 7 7 true');
  });

  test('struct attributes can hold struct references', async () => {
    await assertExecResult(`
      struct S
        num key
        S next

      var x = new S
      x.key = 1
      var y = new S
      var z = new S
      x.next = y
      y.next = z

      print x == y
      print x.next == x
      print x.next == y
      print x.next.next == z

      x.next = null

      print x.next == null

      x.next = x

      print x.next == x
      print x.next == y
      print x.next == z
      print x.next == null
    `, 'false false true true true true false false false');
  });

  test('structs are passed by reference to functions', async () => {
    await assertExecResult(`
      struct S
        num key

      var x = new S

      x.key = 5

      print x.key

      func m(arg)
        arg.key = 8

      m(x)

      print x.key
    `, '5 8');
  });

  test('struct argument keeps access after function call', async () => {
    await assertExecResult(`
      struct evEl
        num key
        evEl next

      var e1=new evEl
      e1.key=4
      e1.next=null

      func dum(L)
        print L.key

      dum(e1)

      print e1.key
    `, '4 4');
  });

  test('array element can be used as struct receiver', async () => {
    await assertExecResult(`
      struct person
        num age

      var p = new person
      p.age = 5
      var A[3] = p

      for i=1 to 3
        print A[i].age
    `, '5 5 5');
  });

  test('struct null pointer assignment throws', async () => {
    await assertExecThrows(`
      struct S
        num key

      var x = new S
      x = null
      x.key = 5
    `);
  });

  test('struct method returns a value', async () => {
    await assertExecResult(`
      struct S
        num key
        m(a)
          this.key = this.key + a
          return this.key

      var x = new S
      x.key = 4

      print x.m(3)
    `, '7');
  });

  test('struct method reads and writes array attribute through local alias', async () => {
    await assertExecResult(`
      struct S
        num[] arr
        set(i,v)
          var my = this.arr
          my[i]=v
          return i
        get(i)
          var my = this.arr
          return my[i]

      var s = new S
      s.arr = [1,2,3,4]
      var h = 0
      h = s.set(1,11)
      h = s.set(2,12)
      h = s.set(3,13)
      h = s.set(4,14)

      for i = 1 to 4
        print s.get(i)
    `, '11 12 13 14');
  });

  test('struct method reads and writes array attribute directly', async () => {
    await assertExecResult(`
      struct S
        num[] arr
        set(i,v)
          this.arr[i]=v
          return i
        get(i)
          return this.arr[i]

      var s = new S
      s.arr = [1,2,3,4]
      var h = 0
      h = s.set(1,11)
      h = s.set(2,12)
      h = s.set(3,13)
      h = s.set(4,14)

      for i = 1 to 4
        print s.get(i)
    `, '11 12 13 14');
  });

  test('struct array attribute can be read directly', async () => {
    await assertExecResult(`
      struct S
        num[] arr

      var s = new S
      s.arr = [1,2,3,4]

      var newarr = s.arr
      for i = 1 to 4
        print s.arr[i]
    `, '1 2 3 4');
  });

  test('struct method can update one array cell', async () => {
    await assertExecResult(`
      struct S
        num[] arr
        set(i,v)
          this.arr[i]=v
          return i

      var s = new S
      s.arr = [1,2,3,4]

      var k = 3
      k = s.set(1,9)

      for i = 1 to 4
        print s.arr[i]
    `, '9 2 3 4');
  });

  test('struct method and direct array access see the same cells', async () => {
    await assertExecResult(`
      struct S
        num[] arr
        set(i,v)
          this.arr[i]=v
          return i
        get(i)
          return this.arr[i]

      var s = new S
      s.arr = [1,2,3,4]

      var k = 3
      k = s.set(1,9)

      for i = 1 to 4
        print s.arr[i]
        print s.get(i)
    `, '9 9 2 2 3 3 4 4');
  });

  test('struct method calls through function parameter keep receiver reference', async () => {
    await assertExecResult(`
      struct S
        num[] arr
        set(i,v)
          this.arr[i]=v
          return i
        get(i)
          return this.arr[i]

      var s = new S
      s.arr = [1,2,3,4]

      var k = 3
      k = s.set(1,9)

      func m(s1)
        print s1.get(3)
        for i = 1 to 4
          print s1.arr[i]
          print s1.get(i)

      m(s)
    `, '3 9 9 2 2 3 3 4 4');
  });

  test('call command invokes struct methods', async () => {
    await assertExecResult(`
      struct S
        num[] arr
        set(i,v)
          this.arr[i]=v
          return i
        get(i)
          return this.arr[i]

      var s = new S
      s.arr = [1,2,3,4]

      call s.set(1,9)

      func m(s1)
        print s1.get(3)
        for i = 1 to 4
          print s1.arr[i]
          print s1.get(i)

      m(s)
    `, '3 9 9 2 2 3 3 4 4');
  });

  test('same method name in different structs resolves correctly', async () => {
    await assertExecResult(`
      struct S1
        m()
          print 1
          return 0

      struct S2
        m()
          print 2
          return 0

      var s1 = new S1
      var s2 = new S2

      call s1.m()
      call s2.m()
    `, '1 2');
  });

  test('same attribute name in different structs resolves correctly', async () => {
    await assertExecResult(`
      struct S1
        num att

      struct S2
        num att

      var s1 = new S1
      var s2 = new S2

      s1.att = 1
      s2.att = 2

      print s1.att
      print s2.att
    `, '1 2');
  });

  test('method scoping works inside function loop', async () => {
    await assertExecResult(`
      struct S1
        m(r,c)
          print 1
          return 35

      func conflictOne(S, r0, c0, h, w)
        for rr = r0 to r0 + h
          for cc=c0 to c0+w
            print 1
            var x = S.m(rr,4)
            if x>0
              return true
        return false

      var s1 = new S1

      conflictOne(s1, 3, 5, 2, 5)
    `, '1 1');
  });

  test('struct array attribute access', async () => {
    await assertExecResult(`
      struct S1
        num[] ids

      var s1 = new S1
      s1.ids = [1,2,3]

      for i=1 to 3
        print s1.ids[i]
    `, '1 2 3');
  });

  test('struct method can initialize array attributes', async () => {
    await assertExecResult(`
      struct S1
        num[] ids
        init1()
          var help[5] = 0
          this.ids = help

        init2()
          this.ids = [1,2,4]

      var s1 = new S1
      call s1.init1()
      print s1.ids[2]

      call s1.init2()
      print s1.ids[2]
    `, '0 2');
  });

  test('nested structs can be initialized and used through methods', async () => {
    await assertExecResult(`
      var N = 2

      var pl = new Place
      call pl.init()

      var r = new Ring
      r.size = 1

      call pl.s.push(r)

      print pl.s.pop().size

      struct Ring
        num size

      struct Place
        RingStack s
        init()
          this.s = new RingStack
          call this.s.init()

      struct RingStack
        Ring[] S

        init()
          var help[N] = new Ring
          this.S = help

        push(x)
          this.S[1] = x

        pop()
          return this.S[1]
    `, '1');
  });

  test('old struct_tmp blueprint keeps nested struct stack behavior', async () => {
    await assertExecResult(`
      var N = 5
      var r = new Ring

      var p = new Place
      call p.init()
      call p.s.push(r)

      print 2
      print "finished"

      struct Ring
        num size

      struct Place
        RingStack s
        init()
          this.s = new RingStack
          call this.s.init()

      struct RingStack
        Ring[] S
        num top

        init()
          var help[N] = new Ring
          this.S = help
          this.top = 1

        isEmpty()
          if this.top == 1
            return true
          else
            return false

        isFull()
          if this.top > N
            return true
          return false

        push(x)
          if this.isFull()
            throw "ERROR: stack is already full"
          this.S[this.top] = x
          this.top = this.top + 1

        pop()
          if this.isEmpty()
            throw "ERROR: stack is empty"
          this.top = this.top - 1
          return this.S[this.top]

        getSizeOfIthRing(i)
          if i >= this.top
            return 0
          return this.S[i].size
    `, '2 finished');
  });
});
