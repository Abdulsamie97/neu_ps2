# Pseudo2 in Moodle VPL

Dieses Paket stellt die JavaScript-basierte Pseudo2-Ausfuehrung fuer Moodle VPL
bereit. Das erzeugte `pseudo2-vpl.mjs` enthaelt Langium, Parser, Linker,
Validator, JavaScript-Generator und Pseudo2-Runtime in einer Datei. Auf dem
VPL-Jail werden weder `npm` noch TypeScript, GCC oder VeriFast benoetigt.

## Voraussetzung

- Node.js 22.0.0 oder neuer im VPL-Jail
- Moodle VPL mit aktiviertem Jail-Server

Die Skripte verwenden zuerst `PSEUDO2_NODE`, danach `/opt/node22/bin/node`
und zuletzt `node` aus `PATH`.

## Bundle bauen

Im Projektroot:

```powershell
npm install
npm run build:vpl
```

Das auslieferbare Verzeichnis ist `packages/vpl/dist`. Es enthaelt:

- `pseudo2-vpl.mjs`: einzelnes serverseitiges Programm
- `vpl_run.sh`: Vorbereitung fuer den interaktiven Run-Button
- `vpl_evaluate.sh`: Vorbereitung fuer die automatische Bewertung
- `assignment.example.json`: vollstaendige Stack-/Queue-/DEQ-Aufgabe mit 100 Punkten
- `README.md`: diese Anleitung

## Moodle-Aktivitaet einrichten

1. In der VPL-Aktivitaet `main.pseudo2` als erforderlichen Abgabedateinamen
   festlegen.
2. `vpl_run.sh` und `vpl_evaluate.sh` in den Ausfuehrungsdateien anlegen.
3. `pseudo2-vpl.mjs` und eine in `assignment.json` umbenannte
   Aufgabenkonfiguration als Ausfuehrungsdateien hochladen.
4. `pseudo2-vpl.mjs` und `assignment.json` als Dateien markieren, die bei der
   Ausfuehrung erhalten bleiben.
5. Die Aktivitaet einmal mit einer Musterabgabe testen.

Alternativ kann die Administration das Bundle zentral installieren, zum
Beispiel als `/opt/pseudo2-vpl/pseudo2-vpl.mjs`. Die Skripte erkennen diesen
Pfad automatisch, wenn kein lokales Bundle vorhanden ist. Ein anderer zentraler
Pfad kann ueber `PSEUDO2_RUNNER` gesetzt werden.
Bei vielen Aufgaben empfiehlt sich eine verborgene Basisaktivitaet mit diesen
Ausfuehrungsdateien; konkrete Aufgaben verwenden sie dann ueber VPLs
`Based on`-Funktion.

## Aufgabenkonfiguration

Eine `assignment.json` besitzt folgende Grundform:

```json
{
  "version": 1,
  "title": "Quadratfunktion",
  "mode": "function",
  "maxGrade": 10,
  "defaultTimeoutMs": 2000,
  "tests": [
    {
      "name": "square(5)",
      "harness": "print square(5)",
      "expectedOutput": "25",
      "points": 5,
      "hidden": false
    },
    {
      "name": "Weitere Eingabe",
      "harness": "print square(-3)",
      "expectedOutput": "9",
      "points": 5,
      "hidden": true
    }
  ]
}
```

`mode` hat zwei Varianten:

- `program`: Die gesamte Abgabe wird ausgefuehrt und ihre Ausgabe verglichen.
  Ein `harness` ist optional.
- `function`: Jeder Test muss ein Pseudo2-`harness` enthalten. Es wird an die
  Abgabe angehaengt und kann die abzugebenden Funktionen aufrufen.

Weitere Testfelder:

- `timeoutMs`: testspezifisches Limit zwischen 100 und 30000 Millisekunden
- `normalizeWhitespace`: vergleicht bei `true` beliebige Leerraumfolgen gleich
- `hidden`: anonymisiert den Testnamen; die Rueckmeldung enthaelt weder
  Harness, Eingaben, Soll-/Istausgabe noch Parser- oder Laufzeitdetails aus dem Harness
- `points`: positives Gewicht; alle Gewichte werden auf `maxGrade` skaliert

Die Funktionsabgabe sollte nur Deklarationen und benoetigte globale Daten
enthalten. Bereits vorhandene Top-Level-Ausgaben gehoeren sonst ebenfalls zur
verglichenen Ausgabe.

### Struktur bewerten

`structuralChecks` ist eine optionale Liste auf derselben Ebene wie `tests`.
Ohne diese Liste bleibt die Bewertung unveraendert, auch bei `"version": 1`.
Jedes Kriterium hat einen sichtbaren `name`, positive `points` und ein
`struct`-Objekt und/oder `scopes`. Ein Kriterium gibt seine Punkte nur, wenn
alle zugehoerigen Regeln erfuellt sind. Fuer feinere Teilpunkte mehrere
Kriterien mit kleineren Gewichten anlegen.

`struct` erwartet eine globale Struct-Deklaration mit passendem `name`.
`fields` ist eine optionale Liste von Objekten mit `name`, optionalem
`type` (`num`, `bool`, `string` oder Struct-Name) und `array` (Standard
`false`). `array: true` verlangt ein eindimensionales Arrayfeld. `methods`
ist eine optionale Liste von Objekten mit `name` und optionaler `arity`
(Anzahl geschriebener Pseudo2-Parameter ohne `this` und Laengenparameter).

Jeder Eintrag in `scopes` hat `in`: den Namen einer globalen Funktion oder
`Struct.methode`. Der Name bezieht sich auf die Deklaration, nicht auf einen
Variablennamen wie `einStack.push`.

