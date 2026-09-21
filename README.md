# Pseudo2 Langium Workspace

Dieses Repository enthaelt die Langium-Portierung von Pseudo2 mit Parser,
Scoping, Validator, JavaScript-Generator, C-Generator, Graphviz-Generatoren,
CLI und Weboberflaeche. Der C-Generator erzeugt VeriFast-faehigen C-Code und
unterstuetzt einfache Pseudo2-Annotationen fuer VeriFast.

## Voraussetzungen

- Node.js 20 oder neuer
- npm 10 oder neuer
- VeriFast im Repo unter `verifast-26.01`
- Fuer die C-Ausfuehrung: GCC, Clang oder Visual Studio C++ Build Tools

Der standardmaessig verwendete VeriFast-Pfad ist repo-lokal:

```powershell
.\verifast-26.01\bin\verifast.exe
```

Wenn ausnahmsweise ein anderer VeriFast verwendet werden soll, kann der Pfad
bei der CLI explizit ueber `--vf` ueberschrieben werden. Die Weboberflaeche
verwendet bewusst den repo-lokalen VeriFast.

Der C-Runner erkennt `gcc`, `clang`, `cc` und `cl` automatisch. Unter Windows
wird eine Visual-Studio-Installation auch dann gefunden, wenn `cl.exe` nicht im
normalen `PATH` steht. Ein abweichender Compiler kann mit
`PSEUDO2_C_COMPILER` oder der CLI-Option `--cc` gewaehlt werden.

## Projektstruktur

- `packages/language`: Grammatik, AST, Scoping, Validator, Typing und alle Generator-Kernfunktionen.
- `packages/cli`: Kommandozeilenwerkzeug fuer JS-, Pretty-Pseudo2-, Graphviz-, C-Generierung und VeriFast.
- `packages/web`: Monaco/Langium-Weboberflaeche mit JS- und C-Ausfuehrung, VeriFast und gerenderten Graphviz-Graphen.
- `packages/standalone-web`: Leichter Pseudo2-JavaScript-Runner, der als einzelne HTML-Datei gebaut wird.
- `packages/extension`: VS-Code-Erweiterung.
- `examples`: Pseudo2-Beispielprogramme.
- `out`: uebliches Zielverzeichnis fuer generierte Ausgaben.

Wichtige Generator-Dateien:

- `packages/language/src/generators/javascript`: JavaScript-Generator und gemeinsamer Namenskontext.
- `packages/language/src/generators/c`: Runtime-basierter und direkter C-/VeriFast-Generator.
- `packages/language/src/generators/c/runtime`: abstrakte C-Vertraege und ausfuehrbare Runtime-Implementierung.
- `packages/language/src/generators/c/direct-runtime`: kleine Runtime-Bausteine des direkten C-Generators.
- `packages/language/src/generators/pretty`: Pretty-Printer fuer Pseudo2 mit geschweiften Klammern.
- `packages/language/src/generators/graphviz`: AST-, Dependency- und CFG-Graphviz-Generatoren.
- `packages/language/src/generators/generator-artifacts.ts`: gemeinsamer Einstieg fuer JS-, Pretty-Pseudo2- und Graphviz-Artefakte.

Weitere Quellcodegliederung:

- `packages/language/src/runtime`: JavaScript-Runtime fuer Skalare, Arrays und Structs.
- `packages/language/src/scoping`: Pseudo2-Namensaufloesung und Sichtbarkeitsregeln.
- `packages/language/src/typing`: Typmodell und Typberechnung.
- `packages/language/src/generated`: von Langium erzeugter Code; nicht manuell bearbeiten.
- `packages/cli/src/main.ts`: stabiler Einstiegspunkt der Kommandozeilenanwendung.
- `packages/cli/src/generation`: dateibasierte JS-, Pretty-Pseudo2- und C-Generatoradapter.
- `packages/cli/src/execution`: C-Compiler-/Programmausfuehrung und VeriFast-Anbindung.
- `packages/cli/src/common`: gemeinsam genutzte CLI-Hilfsfunktionen.
- `packages/web/src/main.ts`, `index.ts` und `node.ts`: Browser-, Bibliotheks- und Node-Einstiege.
- `packages/web/src/verification`: Aufbereitung und Darstellung des Pseudo2-Verifikationsbaums.
- `packages/web/src/worker`: Language Server im Web Worker.
- `packages/web/src/common`: zwischen Browser- und Node-Seite getrennte Web-Hilfsfunktionen.
- `packages/standalone-web/src`: Einstieg, Vorlage und Styles des eigenstaendigen Ein-Datei-JS-Runners.
- `packages/extension/src/extension` und `packages/extension/src/language`: VS-Code- und Language-Server-Einstiege.

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

