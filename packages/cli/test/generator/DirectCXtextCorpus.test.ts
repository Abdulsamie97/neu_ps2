/**
 * @file DirectCXtextCorpus.test.ts
 * @brief Kompiliert und verifiziert den Beispielkorpus einschliesslich der Xtext-Dateien.
 *
 * Die Suite verwendet echte lokale Werkzeuge: Alle ausfuehrbaren Direct-C-Dateien
 * werden in kleinen Batches vom erkannten C-Compiler uebersetzt. Jede unterstuetzte
 * Vertragsvariante wird separat an das im Repository enthaltene VeriFast uebergeben.
 * Dadurch prueft der Test nicht nur Generatorstrings, sondern die erzeugten Artefakte.
 *
 * @author Abdul
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { EmptyFileSystem, URI } from 'langium';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  createPseudo2Services,
  generateDirectCProgramWithSourceMap,
  generateProgram,
  type Program
} from 'pseudo2-language';
import { resolveCCompiler, type CCompiler } from '../../src/c-runner.js';
import { runVeriFast } from '../../src/verifast.js';

/** Wurzel aller in das Langium-Repository portierten Beispiele. */
const EXAMPLES_ROOT = fileURLToPath(new URL('../../../../examples', import.meta.url));
/** Repository-lokale, fuer reproduzierbare Tests verwendete VeriFast-Installation. */
const VERIFAST_EXE = path.join(process.cwd(), 'verifast-26.01', 'bin', 'verifast.exe');

/** Beispiele, deren mathematische Division oder Potenz noch ein Rationalmodell benoetigt. */
const FRACTIONAL_CONTRACT_EXAMPLES = new Set([
  'codeSnippets/landingPageDoc/multipleVars_gobalBlock.pseudo2',
  'codeSnippets/landingPageDoc/multipleVars_ifThenBlock.pseudo2',
  'lectureWS1920/lect05/bin_search.pseudo2',
  'lectureWS1920/lect05/merge_sort.pseudo2',
  'lectureWS1920/lect05/merge_sortV2.pseudo2',
  'lectureWS1920/lect09/treeAddElementPrint.pseudo2',
  'lectureWS1920/lect09/visit.pseudo2',
  'serverExamples/arithmetic/sieveEratosthenes.pseudo2',
  'serverExamples/basicLanguageConcepts/021_datastructure_primitive.pseudo2',
  'serverExamples/basicLanguageConcepts/06_predefined_operators.pseudo2',
  'serverExamples/misc/towerOfHanoi.pseudo2',
  'serverExamples/searching/binarySearch.pseudo2',
  'serverExamples/sorting/mergeSort.pseudo2',
  'test.pseudo2',
  'test2.pseudo2'
]);

/** Alte Beispiele, die im dokumentierten Kompatibilitaetsprofil bereits beweisbar sind. */
const VERIFIED_REGULAR_COMPATIBILITY_EXAMPLES = new Set([
  'codeSnippets/landingPageDoc/multipleVars_WhileBlock.pseudo2',
  'codeSnippets/quickTestingSnippets/array.pseudo2',
  'codeSnippets/quickTestingSnippets/throw.pseudo2',
  'lectureWS1920/lect08/datum.pseudo2',
  'serverExamples/arithmetic/addByPlusMinus.pseudo2',
  'serverExamples/arithmetic/euclid.pseudo2',
  'serverExamples/basicLanguageConcepts/01_var.pseudo2',
  'serverExamples/basicLanguageConcepts/031_loop_for.pseudo2',
  'serverExamples/basicLanguageConcepts/032_loop_while.pseudo2',
  'serverExamples/basicLanguageConcepts/04_if_then_else.pseudo2',
  'test1.pseudo2',
  'verifast_annotations.pseudo2'
]);

/** Positive VeriFast-Beispiele, die nur ohne C-Overflow-Pruefung abgeschlossen werden. */
const RELAXED_OVERFLOW_EXAMPLES = new Set([
  'verifast/valid_do_invariant_true.pseudo2',
  'verifast/valid_model_for_dynamic_invariant.pseudo2'
]);

/** Positive Modellbeispiele, die im Direct-C-Modus das noch fehlende Rationalmodell benoetigen. */
const RATIONAL_MODEL_EXAMPLES = new Set([
  'verifast/valid_model_arithmetic.pseudo2',
  'verifast/valid_model_real_division.pseudo2'
]);

