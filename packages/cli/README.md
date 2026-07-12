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

Run VeriFast:

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c
```

`verifast` uses `.\verifast-26.01\bin\verifast.exe` from the repo by default. Override it with `--vf <path>` if needed.

`verifast` uses VeriFast `-c` by default, because generated C relies on external Pseudo2 runtime contracts. Use `--link` only when concrete runtime manifests/implementations are provided.

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
`vf_field(struct, "fieldName")`. They are translated to abstract VeriFast model
fixpoints in generated C. The two-argument `vf_string` form proves exact string
content using a collision-free sequence of Unicode code points. `vf_elem` is supported for array assignments, array
literals such as `[1, 2]`, and constant array declarations with simple literal
initializers such as `var A[2] = 7`. `vf_in_bounds` can be used for dynamic
1-based array indices. `vf_undefined` is used for default Struct fields after
`new S`. Array and Struct parameters are available in function contracts, so
contracts such as `@requires vf_array(A) && vf_int(vf_elem(A, i)) == 7` and
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

Mutable array and Struct state is currently represented by abstract pure model
projections. Precise loop invariants over repeated heap mutations and aliases
still require the planned stateful ownership model and are not yet a complete
verification of the concrete C heap runtime.
