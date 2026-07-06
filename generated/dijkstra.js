"use strict";

// Pseudo2 generator
let debug = false


class EdgeElem {
  constructor() {
    this.vid = null;
    this.weight = null;
    this.next = null;
  }
}


let noNodes = 6


let dummy = new EdgeElem()


let V = Array((noNodes) + 1).fill(dummy)


init(V)


let AllChars = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]


let Label = Array((noNodes) + 1).fill("")


for (let i = 1; i <= noNodes; i += 1) {
  Label[i] = AllChars[i]
}


let s_white = 0


let s_grey = 1


let s_black = 2


let pred = Array((noNodes) + 1).fill(0)


for (let i = 1; i <= noNodes; i += 1) {
  pred[i] = i
}


let dist = Array((noNodes) + 1).fill((-1))


let mark = Array((noNodes) + 1).fill(s_white)


let X = Array((10) + 1).fill(0)


let tail = 1


dijkstra(1, 6)


console.log("finished")


function dijkstra(start, target) {
  dist[start] = 0
  add(start)
  while ((!empty()))   {
    let x = 0
    x = getElementWithMinDist()
    mark[x] = s_black
    delete(x)
    printDebug(("L1 empty()=" + empty()))
    if ((x == target))     {
      let len = dist[x]
      console.log(("Have found a path from " + Label[start] + " to " + Label[target] + " with length " + len))
      return
    }
    let p = new EdgeElem()
    p = V[x]
    while ((p != null))     {
      let y = p.vid
      let d = (dist[x] + p.weight)
      if (((dist[y] == (-1)) || (d < dist[y])))       {
        dist[y] = d
        printDebug(("set dist[" + y + "]=" + d))
        pred[y] = x
      }
      if ((mark[y] == s_white))       {
        mark[y] = s_grey
        add(y)
      }
      p = p.next
    }
  }
}


function getElementWithMinDist() {
  if (empty())   {
    throw "getElementMinDist() invoked on empty X"
  }
  let n = X[1]
  let min = dist[n]
  for (let i = 2; i <= (tail - 1); i += 1)   {
    n = X[i]
    if ((dist[n] < min))     {
      min = dist[n]
    }
  }
  for (let j = 1; j <= (tail - 1); j += 1)   {
    n = X[j]
    if ((dist[n] == min))     {
      return n
    }
  }
  throw "getElementWithMinDist(): Could not found index with minimal distance"
}


function printDebug(msg) {
  if ((debug))   {
    console.log(("DEBUG " + msg))
  }
}


function printGraph(A, n) {
  let p = new EdgeElem()
  for (let i = 1; i <= n; i += 1)   {
    p = A[i]
    console.log(("Adacency list for node " + i + " is: " + edgeListToString(p)))
  }
}


function init(A, n) {
  A[1] = toWeightedEdgeList([2, 3, 4], [3, 5, 9])
  A[2] = toWeightedEdgeList([4, 5, 3, 1], [4, 7, 3, 3])
  A[3] = toWeightedEdgeList([4, 5, 2, 1, 6], [2, 6, 3, 5, 8])
  A[4] = toWeightedEdgeList([6, 1, 2, 3, 5], [2, 9, 4, 2, 2])
  A[5] = toWeightedEdgeList([6, 2, 3, 4], [5, 7, 6, 2])
  A[6] = toWeightedEdgeList([3, 4, 5], [8, 2, 5])
}


function edgeListToString(first) {
  if ((first == null))   {
    return "null"
  }
  let tailAsString = edgeListToString(first.next)
  return (first.vid + " " + tailAsString)
}


function toWeightedEdgeList(A, n, W, m) {
  if (((n == 0) || (m == 0)))   {
    return null
  }
  let start = new EdgeElem()
  start.vid = A[1]
  start.weight = W[1]
  start.next = null
  let last = new EdgeElem()
  last = start
  for (let i = 2; i <= n; i += 1)   {
    let e = new EdgeElem()
    e.vid = A[i]
    e.weight = W[i]
    e.next = null
    last.next = e
    last = e
  }
  return start
}


function empty() {
  return (tail == 1)
}


function add(x) {
  if (contains(x))   {
    throw ("add(): cannot insert " + x + " a second time")
  }
  X[tail] = x
  tail = (tail + 1)
}


function delete(x) {
  if ((!contains(x)))   {
    throw ("delete(): Could not found " + x + " to delete")
  }
  for (let i = 1; i <= (tail - 1); i += 1)   {
    if ((X[i] == x))     {
      for (let j = i; j <= (tail - 2); j += 1)       {
        X[j] = X[(j + 1)]
      }
      tail = (tail - 1)
    }
  }
}


function contains(x) {
  for (let i = 1; i <= (tail - 1); i += 1)   {
    if ((x == X[i]))     {
      return true
    }
  }
  return false
}