/** Endliche Xtext-Beispiele mit bereits dokumentierter JavaScript-Ausgabe. */
const EXECUTABLE_PARITY_EXAMPLES = new Set([
  'serverExamples/arithmetic/fibonacci.pseudo2',
  'serverExamples/arithmetic/sieveEratosthenes.pseudo2',
  'serverExamples/basicLanguageConcepts/01_var.pseudo2',
  'serverExamples/basicLanguageConcepts/021_datastructure_primitive.pseudo2',
  'serverExamples/basicLanguageConcepts/022_datastructure_array.pseudo2',
  'serverExamples/basicLanguageConcepts/023_datastructure_struct.pseudo2',
  'serverExamples/basicLanguageConcepts/031_loop_for.pseudo2',
  'serverExamples/basicLanguageConcepts/032_loop_while.pseudo2',
  'serverExamples/basicLanguageConcepts/04_if_then_else.pseudo2',
  'serverExamples/basicLanguageConcepts/05_function.pseudo2',
  'serverExamples/basicLanguageConcepts/06_predefined_operators.pseudo2',
  'serverExamples/linkedList/doublyLinkedList.pseudo2',
  'serverExamples/linkedList/linkedListCreatedAutomatically.pseudo2',
  'serverExamples/linkedList/linkedListCreatedManually.pseudo2',
  'serverExamples/linkedList/stackAsSinglyLinkedList.pseudo2',
  'serverExamples/queueAndStack/applicationStackForHTMLProcessing.pseudo2',
  'serverExamples/queueAndStack/queueAsArray.pseudo2',
  'serverExamples/queueAndStack/queueAsArrayImplementedAsADT.pseudo2',
  'serverExamples/queueAndStack/queueAsArrayWithoutContraction.pseudo2',
  'serverExamples/queueAndStack/queueAsRingBuffer.pseudo2',
  'serverExamples/queueAndStack/stackAsArray.pseudo2',
  'serverExamples/queueAndStack/stackAsArrayImplementedAsADT.pseudo2',
  'serverExamples/searching/binarySearch.pseudo2',
  'serverExamples/searching/linearSearch.pseudo2',
  'serverExamples/sorting/insertionSort.pseudo2',
  'serverExamples/sorting/mergeSort.pseudo2',
  'serverExamples/sorting/selectionSort.pseudo2',
  'serverExamples/tree/binaryTreeCreatedAutomatically.pseudo2'
]);

/** Einzelne, bereits geparste Pseudo2-Datei des Korpustests. */
type CorpusProgram = {
  /** Relativer Pfad fuer stabile Testdiagnosen. */
  relativePath: string;
  /** Vollstaendiger Pseudo2-Quelltext. */
  source: string;
  /** Validiertes AST-Programm. */
  program: Program;
};

/** Fehler eines konkreten Compiler- oder Verifikationslaufs. */
type CorpusFailure = {
  /** Relativer Pseudo2-Dateipfad. */
  file: string;
  /** Kompakte, fuer Testausgaben geeignete Fehlermeldung. */
  message: string;
};

/** Fuer alle Tests einmalig geparster Beispielbestand. */
let corpus: CorpusProgram[] = [];
/** Temporaeres Verzeichnis fuer erzeugte C- und Objektdateien. */
let tempDir = '';

/** Bereitet den validierten Korpus und ein isoliertes Buildverzeichnis vor. */
beforeAll(async () => {
  corpus = await loadExampleCorpus();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo2-direct-xtext-corpus-'));
}, 60_000);

