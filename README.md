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
@ensures result != null
@terminates
func verified()
  @assume true
  @assert true
  return 5

@invariant true
@decreases "0"
while false
  @assert true

print verified()
```

Generierter C-Ausschnitt:

```c
Ps2Value* func_verified_0(void)
//@ requires true;
//@ ensures (result != 0);
//@ terminates;
{
  //@ assume(true);
  //@ assert true;
  return ps2_copy_value(ps2_int(5));
}
```

Unterstuetzte Pseudo2-Annotationen:

- `@requires <Expression>` vor einer Funktion.
- `@ensures <Expression>` vor einer Funktion.
- `@terminates` vor einer Funktion. Der C-Generator erzeugt daraus `//@ terminates;`.
- `result` innerhalb von VeriFast-Annotationen, z. B. `@ensures result != null`.
- `@assert <Expression>` im Funktionsrumpf.
- `@assume <Expression>` im Funktionsrumpf.
- `@open <Expression>`, `@close <Expression>` und `@leak <Expression>` im Funktionsrumpf. Fuer komplexe Praedikate ist meistens ein roher String sinnvoll, z. B. `@open "P()"`.
- `@invariant <Expression>` direkt vor `while`, `for` oder `do`.
- `@decreases <Expression>` direkt vor `while`, `for` oder `do`.
- strukturierte VeriFast-Modellhelfer in Annotationen:
  - `vf_value(x)` bedeutet: `x` ist ein gueltiger abstrakter Pseudo2-Wert.
  - `vf_number(x)` bedeutet: `x` besitzt im VeriFast-Modell die Pseudo2-Wertart Zahl. Das ist besonders fuer symbolische Funktionsparameter sinnvoll.
  - `vf_integer(x)` bedeutet: `x` ist eine Pseudo2-Zahl mit exaktem ganzzahligen Modellwert. Ein zusaetzliches `vf_number(x)` ist deshalb nicht erforderlich.
  - `vf_array(x)` bedeutet: `x` ist ein abstraktes Pseudo2-Array.
  - `vf_struct(x)` bedeutet: `x` ist ein abstraktes Pseudo2-Struct.
  - `vf_len(x)` liefert die abstrakte Array-Laenge von `x`.
  - `vf_int(x)` liefert den abstrakten Integer-Wert eines mit `ps2_int` erzeugten Pseudo2-Werts.
  - `vf_real(x)` liefert den mathematischen Real-/Rationalwert einer Pseudo2-Zahl.
  - `vf_ratio(a, b)` erzeugt die rationale Spezifikationskonstante `a / b`. `b` muss ein von null verschiedenes Ganzzahlliteral sein; falsche Nenner werden bereits als Editor-Diagnose gemeldet. Damit koennen nicht ganzzahlige Divisionen eindeutig spezifiziert werden, z. B. `vf_real(result) == vf_ratio(5, 2)` fuer `return 5 / 2`.
  - `vf_bool(x)` bedeutet: `x` ist der abstrakte Pseudo2-Wert `true`.
  - `vf_truthy(x)` bildet die Wahrheitsauswertung der C-Runtime exakt ab: `false`, `0`, leere Strings, `null` und `undefined` sind falsch; Arrays, Structs und alle uebrigen Werte sind wahr.
  - `vf_string(x)` bedeutet: `x` ist ein abstrakter Pseudo2-String-Wert.
  - `vf_string(x, "abc")` bedeutet zusaetzlich, dass der String exakt den Inhalt `abc` besitzt. Der Inhalt wird kollisionsfrei als abstrakte Folge von Unicode-Codepoints modelliert und bleibt bei Wertkopien erhalten.
  - `vf_null(x)` bedeutet: `x` ist der abstrakte Pseudo2-Wert `null`.
  - `vf_undefined(x)` bedeutet: `x` ist der abstrakte Pseudo2-Wert `undefined`.
  - `vf_elem(array, index)` liefert das abstrakte Pseudo2-Arrayelement an der 1-basierten Pseudo2-Position `index`. Das funktioniert fuer Array-Zuweisungen, fuer Array-Literale wie `[1, 2]` und fuer konstante Array-Deklarationen mit einfachen Literal-Initializern wie `var A[2] = 7`.
  - `vf_in_bounds(array, index)` bedeutet: `index` liegt innerhalb der 1-basierten Pseudo2-Arraygrenzen von `array`.
  - `vf_field(struct, "fieldName")` liefert den abstrakten Pseudo2-Struct-Feldwert. Der Feldname ist der Pseudo2-Quellname; der C-Generator uebersetzt ihn intern auf den eindeutigen generierten Feldnamen.
  - `vf_same(left, right)` bedeutet: Beide Ausdruecke bezeichnen dasselbe Array- oder Struct-Objekt. In `@requires` bindet dies mehrere formale Heap-Parameter an denselben Ownership-Zustand und ermoeglicht damit beispielsweise einen Aufruf `f(A, A)`.

