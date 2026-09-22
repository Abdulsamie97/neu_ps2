# Pseudo2 in Moodle VPL

Dieses Paket stellt die JavaScript-basierte Pseudo2-Ausfuehrung fuer Moodle VPL
bereit. Das erzeugte `pseudo2-vpl.mjs` enthaelt Langium, Parser, Linker,
Validator, JavaScript-Generator und Pseudo2-Runtime in einer Datei. Auf dem
VPL-Jail werden weder `npm` noch TypeScript, GCC oder VeriFast benoetigt.

## Voraussetzung

- Node.js 20.10.0 oder neuer im VPL-Jail
- Moodle VPL mit aktiviertem Jail-Server

Node.js 12 ist nicht kompatibel. Die Skripte verwenden zuerst
`PSEUDO2_NODE`, danach `/opt/node20/bin/node` und zuletzt `node` aus `PATH`.

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
- `assignment.example.json`: Beispiel einer Funktionstest-Aufgabe
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
- `hidden`: zeigt bei einem Fehlschlag weder Soll- noch Istausgabe
- `points`: positives Gewicht; alle Gewichte werden auf `maxGrade` skaliert

Die Funktionsabgabe sollte nur Deklarationen und benoetigte globale Daten
enthalten. Bereits vorhandene Top-Level-Ausgaben gehoeren sonst ebenfalls zur
verglichenen Ausgabe.

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
`Comment :=>>`- und `Grade :=>>`-Zeilen.

## Schutzgrenzen

- jede Ausfuehrung laeuft in einem separaten Node-Prozess
- Standardlimit pro Test: 2 Sekunden
- maximales konfigurierbares Limit: 30 Sekunden
- maximales kombiniertes stdout/stderr: 256 KiB
- maximale Quell- und JSON-Dateigroesse: jeweils 1 MiB
- maximal 100 Tests je Aufgabe
- temporaere JavaScript-Dateien werden nach jedem Lauf entfernt
- Host- und Temporaerpfade werden aus Laufzeitfehlern entfernt

Die Prozessgrenzen verhindern haengende Bewertungen. Die eigentliche
Sicherheitsisolation gegen absichtliche Angriffe bleibt Aufgabe des VPL-Jails;
das Bundle soll nicht ausserhalb einer geeigneten Sandbox fuer fremden Code
eingesetzt werden.
