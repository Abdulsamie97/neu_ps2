/**
 * @file pseudo2-engine.ts
 * @brief Kapselt Pseudo2-Analyse, JavaScript-Generierung und isolierte Ausfuehrung.
 * @author Abdul
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { EmptyFileSystem, URI } from 'langium';
import {
  createPseudo2Services,
  generateProgram,
  type Program
} from 'pseudo2-language';
import {
  MAX_OUTPUT_BYTES,
  type AnalysisResult,
  type ExecutionResult,
  type SourceDiagnostic
} from './model.js';

/** Einmalig erzeugte dateisystemunabhaengige Pseudo2-Dienste. */
const services = createPseudo2Services(EmptyFileSystem);
/** Zaehler fuer eindeutige In-Memory-Dokument-URIs. */
let documentCounter = 0;

/**
 * Parst, linkt und validiert einen Pseudo2-Quelltext.
 *
 * @param source Vollstaendiger Pseudo2-Quelltext.
 * @param documentName Logischer Dateiname fuer die interne Dokument-URI.
 * @returns AST bei fehlerfreier Analyse sowie alle normalisierten Diagnosen.
 */
export async function analyzeSource(source: string, documentName: string): Promise<AnalysisResult> {
  if (source.trim().length === 0) {
    return {
      diagnostics: [{
        severity: 'error',
        line: 1,
        column: 1,
        message: 'Die Pseudo2-Abgabe ist leer.'
      }]
    };
  }

  const safeName = basename(documentName).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const uri = URI.parse(`memory:/vpl-${documentCounter++}-${safeName}`);
  const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, uri);
  await services.shared.workspace.DocumentBuilder.build([document], { validation: true });

  const diagnostics = (document.diagnostics ?? []).map(diagnostic => ({
    severity: diagnostic.severity === 1
      ? 'error' as const
      : diagnostic.severity === 2
        ? 'warning' as const
        : 'info' as const,
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
    message: diagnostic.message
  }));
  const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error');

  return {
    program: hasErrors ? undefined : document.parseResult.value as Program,
    diagnostics
  };
}

/**
 * Liest eine UTF-8-Datei erst nach einer Groessenpruefung.
 *
 * @param filePath Pfad der zu lesenden Datei.
 * @param maximumBytes Erlaubte Maximalgroesse.
 * @param label Benutzerlesbare Bezeichnung fuer Fehlermeldungen.
 * @returns Dateiinhalt als UTF-8-Text.
 */
export async function readLimitedUtf8File(
  filePath: string,
  maximumBytes: number,
  label: string
): Promise<string> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`${label} ist keine regulaere Datei: ${basename(filePath)}`);
  }
  if (fileStats.size > maximumBytes) {
    throw new Error(`${label} ist groesser als ${maximumBytes} Bytes.`);
  }
  return readFile(filePath, 'utf8');
}

/**
 * Generiert JavaScript und startet es in einem begrenzten Kindprozess.
 *
 * Die temporaere JavaScript-Datei wird in jedem Fall entfernt. Absolute Pfade
 * aus Node-Stacktraces werden vor der Rueckgabe ersetzt, damit VPL keine
 * internen Server- oder Temporaerverzeichnisse offenlegt.
 *
 * @param program Fehlerfrei gelinkter Pseudo2-AST.
 * @param workingDirectory Arbeitsverzeichnis des Studentenprogramms.
 * @param timeoutMs Maximale Laufzeit in Millisekunden.
 * @returns Gesammelte Ausgabe und Prozessstatus.
 */
