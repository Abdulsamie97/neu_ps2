/**
 * @file main.ts
 * @brief Steuert den vollstaendig lokalen Pseudo2-Einzeldatei-Runner.
 *
 * Die Datei verbindet den leichten Browsereditor mit den gemeinsamen Langium-
 * Diensten, dem JavaScript-Generator und dem Pretty-Printer. Generierter Code
 * wird in einem kurzlebigen Web Worker ausgefuehrt, damit Endlosschleifen die
 * Oberflaeche nicht dauerhaft blockieren.
 *
 * @author Abdul
 */

import { EmptyFileSystem, URI } from 'langium';
import {
  createPseudo2Services,
  generatePrettyPseudo2,
  generateProgram,
  type Program
} from 'pseudo2-language';

/** Auswaehlbare Bereiche des Ergebnisfensters. */
type ResultTab = 'output' | 'javascript' | 'diagnostics' | 'pretty';

/** Normalisierte Diagnose fuer die browserseitige Darstellung. */
interface StandaloneDiagnostic {
  /** Fehler, Warnung oder informative Meldung. */
  kind: 'Fehler' | 'Warnung' | 'Hinweis';
  /** Einsbasierte Quellzeile. */
  line: number;
  /** Einsbasierte Quellspalte. */
  column: number;
  /** Einsbasierte Endzeile des exklusiven Diagnosebereichs. */
  endLine: number;
  /** Einsbasierte Endspalte des exklusiven Diagnosebereichs. */
  endColumn: number;
  /** Von Parser, Linker oder Validator gelieferter Meldungstext. */
  message: string;
}

/** In absolute Zeichenpositionen umgerechneter Diagnosebereich. */
interface DiagnosticOffsetRange {
  /** Zugehoerige normalisierte Langium-Diagnose. */
  diagnostic: StandaloneDiagnostic;
  /** Inklusiver Beginn innerhalb des gesamten Quelltexts. */
  start: number;
  /** Exklusives Ende innerhalb des gesamten Quelltexts. */
  end: number;
}

/** Ergebnis eines vollstaendigen Parse- und Validierungslaufs. */
interface AnalysisResult {
  /** Gelinkter AST; bei mindestens einem Fehler nicht vorhanden. */
  program?: Program;
  /** Alle vom Langium-Dokument gemeldeten Diagnosen. */
  diagnostics: StandaloneDiagnostic[];
}

/** Ergebnis der isolierten JavaScript-Ausfuehrung. */
interface ExecutionResult {
  /** In zeitlicher Reihenfolge abgefangene Konsolenausgaben. */
  output: string[];
  /** Laufzeitfehler oder Zeitlimitmeldung. */
  error?: string;
}

/** Standardprogramm, das die wichtigsten lokalen Funktionen sofort demonstriert. */
const DEFAULT_SOURCE = `func square(value)
    return value * value

var values = [1, 2, 3, 4]
for i=1 to 4
    print square(values[i])
`;

/** Maximale Laufzeit eines generierten Programms im Web Worker. */
const EXECUTION_TIMEOUT_MS = 5_000;
/** Wartezeit zwischen letzter Eingabe und automatischer Langium-Validierung. */
const LIVE_VALIDATION_DELAY_MS = 450;

/** Pseudo2-Schluesselwoerter und Spezifikationsbezeichner fuer das lokale Highlighting. */
const KEYWORDS = new Set([
  'assert', 'assume', 'bool', 'by', 'call', 'close', 'decreases', 'do', 'downto',
  'else', 'ensures', 'false', 'for', 'func', 'if', 'INT_MAX', 'INT_MIN', 'invariant',
  'leak', 'length', 'mod', 'new', 'null', 'num', 'open', 'print', 'requires', 'result',
  'return', 'string', 'struct', 'terminates', 'this', 'throw', 'to', 'true', 'undefined',
  'var', 'while'
]);

/** Laengere Operatoren muessen vor ihren Praefixen erkannt werden. */
const OPERATORS = ['&*&', '!=', '<=', '>=', '==', '&&', '||', '..', '+', '-', '*', '/', '%', '^', '<', '>', '=', '!', '.', ',', '(', ')', '[', ']', '{', '}'];

