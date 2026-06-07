"use strict";

// Pseudo2 generator
function inserti(A, n, i) {
  let x = A[i]
  let j = (i - 1)
  while (((j >= 1) && (A[j] > x)))   {
    A[(j + 1)] = A[j]
    j = (j - 1)
  }
  A[(j + 1)] = x
}


function insertion_sort(A, n) {
  for (let i = 2; i <= n; i += 1)   {
    inserti(A, i)
  }
}


let B = Array((4) + 1).fill(3)


B[1] = 76


B[2] = 16


B[3] = 25


B[4] = 36


insertion_sort(B)