Ohne weitere Option wird der Vertragsmodus fuer VeriFast erzeugt. Fuer eine
kompilierbare Runtime-Implementierung wird `--runtime implementation` benutzt:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\test1.pseudo2 -d .\out\runnable --runtime implementation
```

Fuer gut lesbares, natives C ohne Pseudo2-Runtime gibt es einen zweiten Modus:

```powershell
node .\packages\cli\bin\cli.js generate-c .\examples\direct-c-demo.pseudo2 -d .\out --direct
node .\packages\cli\bin\cli.js run-c .\examples\direct-c-demo.pseudo2 --direct
node .\packages\cli\bin\cli.js verifast .\out\directcdemo.direct.c
```

`--direct` schreibt `<name>.direct.c` und `<name>.direct.c.map.json`. Die Source Map
ordnet VeriFast-Diagnosen und den Verifikationsbaum wieder den Pseudo2-Zeilen zu.
Die CLI erkennt die Endung `.direct.c` und ueberspringt automatisch die beiden
Pseudo2-Runtime-Kerne, weil der native Code sie nicht verwendet. Native C-Typen (`int`,
`double`, `bool`,
`const char *`, `struct` und C-Arrays/Pointer) machen den Code naeher am
Pseudo2-Quelltext. Funktionen und Methoden werden als freie Funktionen mit
explizitem Empfaenger erzeugt. Pseudo2-Arrayindizes werden durch den verifizierten
Helfer `ps2_checked_index` einsbasiert geprueft und danach in C-Indizes umgerechnet.
Lokale dynamische Arrays verwenden `calloc`; konstante Fuellwerte erhalten eine
Slice-Invariante. Eindeutig besessene lokale Arrays und Structs werden freigegeben.

Auch dieser Modus uebersetzt `@requires`, `@ensures`, `@terminates`, `@invariant`,
`@decreases`, `@assert`, `@assume`, `@open`, `@close` und `@leak`. Anders als der
Runtime-Generator beziehen sich die Formeln direkt auf native C-Werte. Daher kann
beispielsweise `@ensures result == 5` unveraendert als nativer Vertrag erscheinen.
Fuer Arrayparameter erzeugt der Generator automatisch Slice-/Laengenvertraege;
fuer Stringparameter Inhaltspraedikate und fuer Structparameter beziehungsweise
Methodenempfaenger Feld- und `malloc_block`-Besitz. Explizite Feld- und Arrayformeln
werden mit den zugehoerigen Ghostwerten verbunden.

Rein ganzzahlige Direct-C-Programme verwenden C-`int`, damit VeriFast echte
arithmetische Ueberlaeufe pruefen kann. Der ausfuehrbare Modus verwendet fuer
Programme mit Division oder Potenz `double`; beispielsweise liefert `3 / 2` dort
`1.5`. Die Direct-C-Vertragsvariante weist solche Programme mit Pseudo2-Zeile ab,
weil VeriFast native Gleitkommaausdruecke nicht wie mathematische reelle Zahlen in
Vertraegen behandelt. `Run C` bleibt davon unabhaengig und erzeugt nur die
kompilierbare Implementierungsvariante.

Unterstuetzt und real mit VeriFast getestet sind skalare Vertraege, Schleifen,
Arrayparameter und lokale Arrays, Arrayupdates, Structs und Methoden sowie
Stringliterale, Inhaltsvergleich, Stringparameter, Stringrueckgaben und
Stringverkettung. Arrayrueckgaben, Arrayfelder in Structs, verschachtelte Arrays,
Structs als Arrayelemente, Aliasparameter und das Ersetzen besessener Child-Objekte
werden ueber typisierte native Deskriptoren und praezise Ownership-Vertraege
abgebildet. `print` akzeptiert neben Skalaren auch Arrays, verschachtelte Arrays und
Struct-Referenzen. Die Arrayausgabe folgt der JavaScript-Stringkonvertierung mit
Kommatrennung; eine vorhandene Struct-Referenz erscheint als `[object Object]`,
`null` und noch nicht initialisierte Felder bleiben unterscheidbar.

Die vollstaendige dynamische JavaScript-Semantik ist ohne Tagged Values trotzdem
nicht in statisch typisiertes natives C uebertragbar. Laufzeitliche Typwechsel sowie
VeriFast-Vertraege fuer funktionsuebergreifende globale Heapwerte werden im
Direct-C-Modus deshalb weiterhin mit einer Pseudo2-Zeile abgewiesen; dafuer bleibt
der Runtime-C-Generator vorgesehen. Nicht-ganzzahlige Direct-C-Programme sind
ausfuehrbar, fuer formale Vertrage mit Division oder Potenzen ist jedoch ein eigenes
Gleitkomma-/Rationalmodell erforderlich.

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

### C-Code kompilieren und ausfuehren

`run-c` kann Pseudo2 direkt in Implementierungs-C uebersetzen, kompilieren und
ausfuehren:

```powershell
node .\packages\cli\bin\cli.js run-c .\examples\serverExamples\arithmetic\fibonacci.pseudo2
```

Alternativ kann eine mit `--runtime implementation` erzeugte C-Datei gestartet
werden:

```powershell
node .\packages\cli\bin\cli.js run-c .\out\runnable\test1.c
```

Compiler und Timeout koennen explizit gesetzt werden:

```powershell
node .\packages\cli\bin\cli.js run-c .\examples\test1.pseudo2 --cc clang --timeout 15000
$env:PSEUDO2_C_COMPILER = "C:\Pfad\zu\gcc.exe"
```

Die JSON-Ausgabe unterscheidet die Phasen `compiler`, `compile` und `run`.
Programm- und Compiler-Ausgaben enthalten keine internen temporaeren Pfade.

### VeriFast ueber CLI ausfuehren

VeriFast kann ueber die CLI auf eine generierte `.c`-Datei angewendet werden.
Der Standardmodus ist Compile-only mit `-c`.

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c
```

