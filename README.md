# Pseudo2 Langium Workspace

Dieses Repository enthaelt die Langium-Portierung von Pseudo2 mit Parser,
Scoping, Validator, JavaScript-Generator, C-Generator, Graphviz-Generatoren,
CLI und Weboberflaeche. Der C-Generator erzeugt VeriFast-faehigen C-Code und
unterstuetzt einfache Pseudo2-Annotationen fuer VeriFast.

## Voraussetzungen

- Node.js 20 oder neuer
- npm 10 oder neuer
- VeriFast im Repo unter `verifast-26.01`

Der standardmaessig verwendete VeriFast-Pfad ist repo-lokal:

```powershell
.\verifast-26.01\bin\verifast.exe
```

Wenn ausnahmsweise ein anderer VeriFast verwendet werden soll, kann der Pfad
ueber `VERIFAST_EXE` oder ueber die CLI-Option `--vf` ueberschrieben werden.

## Projektstruktur

- `packages/language`: Grammatik, AST, Scoping, Validator, Typing und alle Generator-Kernfunktionen.
- `packages/cli`: Kommandozeilenwerkzeug fuer JS-, Graphviz-, C-Generierung und VeriFast.
- `packages/web`: Monaco/Langium-Weboberflaeche mit JS-Ausfuehrung, C-Ausgabe und VeriFast-Button.
- `packages/extension`: VS-Code-Erweiterung.
- `examples`: Pseudo2-Beispielprogramme.
- `out`: uebliches Zielverzeichnis fuer generierte Ausgaben.

Wichtige Generator-Dateien:

- `packages/language/src/generator-core.ts`: JavaScript-Generator.
- `packages/language/src/c-generator-core.ts`: C-/VeriFast-Generator.
- `packages/language/src/generator-context.ts`: eindeutige Zielnamen fuer Variablen, Funktionen und Structs.
- `packages/language/src/generator-artifacts.ts`: gemeinsamer Einstieg fuer JS- und Graphviz-Artefakte.
- `packages/language/src/graphviz/*`: AST-, Dependency- und CFG-Graphviz-Generatoren.

## Installation

Im Repository-Root ausfuehren:

```powershell
npm install
```

Falls `node_modules` bereits vorhanden ist, kann dieser Schritt uebersprungen
werden. Nach Aenderungen an `package-lock.json` oder Dependencies sollte er
erneut ausgefuehrt werden.

## Build und Tests

Langium-Dateien aus der Grammatik neu generieren:

```powershell
npm run langium:generate
```

TypeScript fuer alle Workspace-Pakete kompilieren:

```powershell
npm run compile
```

Kompletter Build:

```powershell
npm run build
```

Alle Tests ausfuehren:

```powershell
npm test
```

Nur Language-Tests:

```powershell
npm run --workspace packages/language test
```

Nur CLI-Tests:

```powershell
npm run --workspace packages/cli test
```

Web-Paket separat bauen:

```powershell
npm run build --workspace packages/web
```

## CLI verwenden

Die CLI wird direkt ueber das lokale Bin-Skript gestartet:

```powershell
node .\packages\cli\bin\cli.js <command>
```

Vor der CLI-Nutzung sollte mindestens einmal gebaut worden sein:

```powershell
npm run build
```

### JavaScript und Graphviz erzeugen

Standardmaessig erzeugt `generate` JavaScript plus Graphviz-Artefakte:

```powershell
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out
```

Typische Ausgaben:

- `out\test1.js`
- `out\graphvizAST.dot`
- `out\graphvizDep.dot`
- `out\graphvizCfg_<funktionsname>.dot`

Nuetzliche Optionen:

```powershell
# Nur JavaScript erzeugen
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --only-js

# JavaScript ohne Graphviz erzeugen
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --no-graphviz

# Kein JavaScript, nur Graphviz-Artefakte
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --no-js

# Nur bestimmte Graphviz-Artefakte erzeugen
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --no-js --ast
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --no-js --dep
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --no-js --cfg
```

Die Graphviz-Dateien sind `.dot`-Dateien. Sie koennen mit Graphviz weiter in
PDF, SVG oder PNG umgewandelt werden, z. B.:

```powershell
dot -Tsvg .\out\graphvizAST.dot -o .\out\graphvizAST.svg
```

### C-Code erzeugen

Der C-Generator wird separat aufgerufen:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out
```

Ergebnis:

```powershell
.\out\test1.c
```

Der erzeugte C-Code enthaelt:

- Pseudo2-Runtime-Signaturen bzw. Runtime-Code je nach Generatoroption.
- VeriFast-Kommentare fuer Runtime-Funktionen.
- eindeutige generierte Namen fuer Pseudo2-Deklarationen.
- freie Funktionen fuer Methoden mit explizitem `mythis`-Parameter.
- 1-basige Pseudo2-Arrayzugriffe ueber Runtime-Helfer.

### VeriFast ueber CLI ausfuehren

VeriFast kann ueber die CLI auf eine generierte `.c`-Datei angewendet werden.
Der Standardmodus ist Compile-only mit `-c`.

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c
```

Die CLI verwendet dabei automatisch `.\verifast-26.01\bin\verifast.exe`.
Alternativ kann ein anderer Pfad explizit angegeben werden:

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c --vf "C:\Pfad\zu\verifast.exe"
```

Die Ausgabe ist JSON, z. B.:

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "0 errors found ...",
  "stderr": "",
  "errors": []
}
```

Weitere Optionen:

```powershell
# Zusaetzliche VeriFast-Argumente
node .\packages\cli\bin\cli.js verifast .\out\test1.c --extra <arg1> <arg2>

# Link-Checking aktivieren
node .\packages\cli\bin\cli.js verifast .\out\test1.c --link
```

`--link` sollte nur verwendet werden, wenn konkrete Runtime-Manifeste oder
Implementierungen fuer die externen Pseudo2-Runtime-Funktionen bereitstehen.
Fuer den aktuell generierten C-Code ist der Standardmodus ohne `--link`
normalerweise der richtige Modus.

### Vollstaendiger CLI-Workflow

```powershell
npm run build
node .\packages\cli\bin\cli.js generate-c .\examples\verifast_annotations.pseudo2 -d .\out
node .\packages\cli\bin\cli.js verifast .\out\verifast_annotations.c
```

## Pseudo2-Annotationen fuer VeriFast

Annotationen werden direkt in Pseudo2 geschrieben. Der C-Generator uebersetzt
sie in VeriFast-Kommentare.

Beispiel:

```pseudo2
@requires true
@ensures "true"
func verified()
  @assert true
  return 5

print verified()
```

Generierter C-Ausschnitt:

```c
Ps2Value* func_verified_0(void)
//@ requires true;
//@ ensures true;
{
  //@ assert true;
  return ps2_copy_value(ps2_num(5));
}
```

Unterstuetzte Pseudo2-Annotationen:

- `@requires <Expression>` vor einer Funktion.
- `@ensures <Expression>` vor einer Funktion.
- `@assert <Expression>` im Funktionsrumpf.

Einfache Pseudo2-Ausdruecke wie `true`, `false`, Zahlen, Variablen und einfache
Operatoren werden direkt in VeriFast-Spec-Ausdruecke uebersetzt.

Falls eine C-/VeriFast-spezifische Spezifikation gebraucht wird, kann als erster
einfacher Weg ein Stringliteral verwendet werden. Der Stringinhalt wird roh in
den VeriFast-Kommentar geschrieben:

```pseudo2
@requires "true"
@ensures "true"
func f()
  @assert "true"
  return 1
```

## Weboberflaeche starten

Die Weboberflaeche wird ueber Vite gestartet:

```powershell
npm run dev
```

Danach im Browser oeffnen:

```text
http://localhost:20002/packages/web/helloworld.html
```

Falls der Port bereits belegt ist, meldet Vite den tatsaechlichen Port in der
Konsole.

Hinweis: `http://localhost:20002` oeffnet die Root-`index.html`, die als
einfacherer Runner ohne alle C-/VeriFast-Controls aufgebaut ist. Fuer den
vollstaendigen Workflow mit `Generate C`, `Save C` und `Run VeriFast` die
`packages/web/helloworld.html`-Adresse verwenden.