/** Entfernt unabhaengig vom Testergebnis alle temporaeren C-Artefakte. */
afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Integrationssuite fuer Compiler und VeriFast auf dem kompletten Xtext-Bestand. */
describe('Direct C example corpus tools', () => {
  test('compiles all 202 executable Direct-C example translations', () => {
    const compiler = resolveCCompiler();
    if (!compiler) return;

    const sourceFiles = corpus.map((entry, index) => {
      const generated = generateDirectCProgramWithSourceMap(entry.program, { runtime: 'implementation' });
      const file = path.join(tempDir, `${String(index).padStart(3, '0')}.c`);
      fs.writeFileSync(file, generated.code, 'utf8');
      return file;
    });

    const failures = compileInBatches(compiler, sourceFiles, tempDir);
    expect(failures).toEqual([]);
  }, 180_000);

  test('executes all 28 documented Xtext programs with JavaScript-equivalent output', async () => {
    const compiler = resolveCCompiler();
    if (!compiler) return;

    const examples = corpus.filter(entry => EXECUTABLE_PARITY_EXAMPLES.has(entry.relativePath));
    const failures: CorpusFailure[] = [];
    for (const [index, entry] of examples.entries()) {
      const generated = generateDirectCProgramWithSourceMap(entry.program, { runtime: 'implementation' });
      const sourceFile = path.join(tempDir, `run-${String(index).padStart(3, '0')}.c`);
      fs.writeFileSync(sourceFile, generated.code, 'utf8');
      const native = compileAndRunOne(compiler, sourceFile, index, tempDir);
      const expected = executeGeneratedJavaScript(generateProgram(entry.program));
      const actual = normalizeOutput(native.stdout);
      if (!native.ok || actual !== expected) {
        failures.push({
          file: entry.relativePath,
          message: native.message || `expected '${expected}', received '${actual}'`
        });
      }
      await yieldToEventLoop();
    }

    expect(examples).toHaveLength(28);
    expect(failures).toEqual([]);
  }, 300_000);

  test('runs VeriFast for every contract-supported regular example and preserves the proof baseline', async () => {
    if (!fs.existsSync(VERIFAST_EXE)) return;

    const regularCorpus = corpus.filter(entry => isRegularExample(entry.relativePath));
    const verifiable = regularCorpus.filter(entry => !FRACTIONAL_CONTRACT_EXAMPLES.has(entry.relativePath));
    const failures = await mapConcurrent(verifiable, 4, async (entry, index): Promise<CorpusFailure | undefined> => {
      const generated = generateDirectCProgramWithSourceMap(entry.program, { runtime: 'contracts' });
      const file = path.join(tempDir, `vf-${String(index).padStart(3, '0')}.c`);
      fs.writeFileSync(file, generated.code, 'utf8');
      const result = await runVeriFast({
        verifastExe: VERIFAST_EXE,
        file,
        compileOnly: true,
        timeoutMs: 10_000,
        extraArgs: [
          '-disable_overflow_check',
          '-allow_dead_code',
          '-assume_left_to_right_evaluation'
        ]
      });
      if (result.ok) return undefined;
      return {
        file: entry.relativePath,
        message: compactVeriFastFailure(result.stdout, result.stderr, result.timedOut)
      };
    });

    const verified = verifiable
      .filter((_entry, index) => failures[index] === undefined)
      .map(entry => entry.relativePath);
    const proofFailures = failures.filter((failure): failure is CorpusFailure => failure !== undefined);

    expect(verifiable).toHaveLength(76);
    expect(verified).toEqual([...VERIFIED_REGULAR_COMPATIBILITY_EXAMPLES].sort((left, right) => left.localeCompare(right)));
    expect(proofFailures).toHaveLength(64);
    expect(proofFailures.every(failure => failure.message.length > 0)).toBe(true);
    expect(proofFailures.filter(failure => failure.message === 'VeriFast timeout').map(failure => failure.file))
      .toEqual(['serverExamples/misc/sudoku.pseudo2']);
  }, 300_000);

  test('strictly verifies every supported positive VeriFast example with Direct C', async () => {
    if (!fs.existsSync(VERIFAST_EXE)) return;

    const validExamples = corpus.filter(entry => entry.relativePath.startsWith('verifast/valid_'));
    const strictExamples = validExamples
      .filter(entry => !RELAXED_OVERFLOW_EXAMPLES.has(entry.relativePath))
      .filter(entry => !RATIONAL_MODEL_EXAMPLES.has(entry.relativePath));
    const failures = await verifyEntries(strictExamples, 'valid-strict');

    expect(validExamples).toHaveLength(48);
    expect(strictExamples).toHaveLength(44);
    expect(failures.filter((failure): failure is CorpusFailure => failure !== undefined)).toEqual([]);
  }, 300_000);

  test('verifies the two documented overflow-relaxed positive examples', async () => {
    if (!fs.existsSync(VERIFAST_EXE)) return;

    const examples = corpus.filter(entry => RELAXED_OVERFLOW_EXAMPLES.has(entry.relativePath));
    const strictFailures = await verifyEntries(examples, 'valid-overflow-strict');
    const relaxedFailures = await verifyEntries(examples, 'valid-overflow-relaxed', ['-disable_overflow_check']);

    expect(examples).toHaveLength(2);
    expect(strictFailures.filter((failure): failure is CorpusFailure => failure !== undefined))
      .toHaveLength(2);
    expect(relaxedFailures.filter((failure): failure is CorpusFailure => failure !== undefined))
      .toEqual([]);
  }, 120_000);

  test('keeps the two rational-model boundaries explicit and source-specific', () => {
    const examples = corpus.filter(entry => RATIONAL_MODEL_EXAMPLES.has(entry.relativePath));
    const failures = examples.map(entry => {
      try {
        generateDirectCProgramWithSourceMap(entry.program, { runtime: 'contracts' });
        return undefined;
      } catch (error) {
        return { file: entry.relativePath, message: formatError(error) };
      }
    });

    expect(examples).toHaveLength(2);
    expect(failures.every(failure => failure?.message.includes('Gleitkomma-/Rationalmodell'))).toBe(true);
  });

  test('rejects all 49 intentionally invalid VeriFast examples in Direct-C mode', async () => {
    if (!fs.existsSync(VERIFAST_EXE)) return;

    const invalidExamples = corpus.filter(entry => entry.relativePath.startsWith('verifast/invalid_'));
    const outcomes = await verifyEntries(invalidExamples, 'invalid');
    const unexpectedSuccesses = invalidExamples
      .filter((_entry, index) => outcomes[index] === undefined)
      .map(entry => entry.relativePath);

    expect(invalidExamples).toHaveLength(49);
    expect(unexpectedSuccesses).toEqual([]);
    expect(outcomes.filter((failure): failure is CorpusFailure => failure !== undefined)).toHaveLength(49);
  }, 300_000);

  test('verifies all dedicated Direct-C examples', async () => {
    if (!fs.existsSync(VERIFAST_EXE)) return;

    const examples = corpus.filter(entry => path.basename(entry.relativePath).startsWith('direct-c-'));
    const failures = await verifyEntries(examples, 'direct');

    expect(examples).toHaveLength(14);
    expect(failures.filter((failure): failure is CorpusFailure => failure !== undefined)).toEqual([]);
  }, 180_000);
});

