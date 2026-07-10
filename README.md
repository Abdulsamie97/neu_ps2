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
bei der CLI explizit ueber `--vf` ueberschrieben werden. Die Weboberflaeche
verwendet bewusst den repo-lokalen VeriFast.

## Projektstruktur

- `packages/language`: Grammatik, AST, Scoping, Validator, Typing und alle Generator-Kernfunktionen.
- `packages/cli`: Kommandozeilenwerkzeug fuer JS-, Pretty-Pseudo2-, Graphviz-, C-Generierung und VeriFast.
- `packages/web`: Monaco/Langium-Weboberflaeche mit JS-Ausfuehrung, C-Ausgabe und VeriFast-Button.
- `packages/extension`: VS-Code-Erweiterung.
- `examples`: Pseudo2-Beispielprogramme.
- `out`: uebliches Zielverzeichnis fuer generierte Ausgaben.

Wichtige Generator-Dateien:

- `packages/language/src/generator-core.ts`: JavaScript-Generator.
- `packages/language/src/c-generator-core.ts`: C-/VeriFast-Generator.
- `packages/language/src/generator-pretty.ts`: Pretty-Printer, der Pseudo2 mit geschweiften Klammern ausgibt.
- `packages/language/src/generator-context.ts`: eindeutige Zielnamen fuer Variablen, Funktionen und Structs.
- `packages/language/src/generator-artifacts.ts`: gemeinsamer Einstieg fuer JS-, Pretty-Pseudo2- und Graphviz-Artefakte.
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

# Zusaetzlich eine geklammerte Pretty-Pseudo2-Version erzeugen
node .\packages\cli\bin\cli.js generate .\examples\test1.pseudo2 -d .\out --pretty
```

Die Graphviz-Dateien sind `.dot`-Dateien. Sie koennen mit Graphviz weiter in
PDF, SVG oder PNG umgewandelt werden, z. B.:

```powershell
dot -Tsvg .\out\graphvizAST.dot -o .\out\graphvizAST.svg
```

### Pretty-Pseudo2 erzeugen

Der Pretty-Pseudo2-Generator erzeugt eine zweite Pseudo2-Version mit
geschweiften Klammern statt Einrueckungsbloecken. Das ist hilfreich, wenn der
AST in eine kanonische, explizit geklammerte Schreibweise zurueckgeschrieben
werden soll.

Nur diese Pretty-Ausgabe erzeugen:

```powershell
node .\packages\cli\bin\cli.js generate-pretty .\examples\test1.pseudo2 -d .\out
```

Ergebnis:

```powershell
.\out\test1.braced.pseudo2
```

Die Ausgabe bleibt Pseudo2-Code und kann wieder vom Parser gelesen werden.
Kommentare werden dabei nicht erhalten, weil sie nicht Teil des AST sind.

### C-Code erzeugen

Der C-Generator wird separat aufgerufen:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out
```

Ergebnis:

```powershell
.\out\test1.c
.\out\test1.c.map.json
```

Der erzeugte C-Code enthaelt:

- Pseudo2-Runtime-Signaturen bzw. Runtime-Code je nach Generatoroption.
- VeriFast-Kommentare fuer Runtime-Funktionen.
- eindeutige generierte Namen fuer Pseudo2-Deklarationen.
- freie Funktionen fuer Methoden mit explizitem `mythis`-Parameter.
- 1-basige Pseudo2-Arrayzugriffe ueber Runtime-Helfer.
- automatische VeriFast-Modulvertraege fuer Top-Level-Variablen.
- triviale VeriFast-Loop-Invarianten fuer generierte C-Schleifen.

Die zusaetzliche Datei `.c.map.json` enthaelt das Mapping von generierten
C-Zeilen zur urspruenglichen Pseudo2-Zeile. Sie wird von `verifast` automatisch
gelesen, wenn sie neben der `.c`-Datei liegt.

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

Bei Fehlern versucht die CLI, VeriFast-Diagnosen auf Pseudo2-Zeilen
zurueckzufuehren. Beispielstruktur:

```json
{
  "ok": false,
  "errors": [
    {
      "file": "out\\invalid_assert_false.c",
      "line": 98,
      "kind": "error",
      "message": "Assertion might not hold.",
      "sourceFile": "examples\\verifast\\invalid_assert_false.pseudo2",
      "sourceLine": 4
    }
  ]
}
```

`line` bleibt die VeriFast-Zeile in der generierten C-Datei.
`sourceLine` ist die relevante Zeile im Pseudo2-Editor bzw. in der
Pseudo2-Quelldatei.

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

@invariant true
while false
  @assert true

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
- `@invariant <Expression>` direkt vor `while`, `for` oder `do`.

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

@invariant "true"
for i = 1 to 2
  @assert true
```

## Weboberflaeche starten

Die Weboberflaeche wird ueber Vite gestartet:

```powershell
npm run dev
```

Danach im Browser oeffnen:

```text
http://localhost:20002/pseudo2-workbench
```

Falls der Port bereits belegt ist, meldet Vite den tatsaechlichen Port in der
Konsole.

Hinweis: `http://localhost:20002` oeffnet die Root-`index.html`, die als
einfacherer Runner ohne alle C-/VeriFast-Controls aufgebaut ist. Fuer den
vollstaendigen Workflow mit `Generate C + Verify`, `Save C` und `Verify C` die
`/pseudo2-workbench`-Adresse verwenden. Die eigentliche HTML-Datei liegt unter
`packages/web/pseudo2-workbench.html`.