/** Einmalig erzeugte, dateisystemunabhaengige Pseudo2-Dienste. */
const services = createPseudo2Services(EmptyFileSystem);
/** Eindeutiger Zaehler fuer unabhaengige In-Memory-Dokumente. */
let documentCounter = 0;
/** Aktuell sichtbare Ergebnisansicht. */
let activeResultTab: ResultTab = 'output';
/** Diagnosen, deren Bereiche aktuell im Editor markiert werden. */
let editorDiagnostics: StandaloneDiagnostic[] = [];
/** Diagnose, die in der Meldungsleiste des Editors angezeigt wird. */
let activeEditorDiagnostic: StandaloneDiagnostic | undefined;
/** Versionsnummer des Editorinhalts zum Verwerfen veralteter Analyseergebnisse. */
let sourceRevision = 0;
/** Noch nicht gestarteter Zeitgeber der Live-Validierung. */
let liveValidationTimer: number | undefined;
/** Letzter Inhalt jeder Ergebnisansicht. */
const resultValues: Record<ResultTab, string> = {
  output: 'Noch nicht ausgefuehrt.',
  javascript: 'Noch nicht generiert.',
  diagnostics: 'Noch nicht validiert.',
  pretty: 'Noch nicht erzeugt.'
};

const sourceEditor = requireElement<HTMLTextAreaElement>('#source-editor');
const highlightLayer = requireElement<HTMLElement>('#highlight-layer');
const lineNumbers = requireElement<HTMLElement>('#line-numbers');
const resultContent = requireElement<HTMLElement>('#result-content');
const sourceStatus = requireElement<HTMLElement>('#source-status');
const editorDiagnostic = requireElement<HTMLElement>('#editor-diagnostic');
const editorDiagnosticKind = requireElement<HTMLElement>('#editor-diagnostic-kind');
const editorDiagnosticLocation = requireElement<HTMLElement>('#editor-diagnostic-location');
const editorDiagnosticText = requireElement<HTMLElement>('#editor-diagnostic-text');
const actionButtons = [...document.querySelectorAll<HTMLButtonElement>('.toolbar-actions button')];

/**
 * Sucht ein zwingend benoetigtes DOM-Element und beendet die Initialisierung bei
 * einer unvollstaendigen HTML-Vorlage mit einer eindeutigen Fehlermeldung.
 *
 * @param selector CSS-Selektor des erwarteten Elements.
 * @returns Gefundenes Element im angeforderten Typ.
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Required element is missing: ${selector}`);
  }
  return element;
}

/**
 * Parst, linkt und validiert einen Pseudo2-Quelltext mit denselben Diensten wie
 * CLI und Workbench. Ein Programm-AST wird nur zurueckgegeben, wenn keine
 * Fehlerdiagnose vorliegt; Warnungen blockieren Generatoren und Ausfuehrung nicht.
 *
 * @param source Vollstaendiger Pseudo2-Quelltext.
 * @param includeProgram Legt fest, ob der AST fuer einen anschliessenden Generator erhalten bleibt.
 * @returns Gelinkter AST und normalisierte Diagnosen.
 */
async function analyzeSource(source: string, includeProgram = true): Promise<AnalysisResult> {
  if (source.trim().length === 0) {
    return {
      diagnostics: [{
        kind: 'Fehler',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 1,
        message: 'Der Quelltext ist leer.'
      }]
    };
  }

  const documentFactory = services.shared.workspace.LangiumDocumentFactory;
  const documentBuilder = services.shared.workspace.DocumentBuilder;
  const uri = URI.parse(`memory:/standalone-${documentCounter++}.pseudo2`);
  const document = documentFactory.fromString(source, uri);

  await documentBuilder.build([document], { validation: true });

  const diagnostics = (document.diagnostics ?? []).map(diagnostic => ({
    kind: diagnostic.severity === 1 ? 'Fehler' as const
      : diagnostic.severity === 2 ? 'Warnung' as const
        : 'Hinweis' as const,
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    endLine: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    message: diagnostic.message
  }));

  const result: AnalysisResult = diagnostics.some(diagnostic => diagnostic.kind === 'Fehler')
    ? { diagnostics }
    : {
        program: includeProgram ? document.parseResult.value as Program : undefined,
        diagnostics
      };

  if (!includeProgram) {
    services.shared.workspace.IndexManager.remove(uri);
    services.shared.workspace.LangiumDocuments.deleteDocument(uri);
  }

  return result;
}

/**
 * Fuehrt die Analyse des aktuellen Editors aus und aktualisiert Diagnosefenster
 * sowie Statuszeile. Fehler aktivieren automatisch die Diagnoseansicht.
 *
 * @returns Analyseergebnis des aktuellen Editorinhalts.
 */
async function analyzeCurrentSource(): Promise<AnalysisResult> {
  cancelLiveValidation();
  setStatus('Validierung laeuft ...');
  const analysis = await analyzeSource(sourceEditor.value);
  presentAnalysis(analysis, true);
  return analysis;
}