Einfache Pseudo2-Ausdruecke wie `true`, `false`, Zahlen, Variablen und einfache
Operatoren werden direkt in VeriFast-Spec-Ausdruecke uebersetzt.

Arithmetik und boolesche Auswertung werden im generierten C nicht mehr durch
unspezifische Runtime-Vertraege abstrahiert. Fuer `+`, `-`, `*`, `/`, `mod`
und `^` erzeugt der Generator operator-spezifische Aufrufe mit Beziehungen
zwischen den abstrakten Eingabe- und Ergebniswerten. Ganzzahlige Division wird
konkret modelliert, wenn der Divisor nicht null ist und ohne Rest teilt. Dasselbe gilt fuer `<`,
`<=`, `>`, `>=`, `==`, `!=`, `&&`, `||` und `!`. Division und Modulo liefern
bei einem von null verschiedenen Divisor die entsprechende mathematische
Integer-Beziehung. Nichtnegative ganzzahlige Potenzen werden durch
`ps2_model_power` auf Basis des VeriFast-Nat-Modells auswertbar dargestellt,
sodass beispielsweise `2 ^ 3 == 8` bewiesen wird.

`for`-Schleifen verwenden dieselben modellierten Vergleichs- und
Arithmetikoperationen. Der Generator konserviert Endwert und Schrittweite in
internen Invarianten, sodass `vf_integer`, `vf_int` und `vf_real` ueber die
Iteration erhalten bleiben. Der Schleifeniterator ist sowohl in
`@invariant` als auch in Beweisanweisungen im Schleifenrumpf sichtbar.

Arrays und Structs besitzen im generierten VeriFast-Modell jetzt explizite
Zustandspraedikate. `ps2_array_state` traegt die aktuelle Elementliste,
`ps2_struct_state` die aktuellen Feldwerte. Array- und Struct-Zuweisungen
erzeugen jeweils den Folgezustand; Lesezugriffe, Funktionsvertraege,
`@assert` und Schleifeninvarianten verwenden denselben Zustand. Dadurch lassen
sich wiederholte Mutationen in Schleifen sowie lokale Aliase beweisen. Wenn
beispielsweise `B = A` gilt und `B[1]` veraendert wird, beschreibt eine
anschliessende Aussage ueber `vf_elem(A, 1)` denselben Arrayzustand.

Direkt besessene Arrays und Structs werden auch in verschachtelten `if`-,
Schleifen- und Block-Sichtbarkeiten verfolgt. Lokale Aliase und mit `vf_same`
deklarierte Parameter-Aliase teilen denselben Zustand. Die konkrete
Heap-Realisierung unter `runtime/c/pseudo2_heap_runtime.c` verifiziert reale
C-Felder, Pointer-Arrays, Arrayzugriffe, Struct-Aufbau und Feldmutationen gegen
dieselben Zustandsideen.

