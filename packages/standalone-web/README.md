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
- Langium-Parsing und vollstaendige Validierung
- JavaScript-Generierung
- JavaScript-Ausfuehrung in einem zeitlich begrenzten Web Worker
- Pretty-Print-Ausgabe mit geschweiften Klammern
- Download des aktuellen Pseudo2-Quelltexts

C-Ausfuehrung und VeriFast benoetigen native Programme und bleiben deshalb Teil der
servergestuetzten Pseudo2 Workbench.
