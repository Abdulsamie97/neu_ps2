/**
 * @file main.ts
 * @brief Stellt die Kommandozeilenbefehle des Pseudo2-VPL-Bundles bereit.
 *
 * Der Einstieg bleibt bewusst duenn: Sprachverarbeitung und Prozessisolation
 * liegen in `pseudo2-engine.ts`, waehrend `assignment.ts` Konfiguration,
 * Testausfuehrung und Moodle-VPL-Ausgabe kapselt.
 *
 * @author Abdul
 */

import { basename, dirname, resolve } from 'node:path';
import {
  loadManifest,
  printEvaluation,
  printValidationFailure,
  runAssignmentTests
} from './assignment.js';
import {
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_SOURCE_BYTES,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS
} from './model.js';
import {
  analyzeSource,
  describeExecutionFailure,
  executeProgram,
  executionSucceeded,
  formatDiagnostic,
  readLimitedUtf8File
} from './pseudo2-engine.js';

/** Exit-Code fuer ungueltige Kommandozeilenargumente. */
const EXIT_USAGE = 1;
/** Exit-Code fuer Parser-, Linker- oder Validatorfehler im Pseudo2-Programm. */
const EXIT_VALIDATION = 2;
/** Exit-Code fuer einen Laufzeitfehler, Timeout oder ein ueberschrittenes Ausgabelimit. */
const EXIT_EXECUTION = 3;
/** Exit-Code fuer eine unlesbare oder ungueltige Bewertungsdatei. */
const EXIT_CONFIGURATION = 4;

/**
 * Validiert eine Datei und gibt alle Meldungen im quellbezogenen Format aus.
 *
 * @param sourcePath Pfad zur Pseudo2-Datei.
 * @returns Prozess-Exit-Code.
 */
async function validateCommand(sourcePath: string): Promise<number> {
  const source = await readLimitedUtf8File(sourcePath, MAX_SOURCE_BYTES, 'Pseudo2-Abgabe');
  const analysis = await analyzeSource(source, basename(sourcePath));
  const sourceName = basename(sourcePath);
  for (const diagnostic of analysis.diagnostics) {
    const line = formatDiagnostic(diagnostic, sourceName);
    if (diagnostic.severity === 'error') {
      console.error(line);
    } else {
      console.warn(line);
    }
  }
  if (!analysis.program) {
    return EXIT_VALIDATION;
  }
  console.log(`Pseudo2 validation OK: ${sourceName}`);
  return 0;
}

/**
 * Validiert, generiert und startet eine einzelne Pseudo2-Datei.
 *
 * @param sourcePath Pfad zur Pseudo2-Datei.
 * @returns Prozess-Exit-Code des VPL-Runners.
 */
async function runCommand(sourcePath: string): Promise<number> {
  const source = await readLimitedUtf8File(sourcePath, MAX_SOURCE_BYTES, 'Pseudo2-Abgabe');
  const analysis = await analyzeSource(source, basename(sourcePath));
  for (const diagnostic of analysis.diagnostics) {
    const line = formatDiagnostic(diagnostic, basename(sourcePath));
    if (diagnostic.severity === 'error') {
      console.error(line);
    } else {
      console.warn(line);
    }
  }
  if (!analysis.program) {
    return EXIT_VALIDATION;
  }

  const timeoutMs = readEnvironmentTimeout();
  const execution = await executeProgram(analysis.program, dirname(sourcePath), timeoutMs);
  if (execution.stdout.length > 0) {
    process.stdout.write(execution.stdout);
  }
  if (!executionSucceeded(execution)) {
    console.error(describeExecutionFailure(execution, timeoutMs));
    return EXIT_EXECUTION;
  }
  if (execution.stderr.length > 0) {
    process.stderr.write(`${execution.stderr}\n`);
  }
  return 0;
}

