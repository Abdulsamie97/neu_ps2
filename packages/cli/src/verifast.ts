/**
 * @file verifast.ts
 * @brief Startet VeriFast, strukturiert dessen Diagnosen und ordnet C-Zeilen den Pseudo2-Zeilen zu.
 * @author Abdul
 */

// packages/cli/src/verifast.ts
import { spawn } from 'node:child_process';
import * as path from 'node:path';

/** @brief Beschreibt eine von VeriFast gemeldete Fehler- oder Hinweismeldung. */
export type VeriFastError = {
  /** @brief Enthält den von VeriFast gemeldeten C-Dateipfad. */
  file: string;
  /** @brief Enthält die einsbasierte Zeilennummer im überprüften C-Code. */
  line: number;
  /** @brief Enthält die erste betroffene Spalte. */
  colFrom: number;
  /** @brief Enthält die letzte betroffene Spalte. */
  colTo: number;
  /** @brief Unterscheidet verifikationsverhindernde Fehler von ergänzenden Hinweisen. */
  kind: 'error' | 'note';
  /** @brief Enthält den eigentlichen, von VeriFast ausgegebenen Meldungstext. */
  message: string;
  /** @brief Enthält nach erfolgreicher Abbildung den ursprünglichen Pseudo2-Dateipfad. */
  sourceFile?: string;
  /** @brief Enthält nach erfolgreicher Abbildung die Pseudo2-Quellzeile. */
  sourceLine?: number;
};

/** @brief Enthält VeriFasts Nachrichtentabelle und die kompakte Kodierung des symbolischen Ausführungswaldes. */
export type VeriFastExecutionForest = {
  /** @brief Ordnet den in `forest` verwendeten numerischen Indizes lesbare VeriFast-Schritttexte zu. */
  messages: string[];
  /** @brief Kodiert Wurzeln, Verzweigungen sowie erfolgreiche und fehlgeschlagene Endzustände. */
  forest: string;
};

/** @brief Einzelner ausschließlich auf Pseudo2-Quellzeilen bezogener Verifikationsknoten. */
export type Pseudo2VerificationNode = {
  /** @brief Innerhalb eines Ergebnisses eindeutige Knotenkennung. */
  id: number;
  /** @brief Unterscheidet Quellschritt, Erfolg, Fehler und nicht geprüften Zweig. */
  kind: 'step' | 'success' | 'failure' | 'pending';
  /** @brief Lesbarer Pseudo2-Quellschritt oder Ergebnistext ohne generierten Dateipfad. */
  message: string;
  /** @brief Optionale einsbasierte Editorzeile für Navigation und Hervorhebung. */
  sourceLine?: number;
  /** @brief Nachfolgende Schritte des kompakten Pseudo2-Beweispfads. */
  children: Pseudo2VerificationNode[];
};

/** @brief Kompakter Verifikationsbaum einer Pseudo2-Funktion oder des Top-Level-Programms. */
export type Pseudo2VerificationTree = {
  /** @brief Benutzername der Pseudo2-Funktion beziehungsweise des Top-Level-Programms. */
  label: string;
  /** @brief Wurzel des ausschließlich quellbezogenen Baums. */
  root: Pseudo2VerificationNode;
};

/** @brief Enthält das vollständige Ergebnis eines einzelnen VeriFast-Prozesses. */
export type VeriFastResult = {
  /** @brief Gibt an, ob VeriFast mit Exitcode 0 und ohne Zeitüberschreitung endete. */
  ok: boolean;
  /** @brief Enthält den VeriFast-Exitcode beziehungsweise 124 bei einer Zeitüberschreitung. */
  exitCode: number;
  /** @brief Enthält die unveränderte Standardausgabe von VeriFast. */
  stdout: string;
  /** @brief Enthält die Fehlerausgabe einschließlich möglicher Start- oder Timeoutmeldung. */
  stderr: string;
  /** @brief Enthält aus beiden Ausgabekanälen extrahierte strukturierte Diagnosen. */
  errors: VeriFastError[];
  /** @brief Gibt an, ob der Prozess nach Ablauf des Zeitlimits beendet wurde. */
  timedOut?: boolean;
  /** @brief Optionaler echter symbolischer Ausführungswald aus VeriFasts JSON-Ausgabe. */
  executionForest?: VeriFastExecutionForest;
  /** @brief Auf Pseudo2-Quellzeilen reduzierte Verifikationsbäume ohne Runtime-Wrapper. */
  verificationTrees?: Pseudo2VerificationTree[];
};

/** @brief Fasst das Verifikationsergebnis eines konkreten C-Runtime-Kerns zusammen. */
export type VeriFastRuntimeCheck = {
  /** @brief Nennt die überprüfte Runtime-C-Datei ohne Verzeichnispfad. */
  component: string;
  /** @brief Gibt an, ob diese Runtime-Komponente erfolgreich verifiziert wurde. */
  ok: boolean;
  /** @brief Enthält den Exitcode der einzelnen Runtime-Verifikation. */
  exitCode: number;
  /** @brief Enthält die zusammengefasste, getrimmte VeriFast-Ausgabe. */
  summary: string;
};

