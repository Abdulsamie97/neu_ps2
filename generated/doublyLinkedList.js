"use strict";

// Pseudo2 generator
class DLLElem {
  constructor() {
    this.key = null;
    this.next = null;
    this.prev = null;
  }
}


function createList(A, n) {
  let lastCreated = new DLLElem()
  lastCreated = null
  let currElem = new DLLElem()
  for (let i = n; i >= 1; i -= 1)   {
    currElem = new DLLElem()
    currElem.key = A[i]
    currElem.next = lastCreated
    if ((lastCreated != null))     {
      lastCreated.prev = currElem
    }
    lastCreated = currElem
  }
  currElem.prev = null
  return currElem
}


function getLast(p) {
  while (((p.next != null)))   {
    p = p.next
  }
  return p
}


let head = createList([5, 8, 9, 7, 3, 1, 4])


let last = getLast(head)


console.log(head.key)


console.log(head.next.key)


console.log(head.next.next.key)


console.log(last.key)


console.log(last.prev.key)


console.log(last.prev.prev.key)


let p = head


while (((p != null))) {
  console.log(p.key)
  p = p.next
}


p = last


while (((p != null))) {
  console.log(p.key)
  p = p.prev
}


console.log("finished")

