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
  /** Von Parser, Linker oder Validator gelieferter Meldungstext. */
  message: string;
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
 * @returns Gelinkter AST und normalisierte Diagnosen.
 */
async function analyzeSource(source: string): Promise<AnalysisResult> {
  if (source.trim().length === 0) {
    return {
      diagnostics: [{ kind: 'Fehler', line: 1, column: 1, message: 'Der Quelltext ist leer.' }]
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
    message: diagnostic.message
  }));

  if (diagnostics.some(diagnostic => diagnostic.kind === 'Fehler')) {
    return { diagnostics };
  }

  return {
    program: document.parseResult.value as Program,
    diagnostics
  };
}

/**
 * Fuehrt die Analyse des aktuellen Editors aus und aktualisiert Diagnosefenster
 * sowie Statuszeile. Fehler aktivieren automatisch die Diagnoseansicht.
 *
 * @returns Analyseergebnis des aktuellen Editorinhalts.
 */
async function analyzeCurrentSource(): Promise<AnalysisResult> {
  setStatus('Validierung laeuft ...');
  const analysis = await analyzeSource(sourceEditor.value);
  resultValues.diagnostics = formatDiagnostics(analysis.diagnostics);

  const errorCount = analysis.diagnostics.filter(diagnostic => diagnostic.kind === 'Fehler').length;
  const warningCount = analysis.diagnostics.filter(diagnostic => diagnostic.kind === 'Warnung').length;
  if (errorCount > 0) {
    setStatus(`${errorCount} Fehler`, 'error');
    showResultTab('diagnostics');
  } else {
    const message = warningCount > 0
      ? `Gueltig, ${warningCount} Warnung(en)`
      : 'Gueltig';
    setStatus(message, 'success');
  }

  return analysis;
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

/** Aktualisiert farbige Tokenebene und Zeilennummern nach jeder Quelltextaenderung. */
function updateEditorPresentation(): void {
  const source = sourceEditor.value;
  highlightLayer.innerHTML = `${highlightPseudo2(source)}${source.endsWith('\n') ? ' ' : ''}`;
  lineNumbers.textContent = Array.from(
    { length: Math.max(1, source.split('\n').length) },
    (_, index) => String(index + 1)
  ).join('\n');
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
 * @param source Zu markierender Pseudo2-Quelltext.
 * @returns Sicherer HTML-Inhalt fuer die Highlight-Ebene.
 */
function highlightPseudo2(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('//@', index)) {
      const end = findLineEnd(source, index);
      output += token('annotation', source.slice(index, end));
      index = end;
      continue;
    }
    if (source.startsWith('//', index)) {
      const end = findLineEnd(source, index);
      output += token('comment', source.slice(index, end));
      index = end;
      continue;
    }

    const character = source[index];
    if (character === '"' || character === "'") {
      const end = findQuotedEnd(source, index, character);
      output += token(character === '"' ? 'string' : 'char', source.slice(index, end));
      index = end;
      continue;
    }

    if (isDigit(character)) {
      const end = findNumberEnd(source, index);
      output += token('number', source.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source[end])) {
        end++;
      }
      const word = source.slice(index, end);
      output += KEYWORDS.has(word) ? token('keyword', word) : escapeHtml(word);
      index = end;
      continue;
    }

    const operator = OPERATORS.find(candidate => source.startsWith(candidate, index));
    if (operator) {
      output += token('operator', operator);
      index += operator.length;
      continue;
    }

    output += escapeHtml(character);
    index++;
  }

  return output;
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

/** Erzeugt ein maskiertes Span fuer eine Tokenklasse. */
function token(kind: string, value: string): string {
  return `<span class="token-${kind}">${escapeHtml(value)}</span>`;
}

/** Maskiert HTML-Steuerzeichen aus frei eingegebenem Quelltext. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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
  updateEditorPresentation();
  setStatus('Geaendert');
});
sourceEditor.addEventListener('scroll', syncEditorScroll);
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

sourceEditor.value = DEFAULT_SOURCE;
updateEditorPresentation();
showResultTab('output');
sourceEditor.focus();