/** @brief Erweitert ein VeriFast-Ergebnis um Runtime-Prüfungen und das tatsächlich geprüfte Ziel. */
export type VeriFastBundleResult = VeriFastResult & {
  /** @brief Enthält die Ergebnisse aller bis zum Abbruch geprüften Runtime-Komponenten. */
  runtimeChecks: VeriFastRuntimeCheck[];
  /** @brief Zeigt, ob ein Fehler in der Runtime oder im generierten Programm entstand. */
  verificationTarget: 'runtime' | 'program';
};

/** @brief Ordnet genau eine Zeile des generierten C-Codes einer Pseudo2-Zeile zu. */
export type CSourceMapEntry = {
  /** @brief Einsbasierte Zeilennummer in der generierten C-Datei. */
  generatedLine: number;
  /** @brief Einsbasierte Zeilennummer in der ursprünglichen Pseudo2-Datei. */
  sourceLine: number;
};

/** @brief Beschreibt die persistierte Source-Map einer generierten C-Datei. */
export type CSourceMapFile = {
  /** @brief Optionaler absoluter oder relativer Pfad der ursprünglichen Pseudo2-Datei. */
  sourceFile?: string;
  /** @brief Enthält sämtliche bekannten C-zu-Pseudo2-Zeilenabbildungen. */
  mappings: CSourceMapEntry[];
};

/** @brief Erkennt das von VeriFast verwendete Format für Fehler- und Hinweiszeilen. */
const VF_LINE_RE =
  /^(.*)\((\d+),(\d+)-(\d+)\):\s*(error|note):\s*(.*)$/;
/** @brief Standardzeitlimit einer VeriFast-Ausführung in Millisekunden. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @brief Führt VeriFast für genau eine C-Datei aus und strukturiert sämtliche Diagnosen.
 *
 * Im Standardfall wird `-c` für eine reine Übersetzungs-/Vertragsprüfung ergänzt.
 * Falls keine eigene Quelloption gesetzt wurde, aktiviert die Funktion außerdem
 * das Lesen von VeriFast-Optionen aus der C-Datei. Beide Ausgabekanäle werden bis
 * zum Prozessende gesammelt. Startfehler und Zeitüberschreitungen werden in genau
 * ein Ergebnis überführt; der Abschlusswächter verhindert mehrfaches Auflösen des Promise.
 *
 * @param args VeriFast-Pfad, C-Datei, Zusatzargumente, Linkmodus und Zeitlimit.
 * @return Strukturiertes VeriFast-Ergebnis mit erkannten Fehlern und Hinweisen.
 */
export async function runVeriFast(args: {
  /** @brief Pfad zur auszuführenden VeriFast-Programmdatei. */
  verifastExe: string;
  /** @brief Pfad der zu verifizierenden C-Datei. */
  file: string;
  /** @brief Zusätzliche, unverändert an VeriFast weitergegebene Argumente. */
  extraArgs?: string[];
  /** @brief Aktiviert standardmäßig `-c` und damit die Prüfung ohne Linkschritt. */
  compileOnly?: boolean;
  /** @brief Maximale VeriFast-Laufzeit in Millisekunden. */
  timeoutMs?: number;
  /** @brief Aktiviert VeriFasts JSON-Ausgabe und übernimmt daraus den symbolischen Ausführungswald. */
  captureExecutionForest?: boolean;
  /** @brief Erzeugt aus JSON-Fehlerpfad, Source Map und Quelltext einen kleinen Pseudo2-Baum. */
  pseudo2Trace?: {
    /** @brief Aktueller Pseudo2-Quelltext für Zeilentexte und Funktionsnamen. */
    sourceCode: string;
    /** @brief Rückabbildung der generierten C-Zeilen. */
    sourceMap: CSourceMapFile;
  };
}): Promise<VeriFastResult> {
  const {
    verifastExe,
    file,
    extraArgs = [],
    compileOnly = true,
    captureExecutionForest = false,
    pseudo2Trace
  } = args;
  const captureJson = captureExecutionForest || pseudo2Trace !== undefined;
  const timeoutMs = normalizeTimeout(args.timeoutMs);
  const vfArgs = [
    ...(compileOnly ? ['-c'] : []),
    ...(captureJson && !extraArgs.includes('-json') ? ['-json'] : []),
    ...withSourceOptions(extraArgs),
    file
  ];

  return await new Promise((resolve) => {
    const child = spawn(verifastExe, vfArgs, {
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    /**
     * @brief Schließt den VeriFast-Lauf genau einmal ab und erzeugt den gemeinsamen Ergebnisdatensatz.
     * @param exitCode Tatsächlicher oder synthetischer Exitcode des Prozesses.
     * @param errorMessage Optionaler Start- oder Timeoutfehler für die Fehlerausgabe.
     */
    const finish = (exitCode: number, errorMessage?: string): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (errorMessage) {
        stderr += `${stderr ? '\n' : ''}${errorMessage}`;
      }

      const jsonResult = captureJson
        ? parseVeriFastJsonOutput(stdout)
        : undefined;
      const effectiveExitCode = jsonResult && !jsonResult.ok && exitCode === 0
        ? 1
        : exitCode;
      resolve({
        ok: (jsonResult?.ok ?? (exitCode === 0)) && !timedOut,
        exitCode: effectiveExitCode,
        stdout: jsonResult?.summary ?? stdout,
        stderr,
        errors: jsonResult?.errors ?? parseVeriFastErrors(stdout, stderr),
        timedOut,
        executionForest: captureExecutionForest ? jsonResult?.executionForest : undefined,
        verificationTrees: pseudo2Trace && jsonResult
          ? buildPseudo2VerificationTrees({
              sourceCode: pseudo2Trace.sourceCode,
              sourceMap: pseudo2Trace.sourceMap,
              traceFrames: jsonResult.traceFrames,
              errors: jsonResult.errors,
              ok: jsonResult.ok
            })
          : undefined
      });
    };

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', error => {
      finish(1, error.message);
    });
    child.on('close', code => {
      finish(timedOut ? 124 : (code ?? 1));
    });

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(124, `VeriFast timed out after ${timeoutMs} ms.`);
    }, timeoutMs);
  });
}

