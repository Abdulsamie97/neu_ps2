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