/**
 * Uebernimmt ein Analyseergebnis in Diagnose-Tab, Editor und Statuszeile. Die
 * Live-Validierung darf Fehler markieren, ohne dabei die aktuelle Ausgabeansicht
 * zu verlassen; explizite Aktionen koennen dagegen zum Diagnose-Tab wechseln.
 *
 * @param analysis Anzuzeigendes Langium-Analyseergebnis.
 * @param revealErrors Aktiviert bei Fehlern automatisch den Diagnose-Tab.
 */
function presentAnalysis(analysis: AnalysisResult, revealErrors: boolean): void {
  resultValues.diagnostics = formatDiagnostics(analysis.diagnostics);
  setEditorDiagnostics(analysis.diagnostics);

  const errorCount = analysis.diagnostics.filter(diagnostic => diagnostic.kind === 'Fehler').length;
  const warningCount = analysis.diagnostics.filter(diagnostic => diagnostic.kind === 'Warnung').length;
  if (errorCount > 0) {
    setStatus(`${errorCount} Fehler`, 'error');
    if (revealErrors) {
      showResultTab('diagnostics');
    } else if (activeResultTab === 'diagnostics') {
      showResultTab('diagnostics');
    }
  } else {
    const message = warningCount > 0
      ? `Gueltig, ${warningCount} Warnung(en)`
      : 'Gueltig';
    setStatus(message, 'success');
    if (activeResultTab === 'diagnostics') {
      showResultTab('diagnostics');
    }
  }
}

/**
 * Plant eine nicht blockierende Validierung des aktuellen Editorstands. Jede
 * weitere Eingabe ersetzt den Zeitgeber und macht bereits laufende Ergebnisse
 * anhand der Revisionsnummer wirkungslos.
 */
function scheduleLiveValidation(): void {
  cancelLiveValidation();
  const revision = sourceRevision;
  const source = sourceEditor.value;
  liveValidationTimer = window.setTimeout(() => {
    liveValidationTimer = undefined;
    void validateSourceInBackground(source, revision);
  }, LIVE_VALIDATION_DELAY_MS);
}

/** Entfernt einen noch nicht gestarteten Zeitgeber der Live-Validierung. */
function cancelLiveValidation(): void {
  if (liveValidationTimer !== undefined) {
    window.clearTimeout(liveValidationTimer);
    liveValidationTimer = undefined;
  }
}

/**
 * Validiert einen zuvor erfassten Editorstand und zeigt das Ergebnis nur dann,
 * wenn seit dem Start keine weitere Eingabe erfolgt ist.
 */
async function validateSourceInBackground(source: string, revision: number): Promise<void> {
  try {
    const analysis = await analyzeSource(source, false);
    if (revision !== sourceRevision || source !== sourceEditor.value) {
      return;
    }
    presentAnalysis(analysis, false);
  } catch (error) {
    if (revision !== sourceRevision) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`Validierung fehlgeschlagen: ${message}`, 'error');
  }
}

/**
 * Wandelt strukturierte Diagnosen in eine zeilenorientierte, kopierbare Ausgabe
 * um. Bei einem fehlerfreien Dokument wird eine ausdrueckliche Erfolgsmeldung erzeugt.
 *
 * @param diagnostics Zu formatierende Parser- und Validatormeldungen.
 * @returns Mehrzeilige Diagnoseausgabe.
 */
function formatDiagnostics(diagnostics: StandaloneDiagnostic[]): string {
  if (diagnostics.length === 0) {
    return 'Keine Fehler oder Warnungen.';
  }

  return diagnostics
    .map(diagnostic => `${diagnostic.kind}: Zeile ${diagnostic.line}, Spalte ${diagnostic.column}: ${diagnostic.message}`)
    .join('\n');
}

/**
 * Ersetzt die Editor-Diagnosen, rendert alle Markierungen neu und waehlt die
 * passendste Meldung fuer die aktuelle Cursorposition. Ohne passende Position
 * wird die schwerste erste Diagnose angezeigt.
 *
 * @param diagnostics Neue Parser-, Linker- und Validatorergebnisse.
 */
function setEditorDiagnostics(diagnostics: StandaloneDiagnostic[]): void {
  editorDiagnostics = [...diagnostics];
  updateEditorPresentation();
  updateActiveEditorDiagnostic();
}

/**
 * Bestimmt anhand des Cursors die relevanteste Diagnose und aktualisiert die
 * Meldungsleiste innerhalb des Editors.
 */