/**
 * @brief Verifiziert Runtime-Kerne sequenziell und anschließend das generierte C-Programm.
 *
 * Jede Runtime-Datei wird bewusst im Compile-only-Modus geprüft. Beim ersten
 * Runtime-Fehler endet die Verarbeitung sofort mit `verificationTarget: runtime`.
 * Nur wenn alle Runtime-Komponenten gültig sind, wird das eigentliche Programm
 * mit den vom Aufrufer gewählten Argumenten und dem gewünschten Linkmodus verifiziert.
 *
 * @param args VeriFast-Konfiguration, Programmdatei und geordnete Runtime-Dateien.
 * @return Bündelergebnis mit Einzelprüfungen und Kennzeichnung des Verifikationsziels.
 */
export async function runVeriFastBundle(args: {
  /** @brief Pfad zur auszuführenden VeriFast-Programmdatei. */
  verifastExe: string;
  /** @brief Pfad des nach den Runtime-Kernen zu verifizierenden C-Programms. */
  file: string;
  /** @brief Geordnete Liste der zuerst separat zu prüfenden Runtime-C-Dateien. */
  runtimeFiles: string[];
  /** @brief Nur an die Verifikation des eigentlichen Programms übergebene Zusatzargumente. */
  extraArgs?: string[];
  /** @brief Aktiviert für das Programm den VeriFast-Compile-only-Modus. */
  compileOnly?: boolean;
  /** @brief Gemeinsames Zeitlimit jedes einzelnen VeriFast-Prozesses. */
  timeoutMs?: number;
}): Promise<VeriFastBundleResult> {
  const runtimeChecks: VeriFastRuntimeCheck[] = [];
  for (const runtimeFile of args.runtimeFiles) {
    const result = await runVeriFast({
      verifastExe: args.verifastExe,
      file: runtimeFile,
      compileOnly: true,
      timeoutMs: args.timeoutMs
    });
    runtimeChecks.push({
      component: path.basename(runtimeFile),
      ok: result.ok,
      exitCode: result.exitCode,
      summary: (result.stdout || result.stderr).trim()
    });
    if (!result.ok) {
      return { ...result, runtimeChecks, verificationTarget: 'runtime' };
    }
  }

  const programResult = await runVeriFast({
    verifastExe: args.verifastExe,
    file: args.file,
    extraArgs: args.extraArgs,
    compileOnly: args.compileOnly,
    timeoutMs: args.timeoutMs
  });
  return { ...programResult, runtimeChecks, verificationTarget: 'program' };
}

/**
 * @brief Ergänzt die Standardoption zum Lesen von VeriFast-Anweisungen aus der C-Datei.
 *
 * Eine explizite Prover-Auswahl oder bereits vorhandene Option
 * `-read_options_from_source_file` wird respektiert und nicht verändert.
 *
 * @param extraArgs Vom Benutzer angegebene VeriFast-Argumente.
 * @return Ursprüngliche oder um die Standardquelloption erweiterte Argumentliste.
 */
function withSourceOptions(extraArgs: string[]): string[] {
  return extraArgs.includes('-prover') || extraArgs.includes('-read_options_from_source_file')
    ? extraArgs
    : ['-read_options_from_source_file', ...extraArgs];
}

/**
 * @brief Normalisiert ein optionales positives VeriFast-Zeitlimit.
 * @param timeoutMs Gewünschte maximale Laufzeit in Millisekunden.
 * @return Abgerundeter positiver Wert oder 60000 Millisekunden als Standard.
 */
function normalizeTimeout(timeoutMs: number | undefined): number {
  return Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0
    ? Math.floor(timeoutMs as number)
    : DEFAULT_TIMEOUT_MS;
}

/**
 * @brief Reduziert VeriFasts JSON-Protokoll auf Status, Hauptdiagnose und Ausführungswald.
 *
 * VeriFast liefert bei `-json` zusätzlich umfangreiche Nutzungsstellen, die für die
 * Workbench weder dargestellt noch übertragen werden müssen. Erfolgsresultate werden
 * auf ihre Zusammenfassung reduziert. Bei einem symbolischen Fehler liest die Funktion
 * die abschließende Quellposition und Meldung aus dem Resultat; unbekannte JSON-Varianten
 * fallen später auf den bisherigen Textparser zurück.
 *
 * @param stdout Vollständige Standardausgabe eines mit `-json` gestarteten VeriFast-Prozesses.
 * @return Reduziertes Ergebnis oder `undefined`, wenn die Ausgabe kein unterstütztes JSON-Protokoll ist.
 */