Dieser eine Aufruf verifiziert zuerst die beiden konkreten Runtime-Kernel im
Repo und danach das generierte Programm gegen die Runtime-Vertraege. Ein
Runtime-Fehler bricht das Buendel ab.

Die CLI verwendet dabei automatisch `.\verifast-26.01\bin\verifast.exe`.
Alternativ kann ein anderer Pfad explizit angegeben werden:

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c --vf "C:\Pfad\zu\verifast.exe"
```

Ein VeriFast-Prozess wird standardmaessig nach 60 Sekunden beendet. Das Limit
kann fuer aufwendigere Beweise angepasst werden:

```powershell
node .\packages\cli\bin\cli.js verifast .\out\test1.c --timeout 120000
```

Redux bleibt der Standard-Prover fuer Programme und die konkreten Runtimes.
Bei annotierten Schleifen, die Struct-Felder veraendern, schreibt der
C-Generator automatisch eine VeriFast-Option fuer `Z3v4.5` in die C-Datei.
Der gemeinsame Runner liest diese Option. Diese gezielte Auswahl verhindert
nicht terminierende Redux-Beweissuchen, ohne die Runtime-Pruefung auf den dort
ungeeigneten Z3-Prover umzustellen.

Die Ausgabe ist JSON, z. B.:

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "0 errors found ...",
  "stderr": "",
  "errors": [],
  "runtimeChecks": [
    { "component": "pseudo2_heap_runtime.c", "ok": true, "exitCode": 0 },
    { "component": "pseudo2_scalar_runtime.c", "ok": true, "exitCode": 0 }
  ]
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

# Nur das angegebene C-Programm pruefen
node .\packages\cli\bin\cli.js verifast .\out\test1.c --no-runtime

# Prozesslimit auf zwei Minuten setzen
node .\packages\cli\bin\cli.js verifast .\out\test1.c --timeout 120000
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
node .\packages\cli\bin\cli.js run-c .\examples\serverExamples\arithmetic\fibonacci.pseudo2
```

## Pseudo2-Annotationen fuer VeriFast

Annotationen werden direkt in Pseudo2 geschrieben. Der C-Generator uebersetzt
sie in VeriFast-Kommentare. Sowohl die kompakte Pseudo2-Schreibweise `@...`
als auch die kommentarartige Form `//@ ...` werden akzeptiert. Pseudo2-
Annotationen besitzen kein abschliessendes Semikolon. Das Semikolon wird erst
vom C-Generator in den erzeugten VeriFast-Kommentaren ergaenzt.

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

Dasselbe kann mit VeriFast-aehnlicher Syntax geschrieben werden:

```pseudo2
//@ requires 0 < a &*& 0 <= b &*& a*b <= INT_MAX
//@ ensures result == a*b
func multByAdd(a, b)
  var xa = a
  var res = 0
  //@ invariant true
  while xa > 0
    res = res + b
    xa = xa - 1
  return res
```

`&*&`, `INT_MAX` und `INT_MIN` sind Teil der Pseudo2-Annotationssyntax.
Natuerliche Integerausdruecke werden automatisch auf das abstrakte Wertmodell
projiziert. Daher ist `result == a*b` ausreichend; interne
`ps2_model_*`-Projektionen gehoeren nicht in die Pseudo2-Annotation.

Enthaelt ein Integervertrag `INT_MAX` oder `INT_MIN`, erzeugt der C-Generator
zusaetzliche native C-Arithmetikchecks. In der Weboberflaeche werden diese
Pruefstellen im Verifikations-C auch ohne solche Vertragsgrenzen erzeugt. In der
CLI aktiviert `generate-c <datei.pseudo2> --check-overflow` dieses Verhalten.
Die Pruefstellen betreffen derzeit numerische Zuweisungen und den C-Integerwert
der Operanden, nicht alle Pseudo2-Zahlenoperationen. VeriFast kann dadurch
`Potential arithmetic overflow` direkt an der verursachenden Pseudo2-Zuweisung
melden. Ohne eine ausreichende fachliche Schleifeninvariante scheitert der
anschliessende Beweis weiterhin korrekt an `result == a*b`.