### VeriFast-Pfad fuer die Weboberflaeche

Die Weboberflaeche kann VeriFast nur starten, wenn sie ueber den lokalen
Vite/Node-Server laeuft. Der Browser selbst startet keine lokalen `.exe`-Dateien;
stattdessen ruft die Oberflaeche den lokalen Endpoint `/api/verifast` auf.

Der Server nutzt den repo-lokalen Standardpfad:

```powershell
.\verifast-26.01\bin\verifast.exe
```

### Bedienung der Weboberflaeche

1. `Start` startet den Monaco-Editor und den Langium-Language-Client.
2. `Save Pseudo2` speichert oder laedt den aktuellen Pseudo2-Code herunter.
3. `Run JavaScript` generiert JavaScript und fuehrt es direkt im Browser aus.
4. `Generate C + Verify` erzeugt C-Code im C-Ausgabefenster und startet danach VeriFast.
5. `Save C` speichert oder laedt den zuletzt erzeugten C-Code herunter.
6. `Verify C` sendet den zuletzt erzeugten C-Code erneut an `/api/verifast` und zeigt das Ergebnis im VeriFast-Fenster.
7. `Summary` erzeugt eine kurze Strukturuebersicht des Programms.
8. `Show Source` zeigt den aktuellen Pseudo2-Quelltext im Ausgabefenster.

Wenn VeriFast einen Fehler meldet und das Source-Mapping vorhanden ist, zeigt
das VeriFast-Fenster die Pseudo2-Zeile statt nur der generierten C-Zeile. Die
Weboberflaeche springt zusaetzlich zur ersten gemappten Pseudo2-Diagnose im
Monaco-Editor.

Der VeriFast-Button funktioniert nur im lokalen Dev-Server-Kontext. Wenn die UI
statisch ohne Node/Vite-Backend ausgeliefert wird, muss VeriFast ueber die CLI
ausgefuehrt werden.

## Generatoren als TypeScript-API

Die wichtigsten Generatorfunktionen werden aus `pseudo2-language` exportiert:

```ts
import {
  generateProgram,
  generateCProgram,
  generatePrettyPseudo2,
  generateGraphvizArtifacts
} from 'pseudo2-language';
```

- `generateProgram(program)` erzeugt JavaScript.
- `generateCProgram(program)` erzeugt C-Code mit VeriFast-Kommentaren.
- `generatePrettyPseudo2(program)` erzeugt Pseudo2-Code mit geschweiften Klammern.
- `generateGraphvizArtifacts(program)` erzeugt AST-, Dependency- und CFG-DOT-Artefakte.

Die CLI und die Weboberflaeche verwenden dieselben Kernfunktionen. Dadurch
sollten C-/JS-/Graphviz-Ausgaben zwischen CLI und Web konsistent bleiben.

## Beispielprogramme

Nuetzliche Beispiele:

- `examples/test1.pseudo2`: allgemeines Beispiel fuer Generierung.
- `examples/verifast_annotations.pseudo2`: kleines Beispiel fuer Pseudo2-VeriFast-Annotationen.
- `examples/verifast/valid_*.pseudo2`: positive VeriFast-Beispiele, die mit dem repo-lokalen VeriFast erfolgreich verifiziert werden.
- `examples/verifast/invalid_*.pseudo2`: negative VeriFast-Beispiele, die absichtlich scheitern und Pseudo2-Zeilen in den Diagnosen liefern.
- `examples/serverExamples`: groessere Beispielprogramme fuer Sprache, Arrays, Structs, Funktionen, Listen, Queues, Stacks, Suche und Sortierung.

Die aktuelle VeriFast-Beispielgruppe deckt u. a. ab:

- einfache `@assert true`-/`@assert false`-Faelle.
- boolesche Spezifikationsausdruecke.
- Loop-Invarianten mit `@invariant` fuer `while`, `for` und `do`.
- rohe VeriFast-Strings wie `@assert "true"` und `@assert "false"`.
- Top-Level-Assertions.
- Array-Parameter inklusive automatisch uebergebener Laenge.
- Struct-Methoden mit explizitem `mythis` im generierten C.
- Schleifen mit automatisch generierten Invarianten.

Alle Beispielprogramme werden durch den File-Validation-Test geparst und
validiert:

```powershell
npm run --workspace packages/language test -- test/integration/FileValidation.test.ts
```

Die echten VeriFast-Beispiele werden im CLI-Test ausgefuehrt, wenn
`.\verifast-26.01\bin\verifast.exe` vorhanden ist:

```powershell
npm run --workspace packages/cli test -- test/verifast/VeriFastSourceMap.test.ts
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

Dann im Browser `http://localhost:20002/pseudo2-workbench` oeffnen
und die Buttons `Run JavaScript`, `Generate C + Verify` und `Verify C` pruefen.

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