| Feld im Geltungsbereich | Bedeutung |
| --- | --- |
| `requiredCalls` | Alle angegebenen Funktionen oder Methoden muessen aufgerufen werden. |
| `requiredFields` | Alle angegebenen `Struct.feld`-Referenzen muessen gelesen oder geschrieben werden. |
| `requiredArrayAccesses` | Alle angegebenen `Struct.feld`-Arrayfelder muessen direkt per Index gelesen oder geschrieben werden. |
| `requiredConstructions` | Fuer jeden genannten Struct muss ein `new` vorkommen. |
| `forbiddenCalls` | Die angegebenen Funktionen oder Methoden duerfen nicht aufgerufen werden. |
| `allowedCalls` | Falls gesetzt, sind nur die angegebenen Aufrufe erlaubt; `[]` verbietet alle. |
| `forbiddenOperations` | Verbote fuer `loop`, `for`, `while`, `do-while`, `print`, `throw`, `new`, `array-create` (Deklaration mit Groesse oder Arrayliteral) und `array-index` (Lesen und Schreiben). |
| `forbiddenOperators` | Operatoren aus dem Programmcode, etwa `mod`, `%`, `++`, `+=` oder `=`. `mod` und `%` sowie `+` und `+=` werden getrennt konfiguriert. `=` meint Zuweisungen, keine Deklarationsinitialisierer. |
| `includeCallees` | Standard `false`: nur der eigene Rumpf. `true`: zusaetzlich deren statisch aufgeloeste Aufrufkette. Die Regeln gelten dann auch in den aufgerufenen Helfern. |

Beispiel fuer die Forderung, dass `reverseWithStack` den echten Stack
verwendet und keine unzulaessigen Helfer aufruft:

```json
{
  "name": "Stack im Algorithmus verwenden",
  "points": 10,
  "scopes": [{
    "in": "reverseWithStack",
    "requiredCalls": ["Stack.push", "Stack.pop"],
    "allowedCalls": ["Stack.init", "Stack.push", "Stack.pop"]
  }]
}
```

Die Summe der bestandenen Test- und Strukturgewichte wird durch die Summe
aller Gewichte geteilt und mit `maxGrade` multipliziert (maximal 100).
Die [vollstaendige Beispielkonfiguration](./assignment.example.json) verwendet
70 Gewichte fuer Verhalten und 30 fuer Struktur; ein anderes Verhaeltnis
erfordert nur andere Gewichte. Sie erwartet `reverseWithStack(A[1..n])` und
`rotateWithQueue(A[1..n])` mit kommagetrenntem Ergebnis sowie einen Struct
`DEQ` mit `init(kapazitaet)`, `isEmpty()`, `pushFront(x)`, `pushBack(x)`,
`popFront()` und `popBack()`. Die oeffentlichen DEQ-Tests fuellen einen
kleinen Puffer, mischen Operationen an beiden Enden beim Umlauf und nutzen
dieselbe Instanz nach wiederholtem Leeren erneut. Die Beispieltests sind
bewusst oeffentlich. Eigene versteckte Testfaelle nur in den
Ausfuehrungsdateien der Lehrperson hinterlegen, nicht in Aufgabenbeschreibung
oder Abgabevorlage.

Die Analyse verwendet ausschliesslich die aufgeloesten AST-Knoten der
validierten Abgabe. Kommentare, Strings, Spezifikationen und der angehaengte
Harness liefern keinen Strukturnachweis; Methoden eines anderen Structs mit
demselben Namen zaehlen nicht. Offensichtlich tote Zweige mit booleschen
Literalen und Anweisungen nach direktem `return` oder `throw` im selben Block
zaehlen ebenfalls nicht. Die Pruefung beweist aber weder Erreichbarkeit fuer
beliebige Eingaben noch, dass Aufrufe tatsaechlich zum Ergebnis beitragen.
Sie verfolgt keine Array-Aliase, weist keine Laufzeitkomplexitaet nach und
ersetzt keine Verhaltenstests. `hidden: true` schuetzt das Feedback, ersetzt
aber keine sichere Ablage der Testdateien im VPL-Jail.

## Lokale Befehle

Nach dem Build kann das Bundle auch ohne Moodle getestet werden:

```powershell
node .\packages\vpl\dist\pseudo2-vpl.mjs validate .\main.pseudo2
node .\packages\vpl\dist\pseudo2-vpl.mjs run .\main.pseudo2
node .\packages\vpl\dist\pseudo2-vpl.mjs evaluate .\main.pseudo2 .\assignment.json
```

`validate` meldet Parser-, Referenz- und alle Pseudo2-Validatorfehler mit
Dateiname, Zeile und Spalte. `run` validiert, generiert JavaScript und startet
es. `evaluate` fuehrt alle Tests aus und schreibt Moodle-VPL-kompatible
`Comment :=>>`- und `Grade :=>>`-Zeilen. Strukturhinweise nennen, soweit
vorhanden, eine Zeile und Spalte in der eingereichten Datei.

## Schutzgrenzen

- jede Ausfuehrung laeuft in einem separaten Node-Prozess
- Standardlimit pro Test: 2 Sekunden
- maximales konfigurierbares Limit: 30 Sekunden
- maximales kombiniertes stdout/stderr: 256 KiB
- maximale Quell- und JSON-Dateigroesse: jeweils 1 MiB
- maximal 100 Tests und 100 Strukturkriterien je Aufgabe
- temporaere JavaScript-Dateien werden nach jedem Lauf entfernt
- Host- und Temporaerpfade werden aus Laufzeitfehlern entfernt

Die Prozessgrenzen verhindern haengende Bewertungen. Die eigentliche
Sicherheitsisolation gegen absichtliche Angriffe bleibt Aufgabe des VPL-Jails;
das Bundle soll nicht ausserhalb einer geeigneten Sandbox fuer fremden Code
eingesetzt werden.