In der Weboberflaeche ist **Check arithmetic overflow** standardmaessig aktiv.
Die Option kann fuer einen zweiten Beweislauf ausgeschaltet werden; dann zeigt
das obige Beispiel statt des Ueberlaufs den Fehler an der `@ensures`-Zeile.
In der CLI entspricht dies `verifast <datei.c> --no-overflow-check`. Fuer das
Beispiel ohne `INT_MAX` im Vertrag muss die C-Datei vorher mit
`generate-c <datei.pseudo2> --check-overflow` erzeugt werden; der VeriFast-Schalter
allein kann keine fehlenden Pruefstellen nachtraeglich einfuegen.
Graue Endknoten im Pseudo2-Verifikationsbaum bezeichnen nach einem Fehler noch
nicht abgeschlossene Alternativpfade und sind kein erfolgreicher Beweis.
Das Beispiel `examples/verifast/valid_bounded_multiply.pseudo2` zeigt einen
erfolgreichen Beweis mit eingeschalteter Overflow-Pruefung. Fuer die allgemeine
Schleife `multByAdd` reicht `invariant true` nicht aus; auch die mathematische
Produktinvariante braucht im aktuellen Modell noch Unterstuetzung fuer
nichtlineare Multiplikation.

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
- direkte Werte und Operatoren, etwa `result == 5`, `result == "abc"`,
  `result == null`, `result.value == undefined`, `result == a*b` und `!!x`.
- Array- und Struct-Zugriffe wie `A[i]`, `matrix[i][j]`, `s.value` und
  `result.values[2]`. Indizes bleiben in Pseudo2 einsbasiert.
- `length(A)` fuer die Arraylaenge; eine Grenze schreibt man beispielsweise
  `1 <= i && i <= length(A)`.
- `A == B` bzw. `left == right` in Vertraegen fuer Heap-Identitaet.
  Der normale Pseudo2-Programmcode erlaubt weiterhin keinen Arrayvergleich.
- konstante rationale Bedingungen wie `result == 5 / 2`. Der C-Generator
  projiziert sie auf exakte VeriFast-Realzahlen.

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
internen Invarianten, sodass ganzzahlige Eigenschaften ueber die Iteration
erhalten bleiben. Der Schleifeniterator ist sowohl in
`@invariant` als auch in Beweisanweisungen im Schleifenrumpf sichtbar.

Arrays und Structs besitzen im generierten VeriFast-Modell jetzt explizite
Zustandspraedikate. `ps2_array_state` traegt die aktuelle Elementliste,
`ps2_struct_state` die aktuellen Feldwerte. Array- und Struct-Zuweisungen
erzeugen jeweils den Folgezustand; Lesezugriffe, Funktionsvertraege,
`@assert` und Schleifeninvarianten verwenden denselben Zustand. Dadurch lassen
sich wiederholte Mutationen in Schleifen sowie lokale Aliase beweisen. Wenn
beispielsweise `B = A` gilt und `B[1]` veraendert wird, beschreibt eine
anschliessende Aussage ueber `A[1]` denselben Arrayzustand.

Direkt besessene Arrays und Structs werden auch in verschachtelten `if`-,
Schleifen- und Block-Sichtbarkeiten verfolgt. Lokale Aliase und mit `==`
deklarierte Parameter-Aliase teilen denselben Zustand. Die konkrete
Heap-Realisierung unter `runtime/c/pseudo2_heap_runtime.c` verifiziert reale
C-Felder, Pointer-Arrays, Arrayzugriffe, Struct-Aufbau und Feldmutationen gegen
dieselben Zustandsideen.

Heapwerte innerhalb von Containern werden als getrennte, uebertragene
Ownership-Chunks modelliert. Damit sind Structs als Arrayelemente, Arrays in
Struct-Feldern und Arrays in Arrays inklusive tiefer Lese- und Schreibzugriffe
verifizierbar. Die Typisierung erhaelt jede Arraydimension; Quellcode kann
`matrix[i][j]` und Struct-Felder beispielsweise `num[][] matrix` verwenden.
Verschachtelte Vertraege verwenden dieselbe Pseudo2-Syntax, zum Beispiel
`matrix[2][1]`, `buffer.values[2]` oder `cells[1].value`.
Da die Chunks flach gekoppelt werden, bleiben auch erlaubte zyklische
Struct-Referenzen endlich modellierbar.

Beim Ersetzen eines bereits besetzten Child-Slots verfolgt der C-Generator die
vorherige Belegung. Sobald das alte Child keinen weiteren bekannten
Container-Slot mehr besitzt, materialisiert der Generator den alten Wert und
konsumiert automatisch dessen `ps2_array_state`- oder `ps2_struct_state`-Chunk.
Das gilt fuer Struct-Felder und statisch verfolgbare Arrayelemente; mehrere
Slots fuer dasselbe Child werden beruecksichtigt. Der konkrete Heap-Kernel
verifiziert die Child-Ersetzung sowohl in Structs als auch in Parent-Arrays.

