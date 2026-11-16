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
  MAX_STRUCTURAL_CHECK_COUNT,
  MAX_TEST_COUNT,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  STRUCTURAL_OPERATIONS,
  STRUCTURAL_OPERATORS,
  type AssignmentManifest,
  type AssignmentTest,
  type EvaluationMode,
  type ExecutionResult,
  type SourceDiagnostic,
  type StructuralCheck,
  type StructuralCheckResult,
  type StructuralScope,
  type StructuralStruct,
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
  } catch {
    // JSON.parse kann einen Ausschnitt aus einem versteckten Harness anzeigen.
    throw new Error('Die Bewertungsdatei ist kein gueltiges JSON. Pruefe Anfuehrungszeichen, Kommas und Klammern.');
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
    tests,
    structuralChecks: root.structuralChecks === undefined
      ? []
      : parseList(root.structuralChecks, 'structuralChecks', parseStructuralCheck)
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

/**
 * Liest ein Strukturkriterium. Unbekannte Eigenschaften werden nur im neuen
 * Schema abgelehnt, damit bestehende Aufgabenformate kompatibel bleiben.
 */
function parseStructuralCheck(value: unknown, label: string): StructuralCheck {
  const check = requireStructuralRecord(value, label, ['name', 'points', 'struct', 'scopes']);
  const struct = check.struct === undefined ? undefined : parseStructuralStruct(check.struct, `${label}.struct`);
  const scopes = parseOptionalList(check.scopes, `${label}.scopes`, parseStructuralScope);
  if (!struct && scopes.length === 0) {
    throw new Error(`"${label}" braucht "struct" oder mindestens einen Eintrag in "scopes".`);
  }
  return {
    name: requireString(check.name, `${label}.name`, 1, 120),
    points: requireNumber(check.points, `${label}.points`, 0.001, 1_000_000),
    struct,
    scopes
  };
}

/** Liest Struct-Namen, Feldtypen und Methodensignaturen aus der Konfiguration. */
function parseStructuralStruct(value: unknown, label: string): StructuralStruct {
  const struct = requireStructuralRecord(value, label, ['name', 'fields', 'methods']);
  const fields = parseOptionalList(struct.fields, `${label}.fields`, (entry, path) => {
    const field = requireStructuralRecord(entry, path, ['name', 'type', 'array']);
    return {
      name: requireReferenceName(field.name, `${path}.name`, 'identifier'),
      type: field.type === undefined ? undefined : requireReferenceName(field.type, `${path}.type`, 'identifier'),
      array: optionalBoolean(field.array, `${path}.array`, false)
    };
  });
  const methods = parseOptionalList(struct.methods, `${label}.methods`, (entry, path) => {
    const method = requireStructuralRecord(entry, path, ['name', 'arity']);
    return {
      name: requireReferenceName(method.name, `${path}.name`, 'identifier'),
      arity: method.arity === undefined ? undefined : requireInteger(method.arity, `${path}.arity`, 0, 100)
    };
  });
  requireUnique([...fields.map(field => field.name), ...methods.map(method => method.name)], label);
  return { name: requireReferenceName(struct.name, `${label}.name`, 'identifier'), fields, methods };
}

/** Liest Regeln fuer einen benannten Funktions- oder Methodenrumpf. */
function parseStructuralScope(value: unknown, label: string): StructuralScope {
  const scope = requireStructuralRecord(value, label, [
    'in', 'includeCallees', 'requiredCalls', 'requiredFields', 'requiredArrayAccesses',
    'requiredConstructions', 'forbiddenCalls', 'forbiddenOperations', 'forbiddenOperators', 'allowedCalls'
  ]);
  const requiredCalls = parseNames(scope.requiredCalls, `${label}.requiredCalls`, 'callable');
  const requiredFields = parseNames(scope.requiredFields, `${label}.requiredFields`, 'member');
  const requiredArrayAccesses = parseNames(scope.requiredArrayAccesses, `${label}.requiredArrayAccesses`, 'member');
  const requiredConstructions = parseNames(scope.requiredConstructions, `${label}.requiredConstructions`, 'identifier');
  const forbiddenCalls = parseNames(scope.forbiddenCalls, `${label}.forbiddenCalls`, 'callable');
  const forbiddenOperations = parseChoices(scope.forbiddenOperations, `${label}.forbiddenOperations`, STRUCTURAL_OPERATIONS);
  const forbiddenOperators = parseChoices(scope.forbiddenOperators, `${label}.forbiddenOperators`, STRUCTURAL_OPERATORS);
  const allowedCalls = scope.allowedCalls === undefined
    ? undefined
    : parseNames(scope.allowedCalls, `${label}.allowedCalls`, 'callable');
  if (allowedCalls === undefined && ![
    requiredCalls, requiredFields, requiredArrayAccesses, requiredConstructions,
    forbiddenCalls, forbiddenOperations, forbiddenOperators
  ].some(entries => entries.length > 0)) {
    throw new Error(`"${label}" muss mindestens eine Aufruf-, Feld- oder Verbotsregel enthalten.`);
  }
  for (const required of requiredCalls) {
    if (forbiddenCalls.includes(required) || (allowedCalls !== undefined && !allowedCalls.includes(required))) {
      throw new Error(`"${label}.requiredCalls": "${required}" ist zugleich durch eine Aufrufregel verboten.`);
    }
  }
  return {
    in: requireReferenceName(scope.in, `${label}.in`, 'callable'),
    includeCallees: optionalBoolean(scope.includeCallees, `${label}.includeCallees`, false),
    requiredCalls, requiredFields, requiredArrayAccesses, requiredConstructions,
    forbiddenCalls, forbiddenOperations, forbiddenOperators, allowedCalls
  };
}

/** Laesst dort, wo Strukturregeln erwartet werden, keine Tippfehler still durch. */
function requireStructuralRecord(value: unknown, label: string, properties: string[]): Record<string, unknown> {
  const record = requireRecord(value, label);
  for (const key of Object.keys(record)) {
    if (!properties.includes(key)) {
      throw new Error(`Unbekanntes Feld "${label}.${key}".`);
    }
  }
  return record;
}

/** Begrenzt und validiert eine Liste mit genauer Position jedes Eintrags. */
function parseList<T>(value: unknown, label: string, parseEntry: (entry: unknown, label: string) => T): T[] {
  if (!Array.isArray(value) || value.length > MAX_STRUCTURAL_CHECK_COUNT) {
    throw new Error(`"${label}" muss ein Array mit hoechstens ${MAX_STRUCTURAL_CHECK_COUNT} Eintraegen sein.`);
  }
  return value.map((entry, index) => parseEntry(entry, `${label}[${index}]`));
}

/** Normalisiert eine fehlende Regelliste zu einer leeren Liste. */
function parseOptionalList<T>(value: unknown, label: string, parseEntry: (entry: unknown, label: string) => T): T[] {
  return value === undefined ? [] : parseList(value, label, parseEntry);
}

/** Validiert Bezeichner in der JSON-Konfiguration, nicht den Pseudo2-Quelltext. */
function requireReferenceName(value: unknown, label: string, kind: 'identifier' | 'member' | 'callable'): string {
  const name = requireString(value, label, 1, 200);
  const parts = name.split('.');
  if ((kind === 'identifier' && parts.length !== 1)
      || (kind === 'member' && parts.length !== 2)
      || parts.length > 2 || !parts.every(part => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) {
    const example = kind === 'identifier' ? 'Stack' : kind === 'member' ? 'Stack.data' : 'algorithmus oder Stack.push';
    throw new Error(`"${label}" muss einen Pseudo2-Namen wie ${example} enthalten.`);
  }
  return name;
}

/** Laedt eine eindeutige Liste benannter Referenzziele. */
function parseNames(value: unknown, label: string, kind: 'identifier' | 'member' | 'callable'): string[] {
  const names = parseOptionalList(value, label, (entry, path) => requireReferenceName(entry, path, kind));
  requireUnique(names, label);
  return names;
}

/** Laedt eine eindeutige Liste aus einer vorgegebenen Menge zulaessiger Werte. */
function parseChoices<T extends string>(value: unknown, label: string, choices: readonly T[]): T[] {
  const entries = parseOptionalList(value, label, (entry, path) => {
    const choice = choices.find(item => item === entry);
    if (choice === undefined) {
      throw new Error(`"${path}" muss einer dieser Werte sein: ${choices.join(', ')}.`);
    }
    return choice;
  });
  requireUnique(entries, label);
  return entries;
}

/** Meldet doppelte Namen oder Werte innerhalb einer Regelliste. */
function requireUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`"${label}" enthaelt "${value}" mehrfach.`);
    seen.add(value);
  }
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
    const analysis = await runWithPrivateErrors(test, () =>
      analyzeSource(appendHarness(source, test.harness), basename(sourcePath)));
    const errors = analysis.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    if (!analysis.program || errors.length > 0) {
      const visibleErrors = errors.filter(diagnostic => diagnostic.line <= sourceLineCount);
      const details = test.hidden
        ? 'Der versteckte Test konnte nicht vorbereitet werden. Pruefe die geforderten Funktionen und Methoden.'
        : (visibleErrors.length > 0 ? visibleErrors : errors)
          .map(diagnostic => formatDiagnostic(diagnostic, basename(sourcePath)))
          .join('\n');
      results.push({ test, passed: false, details });
      continue;
    }

    const timeoutMs = test.timeoutMs ?? manifest.defaultTimeoutMs;
    const program = analysis.program;
    const execution = await runWithPrivateErrors(test, () => executeProgram(program, dirname(sourcePath), timeoutMs));
    if (!executionSucceeded(execution)) {
      results.push({
        test,
        passed: false,
        details: test.hidden
          ? describeHiddenExecutionFailure(execution)
          : describeExecutionFailure(execution, timeoutMs)
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

/** Unterdrueckt interne Analyse- oder Generatorausnahmen, die Harness-Text enthalten koennen. */
async function runWithPrivateErrors<T>(test: AssignmentTest, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!test.hidden) throw error;
    throw new Error('Ein versteckter Test konnte technisch nicht ausgefuehrt werden. Bitte wende dich an die Lehrperson.');
  }
}

/** Meldet nur die Fehlerkategorie, nie Stacktrace, Harness-Text oder Ausgabe. */
function describeHiddenExecutionFailure(execution: ExecutionResult): string {
  if (execution.timedOut) return 'Der versteckte Test hat das Zeitlimit ueberschritten.';
  if (execution.outputLimitExceeded) return 'Der versteckte Test hat das Ausgabelimit ueberschritten.';
  return 'Der versteckte Test konnte wegen eines Laufzeitfehlers nicht abgeschlossen werden.';
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
 * @param structuralResults Ergebnisse der vom Harness getrennten Strukturpruefung.
 * @param diagnostics Nicht blockierende Warnungen aus der Grundabgabe.
 * @param sourceName Name der Abgabedatei fuer anklickbare Meldungen.
 */
export function printEvaluation(
  manifest: AssignmentManifest,
  results: TestResult[],
  structuralResults: StructuralCheckResult[],
  diagnostics: SourceDiagnostic[],
  sourceName: string
): void {
  const testPoints = manifest.tests.reduce((sum, test) => sum + test.points, 0);
  const structuralPoints = manifest.structuralChecks.reduce((sum, check) => sum + check.points, 0);
  const earnedTestPoints = results.reduce((sum, result) => sum + (result.passed ? result.test.points : 0), 0);
  const earnedStructuralPoints = structuralResults.reduce((sum, result) =>
    sum + (result.issues.length === 0 ? result.check.points : 0), 0);
  const grade = Math.min(manifest.maxGrade,
    manifest.maxGrade * (earnedTestPoints + earnedStructuralPoints) / (testPoints + structuralPoints));
  const passedCount = results.filter(result => result.passed).length;
  const lines = [
    `${manifest.title}: ${passedCount}/${results.length} Tests bestanden.`
  ];

  for (const diagnostic of diagnostics) {
    lines.push(formatDiagnostic(diagnostic, sourceName));
  }
  let hiddenIndex = 0;
  for (const result of results) {
    const name = result.test.hidden ? `Versteckter Test ${++hiddenIndex}` : result.test.name;
    lines.push(`${result.passed ? '[OK]' : '[FEHLER]'} ${name} (${result.test.points} Punkte)`);
    if (result.details) {
      lines.push(result.details);
    }
  }

  if (structuralResults.length > 0) {
    lines.push('', `Verhalten: ${formatGrade(earnedTestPoints)}/${formatGrade(testPoints)} Gewichtspunkte.`,
      `Struktur: ${formatGrade(earnedStructuralPoints)}/${formatGrade(structuralPoints)} Gewichtspunkte.`);
    for (const { check, issues } of structuralResults) {
      lines.push(`${issues.length === 0 ? '[OK]' : '[FEHLER]'} ${check.name} (${check.points} Punkte)`);
      for (const { message, location } of issues) {
        lines.push(location ? formatDiagnostic({ ...location, severity: 'info', message }, sourceName) : `  ${message}`);
      }
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