Heapwerte innerhalb von Containern werden als getrennte, uebertragene
Ownership-Chunks modelliert. Damit sind insbesondere Structs als Arrayelemente
und Arrays in Struct-Feldern inklusive tiefer Lese- und Schreibzugriffe
verifizierbar. Verschachtelte Vertrage verwenden dieselbe Pseudo2-Syntax, zum
Beispiel `vf_elem(vf_field(buffer, "values"), 2)` oder
`vf_field(vf_elem(cells, 1), "value")`. Da die Chunks flach gekoppelt werden,
bleiben auch erlaubte zyklische Struct-Referenzen endlich modellierbar.

Aktuelle Grenze: Wird ein bereits besetztes Heap-Feld durch ein anderes
Heapobjekt ersetzt, muss die Ownership des alten Child-Objekts derzeit noch
explizit behandelt werden. Arrays von Arrays bleiben entsprechend der
Pseudo2-Sprachvalidierung unzulaessig. Die vollstaendige skalare C-Runtime fuer
Strings, Gleitkommazahlen, Ausgabe und Speicherfreigabe bleibt weiterhin die
vertrauenswuerdige Vertragsgrenze.

Wichtig: `@decreases` ist in Pseudo2 aktuell eine Loop-Annotation. Fuer
C-Funktionen verwendet VeriFast `terminates`; deshalb gibt es dafuer die
separate Pseudo2-Annotation `@terminates`.

Falls eine C-/VeriFast-spezifische Spezifikation gebraucht wird, kann als erster
einfacher Weg ein Stringliteral verwendet werden. Der Stringinhalt wird roh in
den VeriFast-Kommentar geschrieben:

```pseudo2
@requires "true"
@ensures "result != 0"
@terminates
func f()
  @assume "true"
  @assert "true"
  return 1

@invariant "true"
@decreases "0"
for i = 1 to 2
  @assert true
```

Beispiele fuer die strukturierte Modellsyntax:

```pseudo2
@requires true
@ensures vf_array(result) && vf_len(result) == 2 && vf_int(vf_elem(result, 2)) == 2
func makeArray()
  return [1, 2]

@requires true
@ensures vf_array(result) && vf_int(vf_elem(result, 1)) == 7
func makeArrayWithElement()
  var A[2] = 0
  A[1] = 7
  return A

@requires true
@ensures vf_array(result) && vf_int(vf_elem(result, 1)) == 7 && vf_int(vf_elem(result, 2)) == 7
func makeFilledArray()
  var A[2] = 7
  return A

struct S
  num value

@requires true
@ensures vf_struct(result) && vf_undefined(vf_field(result, "value"))
func makeStruct()
  return new S

@requires true
@ensures vf_struct(result) && vf_int(vf_field(result, "value")) == 7
func makeStructWithField()
  var s = new S
  s.value = 7
  return s

@requires true
@ensures vf_value(result) && vf_int(result) == 7
func seven()
  return 7

@requires true
@ensures vf_bool(result)
func yes()
  return true

@requires true
@ensures vf_string(result, "hello")
func greeting()
  return "hello"

@requires vf_integer(a) && vf_integer(b)
@ensures vf_int(result) == vf_int(a) + vf_int(b)
func add(a, b)
  return a + b

@requires true
@ensures vf_real(result) == vf_ratio(5, 2)
func halfFive()
  return 5 / 2

@requires vf_integer(a) && vf_integer(b)
@ensures vf_bool(result) == (vf_int(a) < vf_int(b))
func less(a, b)
  return a < b

@requires vf_number(x)
@ensures vf_bool(result) == vf_truthy(x)
func normalizeTruthiness(x)
  return !(!x)

@requires vf_array(A) && vf_in_bounds(A, i) && vf_int(vf_elem(A, i)) == 7
@ensures vf_int(result) == 7
func getAt(A[1..n], i)
  return A[i]

@requires vf_struct(s) && vf_int(vf_field(s, "value")) == 7
@ensures vf_int(result) == 7
func readValue(s)
  return s.value

@requires vf_same(A, B) && vf_array(A) && vf_array(B) && vf_in_bounds(A, 1)
@ensures vf_int(vf_elem(A, 1)) == 7 && vf_int(vf_elem(B, 1)) == 7
func writeAlias(A[1..n], B[1..m])
  B[1] = 7
  return A[1]

struct Buffer
  num[] values

@requires vf_struct(buffer) && vf_array(vf_field(buffer, "values")) && vf_in_bounds(vf_field(buffer, "values"), 2)
@ensures vf_struct(result) && vf_array(vf_field(result, "values")) && vf_int(vf_elem(vf_field(result, "values"), 2)) == 8
func updateBuffer(buffer)
  buffer.values[2] = 8
  return buffer

@requires true
@ensures vf_array(result) && vf_int(vf_elem(result, 1)) == 3
func countArray()
  var A[1] = 0
  var i = 0
  @invariant vf_array(A) && vf_integer(vf_elem(A, 1)) && vf_int(vf_elem(A, 1)) == vf_int(i) && vf_integer(i) && vf_int(i) >= 0 && vf_int(i) <= 3
  while i < 3
    A[1] = A[1] + 1
    i = i + 1
  return A
```