### VeriFast-Pfad fuer die Weboberflaeche

Die Weboberflaeche kann VeriFast nur starten, wenn sie ueber den lokalen
Vite/Node-Server laeuft. Der Browser selbst startet keine lokalen `.exe`-Dateien;
stattdessen ruft die Oberflaeche den lokalen Endpoint `/api/verifast` auf.

Der Server verwendet zuerst `VERIFAST_EXE`. Wenn die Variable nicht gesetzt ist,
nutzt er den repo-lokalen Standardpfad:

```powershell
.\verifast-26.01\bin\verifast.exe
```

Wenn ein anderer VeriFast-Pfad verwendet werden soll:

```powershell
$env:VERIFAST_EXE="C:\Pfad\zu\verifast.exe"
npm run dev
```

### Bedienung der Weboberflaeche

1. `Start` startet den Monaco-Editor und den Langium-Language-Client.
2. `Save Pseudo2` speichert oder laedt den aktuellen Pseudo2-Code herunter.
3. `Run JS` generiert JavaScript und fuehrt es direkt im Browser aus.
4. `Generate C` erzeugt C-Code im C-Ausgabefenster.
5. `Save C` speichert oder laedt den zuletzt erzeugten C-Code herunter.
6. `Run VeriFast` sendet den erzeugten C-Code an `/api/verifast` und zeigt das Ergebnis im VeriFast-Fenster.
7. `Summary` erzeugt eine kurze Strukturuebersicht des Programms.
8. `Show Source` zeigt den aktuellen Pseudo2-Quelltext im Ausgabefenster.

Der VeriFast-Button funktioniert nur im lokalen Dev-Server-Kontext. Wenn die UI
statisch ohne Node/Vite-Backend ausgeliefert wird, muss VeriFast ueber die CLI
ausgefuehrt werden.

## Generatoren als TypeScript-API

Die wichtigsten Generatorfunktionen werden aus `pseudo2-language` exportiert:

```ts
import {
  generateProgram,
  generateCProgram,
  generateGraphvizArtifacts
} from 'pseudo2-language';
```

- `generateProgram(program)` erzeugt JavaScript.
- `generateCProgram(program)` erzeugt C-Code mit VeriFast-Kommentaren.
- `generateGraphvizArtifacts(program)` erzeugt AST-, Dependency- und CFG-DOT-Artefakte.

Die CLI und die Weboberflaeche verwenden dieselben Kernfunktionen. Dadurch
sollten C-/JS-/Graphviz-Ausgaben zwischen CLI und Web konsistent bleiben.

## Beispielprogramme

Nuetzliche Beispiele:

- `examples/test1.pseudo2`: allgemeines Beispiel fuer Generierung.
- `examples/verifast_annotations.pseudo2`: kleines Beispiel fuer Pseudo2-VeriFast-Annotationen.
- `examples/serverExamples`: groessere Beispielprogramme fuer Sprache, Arrays, Structs, Funktionen, Listen, Queues, Stacks, Suche und Sortierung.

Alle Beispielprogramme werden durch den File-Validation-Test geparst und
validiert:

```powershell
npm run --workspace packages/language test -- test/integration/FileValidation.test.ts
```

## Typische Arbeitsablaeufe

### Nach einer Grammatik-Aenderung

```powershell
npm run langium:generate
npm run compile
npm test
```

### Nach einer Generator-Aenderung

```powershell
npm run compile
npm test
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out
```

### Nach einer Web-Aenderung

```powershell
npm run build --workspace packages/web
npm run dev
```

Dann im Browser `http://localhost:20002/packages/web/helloworld.html` oeffnen
und die Buttons `Run JS`, `Generate C` und `Run VeriFast` pruefen.

### Nach einer C-/VeriFast-Aenderung

```powershell
npm run build
node .\packages\cli\bin\cli.js generate-c .\examples\verifast_annotations.pseudo2 -d .\out
node .\packages\cli\bin\cli.js verifast .\out\verifast_annotations.c
```

Erwartung fuer das Annotation-Beispiel:

```text
ok: true
0 errors found
```