function parseVeriFastJsonOutput(stdout: string): {
  /** @brief Wahr ausschließlich für VeriFasts explizites `success`-Resultat. */
  ok: boolean;
  /** @brief Kurze VeriFast-Statusmeldung ohne vollständiges JSON-Dokument. */
  summary: string;
  /** @brief Aus dem JSON-Resultat extrahierte Hauptdiagnosen. */
  errors: VeriFastError[];
  /** @brief Optionaler kompakter symbolischer Ausführungswald. */
  executionForest?: VeriFastExecutionForest;
  /** @brief Positionsbehaftete VeriFast-Schritte des fehlgeschlagenen Beweispfads. */
  traceFrames: VeriFastTraceFrame[];
} | undefined {
  try {
    const document = JSON.parse(stdout) as unknown;
    if (
      !Array.isArray(document) ||
      document[0] !== 'VeriFast-Json' ||
      typeof document[3] !== 'object' ||
      document[3] === null
    ) {
      return undefined;
    }

    const payload = document[3] as {
      result?: unknown;
      executionForest?: unknown;
    };
    const result = payload.result;
    const executionForest = parseJsonExecutionForest(payload.executionForest);

    if (Array.isArray(result) && result[0] === 'success') {
      return {
        ok: true,
        summary: typeof result[1] === 'string' ? result[1] : 'VeriFast verification succeeded.',
        errors: [],
        executionForest,
        traceFrames: []
      };
    }

    const error = parsePrimaryJsonError(result);
    return {
      ok: false,
      summary: error?.message ?? 'VeriFast verification failed.',
      errors: error ? [error] : [],
      executionForest,
      traceFrames: parseJsonTraceFrames(result)
    };
  } catch {
    return undefined;
  }
}

/** @brief Positionsbehafteter Schritt aus dem JSON-Ausführungsstapel eines VeriFast-Fehlers. */
type VeriFastTraceFrame = {
  /** @brief C-Datei, in der der Schritt entstand. */
  file: string;
  /** @brief Einsbasierte C-Zeile des Schritts. */
  line: number;
  /** @brief VeriFast-Beschreibung des symbolischen Schritts. */
  message: string;
};

/**
 * @brief Extrahiert den positionsbehafteten Ausführungsstapel eines JSON-Beweisfehlers.
 *
 * VeriFast liefert den Stapel vom innersten Fehler zurück zur Funktionswurzel.
 * Die Funktion kehrt diese Reihenfolge um, damit der spätere Pseudo2-Baum vom
 * Funktionsbeginn zum Fehler verläuft. Frames ohne direkte Quellposition werden
 * verworfen und können daher keine Runtime-Wrapper in den Quellbaum einführen.
 *
 * @param result Ungeprüftes `result`-Feld des VeriFast-JSON-Protokolls.
 * @return Geordnete positionsbehaftete Schritte.
 */
function parseJsonTraceFrames(result: unknown): VeriFastTraceFrame[] {
  if (!Array.isArray(result) || !Array.isArray(result[1])) {
    return [];
  }

  const frames: VeriFastTraceFrame[] = [];
  for (const frame of result[1]) {
    if (!Array.isArray(frame)) {
      continue;
    }
    const location = frame
      .map(value => parseJsonLocation(value))
      .find((value): value is NonNullable<typeof value> => value !== undefined);
    const message = [...frame]
      .reverse()
      .find(value => typeof value === 'string' && value !== frame[0]);
    if (!location || typeof message !== 'string') {
      continue;
    }
    frames.push({
      file: location.file,
      line: location.line,
      message: message.trim()
    });
  }

  return frames.reverse();
}

/**
 * @brief Validiert den `executionForest`-Teil der VeriFast-JSON-Ausgabe.
 * @param value Ungeprüfter JSON-Wert aus dem VeriFast-Protokoll.
 * @return Kompakter Ausführungswald bei vollständig gültiger Grundstruktur.
 */
function parseJsonExecutionForest(value: unknown): VeriFastExecutionForest | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const candidate = value as { msgs?: unknown; forest?: unknown };
  if (
    !Array.isArray(candidate.msgs) ||
    !candidate.msgs.every(message => typeof message === 'string') ||
    typeof candidate.forest !== 'string'
  ) {
    return undefined;
  }

  return {
    messages: candidate.msgs,
    forest: candidate.forest
  };
}

/**
 * @brief Liest die abschließende Hauptdiagnose aus einem fehlgeschlagenen VeriFast-JSON-Resultat.
 *
 * Symbolische Ausführungsfehler enthalten an den Positionen zwei und drei die
 * lexikalische Position und den Beweisfehler. Die allgemeinere Suche nach einem
 * direkten Positions-/Textpaar deckt weitere Resultatvarianten ab, ohne die im
 * Ausführungstrace enthaltenen Zwischenschritte fälschlich als Fehler zu melden.
 *
 * @param result Ungeprüfter `result`-Wert des VeriFast-JSON-Protokolls.
 * @return Strukturierte Hauptdiagnose oder `undefined` bei unbekannter Form.
 */
function parsePrimaryJsonError(result: unknown): VeriFastError | undefined {
  if (!Array.isArray(result)) {
    return undefined;
  }

  for (let index = 1; index + 1 < result.length; index++) {
    const location = parseJsonLocation(result[index]);
    const message = result[index + 1];
    if (location && typeof message === 'string') {
      return {
        ...location,
        kind: 'error',
        message: message.trim()
      };
    }
  }

  return undefined;
}