function updateActiveEditorDiagnostic(): void {
  if (editorDiagnostics.length === 0) {
    showEditorDiagnostic(undefined);
    return;
  }

  const source = sourceEditor.value;
  const caretOffset = sourceEditor.selectionStart;
  const ranges = createDiagnosticOffsetRanges(source, editorDiagnostics);
  const exact = ranges.find(range => range.start <= caretOffset && caretOffset <= range.end)?.diagnostic;
  const caretLine = source.slice(0, caretOffset).split('\n').length;
  const sameLine = editorDiagnostics.find(diagnostic => (
    diagnostic.line <= caretLine && diagnostic.endLine >= caretLine
  ));
  const fallback = [...editorDiagnostics].sort((left, right) => (
    diagnosticPriority(left) - diagnosticPriority(right)
      || left.line - right.line
      || left.column - right.column
  ))[0];

  showEditorDiagnostic(exact ?? sameLine ?? fallback);
}

/**
 * Schreibt eine Diagnose in die Meldungsleiste oder blendet die Leiste aus.
 * Die Schwereklasse steuert Farbe und Symbolik der Darstellung.
 *
 * @param diagnostic Anzuzeigende Diagnose oder `undefined` zum Ausblenden.
 */
function showEditorDiagnostic(diagnostic: StandaloneDiagnostic | undefined): void {
  activeEditorDiagnostic = diagnostic;
  editorDiagnostic.hidden = diagnostic === undefined;
  editorDiagnostic.classList.remove('diagnostic-error', 'diagnostic-warning', 'diagnostic-info');
  if (!diagnostic) {
    editorDiagnosticKind.textContent = '';
    editorDiagnosticLocation.textContent = '';
    editorDiagnosticText.textContent = '';
    return;
  }

  editorDiagnostic.classList.add(`diagnostic-${diagnosticClass(diagnostic)}`);
  editorDiagnosticKind.textContent = diagnostic.kind;
  editorDiagnosticLocation.textContent = `Zeile ${diagnostic.line}, Spalte ${diagnostic.column}`;
  editorDiagnosticText.textContent = diagnostic.message;
}

/**
 * Setzt Cursor und Scrollposition auf den Beginn einer Diagnose. Dies wird von
 * der Meldungsleiste und von markierten Zeilennummern gemeinsam verwendet.
 *
 * @param diagnostic Diagnose, zu deren Quelltextstelle gesprungen wird.
 */
function revealEditorDiagnostic(diagnostic: StandaloneDiagnostic): void {
  const source = sourceEditor.value;
  const offset = sourcePositionToOffset(
    source,
    getLineStarts(source),
    diagnostic.line,
    diagnostic.column
  );
  sourceEditor.focus();
  sourceEditor.setSelectionRange(offset, offset);

  const lineHeight = Number.parseFloat(window.getComputedStyle(sourceEditor).lineHeight) || 21.7;
  sourceEditor.scrollTop = Math.max(
    0,
    (diagnostic.line - 1) * lineHeight - sourceEditor.clientHeight / 2
  );
  syncEditorScroll();
  showEditorDiagnostic(diagnostic);
}

/** Validiert den Editorinhalt und zeigt immer die Diagnoseansicht an. */
async function validateCurrentSource(): Promise<void> {
  await analyzeCurrentSource();
  showResultTab('diagnostics');
}

/**
 * Erzeugt JavaScript aus dem aktuellen, fehlerfreien Pseudo2-AST. Der erzeugte
 * Code wird gespeichert und unmittelbar in der JavaScript-Ansicht dargestellt.
 */
async function generateCurrentSource(): Promise<void> {
  const analysis = await analyzeCurrentSource();
  if (!analysis.program) {
    return;
  }

  resultValues.javascript = generateProgram(analysis.program);
  showResultTab('javascript');
}

/**
 * Erzeugt eine kanonisch eingerueckte Pseudo2-Fassung mit expliziten geschweiften
 * Klammern und stellt sie im Pretty-Print-Tab bereit.
 */
async function prettyPrintCurrentSource(): Promise<void> {
  const analysis = await analyzeCurrentSource();
  if (!analysis.program) {
    return;
  }

  resultValues.pretty = generatePrettyPseudo2(analysis.program);
  showResultTab('pretty');
}

/**
 * Generiert JavaScript und fuehrt es in einem isolierten Web Worker aus. Ausgabe,
 * Laufzeitfehler und Zeitlimit werden gemeinsam im Ausgabe-Tab dargestellt.
 */
async function runCurrentSource(): Promise<void> {
  const analysis = await analyzeCurrentSource();
  if (!analysis.program) {
    return;
  }

  const javaScript = generateProgram(analysis.program);
  resultValues.javascript = javaScript;
  resultValues.output = 'Programm wird ausgefuehrt ...';
  showResultTab('output');

  const execution = await executeJavaScript(javaScript);
  const output = execution.output.length > 0 ? execution.output.join('\n') : '(keine Ausgabe)';
  resultValues.output = execution.error
    ? `${output}\n\nLaufzeitfehler:\n${execution.error}`
    : output;
  showResultTab('output');
}