/**
 * Liest, validiert und typisiert den vollstaendigen Beispielbestand.
 * @returns Stabil sortierte Liste aller 202 gueltigen AST-Programme.
 */
async function loadExampleCorpus(): Promise<CorpusProgram[]> {
  const files = collectPseudo2Files(EXAMPLES_ROOT)
    .sort((left, right) => left.localeCompare(right));
  const programs: CorpusProgram[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.trim()) continue;
    const services = createPseudo2Services(EmptyFileSystem);
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.file(file));
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
    const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
    if (errors.length > 0) {
      throw new Error(`${relativeExamplePath(file)}: ${errors.map(error => error.message).join(' | ')}`);
    }
    programs.push({
      relativePath: relativeExamplePath(file),
      source,
      program: document.parseResult.value as Program
    });
  }

  expect(programs).toHaveLength(202);
  return programs;
}

/**
 * Erkennt die 91 regulaeren Beispiele: 87 Xtext-Portierungen und vier Basisdateien.
 * @param relativePath Relativer Pfad innerhalb des Beispielverzeichnisses.
 * @returns `true`, wenn die Datei weder zur neuen Direct-C- noch zur VeriFast-Suite gehoert.
 */
function isRegularExample(relativePath: string): boolean {
  return !relativePath.startsWith('verifast/') && !path.basename(relativePath).startsWith('direct-c-');
}

/**
 * Erzeugt und verifiziert mehrere Vertragsvarianten mit begrenzter Parallelitaet.
 *
 * Auch Generatorablehnungen werden als dateibezogene Verifikationsergebnisse
 * zurueckgegeben. Dadurch kann die Negativsuite sowohl erwartete statische Grenzen
 * als auch echte VeriFast-Gegenbeispiele ohne Ausnahmen pruefen.
 *
 * @param entries Zu verifizierende, bereits validierte Programme.
 * @param prefix Eindeutiger Dateinamenspraefix im temporaeren Verzeichnis.
 * @param extraArgs Zusaetzliche VeriFast-Schalter fuer den konkreten Testmodus.
 * @returns Positionsgleiche Liste; `undefined` kennzeichnet einen erfolgreichen Beweis.
 */