/**
 * @brief Übersetzt VeriFasts `Lexed`-Positionsformat in die bestehende Diagnoseposition.
 * @param value Mögliche JSON-Quellposition.
 * @return Datei, Zeile und Spaltenbereich oder `undefined` bei abweichender Struktur.
 */
function parseJsonLocation(value: unknown): Pick<VeriFastError, 'file' | 'line' | 'colFrom' | 'colTo'> | undefined {
  if (
    !Array.isArray(value) ||
    value[0] !== 'Lexed' ||
    !Array.isArray(value[1]) ||
    value[1].length < 2
  ) {
    return undefined;
  }

  const start = value[1][0];
  const end = value[1][1];
  if (
    !Array.isArray(start) ||
    !Array.isArray(end) ||
    typeof start[0] !== 'string' ||
    typeof start[1] !== 'number' ||
    typeof start[2] !== 'number' ||
    typeof end[2] !== 'number'
  ) {
    return undefined;
  }

  return {
    file: start[0],
    line: start[1],
    colFrom: start[2],
    colTo: end[2]
  };
}

/**
 * @brief Extrahiert strukturierte VeriFast-Diagnosen aus Standard- und Fehlerausgabe.
 *
 * Nur Zeilen, die Dateipfad, Zeilen-/Spaltenbereich, Meldungsart und Text im
 * erwarteten VeriFast-Format enthalten, werden übernommen. Andere Statusausgaben
 * bleiben ausschließlich in `stdout` beziehungsweise `stderr` erhalten.
 *
 * @param stdout Vollständige Standardausgabe des VeriFast-Prozesses.
 * @param stderr Vollständige Fehlerausgabe des VeriFast-Prozesses.
 * @return Fehler und Hinweise in ihrer ursprünglichen Ausgabereihenfolge.
 */
function parseVeriFastErrors(stdout: string, stderr: string): VeriFastError[] {
  const errors: VeriFastError[] = [];
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const match = line.match(VF_LINE_RE);
    if (!match) continue;
    errors.push({
      file: match[1],
      line: Number(match[2]),
      colFrom: Number(match[3]),
      colTo: Number(match[4]),
      kind: match[5] as 'error' | 'note',
      message: match[6].trim()
    });
  }
  return errors;
}

/**
 * @brief Ergänzt VeriFast-Diagnosen um die zugehörigen Pseudo2-Quellpositionen.
 *
 * Die Source-Map wird für direkten Zugriff nach generierter C-Zeile indiziert.
 * Diagnosen ohne passende Zuordnung bleiben unverändert; alle übrigen erhalten
 * `sourceFile` und `sourceLine`. Das übergebene Ergebnis wird nicht mutiert.
 *
 * @param result Unverändertes Ergebnis der Verifikation des generierten C-Codes.
 * @param sourceMap Zu dieser C-Datei gehörende Pseudo2-Zeilenabbildung.
 * @return Neues Ergebnis mit soweit möglich ergänzten Pseudo2-Positionen.
 */
export function applyCSourceMapToVeriFastResult(result: VeriFastResult, sourceMap: CSourceMapFile): VeriFastResult {
  const byGeneratedLine = new Map<number, CSourceMapEntry>();
  for (const entry of sourceMap.mappings ?? []) {
    byGeneratedLine.set(entry.generatedLine, entry);
  }

  return {
    ...result,
    errors: result.errors.map(error => {
      const mapped = byGeneratedLine.get(error.line);
      if (!mapped) {
        return error;
      }

      return {
        ...error,
        sourceFile: sourceMap.sourceFile,
        sourceLine: mapped.sourceLine
      };
    })
  };
}

/** @brief Quellbereich einer aus dem Pseudo2-Text erkannten Funktion oder Methode. */
type Pseudo2FunctionRange = {
  /** @brief Quellname ohne generiertes C-Präfix oder Eindeutigkeitsindex. */
  name: string;
  /** @brief Erste zugehörige Vertrags- oder Deklarationszeile. */
  startLine: number;
  /** @brief Zeile der eigentlichen Funktionssignatur. */
  declarationLine: number;
  /** @brief Letzte zum eingerückten Funktionsrumpf gehörende Zeile. */
  endLine: number;
};

/** @brief Kontrollflusskonstrukt, dessen Rumpf eine fehlerhafte Pseudo2-Zeile einschließt. */
type Pseudo2ControlContext = {
  /** @brief Quellzeile der Bedingung beziehungsweise des `do`-Beginns. */
  line: number;
  /** @brief Art der verzweigenden Pseudo2-Anweisung. */
  kind: 'if' | 'while' | 'for' | 'do';
  /** @brief Einrückungsebene zur Bestimmung des lexikalischen Rumpfs. */
  indent: number;
};

