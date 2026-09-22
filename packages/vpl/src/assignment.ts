/**
 * @file assignment.ts
 * @brief Laedt Aufgabenkonfigurationen, fuehrt Tests aus und erzeugt VPL-Feedback.
 * @author Abdul
 */

import { basename, dirname } from 'node:path';
import {
  DEFAULT_TEST_TIMEOUT_MS,
  MAX_MANIFEST_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_SOURCE_BYTES,
  MAX_TEST_COUNT,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  type AssignmentManifest,
  type AssignmentTest,
  type EvaluationMode,
  type SourceDiagnostic,
  type TestResult
} from './model.js';
import {
  analyzeSource,
  describeExecutionFailure,
  executeProgram,
  executionSucceeded,
  formatDiagnostic,
  normalizeOutput,
  readLimitedUtf8File
} from './pseudo2-engine.js';

/**
 * Liest und validiert die JSON-Konfiguration einer VPL-Aufgabe.
 *
 * @param manifestPath Pfad zur Bewertungsdatei.
 * @returns Vollstaendig normalisierte Aufgabenkonfiguration.
 */
export async function loadManifest(manifestPath: string): Promise<AssignmentManifest> {
  const text = await readLimitedUtf8File(manifestPath, MAX_MANIFEST_BYTES, 'Bewertungsdatei');
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Bewertungsdatei ist kein gueltiges JSON: ${message}`);
  }
  return parseManifest(value);
}

/**
 * Ueberfuehrt einen unbekannten JSON-Wert in eine sichere Konfiguration.
 *
 * @param value Von JSON.parse gelieferter Wert.
 * @returns Validierte und mit Standardwerten ergaenzte Konfiguration.
 */
function parseManifest(value: unknown): AssignmentManifest {
  const root = requireRecord(value, 'Die Bewertungsdatei');
  if (root.version !== 1) {
    throw new Error('Die Bewertungsdatei muss "version": 1 verwenden.');
  }
  const title = requireString(root.title, 'title', 1, 200);
  const mode = root.mode;
  if (mode !== 'program' && mode !== 'function') {
    throw new Error('"mode" muss "program" oder "function" sein.');
  }
  const maxGrade = requireNumber(root.maxGrade, 'maxGrade', 0.01, 100);
  const defaultTimeoutMs = root.defaultTimeoutMs === undefined
    ? DEFAULT_TEST_TIMEOUT_MS
    : requireInteger(root.defaultTimeoutMs, 'defaultTimeoutMs', MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  if (!Array.isArray(root.tests) || root.tests.length === 0 || root.tests.length > MAX_TEST_COUNT) {
    throw new Error(`"tests" muss 1 bis ${MAX_TEST_COUNT} Eintraege enthalten.`);
  }

  const tests = root.tests.map((entry, index) => parseAssignmentTest(entry, index, mode));
  return {
    version: 1,
    title,
    mode,
    maxGrade,
    defaultTimeoutMs,
    tests
  };
}

/**
 * Validiert einen Testeintrag und setzt optionale Schalter auf sichere Werte.
 *
 * @param value Unbekannter JSON-Testwert.
 * @param index Nullbasierter Index fuer Fehlermeldungen.
 * @param mode Bewertungsmodus der Aufgabe.
 * @returns Normalisierter Test.
 */
function parseAssignmentTest(value: unknown, index: number, mode: EvaluationMode): AssignmentTest {
  const label = `tests[${index}]`;
  const test = requireRecord(value, label);
  const harness = test.harness === undefined
    ? undefined
    : requireString(test.harness, `${label}.harness`, 1, MAX_SOURCE_BYTES);
  if (mode === 'function' && harness === undefined) {
    throw new Error(`${label}.harness ist im Modus "function" erforderlich.`);
  }
  return {
    name: requireString(test.name, `${label}.name`, 1, 120),
    expectedOutput: requireString(test.expectedOutput, `${label}.expectedOutput`, 0, MAX_OUTPUT_BYTES),
    points: requireNumber(test.points, `${label}.points`, 0.001, 1_000_000),
    harness,
    timeoutMs: test.timeoutMs === undefined
      ? undefined
      : requireInteger(test.timeoutMs, `${label}.timeoutMs`, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    normalizeWhitespace: optionalBoolean(test.normalizeWhitespace, `${label}.normalizeWhitespace`, false),
    hidden: optionalBoolean(test.hidden, `${label}.hidden`, false)
  };
}

/** Fordert fuer einen Wert ein normales JSON-Objekt ohne Arrayform. */
function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} muss ein JSON-Objekt sein.`);
  }
  return value as Record<string, unknown>;
}