export async function executeProgram(
  program: Program,
  workingDirectory: string,
  timeoutMs: number
): Promise<ExecutionResult> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pseudo2-vpl-'));
  const scriptPath = join(temporaryDirectory, 'program.mjs');

  try {
    await writeFile(scriptPath, generateProgram(program), 'utf8');
    const result = await executeNodeScript(scriptPath, workingDirectory, timeoutMs);
    return {
      ...result,
      stderr: sanitizeExecutionText(result.stderr, temporaryDirectory, scriptPath),
      spawnError: result.spawnError
        ? sanitizeExecutionText(result.spawnError, temporaryDirectory, scriptPath)
        : undefined
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

/**
 * Startet eine JavaScript-Datei mit dem aktuell verwendeten Node-Interpreter.
 *
 * @param scriptPath Temporaere, generierte JavaScript-Datei.
 * @param workingDirectory Arbeitsverzeichnis des Kindprozesses.
 * @param timeoutMs Maximale Laufzeit.
 * @returns Prozessausgabe, Exit-Code und Abbruchgrund.
 */
function executeNodeScript(
  scriptPath: string,
  workingDirectory: string,
  timeoutMs: number
): Promise<ExecutionResult> {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: workingDirectory,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let capturedBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let spawnError: string | undefined;
    let completed = false;

    /** Speichert nur Bytes bis zum globalen Ausgabelimit und beendet danach den Prozess. */
    const capture = (chunk: Buffer | string, destination: Buffer[]): void => {
      if (outputLimitExceeded) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const available = MAX_OUTPUT_BYTES - capturedBytes;
      if (available > 0) {
        destination.push(buffer.subarray(0, available));
        capturedBytes += Math.min(buffer.length, available);
      }
      if (buffer.length > available) {
        outputLimitExceeded = true;
        child.kill('SIGKILL');
      }
    };

    child.stdout.on('data', chunk => capture(chunk as Buffer, stdoutChunks));
    child.stderr.on('data', chunk => capture(chunk as Buffer, stderrChunks));
    child.once('error', error => {
      spawnError = error.message;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    /** Schliesst das Ergebnis genau einmal ab und gibt alle gepufferten Daten zurueck. */
    const finish = (exitCode: number | null): void => {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timeout);
      resolveResult({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode,
        timedOut,
        outputLimitExceeded,
        spawnError
      });
    };

    child.once('close', exitCode => finish(exitCode));
  });
}

/**
 * Entfernt konkrete Temporaerpfade aus einer Node-Fehlerausgabe.
 *
 * @param text Zu bereinigender Stacktrace oder Fehlertext.
 * @param temporaryDirectory Temporaeres Arbeitsverzeichnis.
 * @param scriptPath Pfad des generierten Skripts.
 * @returns Fehlertext mit neutralen Platzhaltern.
 */
function sanitizeExecutionText(text: string, temporaryDirectory: string, scriptPath: string): string {
  let sanitized = text;
  const replacements: Array<[string, string]> = [
    [pathToFileURL(scriptPath).href, '<generated-javascript>'],
    [scriptPath.replaceAll('\\', '/'), '<generated-javascript>'],
    [scriptPath, '<generated-javascript>'],
    [temporaryDirectory.replaceAll('\\', '/'), '<temporary-directory>'],
    [temporaryDirectory, '<temporary-directory>']
  ];
  for (const [value, replacement] of replacements) {
    sanitized = sanitized.replaceAll(value, replacement);
  }
  return sanitized.trimEnd();
}

/**
 * Formatiert eine Diagnose so, dass Moodle VPL die Quellzeile verlinken kann.
 *
 * @param diagnostic Normalisierte Langium-Diagnose.
 * @param sourceName In VPL sichtbarer Name der Abgabedatei.
 * @returns Meldung im Format `datei:zeile:spalte: Schweregrad: Text`.
 */
export function formatDiagnostic(diagnostic: SourceDiagnostic, sourceName: string): string {
  const severity = diagnostic.severity === 'error'
    ? 'Fehler'
    : diagnostic.severity === 'warning'
      ? 'Warnung'
      : 'Hinweis';
  return `${sourceName}:${diagnostic.line}:${diagnostic.column}: ${severity}: ${diagnostic.message}`;
}

/**
 * Prueft, ob eine Ausfuehrung ohne technischen Fehler beendet wurde.
 *
 * @param result Ergebnis des Kindprozesses.
 * @returns true genau bei Exit-Code 0 ohne Timeout oder Limitverletzung.
 */
export function executionSucceeded(result: ExecutionResult): boolean {
  return result.exitCode === 0
    && !result.timedOut
    && !result.outputLimitExceeded
    && result.spawnError === undefined;
}

/**
 * Erzeugt eine kurze, fuer VPL geeignete Beschreibung eines Ausfuehrungsfehlers.
 *
 * @param result Fehlgeschlagene Ausfuehrung.
 * @param timeoutMs Fuer diesen Lauf geltendes Zeitlimit.
 * @returns Fehlergrund ohne Hostpfade.
 */
export function describeExecutionFailure(result: ExecutionResult, timeoutMs: number): string {
  if (result.timedOut) {
    return `Zeitlimit von ${timeoutMs} ms ueberschritten.`;
  }
  if (result.outputLimitExceeded) {
    return `Ausgabelimit von ${MAX_OUTPUT_BYTES} Bytes ueberschritten.`;
  }
  if (result.spawnError) {
    return `Node-Prozess konnte nicht gestartet werden: ${result.spawnError}`;
  }
  const stderr = result.stderr.trim();
  if (stderr.length > 0) {
    return `Laufzeitfehler (Exit-Code ${result.exitCode ?? 'Signal'}):\n${stderr}`;
  }
  return `Programm endete mit Exit-Code ${result.exitCode ?? 'Signal'}.`;
}

/**
 * Normalisiert Zeilenenden und optional den gesamten Leerraum fuer Vergleiche.
 *
 * @param output Programm- oder Erwartungsausgabe.
 * @param normalizeWhitespace Ob alle Leerraumfolgen gleich behandelt werden.
 * @returns Vergleichbarer Text ohne abschliessende Leerzeilen.
 */
export function normalizeOutput(output: string, normalizeWhitespace: boolean): string {
  const normalizedLines = output.replace(/\r\n?/g, '\n').replace(/\n+$/g, '');
  return normalizeWhitespace
    ? normalizedLines.trim().replace(/\s+/g, ' ')
    : normalizedLines;
}