/**
 * Bewertet eine Abgabe anhand einer JSON-Aufgabenkonfiguration.
 *
 * Parser- und Validatorfehler sind regulaere studentische Ergebnisse und
 * erzeugen daher eine VPL-Bewertung mit Note 0 statt eines technischen Abbruchs.
 *
 * @param sourcePath Pfad zur studentischen Pseudo2-Datei.
 * @param manifestPath Pfad zur Bewertungsdatei.
 * @returns 0 bei abgeschlossener Bewertung oder Konfigurations-Exit-Code.
 */
async function evaluateCommand(sourcePath: string, manifestPath: string): Promise<number> {
  const [source, manifest] = await Promise.all([
    readLimitedUtf8File(sourcePath, MAX_SOURCE_BYTES, 'Pseudo2-Abgabe'),
    loadManifest(manifestPath)
  ]);
  const sourceName = basename(sourcePath);
  const baseAnalysis = await analyzeSource(source, sourceName);
  const errors = baseAnalysis.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  if (!baseAnalysis.program || errors.length > 0) {
    printValidationFailure(manifest.title, baseAnalysis.diagnostics, sourceName);
    return 0;
  }

  const warnings = baseAnalysis.diagnostics.filter(diagnostic => diagnostic.severity !== 'error');
  const results = await runAssignmentTests(source, resolve(sourcePath), manifest);
  printEvaluation(manifest, results, warnings, sourceName);
  return 0;
}

/**
 * Liest ein optionales Laufzeitlimit aus `PSEUDO2_TIMEOUT_MS`.
 *
 * @returns Geprueftes Zeitlimit oder der Standardwert.
 */
function readEnvironmentTimeout(): number {
  const raw = process.env.PSEUDO2_TIMEOUT_MS;
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new Error(
      `PSEUDO2_TIMEOUT_MS muss ganzzahlig zwischen ${MIN_TIMEOUT_MS} und ${MAX_TIMEOUT_MS} liegen.`
    );
  }
  return value;
}

/** Gibt die verfuegbaren Befehle und die benoetigte Node-Version aus. */
function printHelp(): void {
  console.log(`Pseudo2 VPL runner

Usage:
  pseudo2-vpl.mjs validate <source.pseudo2>
  pseudo2-vpl.mjs run <source.pseudo2>
  pseudo2-vpl.mjs evaluate <source.pseudo2> <assignment.json>

Environment:
  PSEUDO2_TIMEOUT_MS  Timeout for "run" (${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} ms)

Requires Node.js >= 20.10.0.`);
}

/** Prueft die fuer Langium erforderliche minimale Node-Version. */
function requireSupportedNodeVersion(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 10)) {
    throw new Error(`Node.js >= 20.10.0 ist erforderlich; gefunden wurde ${process.versions.node}.`);
  }
}

/**
 * Verteilt Kommandozeilenargumente auf Validierung, Ausfuehrung und Bewertung.
 *
 * @param arguments_ Argumente ohne Node- und Skriptpfad.
 * @returns Gewuenschter Prozess-Exit-Code.
 */
async function main(arguments_: string[]): Promise<number> {
  requireSupportedNodeVersion();
  const [command, ...argumentsAfterCommand] = arguments_;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return 0;
  }
  if (command === '--version' || command === '-v') {
    console.log('pseudo2-vpl 0.0.1');
    return 0;
  }
  if (command === 'validate' && argumentsAfterCommand.length === 1) {
    return validateCommand(resolve(argumentsAfterCommand[0]));
  }
  if (command === 'run' && argumentsAfterCommand.length === 1) {
    return runCommand(resolve(argumentsAfterCommand[0]));
  }
  if (command === 'evaluate' && argumentsAfterCommand.length === 2) {
    return evaluateCommand(resolve(argumentsAfterCommand[0]), resolve(argumentsAfterCommand[1]));
  }

  printHelp();
  return EXIT_USAGE;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Pseudo2 VPL error: ${message}`);
  process.exitCode = process.argv[2] === 'evaluate' ? EXIT_CONFIGURATION : EXIT_USAGE;
}