async function verifyEntries(
  entries: CorpusProgram[],
  prefix: string,
  extraArgs: string[] = []
): Promise<Array<CorpusFailure | undefined>> {
  return await mapConcurrent(entries, 4, async (entry, index): Promise<CorpusFailure | undefined> => {
    try {
      const generated = generateDirectCProgramWithSourceMap(entry.program, { runtime: 'contracts' });
      const file = path.join(tempDir, `${prefix}-${String(index).padStart(3, '0')}.c`);
      fs.writeFileSync(file, generated.code, 'utf8');
      const result = await runVeriFast({
        verifastExe: VERIFAST_EXE,
        file,
        compileOnly: true,
        timeoutMs: 10_000,
        extraArgs
      });
      if (result.ok) return undefined;
      return {
        file: entry.relativePath,
        message: compactVeriFastFailure(result.stdout, result.stderr, result.timedOut)
      };
    } catch (error) {
      return { file: entry.relativePath, message: formatError(error) };
    }
  });
}

/**
 * Kompiliert C-Dateien gebuendelt ohne Linkschritt und sammelt Batchfehler.
 *
 * Mehrere Quellen pro Compilerprozess halten den Volltest auch mit der relativ
 * teuren Visual-Studio-Umgebung schnell. Eindeutige Dateinamen verhindern dabei
 * Kollisionen der erzeugten Objektdateien.
 *
 * @param compiler Erkannter GNU-kompatibler oder MSVC-Compiler.
 * @param files Zu uebersetzende C-Dateien.
 * @param outputRoot Temporaeres Stammverzeichnis fuer Objektdateien.
 * @returns Kompakte Fehlerliste; eine leere Liste bedeutet vollstaendige Kompilierbarkeit.
 */
