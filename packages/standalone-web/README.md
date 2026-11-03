# Pseudo2 Standalone Web

Dieses Workspace erzeugt einen vollstaendig eingebetteten JavaScript-Runner fuer
Pseudo2. Parser, Validator, Generator, Oberflaeche, CSS und JavaScript befinden sich
nach dem Build in genau einer HTML-Datei.

## Build

Im Repository-Stamm:

```powershell
npm run build:standalone
```

Ergebnis:

```text
packages/standalone-web/dist/pseudo2-js-runner.html
```

Die Datei kann direkt im Browser geoeffnet oder unveraendert auf einen statischen
Webserver kopiert werden. Sie benoetigt keine weiteren Assets und keine Verbindung
zum Vite-/Node-Server.

## Enthaltene Funktionen

- Pseudo2-Editor mit lokalem Syntax-Highlighting
- kontextbezogene Autovervollstaendigung fuer Pseudo2-Schluesselwoerter und
  sichtbare Bezeichner (Pfeiltasten, Enter/Tab oder Strg+Leertaste)
- verzoegerte Langium-Live-Validierung mit Wellenlinien, markierten Zeilennummern
  und Validator-Meldung direkt im Editor
- JavaScript-Generierung
- JavaScript-Ausfuehrung in einem zeitlich begrenzten Web Worker
- rechte Seitenleiste mit globalen und lokalen Variablen, ihrem Geltungsbereich,
  der Deklarationszeile und dem bei Deklaration/Zuweisung beobachteten Wert;
  bei lokalen Variablen bleibt nach Funktionsende der letzte Wert sichtbar
- Arrays und Structs werden lesbar dargestellt; die Ortsangabe springt zur Deklaration
- Pretty-Print-Ausgabe mit geschweiften Klammern
- Download des aktuellen Pseudo2-Quelltexts

C-Ausfuehrung und VeriFast benoetigen native Programme und bleiben deshalb Teil der
servergestuetzten Pseudo2 Workbench.