/** Fordert einen String innerhalb der angegebenen Laengengrenzen. */
function requireString(value: unknown, label: string, minimumLength: number, maximumLength: number): string {
  if (typeof value !== 'string' || value.length < minimumLength || value.length > maximumLength) {
    throw new Error(`"${label}" muss ein String mit ${minimumLength} bis ${maximumLength} Zeichen sein.`);
  }
  return value;
}

/** Fordert eine endliche Zahl innerhalb des geschlossenen Wertebereichs. */
function requireNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`"${label}" muss zwischen ${minimum} und ${maximum} liegen.`);
  }
  return value;
}

/** Fordert eine ganze Zahl innerhalb des geschlossenen Wertebereichs. */
function requireInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const number = requireNumber(value, label, minimum, maximum);
  if (!Number.isInteger(number)) {
    throw new Error(`"${label}" muss ganzzahlig sein.`);
  }
  return number;
}

/** Liest einen optionalen booleschen JSON-Wert oder verwendet den Standard. */
function optionalBoolean(value: unknown, label: string, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`"${label}" muss true oder false sein.`);
  }
  return value;
}

/**
 * Haengt einen Funktionstest an die studentische Abgabe an.
 *
 * @param source Studentischer Pseudo2-Quelltext.
 * @param harness Pseudo2-Anweisungen des Tests.
 * @returns Gemeinsam parsebarer Quelltext.
 */
function appendHarness(source: string, harness: string | undefined): string {
  if (harness === undefined) {
    return source;
  }
  return `${source.trimEnd()}\n\n// VPL test harness\n${harness}\n`;
}

/**
 * Fuehrt alle konfigurierten Tests nacheinander und isoliert aus.
 *
 * @param source Studentischer Quelltext.
 * @param sourcePath Absoluter Pfad der Abgabe fuer Arbeitsverzeichnis und Diagnosen.
 * @param manifest Validierte Aufgabenkonfiguration.
 * @returns Ergebnisse in derselben Reihenfolge wie die Konfiguration.
 */
export async function runAssignmentTests(
  source: string,
  sourcePath: string,
  manifest: AssignmentManifest
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const sourceLineCount = source.replace(/\r/g, '').split('\n').length;

  for (const test of manifest.tests) {
    const combinedSource = appendHarness(source, test.harness);
    const analysis = await analyzeSource(combinedSource, basename(sourcePath));
    const errors = analysis.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (!analysis.program || errors.length > 0) {
      const visibleErrors = errors.filter(diagnostic => diagnostic.line <= sourceLineCount);
      const details = test.hidden
        ? 'Der versteckte Test konnte wegen eines Fehlers in der Abgabe nicht vorbereitet werden.'
        : (visibleErrors.length > 0 ? visibleErrors : errors)
          .map(diagnostic => formatDiagnostic(diagnostic, basename(sourcePath)))
          .join('\n');
      results.push({ test, passed: false, details });
      continue;
    }

    const timeoutMs = test.timeoutMs ?? manifest.defaultTimeoutMs;
    const execution = await executeProgram(analysis.program, dirname(sourcePath), timeoutMs);
    if (!executionSucceeded(execution)) {
      results.push({
        test,
        passed: false,
        details: describeExecutionFailure(execution, timeoutMs)
      });
      continue;
    }

    const actual = normalizeOutput(execution.stdout, test.normalizeWhitespace);
    const expected = normalizeOutput(test.expectedOutput, test.normalizeWhitespace);
    if (actual === expected) {
      results.push({ test, passed: true });
    } else if (test.hidden) {
      results.push({
        test,
        passed: false,
        details: 'Die Ausgabe des versteckten Tests stimmt nicht.'
      });
    } else {
      results.push({
        test,
        passed: false,
        details: `Erwartete Ausgabe:\n${indentOutput(expected)}\nTatsaechliche Ausgabe:\n${indentOutput(actual)}`
      });
    }
  }

  return results;
}

