"use strict";

// Pseudo2 generator
let debug = false


class edgeElem {
  constructor() {
    this.vid = null;
    this.next = null;
  }
}


let dummy = new edgeElem()


let V = Array((6) + 1).fill(dummy)


init(V)


let s_white = 0


let s_grey = 1


let s_black = 2


let VStatus = Array((6) + 1).fill(s_white)


let tail = 1


let Q = Array((100) + 1).fill(0)


bfs(1)


function bfs(start) {
  printDebug("bfs started")
  VStatus[start] = s_grey
  enqueue(start)
  while ((!empty()))   {
    let v = dequeue()
    if ((VStatus[v] != s_black))     {
      let p = new edgeElem()
      p = V[v]
      registerNeighbors(p)
      console.log(v)
      VStatus[v] = s_black
    }
  }
  printDebug("bfs finished")
}


function registerNeighbors(first) {
  printDebug("registerNeighbors entered")
  if ((first == null))   {
    return
  }
  printDebug(("registerNeighbors: processing node " + first.vid))
  if ((VStatus[first.vid] == s_white))   {
    VStatus[first.vid] = s_grey
    printDebug(("registerNeighbors: node " + first.vid + " set to grey"))
    enqueue(first.vid)
  }
  registerNeighbors(first.next)
}


function empty() {
  if ((tail == 1))   {
    return true
  }
  else   {
    return false
  }
}


function enqueue(x) {
  Q[tail] = x
  tail = (tail + 1)
}


function dequeue() {
  if (empty())   {
    throw "dequeue() requires non-empty queue"
  }
  let x = Q[1]
  tail = (tail - 1)
  for (let i = 2; i <= tail; i += 1)   {
    Q[(i - 1)] = Q[i]
  }
  return x
}


function printDebug(msg) {
  if ((debug))   {
    console.log(("DEBUG " + msg))
  }
}


function printGraph(A, n) {
  let p = new edgeElem()
  for (let i = 1; i <= n; i += 1)   {
    p = A[i]
    console.log(("Adacency list for node " + i + " is: " + edgeListToString(p)))
  }
}


function init(A, n) {
  A[1] = toEdgeList([2, 3, 6])
  A[2] = toEdgeList([1, 3, 4])
  A[3] = toEdgeList([1, 2, 4, 5, 6])
  A[4] = toEdgeList([2, 3, 5])
  A[5] = toEdgeList([3, 4, 6])
  A[6] = toEdgeList([1, 3, 5])
}


function edgeListToString(first) {
  if ((first == null))   {
    return "null"
  }
  let tailAsString = edgeListToString(first.next)
  return (first.vid + " " + tailAsString)
}


function toEdgeList(A, n) {
  if ((n == 0))   {
    return null
  }
  let start = new edgeElem()
  start.vid = A[1]
  start.next = null
  let last = new edgeElem()
  last = start
  for (let i = 2; i <= n; i += 1)   {
    let e = new edgeElem()
    e.vid = A[i]
    e.next = null
    last.next = e
    last = e
  }
  return start
}