Die konkreten Runtime-Kernel liegen getrennt vom Generator unter `runtime/c`:

- `pseudo2_heap_runtime.c` verifiziert Array-/Struct-Speicher, Mutation,
  Child-Ersetzung und Freigabe der Containerdaten.
- `pseudo2_scalar_runtime.c` verifiziert skalare Werte, Stringkopien und
  Stringgleichheit, den gespeicherten `double`-Wert ueber `fp_of_double`,
  Ein-/Ausgabewrapper sowie die vollstaendige Freigabe der skalaren Objekte.

Der generierte Programmcode verwendet abstrakte Runtime-Vertraege, damit
Pseudo2-Vertraege modular bewiesen werden koennen. CLI und Weboberflaeche
verifizieren diese Client-Vertraege und beide konkreten Runtime-Kernel in einem
verpflichtenden Buendel. Ein Aufruf ist nur erfolgreich, wenn Heap-Kernel,
Scalar-Kernel und generiertes Programm erfolgreich sind; `--no-runtime` dient
nur der gezielten Einzeldiagnose.

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

Beispiele fuer direkte Pseudo2-Vertraege:

```pseudo2
@requires true
@ensures length(result) == 2 && result[2] == 2
func makeArray()
  return [1, 2]

struct S
  num value

@requires true
@ensures result.value == 7
func makeStructWithField()
  var s = new S
  s.value = 7
  return s

@requires a >= INT_MIN && b >= INT_MIN
@ensures result == a + b
func add(a, b)
  return a + b

@requires true
@ensures result == 5 / 2
func halfFive()
  return 5 / 2

@requires 1 <= i && i <= length(A) && A[i] == 7
@ensures result == 7
func getAt(A[1..n], i)
  return A[i]

@requires A == B && 1 <= length(A)
@ensures A[1] == 7 && B[1] == 7
func writeAlias(A[1..n], B[1..m])
  B[1] = 7
  return A[1]

@requires true
@ensures result[1] == 3
func countArray()
  var A[1] = 0
  var i = 0
  @invariant length(A) == 1 && A[1] == i && i >= 0 && i <= 3
  while i < 3
    A[1] = A[1] + 1
    i = i + 1
  return A
```

Intern bildet der C-Generator
Wertarten und Skalare auf abstrakte VeriFast-Fixpoints wie
`ps2_model_array(...)`, `ps2_model_int(...)` und
`ps2_model_string_content(...)` ab. Veraenderliche Arrayelemente und
Struct-Felder werden ueber `ps2_array_state(...)`, `ps2_struct_state(...)`,
`nth(...)` und `ps2_struct_field_lookup(...)` an den jeweils aktuellen
Heapzustand gebunden.

Die konkreten Runtime-Kernel werden beim normalen `verifast`-Aufruf automatisch
mitgeprueft. Fuer eine isolierte Diagnose koennen sie weiterhin einzeln gestartet
werden:

```powershell
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_heap_runtime.c
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_scalar_runtime.c
```

## Weboberflaeche starten

Die Weboberflaeche wird ueber Vite gestartet:

```powershell
npm run dev
```

Danach im Browser oeffnen:

```text
http://localhost:21002/pseudo2-workbench
```

Falls der Port bereits belegt ist, meldet Vite den tatsaechlichen Port in der
Konsole.

Hinweis: `http://localhost:21002` oeffnet die Root-`index.html`, die als
einfacherer Runner ohne alle C-/VeriFast-Controls aufgebaut ist. Fuer den
vollstaendigen Workflow mit `Run C`, `Generate & Verify C` und `Verify C` die
`/pseudo2-workbench`-Adresse verwenden. Die eigentliche HTML-Datei liegt unter
`packages/web/pseudo2-workbench.html`.

### Statisches JavaScript-Bundle

Die reduzierte Root-Seite kann als eigenstaendiges Browser-Bundle gebaut werden.
Editor, Validierung, JavaScript-Generierung und JavaScript-Ausfuehrung benoetigen
dabei kein Node-Backend auf dem Zielserver:

```powershell
npm run build:web
```

Das vollstaendige Upload-Verzeichnis ist danach `dist`. Die JavaScript-Seite
liegt dort als `index.html` und wird am Server-Root `/` ausgeliefert. Eine lokale
Vorschau des tatsaechlich gebauten Bundles startet mit:

```powershell
npm run preview:web
```

Danach ist die statische Vorschau unter `http://127.0.0.1:4173` erreichbar. Der
Produktions-Webserver muss fuer diese Dateien ebenfalls die Header
`Cross-Origin-Opener-Policy: same-origin` und
`Cross-Origin-Embedder-Policy: require-corp` setzen. Die statische Root-Seite
enthaelt bewusst keine serverseitige C-Ausfuehrung und keine VeriFast-Anbindung.