/** Formatiert auch eine leere Programmausgabe eindeutig fuer Rueckmeldungen. */
function indentOutput(output: string): string {
  if (output.length === 0) {
    return '  <leer>';
  }
  return output.split('\n').map(line => `  ${line}`).join('\n');
}

/**
 * Entfernt Steuerzeichen und neutralisiert VPL-Steuermarker aus Fremdtext.
 *
 * @param text Testname, Diagnose oder Programmausgabe.
 * @returns Text, der den umgebenden VPL-Kommentarblock nicht verlassen kann.
 */
function escapeVplText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replaceAll('<|--', '< |--')
    .replaceAll('--|>', '--| >')
    .replaceAll(':=>>', ': >>');
}

/**
 * Berechnet die gewichtete Bewertung und schreibt das Moodle-VPL-Protokoll.
 *
 * @param manifest Aufgabenkonfiguration mit Maximalnote.
 * @param results Ergebnisse aller Tests.
 * @param diagnostics Nicht blockierende Warnungen aus der Grundabgabe.
 * @param sourceName Name der Abgabedatei fuer anklickbare Meldungen.
 */
export function printEvaluation(
  manifest: AssignmentManifest,
  results: TestResult[],
  diagnostics: SourceDiagnostic[],
  sourceName: string
): void {
  const totalPoints = manifest.tests.reduce((sum, test) => sum + test.points, 0);
  const earnedPoints = results.reduce((sum, result) => sum + (result.passed ? result.test.points : 0), 0);
  const grade = totalPoints === 0 ? 0 : manifest.maxGrade * earnedPoints / totalPoints;
  const passedCount = results.filter(result => result.passed).length;
  const lines = [
    `${manifest.title}: ${passedCount}/${results.length} Tests bestanden.`
  ];

  for (const diagnostic of diagnostics) {
    lines.push(formatDiagnostic(diagnostic, sourceName));
  }
  for (const result of results) {
    lines.push(`${result.passed ? '[OK]' : '[FEHLER]'} ${result.test.name} (${result.test.points} Punkte)`);
    if (result.details) {
      lines.push(result.details);
    }
  }

  console.log(`Comment :=>>${escapeVplText(manifest.title)}`);
  console.log('<|--');
  console.log(escapeVplText(lines.join('\n')));
  console.log('--|>');
  console.log(`Grade :=>>${formatGrade(grade)}`);
}

/** Schreibt eine fehlerhafte Abgabe als gueltiges VPL-Ergebnis mit Note 0. */
export function printValidationFailure(
  title: string,
  diagnostics: SourceDiagnostic[],
  sourceName: string
): void {
  const lines = diagnostics.map(diagnostic => formatDiagnostic(diagnostic, sourceName));
  console.log(`Comment :=>>${escapeVplText(title)}`);
  console.log('<|--');
  console.log(escapeVplText(lines.join('\n')));
  console.log('--|>');
  console.log('Grade :=>>0');
}

/** Formatiert eine Note mit hoechstens zwei Nachkommastellen. */
function formatGrade(grade: number): string {
  return Number(grade.toFixed(2)).toString();
}