/**
 * @brief Baut verzweigte Verifikationsbäume ausschließlich aus Pseudo2-Quellpositionen.
 *
 * Bei einem Beweisfehler bestimmt die Source Map zunächst die verursachende
 * Pseudo2-Zeile. Anschließend werden die im VeriFast-Fehlertrace tatsächlich
 * erreichten Pseudo2-Kontrollstellen übernommen; ohne Trace dienen die lexikalisch
 * einschließenden Kontrollstellen als Fallback. Nicht abgeschlossene Alternativen
 * bleiben offen statt einen erfolgreichen Beweis vorzutäuschen. Dadurch bleibt die
 * Verzweigung sichtbar, ohne Runtime-Deklarationen, Wrapperfunktionen, Hilfslemmata,
 * generierte Einzelaufrufe oder den technischen C-`main` abzubilden.
 *
 * Falls die Hauptdiagnose selbst keine Source-Map-Zuordnung besitzt, wird als
 * konservativer Fallback der letzte zuordenbare Frame des Fehlerstapels verwendet.
 * Erfolgreiche Läufe erhalten je Pseudo2-Funktion eine kompakte Erfolgswurzel und
 * optional eine Top-Level-Wurzel.
 *
 * @param args Pseudo2-Text, Source Map, JSON-Fehlerpfad, Diagnose und Gesamtstatus.
 * @return Direkt durch CLI und Weboberfläche darstellbare Pseudo2-Bäume.
 */
export function buildPseudo2VerificationTrees(args: {
  /** @brief Vollständiger Pseudo2-Quelltext. */
  sourceCode: string;
  /** @brief C-zu-Pseudo2-Zeilenabbildung. */
  sourceMap: CSourceMapFile;
  /** @brief Positionsbehaftete Frames des fehlgeschlagenen VeriFast-Pfads. */
  traceFrames: VeriFastTraceFrame[];
  /** @brief Unveränderte VeriFast-Hauptdiagnosen. */
  errors: VeriFastError[];
  /** @brief Gesamtstatus des Beweises. */
  ok: boolean;
}): Pseudo2VerificationTree[] {
  const sourceLines = args.sourceCode.replace(/\r/g, '').split('\n');
  const functionRanges = collectPseudo2FunctionRanges(sourceLines);
  const byGeneratedLine = new Map(
    (args.sourceMap.mappings ?? []).map(mapping => [mapping.generatedLine, mapping.sourceLine])
  );
  const fallbackSourceLine = args.traceFrames
    .map(frame => byGeneratedLine.get(frame.line))
    .filter((line): line is number => line !== undefined)
    .at(-1);
  let nextNodeId = 0;

  type MutableTree = {
    tree: Pseudo2VerificationTree;
    range?: Pseudo2FunctionRange;
  };
  const trees = new Map<string, MutableTree>();

  /** @brief Liefert oder erzeugt den Baum des Quellbereichs einer Pseudo2-Zeile. */
  const treeForSourceLine = (sourceLine: number): MutableTree => {
    const range = functionRanges.find(candidate =>
      candidate.startLine <= sourceLine && sourceLine <= candidate.endLine
    );
    const key = range ? `function:${range.declarationLine}` : 'top-level';
    const existing = trees.get(key);
    if (existing) {
      return existing;
    }

    const label = range ? `Function: ${range.name}` : 'Top-level program';
    const rootLine = range?.declarationLine;
    const root: Pseudo2VerificationNode = {
      id: nextNodeId++,
      kind: 'step',
      message: range
        ? formatPseudo2SourceStep(range.declarationLine, sourceLines, 'Funktion wird verifiziert.')
        : 'Top-level program',
      sourceLine: rootLine,
      children: []
    };
    const created = {
      tree: { label, root },
      range
    };
    trees.set(key, created);
    return created;
  };

  // Auch ein früh abgebrochener Beweis erhält für jede Quellfunktion einen Baum.
  for (const range of functionRanges) {
    treeForSourceLine(range.declarationLine);
  }

  for (const error of args.errors.filter(candidate => candidate.kind === 'error')) {
    const sourceLine = byGeneratedLine.get(error.line) ?? fallbackSourceLine;
    if (!sourceLine) {
      continue;
    }
    const holder = treeForSourceLine(sourceLine);
    let parent = holder.tree.root;
    const tracedControls = collectTracedPseudo2Controls(
      sourceLines, args.traceFrames, byGeneratedLine, holder.range
    );
    const controls = [...new Map(
      [...tracedControls, ...collectEnclosingPseudo2Controls(sourceLines, sourceLine, holder.range)]
        .sort((left, right) => left.line - right.line)
        .map(control => [control.line, control] as const)
    ).values()];
    const branches: Pseudo2VerificationNode[] = [];

    for (const control of controls) {
      const branch: Pseudo2VerificationNode = {
        id: nextNodeId++,
        kind: 'step',
        message: formatPseudo2SourceStep(
          control.line,
          sourceLines,
          pseudo2ControlDescription(control.kind)
        ),
        sourceLine: control.line,
        children: []
      };
      parent.children.push(branch);
      branches.push(branch);
      parent = branch;
    }

    const isContractLine = /^(?:\/\/\s*)?@\s*(?:requires|ensures)\b/.test(
      sourceLines[sourceLine - 1]?.trim() ?? ''
    );
    if (parent.sourceLine !== sourceLine && !isContractLine) {
      const statement: Pseudo2VerificationNode = {
        id: nextNodeId++,
        kind: 'step',
        message: formatPseudo2SourceStep(
          sourceLine,
          sourceLines,
          'This Pseudo2 statement leads to the failed proof path.'
        ),
        sourceLine,
        children: []
      };
      parent.children.push(statement);
      parent = statement;
    }

    const failure: Pseudo2VerificationNode = {
      id: nextNodeId++,
      kind: 'failure',
      message: formatPseudo2SourceStep(sourceLine, sourceLines, error.message),
      sourceLine,
      children: []
    };
    parent.children.push(failure);

    for (const branch of branches) {
      branch.children.push({
        id: nextNodeId++,
        kind: 'pending',
        message: formatPseudo2SourceStep(
          branch.sourceLine ?? sourceLine, sourceLines,
          'Alternative path was not completed after the proof failure.'
        ),
        sourceLine: branch.sourceLine,
        children: []
      });
    }
  }

  if (args.ok) {
    for (const range of functionRanges) {
      const holder = treeForSourceLine(range.declarationLine);
      holder.tree.root.children.push({
        id: nextNodeId++,
        kind: 'success',
        message: `Function ${range.name} verified successfully.`,
        sourceLine: range.declarationLine,
        children: []
      });
    }
    if (hasPseudo2TopLevelCode(sourceLines, functionRanges)) {
      const holder = treeForSourceLine(findFirstTopLevelLine(sourceLines, functionRanges) ?? 1);
      holder.tree.root.children.push({
        id: nextNodeId++,
        kind: 'success',
        message: 'Top-level program verified successfully.',
        children: []
      });
    }
  } else {
    for (const range of functionRanges) {
      const root = treeForSourceLine(range.declarationLine).tree.root;
      if (root.children.length === 0) {
        root.children.push({
          id: nextNodeId++,
          kind: 'pending',
          message: `Verification status of function ${range.name} is unavailable after the proof stopped.`,
          sourceLine: range.declarationLine,
          children: []
        });
      }
    }
  }

  return [...trees.values()].map(holder => holder.tree);
}

