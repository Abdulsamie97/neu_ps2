# Pseudo2 CLI

Build the workspace first:

```powershell
npm run build
```

Generate JavaScript plus Graphviz artifacts:

```powershell
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out
```

Generate C for VeriFast:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out
```

Run VeriFast:

```powershell
$env:VERIFAST_EXE="G:\Uni\Master\Masterarbeit\Verifast\verifast-26.01\bin\verifast.exe"
node .\packages\cli\bin\cli.js verifast .\out\test1.c
```

`verifast` uses VeriFast `-c` by default, because generated C relies on external Pseudo2 runtime contracts. Use `--link` only when concrete runtime manifests/implementations are provided.
