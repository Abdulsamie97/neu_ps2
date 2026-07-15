# Pseudo2 CLI

Build the workspace first:

```powershell
npm run build
```

Generate JavaScript plus Graphviz artifacts:

```powershell
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out
```

Generate a braced pretty-printed Pseudo2 copy:

```powershell
node .\packages\cli\bin\cli.js generate-pretty .\examples\test1.pseudo2 -d .\out
```

Or include it in the normal generator run:

```powershell
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --pretty
```

Generate C for VeriFast:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out
```

This writes both `out\test1.c` and `out\test1.c.map.json`. The map file is used
to translate VeriFast diagnostics from generated C lines back to Pseudo2 source
lines.

Generate runnable implementation C or compile and run Pseudo2 directly:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out\runnable --runtime implementation
node .\packages\cli\bin\cli.js run-c .\examples\serverExamples\arithmetic\fibonacci.pseudo2
```

`run-c` detects GCC, Clang, and MSVC, including Visual Studio installations
whose developer environment is not active. Override detection with `--cc` or
`PSEUDO2_C_COMPILER`; use `--timeout <ms>` to change the execution timeout.

Run VeriFast:

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c
```

`verifast` uses `.\verifast-26.01\bin\verifast.exe` from the repo by default. Override it with `--vf <path>` if needed.

`verifast` uses VeriFast `-c` by default. It first verifies the repo-local heap
and scalar runtime kernels and then the generated client. Use `--no-runtime`
only for an intentionally isolated client check. Use `--link` only when link
checking is explicitly required. Each process has a 60-second timeout; change
it with `--timeout <ms>`. Redux remains the default prover. Generated programs
with annotated Struct-mutating loops select `Z3v4.5` through a source option,
which the shared CLI/Web runner reads automatically.

Run the positive and negative VeriFast examples:

```powershell
npm run --workspace packages/cli test -- test/verifast/VeriFastSourceMap.test.ts
```

Pseudo2 VeriFast annotations currently include function contracts
`@requires`, `@ensures` and `@terminates`, `result` inside annotation
expressions, proof statements `@assert`, `@assume`, `@open`, `@close` and
`@leak`, plus loop annotations `@invariant` and `@decreases` before `while`,
`for` or `do`.

Structured model helpers are available inside annotations: `vf_value(x)`, `vf_number(x)`, `vf_integer(x)`,
`vf_array(x)`, `vf_struct(x)`, `vf_len(x)`, `vf_int(x)`,
`vf_real(x)`, `vf_ratio(a, b)`, `vf_bool(x)`, `vf_truthy(x)`, `vf_string(x)`, `vf_string(x, "text")`, `vf_null(x)`, `vf_undefined(x)`,
`vf_elem(array, index)`, `vf_in_bounds(array, index)` and
`vf_field(struct, "fieldName")`, plus `vf_same(left, right)` for explicit
array/Struct parameter aliasing. They are translated to abstract VeriFast model
fixpoints in generated C. The two-argument `vf_string` form proves exact string
content using a collision-free sequence of Unicode code points. `vf_elem` is supported for array assignments, array
literals such as `[1, 2]`, and constant array declarations with simple literal
initializers such as `var A[2] = 7`. `vf_in_bounds` can be used for dynamic
1-based array indices. `vf_undefined` is used for default Struct fields after
`new S`. Array and Struct parameters are available in function contracts, so
array elements can be written directly as `A[i]` in annotations. This natural
syntax is equivalent to `vf_elem(A, i)`; both forms remain supported. Contracts
such as `@requires vf_array(A) && vf_int(A[i]) == 7` and
`@requires vf_struct(s) && vf_int(vf_field(s, "value")) == 7` are supported.
The helpers are covered by the `examples/verifast/valid_model_*.pseudo2` and
`examples/verifast/invalid_model_*.pseudo2` examples.

The generated contracts model `+`, `-`, `*`, `/`, `mod`, `^`, numeric
comparisons, value equality and runtime truthiness. Symbolic contracts can use
`vf_number(x)` as a numeric kind precondition, `vf_integer(x)` for exact
integer-valued numeric parameters, and `vf_truthy(x)` to refer to the
same truth-value conversion used by generated C control flow.
`vf_real(x)` exposes the mathematical real/rational model and `vf_ratio(a, b)`
constructs an explicitly typed rational constant. A contract such as
`vf_real(result) == vf_ratio(5, 2)` verifies a generated `return 5 / 2`.
The denominator of `vf_ratio` must be a non-zero integer literal. Generated
`for` loops preserve their end and step models in internal invariants, so the
iterator can be constrained with `vf_integer`, `vf_int` and `vf_real`.

Mutable arrays and Structs use explicit VeriFast ownership predicates.
`ps2_array_state` carries the current element list and `ps2_struct_state`
carries the current field map through reads, writes, function contracts,
assertions and loop invariants. Repeated mutations and local aliases are covered
by the `valid_stateful_*`, `valid_nested_*`, `valid_parameter_alias_*` and
matching invalid examples. `vf_same(A, B)` in a precondition makes two formal
heap parameters share one ownership state, allowing calls such as `f(A, A)`.

Arrays may contain arrays. Types preserve every dimension, chained reads and
writes and contracts use `matrix[i][j]`. The nested helper form
`vf_elem(vf_elem(matrix, i), j)` remains supported for compatibility. Struct
fields may declare types such as `num[][] matrix`.

`runtime/c/pseudo2_heap_runtime.c` verifies the concrete array and Struct memory
representation, including pointer arrays, field mutation, owned-child
replacement and container deallocation. Run both concrete runtime kernels with:

```powershell
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_heap_runtime.c
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_scalar_runtime.c
```

Nested container ownership is supported through separate transferred chunks.
This covers arrays stored in Struct fields, Struct values stored in arrays and
arrays stored in arrays, including chained reads, writes and contracts such as
`vf_elem(vf_elem(matrix, 2), 1)`. The flat representation also permits cyclic
Struct references without recursively expanding predicates.

Replacing an already owned heap child is tracked per container slot. The C
generator consumes the old array/Struct state after its last known slot is
overwritten. The heap kernel verifies owned-child replacement in both Struct
fields and parent arrays.

`runtime/c/pseudo2_scalar_runtime.c` verifies scalar allocation
and copying, owned strings and content equality, stored `double` values through
VeriFast's floating-point model, standard I/O wrappers and complete scalar
deallocation. CLI and web verification report success only after the heap
kernel, scalar kernel and generated client have all passed.