/**
 * Startet generierten Code in einem Blob-basierten Worker und beendet den Worker
 * nach Abschluss oder nach dem festen Zeitlimit. Konsolenargumente werden bereits
 * im Worker in Text umgewandelt, sodass nur strukturierbare Daten die Grenze passieren.
 *
 * @param source Ausfuehrbarer JavaScript-Quelltext des Generators.
 * @returns Abgefangene Ausgabe und optionaler Fehlertext.
 */
function executeJavaScript(source: string): Promise<ExecutionResult> {
  const workerProgram = `
    function formatValue(value) {
      if (typeof value === 'string') return value;
      if (typeof value === 'undefined') return 'undefined';
      if (typeof value === 'bigint') return String(value) + 'n';
      if (value instanceof Error) return value.name + ': ' + value.message;
      try {
        var json = JSON.stringify(value);
        return typeof json === 'undefined' ? String(value) : json;
      } catch (_) {
        return String(value);
      }
    }

    self.onmessage = function (event) {
      var output = [];
      var capturedConsole = {
        log: function () { output.push(Array.from(arguments).map(formatValue).join(' ')); },
        warn: function () { output.push(Array.from(arguments).map(formatValue).join(' ')); },
        error: function () { output.push(Array.from(arguments).map(formatValue).join(' ')); }
      };

      try {
        new Function('console', '\"use strict\";\\n' + event.data)(capturedConsole);
        self.postMessage({ output: output });
      } catch (error) {
        self.postMessage({
          output: output,
          error: error instanceof Error ? error.name + ': ' + error.message : String(error)
        });
      }
    };
  `;

  return new Promise(resolve => {
    const workerUrl = URL.createObjectURL(new Blob([workerProgram], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    let settled = false;

    const finish = (result: ExecutionResult) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(result);
    };

    const timeout = window.setTimeout(() => {
      finish({
        output: [],
        error: `Zeitlimit von ${EXECUTION_TIMEOUT_MS / 1000} Sekunden ueberschritten.`
      });
    }, EXECUTION_TIMEOUT_MS);

    worker.onmessage = event => {
      const result = event.data as ExecutionResult;
      finish({
        output: Array.isArray(result.output) ? result.output.map(String) : [],
        error: typeof result.error === 'string' ? result.error : undefined
      });
    };
    worker.onerror = event => {
      finish({ output: [], error: event.message || 'Unbekannter Worker-Fehler.' });
    };
    worker.postMessage(source);
  });
}

/**
 * Laedt den aktuellen Pseudo2-Quelltext als lokale Datei herunter. Dabei werden
 * Blob-URL und temporaeres Ankerelement direkt nach dem Start wieder freigegeben.
 */
function saveCurrentSource(): void {
  const objectUrl = URL.createObjectURL(new Blob([sourceEditor.value], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = 'program.pseudo2';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  setStatus('program.pseudo2 gespeichert', 'success');
}

/**
 * Aktiviert einen Ergebnis-Tab, aktualisiert die Schaltflaechen und schreibt den
 * zuletzt gespeicherten Inhalt dieses Tabs in den gemeinsamen Ausgabebereich.
 *
 * @param tab Anzuzeigende Ergebnisart.
 */
function showResultTab(tab: ResultTab): void {
  activeResultTab = tab;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-result-tab]')) {
    const selected = button.dataset.resultTab === tab;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  resultContent.textContent = resultValues[activeResultTab];
}

/**
 * Setzt die kompakte Statusmeldung und eine optionale Erfolgs- oder Fehlerklasse.
 *
 * @param message Sichtbarer Statustext.
 * @param kind Optionale visuelle Bedeutung der Meldung.
 */
function setStatus(message: string, kind?: 'success' | 'error'): void {
  sourceStatus.textContent = message;
  sourceStatus.classList.toggle('success', kind === 'success');
  sourceStatus.classList.toggle('error', kind === 'error');
}

/**
 * Sperrt alle Hauptaktionen waehrend eines asynchronen Arbeitsschritts. Geworfene
 * Fehler werden als Diagnose dargestellt, ohne die Oberflaeche unbedienbar zu lassen.
 *
 * @param action Auszufuehrender Validierungs-, Generator- oder Laufzeitschritt.
 */
async function runBusyAction(action: () => Promise<void>): Promise<void> {
  actionButtons.forEach(button => { button.disabled = true; });
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    resultValues.diagnostics = `Fehler: ${message}`;
    setStatus('Verarbeitung fehlgeschlagen', 'error');
    showResultTab('diagnostics');
  } finally {
    actionButtons.forEach(button => { button.disabled = false; });
  }
}

/** Aktualisiert farbige Tokenebene, Diagnosemarkierungen und Zeilennummern. */
function updateEditorPresentation(): void {
  const source = sourceEditor.value;
  highlightLayer.innerHTML = `${highlightPseudo2(source, editorDiagnostics)}${source.endsWith('\n') ? ' ' : ''}`;
  lineNumbers.innerHTML = renderLineNumbers(source, editorDiagnostics);
  syncEditorScroll();
}

/**
 * Synchronisiert horizontales und vertikales Scrollen der transparenten Eingabe
 * mit Highlighting und Zeilennummern.
 */
function syncEditorScroll(): void {
  highlightLayer.scrollTop = sourceEditor.scrollTop;
  highlightLayer.scrollLeft = sourceEditor.scrollLeft;
  lineNumbers.scrollTop = sourceEditor.scrollTop;
}

/**
 * Zerlegt Pseudo2 ohne Abhaengigkeit von Monaco in sichtbare Token. Kommentare,
 * Annotationen, Strings, Zeichenliterale, Zahlen, Schluesselwoerter und Operatoren
 * erhalten eigene Klassen; alle Inhalte werden vor der HTML-Ausgabe maskiert.
 *
 * Diagnosebereiche werden mit den Token-Spans verschachtelt, sodass Syntaxfarbe
 * und Wellenlinie gleichzeitig sichtbar bleiben.
 *
 * @param source Zu markierender Pseudo2-Quelltext.
 * @param diagnostics Im Quelltext hervorzuhebende Langium-Diagnosen.
 * @returns Sicherer HTML-Inhalt fuer die Highlight-Ebene.
 */
function highlightPseudo2(source: string, diagnostics: StandaloneDiagnostic[]): string {
  let output = '';
  let index = 0;
  const diagnosticRanges = createDiagnosticOffsetRanges(source, diagnostics);

  const append = (start: number, end: number, kind?: string): void => {
    output += renderHighlightedSegment(source, start, end, kind, diagnosticRanges);
  };

  while (index < source.length) {
    if (source.startsWith('//@', index)) {
      const end = findLineEnd(source, index);
      append(index, end, 'annotation');
      index = end;
      continue;
    }
    if (source.startsWith('//', index)) {
      const end = findLineEnd(source, index);
      append(index, end, 'comment');
      index = end;
      continue;
    }

    const character = source[index];
    if (character === '"' || character === "'") {
      const end = findQuotedEnd(source, index, character);
      append(index, end, character === '"' ? 'string' : 'char');
      index = end;
      continue;
    }

    if (isDigit(character)) {
      const end = findNumberEnd(source, index);
      append(index, end, 'number');
      index = end;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source[end])) {
        end++;
      }
      const word = source.slice(index, end);
      append(index, end, KEYWORDS.has(word) ? 'keyword' : undefined);
      index = end;
      continue;
    }

    const operator = OPERATORS.find(candidate => source.startsWith(candidate, index));
    if (operator) {
      append(index, index + operator.length, 'operator');
      index += operator.length;
      continue;
    }

    append(index, index + 1);
    index++;
  }

  return output;
}