/**
 * Liest nur die Kontrollstellen, deren generierte C-Zeilen im echten Fehlertrace
 * vorkommen. Ein `while` kann durch seine vorangestellte `@invariant`-Zeile auf
 * dieselbe C-Position abgebildet sein; in diesem Fall wird auf die folgende
 * Pseudo2-Kontrollanweisung weitergeschaltet.
 */
function collectTracedPseudo2Controls(
  lines: string[],
  frames: VeriFastTraceFrame[],
  byGeneratedLine: ReadonlyMap<number, number>,
  range?: Pseudo2FunctionRange
): Pseudo2ControlContext[] {
  const seen = new Set<number>();
  const controls: Pseudo2ControlContext[] = [];
  for (const frame of frames) {
    const sourceLine = byGeneratedLine.get(frame.line);
    if (!sourceLine || (range && (sourceLine < range.startLine || sourceLine > range.endLine))) {
      continue;
    }
    let controlLine = sourceLine;
    let text = lines[controlLine - 1]?.trim() ?? '';
    if (/^(?:\/\/\s*)?@\s*(?:invariant|decreases)\b/.test(text)) {
      do {
        controlLine++;
        text = lines[controlLine - 1]?.trim() ?? '';
      } while (controlLine <= lines.length && (text === '' || /^(?:\/\/\s*)?@/.test(text)));
    }
    const match = text.match(/^(if|while|for|do)\b/);
    if (!match || seen.has(controlLine)) {
      continue;
    }
    seen.add(controlLine);
    controls.push({
      line: controlLine,
      kind: match[1] as Pseudo2ControlContext['kind'],
      indent: sourceIndent(lines[controlLine - 1] ?? '')
    });
  }
  return controls;
}

/**
 * @brief Ermittelt die lexikalisch einschließenden Verzweigungen einer Fehlerzeile.
 *
 * Die Analyse arbeitet auf der sichtbaren Pseudo2-Struktur und unterstützt sowohl
 * eingerückte als auch geklammerte Blöcke. Annotationen und Kommentare verändern
 * den Kontrollflussstapel nicht. Ein `else` behält das zugehörige `if` auf derselben
 * Einrückung; die abschließende Bedingung eines `do`-Blocks wird nicht als neue
 * `while`-Schleife interpretiert.
 *
 * @param lines Pseudo2-Quellzeilen ohne Wagenrücklauf.
 * @param sourceLine Einsbasierte Zeile der fehlgeschlagenen Anweisung.
 * @param range Optionaler Funktionsbereich zur Begrenzung der Suche.
 * @return Von außen nach innen geordnete Kontrollflusskontexte.
 */
function collectEnclosingPseudo2Controls(
  lines: string[],
  sourceLine: number,
  range?: Pseudo2FunctionRange
): Pseudo2ControlContext[] {
  const controls: Pseudo2ControlContext[] = [];
  const startLine = range ? range.declarationLine + 1 : 1;

  for (let line = startLine; line <= sourceLine; line++) {
    const text = lines[line - 1]?.trim() ?? '';
    if (text === '' || text.startsWith('//') || text.startsWith('@')) {
      continue;
    }

    const indent = sourceIndent(lines[line - 1] ?? '');
    const elseLine = /^(?:}\s*)?else\b/.test(text);
    if (elseLine) {
      while (controls.length > 0 && controls[controls.length - 1].indent > indent) {
        controls.pop();
      }
      if (
        controls.length > 0 &&
        controls[controls.length - 1].kind === 'if' &&
        controls[controls.length - 1].indent === indent
      ) {
        continue;
      }
    }

    const closesDo = /^(?:}\s*)?while\b/.test(text) &&
      controls.at(-1)?.kind === 'do' &&
      controls.at(-1)?.indent === indent;
    if (closesDo) {
      controls.pop();
      continue;
    }

    while (controls.length > 0 && indent <= controls[controls.length - 1].indent) {
      controls.pop();
    }

    if (line === sourceLine) {
      break;
    }

    const match = text.match(/^(if|while|for|do)\b/);
    if (match) {
      controls.push({
        line,
        kind: match[1] as Pseudo2ControlContext['kind'],
        indent
      });
    }
  }

  return controls;
}