### Einzeldatei-JavaScript-Runner

Zusaetzlich zur Monaco-basierten Weboberflaeche gibt es einen leichten Runner,
der Parser, Validator, JavaScript-Generator, Pretty Printer, Oberflaeche, CSS und
JavaScript in genau eine HTML-Datei einbettet:

```powershell
npm run build:standalone
```

Der normale Gesamtbuild `npm run build` erzeugt diese Datei ebenfalls neu. Der
separate Befehl ist fuer einen gezielten Standalone-Neubau ohne Vite-Bundle gedacht.

Die fertige Datei liegt danach hier:

```text
packages/standalone-web/dist/pseudo2-js-runner.html
```

Sie kann direkt per Doppelklick im Browser geoeffnet oder als einzelne Datei auf
einen statischen Webserver kopiert werden. Sie laedt keine externen Assets und
benoetigt weder Vite noch einen laufenden Node-Prozess. Die Programmausfuehrung
erfolgt in einem Web Worker mit Zeitlimit, damit eine Pseudo2-Endlosschleife die
Oberflaeche nicht dauerhaft blockiert. Parser-, Linker- und Validatorfehler werden
nach einer kurzen Tipp-Pause automatisch als Wellenlinie und Zeilenmarkierung
angezeigt; Position und Meldung stehen direkt in der Diagnoseleiste des Editors.

Der Einzeldatei-Runner enthaelt bewusst nur browserfaehige Funktionen. C-Ausfuehrung
und VeriFast bleiben in der vollstaendigen Workbench, weil dafuer native Prozesse
auf dem Server gestartet werden muessen.

### VeriFast-Pfad fuer die Weboberflaeche

Die Weboberflaeche kann VeriFast nur starten, wenn sie ueber den lokalen
Vite/Node-Server laeuft. Der Browser selbst startet keine lokalen `.exe`-Dateien;
stattdessen ruft die Oberflaeche den lokalen Endpoint `/api/verifast` auf. Die
C-Ausfuehrung verwendet entsprechend `/api/run-c`; dort wird die
Implementierungsvariante kompiliert und als lokaler Prozess mit Timeout
gestartet.

Der Server nutzt den repo-lokalen Standardpfad:

```powershell
.\verifast-26.01\bin\verifast.exe
```

### Bedienung der Weboberflaeche

1. `Start` startet den Monaco-Editor und den Langium-Language-Client.
2. `Save Pseudo2` speichert oder laedt den aktuellen Pseudo2-Code herunter.
3. Das Register `JavaScript` enthaelt Programmausgabe, generiertes JavaScript,
   Summary und Source Echo. `Run JavaScript` wechselt automatisch dorthin.
4. Das Register `C` enthaelt C-Programmausgabe und die Auswahl
   `VeriFast C (runtime)` / `Direct C (native, VeriFast)`. Beide Modi zeigen
   Verifikation und Pseudo2-Verifikationsbaum. Nur der Runtime-Modus besitzt den
   zusaetzlichen Bereich mit der getrennten ausfuehrbaren Runtime-Implementierung.
5. `Run C` generiert Implementierungs-C, kompiliert es mit dem lokal erkannten
   Compiler und zeigt nur die relevante Programmausgabe bzw. Compilerdiagnose.
6. `Generate & Verify C` erzeugt die gewaehlte C-Variante und startet VeriFast.
   Im Direct-Modus werden dabei keine Runtime-Kerne vorab geprueft.
7. `Save C` speichert den Code des gerade gewaehlten Generators.
8. `Verify C` sendet den zuletzt erzeugten C-Code erneut an
   `/api/verifast`.
9. Unter `VeriFast Execution Tree` wird ein kompakter Pseudo2-Verifikationsbaum
   dargestellt. Der lokale Node-Endpunkt filtert den VeriFast-JSON-Pfad ueber
   die Generator-Source-Map: Runtime-Helfer, Wrapperfunktionen, generierte
   Namensindizes und der technische C-`main`-Vertrag erscheinen nicht.
10. Der reduzierte Baum rekonstruiert Verzweigungen aus dem sichtbaren
    Pseudo2-Kontrollfluss. `if`, `while`, `for` und `do` erzeugen alternative
    Pfade wie im VeriFast-Ausfuehrungsbaum, waehrend technische Einzelschritte
    zusammengefasst werden. Dadurch bleiben auch Schleifen mit sehr grossen
    rohen VeriFast-Waeldern im Browser klein. Schwarze Knoten sind
    Pseudo2-Schritte, gruene Blaetter abgeschlossene Alternativpfade und rote
    Blaetter Fehler. Jeder Knoten mit Quellposition springt beim Anklicken direkt
    zur zugehoerigen Pseudo2-Editorzeile.
11. `Summary` erzeugt eine kurze Strukturuebersicht; `Show Source` zeigt den
   aktuellen Pseudo2-Quelltext. Beide wechseln in das JavaScript-Register.