/**
 * Wandelt die zeilenbasierten Langium-Bereiche in absolute Zeichenpositionen um.
 * Leere Parserbereiche werden auf ein benachbartes Zeichen erweitert, damit auch
 * fehlende Tokens eine sichtbare Markierung erhalten.
 *
 * @param source Aktueller Quelltext, auf den sich die Positionen beziehen.
 * @param diagnostics Zu konvertierende Diagnosen.
 * @returns Sortierte, nicht zwingend disjunkte Zeichenbereiche.
 */
function createDiagnosticOffsetRanges(
  source: string,
  diagnostics: StandaloneDiagnostic[]
): DiagnosticOffsetRange[] {
  const lineStarts = getLineStarts(source);
  return diagnostics.map(diagnostic => {
    let start = sourcePositionToOffset(source, lineStarts, diagnostic.line, diagnostic.column);
    let end = sourcePositionToOffset(source, lineStarts, diagnostic.endLine, diagnostic.endColumn);

    if (end <= start && source.length > 0) {
      if (start < source.length && source[start] !== '\n') {
        end = start + 1;
      } else {
        start = Math.max(0, start - 1);
        end = Math.min(source.length, start + 1);
      }
    }

    return { diagnostic, start, end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Rendert ein Syntaxsegment und unterteilt es an allen Diagnosegrenzen. Bei
 * ueberlappenden Meldungen bestimmt die hoechste Schwere die sichtbare Linie.
 *
 * @param source Vollstaendiger Quelltext.
 * @param start Inklusiver Segmentbeginn.
 * @param end Exklusives Segmentende.
 * @param tokenKind Optionale Syntaxklasse des Segments.
 * @param diagnostics Absolute Diagnosebereiche.
 * @returns Maskiertes HTML fuer das Segment.
 */
function renderHighlightedSegment(
  source: string,
  start: number,
  end: number,
  tokenKind: string | undefined,
  diagnostics: DiagnosticOffsetRange[]
): string {
  const relevant = diagnostics.filter(range => range.start < end && range.end > start);
  const boundaries = new Set<number>([start, end]);
  for (const range of relevant) {
    boundaries.add(Math.max(start, range.start));
    boundaries.add(Math.min(end, range.end));
  }

  const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
  let content = '';
  for (let index = 0; index < orderedBoundaries.length - 1; index++) {
    const partStart = orderedBoundaries[index];
    const partEnd = orderedBoundaries[index + 1];
    if (partEnd <= partStart) {
      continue;
    }

    const active = relevant
      .filter(range => range.start < partEnd && range.end > partStart)
      .sort((left, right) => diagnosticPriority(left.diagnostic) - diagnosticPriority(right.diagnostic))[0];
    const escaped = escapeHtml(source.slice(partStart, partEnd));
    content += active
      ? `<span class="diagnostic-range diagnostic-${diagnosticClass(active.diagnostic)}">${escaped}</span>`
      : escaped;
  }

  return tokenKind ? `<span class="token-${tokenKind}">${content}</span>` : content;
}

/**
 * Baut die Zeilennummern auf und kennzeichnet jede betroffene Zeile entsprechend
 * ihrer schwersten Diagnose. Der Tooltip enthaelt alle Meldungen der Zeile.
 *
 * @param source Aktueller Editorinhalt.
 * @param diagnostics Aktuell anzuzeigende Diagnosen.
 * @returns Sicheres HTML fuer die Zeilennummernspalte.
 */
function renderLineNumbers(source: string, diagnostics: StandaloneDiagnostic[]): string {
  const lineCount = Math.max(1, source.split('\n').length);
  return Array.from({ length: lineCount }, (_, index) => {
    const line = index + 1;
    const lineDiagnostics = diagnostics
      .filter(diagnostic => diagnostic.line <= line && diagnostic.endLine >= line)
      .sort((left, right) => diagnosticPriority(left) - diagnosticPriority(right));
    const primary = lineDiagnostics[0];
    const className = primary ? ` line-number-${diagnosticClass(primary)}` : '';
    const title = lineDiagnostics.length > 0
      ? ` title="${escapeHtmlAttribute(lineDiagnostics.map(diagnostic => diagnostic.message).join('\n'))}"`
      : '';
    const dataLine = primary ? ` data-diagnostic-line="${line}"` : '';
    return `<span class="line-number${className}"${dataLine}${title}>${line}</span>`;
  }).join('');
}

/** Liefert alle absoluten Startpositionen der Quelltextzeilen. */
function getLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

/**
 * Rechnet eine einsbasierte Zeilen-/Spaltenposition in einen sicheren Offset um.
 * Positionen hinter dem Zeilenende werden auf das vorhandene Zeilenende begrenzt.
 */
function sourcePositionToOffset(
  source: string,
  lineStarts: number[],
  line: number,
  column: number
): number {
  const lineIndex = Math.max(0, Math.min(lineStarts.length - 1, line - 1));
  const lineStart = lineStarts[lineIndex];
  const nextLineStart = lineStarts[lineIndex + 1];
  const lineEnd = nextLineStart === undefined ? source.length : Math.max(lineStart, nextLineStart - 1);
  return Math.max(lineStart, Math.min(lineEnd, lineStart + Math.max(0, column - 1)));
}

/** Ordnet Fehler vor Warnungen und Hinweise vor rein informativen Meldungen ein. */
function diagnosticPriority(diagnostic: StandaloneDiagnostic): number {
  return diagnostic.kind === 'Fehler' ? 0 : diagnostic.kind === 'Warnung' ? 1 : 2;
}

/** Liefert den CSS-Suffix fuer die Schwere einer Diagnose. */
function diagnosticClass(diagnostic: StandaloneDiagnostic): 'error' | 'warning' | 'info' {
  return diagnostic.kind === 'Fehler' ? 'error' : diagnostic.kind === 'Warnung' ? 'warning' : 'info';
}

/** Sucht das Ende eines einzeiligen Kommentars oder einer Annotation. */
function findLineEnd(source: string, start: number): number {
  const lineEnd = source.indexOf('\n', start);
  return lineEnd === -1 ? source.length : lineEnd;
}

/**
 * Sucht unter Beachtung von Escape-Sequenzen das Ende eines String- oder
 * Zeichenliterals. Nicht geschlossene Literale reichen sichtbar bis zum Textende.
 */
function findQuotedEnd(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index++;
  }
  return source.length;
}

/** Bestimmt das Ende einer dezimalen Zahl mit optionalem Nachkommateil. */
function findNumberEnd(source: string, start: number): number {
  let index = start;
  while (index < source.length && isDigit(source[index])) {
    index++;
  }
  if (source[index] === '.' && source[index + 1] !== '.' && isDigit(source[index + 1] ?? '')) {
    index++;
    while (index < source.length && isDigit(source[index])) {
      index++;
    }
  }
  return index;
}

/** Prueft, ob ein Zeichen eine ASCII-Ziffer ist. */
function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

/** Prueft, ob ein Zeichen einen Pseudo2-Bezeichner beginnen darf. */
function isIdentifierStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
}

/** Prueft, ob ein Zeichen innerhalb eines Pseudo2-Bezeichners erlaubt ist. */
function isIdentifierPart(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

/** Maskiert HTML-Steuerzeichen aus frei eingegebenem Quelltext. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Maskiert zusaetzlich Anfuehrungszeichen fuer sicher erzeugte HTML-Attribute. */
function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value)
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\n', '&#10;');
}

/**
 * Fuegt an der Cursorposition vier Leerzeichen ein und ersetzt dabei eine aktive
 * Auswahl. Anschliessend wird dieselbe Aktualisierung wie bei manueller Eingabe ausgeloest.
 */
function insertIndentation(): void {
  sourceEditor.setRangeText('    ', sourceEditor.selectionStart, sourceEditor.selectionEnd, 'end');
  sourceEditor.dispatchEvent(new Event('input', { bubbles: true }));
}

document.querySelector('#validate-button')?.addEventListener('click', () => {
  void runBusyAction(validateCurrentSource);
});
document.querySelector('#generate-button')?.addEventListener('click', () => {
  void runBusyAction(generateCurrentSource);
});
document.querySelector('#pretty-button')?.addEventListener('click', () => {
  void runBusyAction(prettyPrintCurrentSource);
});
document.querySelector('#run-button')?.addEventListener('click', () => {
  void runBusyAction(runCurrentSource);
});
document.querySelector('#save-button')?.addEventListener('click', saveCurrentSource);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-result-tab]')) {
  button.addEventListener('click', () => {
    const tab = button.dataset.resultTab as ResultTab | undefined;
    if (tab) {
      showResultTab(tab);
    }
  });
}