/** @brief Beschreibt die fachliche Verzweigung eines Pseudo2-Kontrollkonstrukts. */
function pseudo2ControlDescription(kind: Pseudo2ControlContext['kind']): string {
  switch (kind) {
    case 'if':
      return 'The condition splits the symbolic proof into alternative paths.';
    case 'while':
    case 'for':
    case 'do':
      return 'The loop condition splits the symbolic proof into exit and body paths.';
  }
}

/**
 * @brief Erkennt Funktionsbereiche aus eingerücktem oder geklammertem Pseudo2-Text.
 *
 * Globale `func`-Deklarationen werden direkt erkannt. Methoden ohne `func` gelten
 * als Deklaration, wenn auf ihre Signatur ein tiefer eingerückter Rumpf oder eine
 * öffnende Klammer folgt. Unmittelbar davor stehende Verträge werden dem Bereich
 * zugeschlagen, damit Nachbedingungsfehler im richtigen Funktionsbaum erscheinen.
 *
 * @param lines Pseudo2-Quellzeilen ohne Wagenrücklauf.
 * @return Geordnete Funktions- und Methodenbereiche.
 */
function collectPseudo2FunctionRanges(lines: string[]): Pseudo2FunctionRange[] {
  const candidates: Array<{ name: string; line: number; indent: number }> = [];
  const reserved = /^(?:if|while|for|do|print|return|throw|call|var|struct)\b/;

  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim();
    const indent = sourceIndent(lines[index]);
    const globalFunction = text.match(/^func\s+([_A-Za-z]\w*)\s*\(/);
    if (globalFunction) {
      candidates.push({ name: globalFunction[1], line: index + 1, indent });
      continue;
    }

    const method = text.match(/^([_A-Za-z]\w*)\s*\([^)]*\)\s*(?:\{)?$/);
    const next = findNextNonEmptyLine(lines, index + 1);
    if (
      method &&
      !reserved.test(text) &&
      (
        text.endsWith('{') ||
        (next !== undefined && sourceIndent(lines[next]) > indent)
      )
    ) {
      candidates.push({ name: method[1], line: index + 1, indent });
    }
  }

  return candidates.map(candidate => {
    let startLine = candidate.line;
    for (let line = candidate.line - 1; line >= 1; line--) {
      const text = lines[line - 1].trim();
      if (
        sourceIndent(lines[line - 1]) === candidate.indent &&
        /^(?:@|\/\/@)\s*(?:requires|ensures|terminates)\b/.test(text)
      ) {
        startLine = line;
        continue;
      }
      if (text === '') {
        continue;
      }
      break;
    }

    let endLine = lines.length;
    for (let line = candidate.line + 1; line <= lines.length; line++) {
      const text = lines[line - 1].trim();
      if (text === '') {
        continue;
      }
      if (sourceIndent(lines[line - 1]) <= candidate.indent && text !== '}') {
        endLine = line - 1;
        break;
      }
    }
    return {
      name: candidate.name,
      startLine,
      declarationLine: candidate.line,
      endLine
    };
  });
}

/** @brief Berechnet die vergleichbare Einrückungsbreite einer Pseudo2-Zeile. */
function sourceIndent(line: string): number {
  const prefix = line.match(/^[\t ]*/)?.[0] ?? '';
  return [...prefix].reduce((width, character) => width + (character === '\t' ? 4 : 1), 0);
}

/** @brief Sucht ab einem nullbasierten Index die nächste nichtleere Quellzeile. */
function findNextNonEmptyLine(lines: string[], startIndex: number): number | undefined {
  for (let index = startIndex; index < lines.length; index++) {
    if (lines[index].trim() !== '') {
      return index;
    }
  }
  return undefined;
}

/** @brief Prüft, ob außerhalb erkannter Funktionen ausführbarer Pseudo2-Text vorhanden ist. */
function hasPseudo2TopLevelCode(lines: string[], ranges: Pseudo2FunctionRange[]): boolean {
  return findFirstTopLevelLine(lines, ranges) !== undefined;
}

/** @brief Liefert die erste nichtleere Quellzeile außerhalb erkannter Funktionsbereiche. */
function findFirstTopLevelLine(lines: string[], ranges: Pseudo2FunctionRange[]): number | undefined {
  for (let line = 1; line <= lines.length; line++) {
    const text = lines[line - 1].trim();
    if (
      text !== '' &&
      !text.startsWith('//') &&
      !ranges.some(range => range.startLine <= line && line <= range.endLine)
    ) {
      return line;
    }
  }
  return undefined;
}

/** @brief Formatiert genau eine Editorzeile samt optionaler fachlicher Prüfbeschreibung. */
function formatPseudo2SourceStep(line: number, sourceLines: string[], detail?: string): string {
  const source = sourceLines[line - 1]?.trim() ?? '';
  const prefix = source ? `Line ${line}: ${source}` : `Line ${line}`;
  return detail ? `${prefix}\n${detail}` : prefix;
}