Diese `vf_*`-Helfer sind absichtlich nur in VeriFast-Annotationen erlaubt.
Ausserhalb davon meldet der Validator einen Fehler. Intern bildet der C-Generator
Wertarten und Skalare auf abstrakte VeriFast-Fixpoints wie
`ps2_model_array(...)`, `ps2_model_int(...)` und
`ps2_model_string_content(...)` ab. Veraenderliche Arrayelemente und
Struct-Felder werden ueber `ps2_array_state(...)`, `ps2_struct_state(...)`,
`nth(...)` und `ps2_struct_field_lookup(...)` an den jeweils aktuellen
Heapzustand gebunden.

Die konkrete Heap-Runtime kann unabhaengig vom generierten Programm geprueft
werden:

```powershell
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_heap_runtime.c
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
- Loop-Varianten mit `@decreases`.
- Funktions-Terminierung mit `@terminates`.
- `result` in `@ensures`.
- Ghost-/Proof-Statements wie `@assume`, `@open`, `@close` und `@leak`.
- strukturierte Modellhelfer `vf_value`, `vf_number`, `vf_integer`, `vf_array`, `vf_struct`, `vf_len`, `vf_int`, `vf_real`, `vf_ratio`, `vf_bool`, `vf_truthy`, `vf_string`, `vf_null`, `vf_undefined`, `vf_elem`, `vf_in_bounds`, `vf_field` und `vf_same`.
- rationale Zahlenbeziehungen und nicht ganzzahlige Division ueber `vf_real`.
- praezise Arithmetik fuer `+`, `-`, `*`, `/`, `mod` und `^`, auch mit symbolischen Funktionsparametern.
- praezise Vergleiche und Gleichheit fuer Zahlen, Booleans, Strings, Null-/Undefined-Werte sowie Identitaetsgleichheit im Runtime-Modell.
- Runtime-konforme Wahrheitsauswertung fuer `&&`, `||` und `!` ueber `vf_truthy`.
- konkrete String-Inhalte mit `vf_string(value, "text")`, einschliesslich positiver und absichtlich falscher Inhaltsvertraege.
- Stringverkettung mit `+`, einschliesslich eines exakten Inhaltsbeweises fuer das Ergebnis.
- Array-Literal-Elemente, z. B. `vf_elem(result, 2)` nach `return [1, 2]`.
- konstante Array-Initialisierung mit Literal-Werten, z. B. `vf_elem(result, 1)` nach `var A[2] = 7`.
- Struct-Defaultfelder, z. B. `vf_undefined(vf_field(result, "value"))` nach `return new S`.
- Array- und Struct-Parameter in Funktionsvertraegen, z. B. `vf_elem(A, i)` und `vf_field(s, "value")`.
- bounds-gesicherte Arrayparameter mit `vf_in_bounds(A, i)`.
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