sourceEditor.addEventListener('input', () => {
  sourceRevision++;
  editorDiagnostics = [];
  activeEditorDiagnostic = undefined;
  resultValues.diagnostics = 'Quelltext geaendert. Erneut validieren.';
  updateEditorPresentation();
  showEditorDiagnostic(undefined);
  setStatus('Geaendert');
  if (activeResultTab === 'diagnostics') {
    showResultTab('diagnostics');
  }
  scheduleLiveValidation();
});
sourceEditor.addEventListener('scroll', syncEditorScroll);
sourceEditor.addEventListener('click', updateActiveEditorDiagnostic);
sourceEditor.addEventListener('keyup', updateActiveEditorDiagnostic);
sourceEditor.addEventListener('select', updateActiveEditorDiagnostic);
sourceEditor.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    insertIndentation();
    return;
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void runBusyAction(runCurrentSource);
  }
});

lineNumbers.addEventListener('click', event => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-diagnostic-line]')
    : undefined;
  const line = Number(target?.dataset.diagnosticLine);
  if (!Number.isInteger(line)) {
    return;
  }

  const diagnostic = [...editorDiagnostics]
    .filter(candidate => candidate.line <= line && candidate.endLine >= line)
    .sort((left, right) => diagnosticPriority(left) - diagnosticPriority(right))[0];
  if (diagnostic) {
    revealEditorDiagnostic(diagnostic);
  }
});

editorDiagnostic.addEventListener('click', () => {
  if (activeEditorDiagnostic) {
    revealEditorDiagnostic(activeEditorDiagnostic);
  }
});

sourceEditor.value = DEFAULT_SOURCE;
updateEditorPresentation();
showResultTab('output');
sourceEditor.focus();
scheduleLiveValidation();