12. Das Register `Graphen` rendert AST, Dependency-Graph und CFGs.
13. Beim ersten Oeffnen von `Graphen` oder mit `Refresh` werden alle
    Graphviz-Artefakte aus dem aktuellen, validierten Editor-AST erzeugt.
14. Das Auswahlmenue enthaelt den Abstract Syntax Tree, den Dependency-Graph
    und fuer jede Pseudo2-Funktion einen eigenen Control Flow Graph.
15. Der vertikale Splitter zwischen Editor und Ergebnisbereich kann horizontal
    gezogen werden. Mit `Pfeil links/rechts` wird die Breite per Tastatur
    veraendert; ein Doppelklick setzt sie auf den Standardwert zurueck.

Die Graphen werden lokal mit `@viz-js/viz` als SVG gerendert. Eine separate
Graphviz-Systeminstallation ist fuer die Webansicht nicht erforderlich. Der
zugehoerige DOT-Quelltext bleibt unter `DOT Source` einsehbar. Grosse Graphen
werden in ihrer natuerlichen Graphviz-Groesse innerhalb der Graphflaeche
gescrollt. Der AST-Generator besitzt keine alte Begrenzung auf zehn
Instruktionen mehr.

Wenn VeriFast einen Fehler meldet und das Source-Mapping vorhanden ist, zeigt
das VeriFast-Fenster die Pseudo2-Zeile statt nur der generierten C-Zeile. Die
Weboberflaeche springt zusaetzlich zur ersten gemappten Pseudo2-Diagnose im
Monaco-Editor.

VeriFast und `Run C` funktionieren nur im lokalen Dev-Server-Kontext. Wenn die
UI statisch ohne Node/Vite-Backend ausgeliefert wird, muessen Verifikation und
C-Ausfuehrung ueber die CLI erfolgen.

Der lokale C-Endpunkt fuehrt nativen Code auf dem Entwicklungsrechner aus.
Deshalb akzeptiert er keine Anfragen von fremden Browser-Origins und verarbeitet
hoechstens einen C-Lauf gleichzeitig. Der Vite-Server sollte nicht mit
`--host` in ein nicht vertrauenswuerdiges Netzwerk freigegeben werden.

## Generatoren als TypeScript-API

Die wichtigsten Generatorfunktionen werden aus `pseudo2-language` exportiert:

```ts
import {
  generateProgram,
  generateCProgram,
  generateDirectCProgram,
  generateDirectCProgramWithSourceMap,
  generatePrettyPseudo2,
  generateGraphvizArtifacts
} from 'pseudo2-language';
```

- `generateProgram(program)` erzeugt JavaScript.
- `generateCProgram(program)` erzeugt C-Code mit VeriFast-Kommentaren.
- `generateDirectCProgram(program)` erzeugt natives, runtimefreies C mit nativen VeriFast-Vertraegen.
- `generateDirectCProgramWithSourceMap(program)` liefert dazu die C-zu-Pseudo2-Zeilenabbildung.
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
- `examples/direct-c-*.pseudo2`: native Direct-C-Beispiele fuer Skalare, Overflow, Schleifen, Arrays, Structs und Strings.
- `examples/serverExamples`: groessere Beispielprogramme fuer Sprache, Arrays, Structs, Funktionen, Listen, Queues, Stacks, Suche und Sortierung.

Die aktuelle VeriFast-Beispielgruppe deckt u. a. ab:

- einfache `@assert true`-/`@assert false`-Faelle.
- boolesche Spezifikationsausdruecke.
- Loop-Invarianten mit `@invariant` fuer `while`, `for` und `do`.
- Loop-Varianten mit `@decreases`.
- Funktions-Terminierung mit `@terminates`.
- `result` in `@ensures`.
- Ghost-/Proof-Statements wie `@assume`, `@open`, `@close` und `@leak`.
- direkte Vertraege ohne Modellhelfer: Vergleiche wie `result == 5`,
  `result == true`, `result == "text"`, `result == null`, `x != null` oder
  `x >= 5` werden automatisch auf das passende VeriFast-Wertmodell abgebildet.
  Das gilt auch fuer `result == a*b`, `a*b <= INT_MAX`, `A[i]`, `s.value`
  und `length(A)`.

Für einfache skalare Verträge ist damit normale Pseudo2-Syntax ausreichend:

```pseudo2
@requires x == 5
@ensures result == 5
func identityFive(x)
  @assert x == 5
  return x
```
- rationale Zahlenbeziehungen wie `result == 5 / 2`.
- praezise Arithmetik fuer `+`, `-`, `*`, `/`, `mod` und `^`, auch mit symbolischen Funktionsparametern.
- praezise Vergleiche und Gleichheit fuer Zahlen, Booleans, Strings, Null-/Undefined-Werte sowie Identitaetsgleichheit im Runtime-Modell.
- Runtime-konforme Wahrheitsauswertung fuer `&&`, `||` und `!`, auch `!!x`.
- konkrete String-Inhalte mit `result == "text"`, einschliesslich positiver und absichtlich falscher Inhaltsvertraege.
- Stringverkettung mit `+`, einschliesslich eines exakten Inhaltsbeweises fuer das Ergebnis.
- direkte 1-basierte Arrayzugriffe in Annotationen mit `A[i]` sowie verschachtelte Zugriffe mit `matrix[i][j]`, jeweils mit positiven und absichtlich falschen Beispielen.
- Array-Literal-Elemente, z. B. `result[2]` nach `return [1, 2]`.
- konstante Array-Initialisierung mit Literal-Werten, z. B. `result[1]` nach `var A[2] = 7`.
- Struct-Defaultfelder, z. B. `result.value == undefined` nach `return new S`.
- Array- und Struct-Parameter in Funktionsvertraegen, z. B. `A[i]` und `s.value`.
- automatische Ownership-Aufgabe beim Ersetzen besessener Array-/Struct-Childs.
- konkrete Heap-Freigabe sowie konkrete skalare String-, Gleitkomma-, I/O- und Freigabe-Runtime.
- bounds-gesicherte Arrayparameter mit `1 <= i && i <= length(A)`.
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

### Vollstaendiger Direct-C-Beispielkorpus

Der eigene Corpus-Test prueft alle aus Xtext portierten Dateibeispiele sowie
alle neueren Direct-C- und VeriFast-Beispiele mit den realen Werkzeugen:

```powershell
npm run test:direct-c-corpus
```

Der Test fuehrt derzeit folgende Kontrollen durch:

- Alle 202 `.pseudo2`-Beispiele werden als Direct-C-Implementierung erzeugt und
  mit dem lokal gefundenen C-Compiler kompiliert.
- 28 terminierende und nicht interaktive Xtext-Beispiele werden nativ
  ausgefuehrt; ihre Ausgabe muss exakt der Ausgabe des JavaScript-Generators
  entsprechen.
- Der regulaere Altbestand umfasst alle 87 Dateien aus dem urspruenglichen
  Xtext-Beispielprojekt sowie vier aktuelle Basisbeispiele. Seine 76 ganzzahlig
  modellierbaren Programme werden dem repo-lokalen VeriFast uebergeben. Davon
  sind 12 bereits beweisbar; die uebrigen 64 muessen einen konkreten
  Beweisfehler liefern. Das dokumentiert insbesondere die in alten Beispielen
  noch fehlenden Ownership-Vertraege und Schleifeninvarianten.
- Die 15 weiteren regulaeren Beispiele mit Division, Potenz oder
  nicht-ganzzahligen Zahlen werden exakt als bekannte Grenze des noch fehlenden
  Rationalmodells erkannt.
- 44 positive VeriFast-Beispiele werden strikt bewiesen, zwei dokumentierte
  Beispiele mit deaktivierter Ueberlaufpruefung bewiesen und zwei
  Rationalmodell-Beispiele gezielt abgewiesen.
- Alle 49 absichtlich falschen VeriFast-Beispiele muessen bei Generierung oder
  Verifikation scheitern.
- Alle 14 dedizierten `direct-c-*`-Beispiele werden strikt mit VeriFast bewiesen.

Damit wird jede Beispiel-Datei durch Direct C und einen echten C-Compiler
geprueft. Ein erfolgreicher C-Lauf ist dabei nicht mit einem formalen Beweis zu
verwechseln: Unannotierte Altbeispiele bleiben bewusst als erwartete
VeriFast-Fehler klassifiziert, bis ihre fehlenden Vertraege ergaenzt werden.
Inline-Fragmente aus den portierten Parser- und Validator-Tests werden weiterhin
von ihren jeweiligen Sprachtests geprueft; absichtlich unvollstaendige oder
ungueltige Fragmente sind keine ausfuehrbaren C-Programme.

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

Dann im Browser `http://localhost:21002/pseudo2-workbench` oeffnen
und die Buttons `Run JavaScript`, `Run C`, `Generate & Verify C` und `Verify C`
pruefen. Zusaetzlich im Register `Graphen` AST, Dependency-Graph und mindestens
einen CFG auswaehlen.

### Nach einer C-/VeriFast-Aenderung

```powershell
npm run build
node .\packages\cli\bin\cli.js generate-c .\examples\verifast_annotations.pseudo2 -d .\out
node .\packages\cli\bin\cli.js verifast .\out\verifast_annotations.c
node .\packages\cli\bin\cli.js run-c .\examples\serverExamples\arithmetic\fibonacci.pseudo2
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_heap_runtime.c
node .\packages\cli\bin\cli.js verifast .\runtime\c\pseudo2_scalar_runtime.c
```

Erwartung fuer das Annotation-Beispiel:

```text
ok: true
0 errors found
```