function compileInBatches(compiler: CCompiler, files: string[], outputRoot: string): CorpusFailure[] {
  const failures: CorpusFailure[] = [];
  const batchSize = 12;

  for (let offset = 0; offset < files.length; offset += batchSize) {
    const batch = files.slice(offset, offset + batchSize);
    const objectDir = path.join(outputRoot, `objects-${offset}`);
    fs.mkdirSync(objectDir, { recursive: true });
    const args = compiler.kind === 'msvc'
      ? ['/nologo', '/TC', '/W3', '/c', ...batch, `/Fo${objectDir}${path.sep}`]
      : ['-std=c11', '-Wall', '-Wextra', '-c', ...batch];
    const result = spawnSync(compiler.command, args, {
      cwd: objectDir,
      env: compiler.env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.status !== 0 || result.error) {
      failures.push({
        file: `batch ${offset / batchSize + 1}`,
        message: compactProcessFailure(result.stdout, result.stderr, result.error)
      });
    }
  }

  return failures;
}

/**
 * Kompiliert und startet eine einzelne Direct-C-Datei mit der bereits erkannten Toolchain.
 *
 * Anders als der allgemeine CLI-Runner wird die teure Visual-Studio-Erkennung nicht
 * fuer jedes Korpusbeispiel wiederholt. Compiler- und Programmlauf besitzen eigene
 * Zeitlimits sowie begrenzte Ausgabepuffer.
 *
 * @param compiler Einmalig erkannte und vollstaendig konfigurierte C-Toolchain.
 * @param sourceFile Absoluter Pfad zur erzeugten C-Datei.
 * @param index Eindeutiger Index fuer Objekt- und Programmdateien.
 * @param outputRoot Temporaeres Buildverzeichnis.
 * @returns Laufstatus, Standardausgabe und gegebenenfalls kompakte Fehlerdiagnose.
 */
function compileAndRunOne(
  compiler: CCompiler,
  sourceFile: string,
  index: number,
  outputRoot: string
): { ok: boolean; stdout: string; message?: string } {
  const suffix = String(index).padStart(3, '0');
  const executable = path.join(outputRoot, process.platform === 'win32' ? `run-${suffix}.exe` : `run-${suffix}`);
  const objectFile = path.join(outputRoot, `run-${suffix}.obj`);
  const compileArgs = compiler.kind === 'msvc'
    ? ['/nologo', '/TC', '/std:c11', sourceFile, `/Fo:${objectFile}`, `/Fe:${executable}`]
    : ['-std=c11', '-O0', sourceFile, '-o', executable, '-lm'];
  const compiled = spawnSync(compiler.command, compileArgs, {
    cwd: outputRoot,
    env: compiler.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (compiled.status !== 0 || compiled.error) {
    return {
      ok: false,
      stdout: '',
      message: compactProcessFailure(compiled.stdout, compiled.stderr, compiled.error)
    };
  }

  const executed = spawnSync(executable, [], {
    cwd: outputRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (executed.status !== 0 || executed.error) {
    return {
      ok: false,
      stdout: executed.stdout ?? '',
      message: compactProcessFailure(executed.stdout, executed.stderr, executed.error)
    };
  }
  return { ok: true, stdout: executed.stdout ?? '' };
}

/**
 * Fuehrt das vorhandene JavaScript-Backend als semantische Referenz aus.
 * @param code Vollstaendiger, vom Pseudo2-JavaScript-Generator erzeugter Quelltext.
 * @returns Auf eine Zeile normalisierte Konsolenausgabe.
 */
function executeGeneratedJavaScript(code: string): string {
  const output: string[] = [];
  vm.runInNewContext(code, {
    console: {
      log: (...values: unknown[]) => output.push(values.map(value => String(value)).join(' '))
    }
  }, { timeout: 10_000 });
  return normalizeOutput(output.join(' '));
}

/**
 * Vereinheitlicht Zeilenumbrueche und sonstige Zwischenraeume fuer Backendvergleiche.
 * @param output Rohe C- oder JavaScript-Konsolenausgabe.
 * @returns Getrimmte Ausgabe mit genau einem Leerzeichen zwischen Tokens.
 */
function normalizeOutput(output: string): string {
  return output.replace(/\s+/g, ' ').trim();
}

/**
 * Gibt Vitests Worker-RPC zwischen synchronen Compilerprozessen Rechenzeit.
 *
 * MSVC kann die 28 Einzelprogramme auf ausgelasteten Rechnern langsamer bauen.
 * Ohne diesen Yield bleibt der Worker dabei laenger als das RPC-Heartbeat-Limit
 * blockiert, obwohl alle Compiler- und Programmlaeufe erfolgreich abschliessen.
 *
 * @returns Promise, das im naechsten Event-Loop-Durchlauf abgeschlossen wird.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/**
 * Verarbeitet Elemente mit begrenzter Parallelitaet und erhaelt ihre Eingabereihenfolge.
 * @param values Zu verarbeitende Werte.
 * @param concurrency Maximale Zahl gleichzeitig laufender Prozesse.
 * @param worker Asynchrone Verarbeitung eines Werts und seines Index.
 * @returns Ergebnisliste in derselben Reihenfolge wie `values`.
 */
async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await worker(values[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => runWorker()));
  return results;
}

/**
 * Sammelt rekursiv alle Pseudo2-Dateien eines Verzeichnisses.
 * @param dir Aktuell zu durchsuchendes Verzeichnis.
 * @returns Absolut aufgeloeste Pseudo2-Dateien.
 */
function collectPseudo2Files(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectPseudo2Files(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.pseudo2')) files.push(fullPath);
  }
  return files;
}

/**
 * Liefert den stabilen relativen Pfad einer Beispieldatei.
 * @param file Absoluter Pfad unterhalb von `examples`.
 * @returns Relativer Pfad mit Vorwaertsschraegen.
 */
function relativeExamplePath(file: string): string {
  return path.relative(EXAMPLES_ROOT, file).replace(/\\/g, '/');
}

/**
 * Verdichtet Compilerdiagnosen auf eine lesbare, begrenzte Meldung.
 * @param stdout Standardausgabe des Compilers.
 * @param stderr Fehlerausgabe des Compilers.
 * @param error Optionaler Prozessstartfehler.
 * @returns Getrimmte Diagnose ohne unbeschraenkte Folgeausgabe.
 */
function compactProcessFailure(stdout: string, stderr: string, error?: Error): string {
  return (error?.message || stderr || stdout || 'C compilation failed.').trim().slice(0, 4_000);
}

/**
 * Verdichtet ein fehlgeschlagenes VeriFast-Ergebnis fuer Vitest-Diffs.
 * @param stdout VeriFast-Standardausgabe.
 * @param stderr VeriFast-Fehlerausgabe.
 * @param timedOut Kennzeichnet einen durch das Testzeitlimit beendeten Lauf.
 * @returns Erste aussagekraeftige VeriFast-Zeile oder Timeoutmeldung.
 */
function compactVeriFastFailure(stdout: string, stderr: string, timedOut?: boolean): string {
  if (timedOut) return 'VeriFast timeout';
  const text = `${stdout}\n${stderr}`.trim();
  return text.split(/\r?\n/).find(line => /\berror:|Cannot prove|Potential arithmetic overflow/i.test(line))
    ?? text.slice(0, 1_000)
    ?? 'VeriFast failed.';
}

/**
 * Wandelt beliebige geworfene Generatorwerte in eine stabile Meldung um.
 * @param error Geworfener Fehler oder sonstiger Wert.
 * @returns Fehlertext ohne Stacktrace.
 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
